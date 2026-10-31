/**
 * وحدة الخوارزميات المساعدة الذكية لقراءة وتصحيح أوراق جرد أسمو (SAP Inventory Controller Assistive Engine)
 * 1. خوارزمية تصحيح البادئة البصرية لأرقام مواد SAP (normalizeSapMaterialPrefix):
 *    - تصحيح الأخطاء البصرية في خانات البادئة (1000 / 1001 / 1002 / 1015) مثل I00, l00, |00, T00, 700, 1OO, 10O, 000 -> 1000
 *    - استخراج الـ 10 أرقام الكاملة حتى لو التصق بها رقم التسلسل (#) أو رمز الوحدة (EA/PK) أو خط الجدول (|)
 * 2. خوارزمية التصحيح وتنعيم الساندويتش السياقي للمواقع (resolveSheetLocationsWithContext):
 *    - تصحيح الأخطاء الشائعة في رموز المواقع مثل (NO1B2 -> N01B2) و (N01FLI -> N01FL1) و (N11DI -> N11D1)
 *    - تنعيم الساندويتش السياقي (Sandwich Context Smoothing): إذا كان السطر السابق والسطر اللاحق يحملان نفس الموقع بينما السطر الأوسط مطموس أو مشوه بسبب علامة القلم، يرث الموقع الصحيح تلقائياً
 *    - دعم موقع القطع الثقيلة (D / D1 / D2 / N11D1 / N16D1) ومنع إدخال موقع "عام" نهائياً
 * 3. خوارزمية التمييز المرن لعلامات اليد (✓ صح = موجودة | × خطأ = غير موجودة)
 */

export interface SanitizedPartData {
  part_number: string;
  location_code: string;
  description_en: string;
  qty_total: number;
  qty_out: number;
  qty_remaining: number;
  is_missing: number;
  remark?: string;
  isValid: boolean;
}

const LOCATION_CACHE = new Map<string, string>();

/**
 * تحويل الحروف المشوهة في الأرقام (Char-to-Digit Mapper)
 */
export function charToDigitMapper(
  raw: string | number | null | undefined,
  defaultValue: number = 0
): number {
  if (raw === null || raw === undefined) return defaultValue;
  if (typeof raw === 'number') {
    return isNaN(raw) ? defaultValue : Math.max(0, Math.floor(raw));
  }

  const str = String(raw)
    .trim()
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!tTrR]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Gg]/g, '6')
    .replace(/[q]/g, '9');

  const digitsOnly = str.replace(/[^0-9]/g, '');
  if (!digitsOnly) return defaultValue;

  const parsed = parseInt(digitsOnly, 10);
  return isNaN(parsed) ? defaultValue : Math.max(0, parsed);
}

/**
 * خوارزمية تصحيح البادئة البصرية لأرقام مواد SAP (normalizeSapMaterialPrefix)
 * تعالج تشوهات OCR في بداية رقم القطعة المكون من 10 أرقام (مثل I00, l00, |00, T00, 700, 1OO, 10O, 000xxxx)
 */
export function normalizeSapMaterialPrefix(raw: string | null | undefined): string {
  if (!raw) return '';
  let token = String(raw)
    .trim()
    .replace(/^[|\[\]()—\-~_]+|[|\[\]()—\-~_]+$/g, '')
    .replace(/(?:C006|M016|D04D|002)$/i, '');

  token = token
    .replace(/^[Il|!tTrR7]([0OoQD]{2})/i, '1$1')
    .replace(/^1[OoQD]([0OoQD])/i, '10$1')
    .replace(/^10[OoQD]/i, '100')
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!tTrR]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/[Gg]/g, '6')
    .replace(/[Bb]/g, '8')
    .replace(/[q]/g, '9');

  const digits = token.replace(/[^0-9]/g, '');
  if (/^00[012]\d{6}$/.test(digits)) {
    return `1${digits}`;
  }
  if (/^[47]00[012]\d{6}$/.test(digits)) {
    return `1${digits.slice(1)}`;
  }
  return digits;
}

/**
 * 1. خوارزمية المطابقة الصارمة لرقم القطعة (Strict 10-Digit SAP Material Filter)
 */
export function strict10DigitRegexFilter(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  return /^\d{10}$/.test(value) ? value : null;
}

/**
 * إصلاح ذكي لرقم القطعة المكون من 10 أرقام يبدأ بـ 100 أو 101 من مخرجات القراءة البصرية
 */
export function repair10DigitMaterialCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (/^\d{10}$/.test(trimmed)) return trimmed;

  // 1. فحص وجود 10 أرقام صحيحة تبدأ بـ 100 أو 101 حتى لو التصقت بخط جدول (|) أو كود مصنع
  const directGlued = trimmed.match(/(?:^|[^0-9])(10[01]\d{7})(?=[^0-9]|$)/);
  if (directGlued) return directGlued[1];

  // 2. تطبيق خوارزمية تصحيح البادئة البصرية لأرقام مواد SAP
  const normalizedDigits = normalizeSapMaterialPrefix(trimmed);
  if (/^10[01]\d{7}$/.test(normalizedDigits)) {
    return normalizedDigits;
  }

  const exact10 = normalizedDigits.match(/(10[01]\d{7})/);
  if (exact10) return exact10[1];

  if (/^00\d{7}$/.test(normalizedDigits)) {
    return `1${normalizedDigits}`;
  }

  return null;
}

const FORBIDDEN_LOCATIONS = new Set([
  'عام',
  'موقع عام',
  'بدون موقع',
  'غير محدد',
  'GENERAL',
  'UNKNOWN',
  'NONE',
  'N/A',
  'NULL',
  'UNDEFINED',
  '002',
  '001',
  'C006',
  'M016',
  'D04D',
  'EA',
  'SET',
  'PK',
  'SH',
  'CO',
  'AY',
  'KG',
  'M',
  'L',
  'PAA',
  'ZYD',
  'KIT',
]);

/**
 * فحص هل الموقع حقيقي ومحدد وليس موقعاً عاماً أو فارغاً أو كود مصنع
 */
export function isValidSpecificLocation(loc: string | null | undefined): boolean {
  if (!loc) return false;
  const trimmed = String(loc).trim().toUpperCase();
  if (!trimmed) return false;

  if (trimmed === 'D' || /^D\d{1,3}$/.test(trimmed)) {
    return true;
  }

  if (trimmed.length < 2) return false;
  if (FORBIDDEN_LOCATIONS.has(trimmed)) return false;
  if (trimmed.includes('عام')) return false;

  return /^[A-Z0-9][A-Z0-9\s\/._-]{1,18}$/i.test(trimmed) && /[A-Z]/i.test(trimmed);
}

/**
 * 2. خوارزمية التصحيح الذكي لأسماء المواقع (Smart SAP Storage Bin Normalizer)
 */
export function dynamicLocationNormalizer(raw: string | null | undefined): string {
  if (!raw) return '';
  const rawStr = String(raw).trim();
  if (!rawStr) return '';

  const cached = LOCATION_CACHE.get(rawStr);
  if (cached !== undefined) return cached;

  let cleaned = rawStr.toUpperCase();

  if (cleaned === 'D' || /^D\d{1,3}$/.test(cleaned)) {
    LOCATION_CACHE.set(rawStr, cleaned);
    return cleaned;
  }

  cleaned = cleaned
    .replace(/عام/g, '')
    .replace(/موقع[:\s]*/g, '')
    .replace(/[\[\]\(\)\{\}\=\|\&\~\\\@\#\$\%\^\*\+\?\!\;\:\"\'\`<>]/g, ' ')
    .replace(/\b(002\s*02|0020|002|C006|M016|D04D|STORAGE\s*BIN|BIN|LOC)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    LOCATION_CACHE.set(rawStr, '');
    return '';
  }

  if (cleaned === 'D' || /^D\d{1,3}$/.test(cleaned)) {
    LOCATION_CACHE.set(rawStr, cleaned);
    return cleaned;
  }

  let sapFixed = cleaned
    .replace(/\b([A-Z])[Oo](\d)/g, '$10$2')
    .replace(/\b([A-Z]\d)[Oo]/g, '$10')
    .replace(/\b([A-Z])[Il|](\d)/g, '$11$2')
    .replace(/\b([A-Z]\d)[Il|]([A-Z])/g, '$11$2')
    .replace(/([A-Z]{1,3})[Il|]\b/g, '$11')
    .replace(/([A-Z]{1,3})[Oo]\b/g, '$10')
    .replace(/\b(N\d{2})8([12])\b/g, '$1B$2')
    .replace(/\b(N\d{2})[EB8]1\b/g, '$1B1')
    .replace(/\b(N\d{2})[EB8]2\b/g, '$1B2');

  const splitSapMatch = sapFixed.match(/^([A-Z]\d{2})\s+([A-Z]{1,3}\d{0,2})$/);
  if (splitSapMatch) {
    sapFixed = `${splitSapMatch[1]}${splitSapMatch[2]}`;
  }

  const compactBinMatch = sapFixed.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{0,2})\b/);
  if (compactBinMatch) {
    const candidate = compactBinMatch[1].toUpperCase();
    if (!['C006', 'M016', 'D04D'].includes(candidate)) {
      LOCATION_CACHE.set(rawStr, candidate);
      return candidate;
    }
  }

  const spacedBinMatch3 = sapFixed.match(/\b([A-Z]\d{2}\s+[A-Z0-9]+\s+[A-Z0-9]+)\b/);
  if (spacedBinMatch3) {
    const res = spacedBinMatch3[1].replace(/\s+/g, ' ').trim();
    LOCATION_CACHE.set(rawStr, res);
    return res;
  }

  const spacedBinMatch2 = sapFixed.match(/\b([A-Z]\d{2}\s+[A-Z0-9]+)\b/);
  if (spacedBinMatch2) {
    const res = spacedBinMatch2[1].replace(/\s+/g, ' ').trim();
    LOCATION_CACHE.set(rawStr, res);
    return res;
  }

  if (isValidSpecificLocation(sapFixed)) {
    LOCATION_CACHE.set(rawStr, sapFixed);
    return sapFixed;
  }

  LOCATION_CACHE.set(rawStr, '');
  return '';
}

/**
 * 3. خوارزمية التمييز الذكي لعلامة اليد في عمود Check (✓ صح = موجودة | × خطأ = غير موجودة)
 */
export function detectMissingFromCheckMark(rawItem: any): boolean {
  if (!rawItem) return false;
  if (rawItem.is_missing === true || rawItem.is_missing === 1 || rawItem.is_missing === 'true') {
    return true;
  }
  if (rawItem.status === 'غير موجودة') return true;

  const checkCol = String(
    rawItem.check ?? rawItem.check_mark ?? rawItem.checkMark ?? rawItem.status_mark ?? ''
  )
    .trim()
    .toUpperCase();

  if (!checkCol) return false;

  if (
    checkCol === 'X' ||
    checkCol === '×' ||
    checkCol === '✗' ||
    checkCol === '✘' ||
    checkCol === '✕' ||
    checkCol === '✖' ||
    checkCol === 'CROSS' ||
    checkCol === 'MISSING' ||
    checkCol === 'NOT FOUND' ||
    checkCol === 'FALSE' ||
    checkCol.includes('غير موجود')
  ) {
    return true;
  }

  return false;
}

/**
 * فحص هل الموقع مطابق لنمط SAP القياسي (مثل N13B1, N16D1, N11FL2, D1)
 */
function isStandardSapBinFormat(loc: string): boolean {
  return /^(?:[A-Z]\d{2}[A-Z]{1,3}\d{1,2}|D\d{0,2}|[A-Z]\d{2}\s+[A-Z0-9]+(?:\s+[A-Z0-9]+)?)$/.test(
    loc
  );
}

/**
 * 4. خوارزمية تنعيم الساندويتش السياقي للمواقع (Contextual Sandwich Smoothing & Neighbor Resolver):
 * - تملأ المواقع الفارغة من السطور المجاورة (Forward & Backward Fill).
 * - تنعيم الساندويتش (Sandwich Smoothing): إذا كان السطر (i-1) والسطر (i+1) يحملان نفس الموقع القياسي (مثلاً N16D1)،
 *   وكان السطر الأوسط (i) فارغاً أو يحمل قراءة مشوهة غير قياسية بسبب مرور خط علامة الصح فوق خانة الموقع،
 *   تتم معايرته تلقائياً ليطابق الساندويتش المحيط به.
 */
export function resolveSheetLocationsWithContext<
  T extends { location?: string; location_code?: string }
>(rows: T[]): T[] {
  if (!rows || rows.length === 0) return rows;

  const normalized = rows.map((r) => {
    const rawLoc = r.location_code ?? r.location ?? '';
    const normLoc = dynamicLocationNormalizer(rawLoc);
    return {
      ...r,
      location: normLoc,
      location_code: normLoc,
    };
  });

  // 1. تمريرة الساندويتش السياقي (Sandwich Context Smoothing)
  for (let i = 1; i < normalized.length - 1; i++) {
    const prevLoc = normalized[i - 1].location_code || '';
    const currLoc = normalized[i].location_code || '';
    const nextLoc = normalized[i + 1].location_code || '';

    if (
      prevLoc &&
      prevLoc === nextLoc &&
      isValidSpecificLocation(prevLoc) &&
      (!isValidSpecificLocation(currLoc) || !isStandardSapBinFormat(currLoc))
    ) {
      normalized[i].location = prevLoc;
      normalized[i].location_code = prevLoc;
    }
  }

  // 2. تمريرة للأمام (Forward Fill من السطر السابق في نفس الورقة إذا كان السطر الحالي مطموس الموقع)
  let lastValidLocation = '';
  for (let i = 0; i < normalized.length; i++) {
    const loc = normalized[i].location_code || '';
    if (isValidSpecificLocation(loc)) {
      lastValidLocation = loc;
    } else if (lastValidLocation) {
      normalized[i].location = lastValidLocation;
      normalized[i].location_code = lastValidLocation;
    }
  }

  // 3. تمريرة للخلف (Backward Fill للسطر الأول إذا كان مطموس الموقع والسطر الثاني واضح)
  let nextValidLocation = '';
  for (let i = normalized.length - 1; i >= 0; i--) {
    const loc = normalized[i].location_code || '';
    if (isValidSpecificLocation(loc)) {
      nextValidLocation = loc;
    } else if (nextValidLocation) {
      normalized[i].location = nextValidLocation;
      normalized[i].location_code = nextValidLocation;
    }
  }

  return normalized;
}

/**
 * خط الأنابيب المتكامل لما بعد القراءة والفلترة (Complete Post-Processing Pipeline)
 */
export function applyPostProcessingPipeline(rawItem: {
  part_number?: string | null;
  location?: string | null;
  location_code?: string | null;
  quantity?: number | string | null;
  qty_total?: number | string | null;
  description_en?: string | null;
  is_missing?: boolean | number | null;
  check?: string | null;
  remark?: string | null;
}): {
  isValid: boolean;
  part_number: string;
  location_code: string;
  qty_total: number;
  qty_out: number;
  qty_remaining: number;
  description_en: string;
  is_missing: number;
  remark?: string;
  rejectedReason?: string;
} {
  const rawPart = rawItem.part_number;
  const cleanPart = strict10DigitRegexFilter(rawPart) || repair10DigitMaterialCode(rawPart);
  const cleanLocation = dynamicLocationNormalizer(rawItem.location || rawItem.location_code);
  const isMissing = detectMissingFromCheckMark(rawItem) ? 1 : 0;
  const qtyTotal = Math.max(0, charToDigitMapper(rawItem.quantity ?? rawItem.qty_total, 1));
  const qtyOut = 0;
  const qtyRemaining = isMissing ? 0 : qtyTotal;
  const remark = rawItem.remark ? String(rawItem.remark).trim() : undefined;

  if (!cleanPart) {
    return {
      isValid: false,
      part_number: String(rawPart || '').trim(),
      location_code: cleanLocation,
      qty_total: qtyTotal,
      qty_out: qtyOut,
      qty_remaining: qtyRemaining,
      description_en: String(rawItem.description_en || 'SPARE PART').trim(),
      is_missing: isMissing,
      remark,
      rejectedReason: `رقم القطعة ناقص أو غير مكتمل (${rawPart || 'فارغ'}) — يجب أن يتكون من 10 أرقام كاملة من عمود Material`,
    };
  }

  if (!isValidSpecificLocation(cleanLocation)) {
    return {
      isValid: false,
      part_number: cleanPart,
      location_code: cleanLocation,
      qty_total: qtyTotal,
      qty_out: qtyOut,
      qty_remaining: qtyRemaining,
      description_en: String(rawItem.description_en || 'SPARE PART').trim(),
      is_missing: isMissing,
      remark,
      rejectedReason: `الموقع غير محدد — يجب قراءة رمز الموقع الفعلي من عمود Storage Bin`,
    };
  }

  return {
    isValid: true,
    part_number: cleanPart,
    location_code: cleanLocation,
    qty_total: qtyTotal,
    qty_out: qtyOut,
    qty_remaining: qtyRemaining,
    description_en: String(rawItem.description_en || 'SPARE PART ASMO').trim(),
    is_missing: isMissing,
    remark,
  };
}

export const sanitizePartNumber = (raw: string | null | undefined): string => {
  const filtered = strict10DigitRegexFilter(raw) || repair10DigitMaterialCode(raw);
  if (filtered) return filtered;
  return String(raw || '').replace(/[^0-9]/g, '').trim();
};

export const sanitizeQuantity = charToDigitMapper;
export const sanitizeLocationCode = (raw: string | null | undefined): string => {
  return dynamicLocationNormalizer(raw);
};

export function sanitizeDescription(raw: string | null | undefined): {
  cleaned: string;
  isValid: boolean;
} {
  if (!raw) return { cleaned: 'SPARE PART ASMO', isValid: true };
  let cleaned = String(raw).trim();
  cleaned = cleaned.replace(/[\[\]\(\)\{\}\=\|\&\~\\@#\$\%\^\*\+\?\!\;\`<>_]/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  const valid = cleaned.length >= 2;
  return { cleaned: cleaned || 'SPARE PART ASMO', isValid: valid };
}

export function sanitizeExtractedRow(raw: any): any {
  return applyPostProcessingPipeline(raw);
}

export function extractDynamicLocationFromLine(line: string): string | null {
  if (!line) return null;
  const norm = dynamicLocationNormalizer(line);
  return norm || null;
}
