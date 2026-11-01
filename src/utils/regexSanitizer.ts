/**
 * وحدة الخوارزميات المساعدة الذكية لقراءة وتصحيح أوراق جرد أسمو (SAP Inventory Controller Assistive Engine)
 * مصممة خصيصاً لمساعدة Gemini Vision ومحرك القراءة على تحقيق قراءة سريعة ودقيقة 100%:
 * 1. خوارزمية الإصلاح الذكي لرقم القطعة (Smart 10-Digit Material Auto-Repair):
 *    - استخراج الـ 10 أرقام الكاملة حتى لو التصق بها رقم التسلسل (#) أو رمز الوحدة (EA/PK) أو خط الجدول (|)
 *    - تصحيح الحروف المتشابهة بصرياً (O->0, I/l->1, Z->2, S->5, G->6, B->8)
 *    - تصحيح التباس البادئة في خطوط SAP (1007xxxxxx -> 1001xxxxxx, 1900xxxxxx -> 1000xxxxxx, 1090xxxxxx -> 1000xxxxxx)
 * 2. خوارزمية التصحيح والاستنتاج السياقي للمواقع (Smart Storage Bin Normalizer & Sandwich Context Resolver):
 *    - تصحيح الأخطاء الشائعة في رموز المواقع مثل (NIS8B2 -> N15BB2, NOIAT -> N01A1, N1502 -> N15D2, N1101 -> N11D1)
 *    - استنتاج رمز الموقع تلقائياً من السطور المجاورة وتنعيم التشتت الفردي (Sandwich Smoothing)
 * 3. خوارزمية التمييز المرن لعلامات اليد (✓ صح = موجودة | × خطأ = غير موجودة) والملاحظات (-N)
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
export function charToDigitMapper(raw: string | number | null | undefined, defaultValue: number = 0): number {
  if (raw === null || raw === undefined) return defaultValue;
  if (typeof raw === 'number') {
    return isNaN(raw) ? defaultValue : Math.max(0, Math.floor(raw));
  }

  let str = String(raw).trim();

  str = str
    .replace(/[OoQD°]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$§]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Gg]/g, '6')
    .replace(/[q]/g, '9');

  const digitsOnly = str.replace(/[^0-9]/g, '');
  if (!digitsOnly) return defaultValue;

  const parsed = parseInt(digitsOnly, 10);
  return isNaN(parsed) ? defaultValue : Math.max(0, parsed);
}

/**
 * تصحيح التباس البادئة البصري في أرقام مواد SAP المكونة من 10 أرقام (تبدأ دائماً بـ 1000 أو 1001)
 */
export function normalizeSapMaterialPrefix(code10: string): string {
  if (!/^\d{10}$/.test(code10)) return code10;
  // في جداول SAP، الرقم الرابع في 1001xxxxxx قد يُقرأ 7 أو 4 أو 3 بسبب زاوية خط الرقم 1
  if (/^100[743]\d{6}$/.test(code10)) {
    return `1001${code10.slice(4)}`;
  }
  // قد يُقرأ الصفر الأول أو الثاني كـ 9 (1900/1901 أو 1090/1091)
  if (/^190[01]\d{6}$/.test(code10)) {
    return `100${code10.slice(3)}`;
  }
  if (/^109[01]\d{6}$/.test(code10)) {
    return `100${code10.slice(3)}`;
  }
  if (/^[74]00[01]\d{6}$/.test(code10)) {
    return `1${code10.slice(1)}`;
  }
  return code10;
}

/**
 * 1. خوارزمية المطابقة الصارمة لرقم القطعة (Strict 10-Digit SAP Material Filter)
 */
export function strict10DigitRegexFilter(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  return /^\d{10}$/.test(value) ? value : null;
}

/**
 * إصلاح ذكي لرقم القطعة المكون من 10 أرقام يبدأ بـ 100 من مخرجات القراءة البصرية
 */
export function repair10DigitMaterialCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (/^\d{10}$/.test(trimmed)) return normalizeSapMaterialPrefix(trimmed);

  // 1. فحص وجود 10 أرقام صحيحة تبدأ بـ 100 حتى لو التصقت بخط جدول (|) أو كود مصنع
  const directGlued = trimmed.match(/(?:^|[^0-9])(100\d{7})(?=[^0-9]|$)/);
  if (directGlued) return normalizeSapMaterialPrefix(directGlued[1]);

  // 2. إزالة خطوط الجدول الطرفية (|) قبل تحويل الحروف البصرية المتشابهة
  const strippedPipes = trimmed.replace(/^[|\s]+|[|\s]+$/g, '');
  const mapped = strippedPipes
    .replace(/^(?:aot|aoo|qop|roo|too|190|109)/i, '100')
    .toUpperCase()
    .replace(/[OQD°]/g, '0')
    .replace(/[IL!'"`]/g, '1')
    .replace(/[Z]/g, '2')
    .replace(/[S$§]/g, '5')
    .replace(/[G%]/g, '6')
    .replace(/[B]/g, '8');

  const exact10 = mapped.match(/(?:^|[^0-9])(100\d{7})(?=[^0-9]|$)/);
  if (exact10) return normalizeSapMaterialPrefix(exact10[1]);

  const digitsOnly = mapped.replace(/[^0-9]/g, '');
  if (/^\d{10}$/.test(digitsOnly)) {
    const fixed = normalizeSapMaterialPrefix(digitsOnly);
    if (/^100\d{7}$/.test(fixed)) return fixed;
  }
  // إذا التصق رقم واحد في البداية من خط الجدول العمودي (مثل 71001078850 أو 41001087218)
  if (/^[147]100\d{7}$/.test(digitsOnly)) {
    return normalizeSapMaterialPrefix(digitsOnly.slice(1));
  }
  // ترميم إذا سقط الرقم الأول (1) وبقي 00xxxxxxx (9 أرقام تبدأ بـ 00)
  if (/^00\d{7}$/.test(digitsOnly)) return normalizeSapMaterialPrefix(`1${digitsOnly}`);

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
 * فحص هل الموقع حقيقي ومحدد في مستودع أسمو (SAP Storage Bin) وليس نصاً عشوائياً أو كود مصنع
 */
export function isValidSpecificLocation(loc: string | null | undefined): boolean {
  if (!loc) return false;
  const trimmed = String(loc).trim().toUpperCase();
  if (!trimmed) return false;

  if (trimmed === 'D' || /^D\d{1,3}$/.test(trimmed) || trimmed === 'FL' || /^FL\d{1,2}$/.test(trimmed)) {
    return true;
  }

  if (trimmed.length < 2 || trimmed.length > 14) return false;
  if (FORBIDDEN_LOCATIONS.has(trimmed)) return false;
  if (trimmed.includes('عام') || trimmed.includes('غير محدد')) return false;

  // استبعاد مقاسات البراغي والسبائك الشائعة في الوصف مثل M16, M12, 316L, 304L, A105
  if (/^(?:M\d{1,2}|304L?|316L?|A105|B16|A234|SCH\d+|PN\d+|CL\d+)$/i.test(trimmed)) {
    return false;
  }

  // صيغة أرفف SAP القياسية: N01A1, N15BB2, N11FL1, N12C2, N16D2 أو بصيغة مفصولة بمسافة
  if (/^[A-Z]\d{2}[A-Z]{1,3}\d{0,2}$/.test(trimmed)) {
    return !['C006', 'M016', 'D04D'].includes(trimmed);
  }

  if (/^[A-Z]\d{2}\s+[A-Z]{1,3}\d{0,2}$/.test(trimmed)) {
    return true;
  }

  if (/^[A-Z]\d{2}\s+[A-Z0-9]{1,4}\s+[A-Z0-9]{1,4}$/.test(trimmed)) {
    return true;
  }

  if (/^(?:LOC|BIN|RACK|SH|ZONE)-[A-Z0-9-]{1,10}$/.test(trimmed)) {
    return true;
  }

  // قبول أكواد الأرفف القصيرة التي تجمع حرف رف ورقم (مثل A1, B2, BB1, C4, D1) عند إدخالها كرمز موقع مستقل
  if (/^(?:FL|[A-D]|BB|C4)\d{1,2}$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * 2. خوارزمية التصحيح الذكي لأسماء المواقع (Smart SAP Storage Bin Normalizer)
 * تصلح الأخطاء البصرية الشائعة في رموز المواقع مثل:
 * NIS8B2 -> N15BB2 | NOIAT -> N01A1 | NOTAZ -> N01A2 | NOWB1 -> N01B1 | N1502 -> N15D2 | N1101 -> N11D1
 */
export function dynamicLocationNormalizer(raw: string | null | undefined): string {
  if (!raw) return '';
  const rawStr = String(raw).trim();
  if (!rawStr) return '';

  const cached = LOCATION_CACHE.get(rawStr);
  if (cached !== undefined) return cached;

  let cleaned = rawStr.toUpperCase();

  if (cleaned === 'D' || /^D\d{1,3}$/.test(cleaned) || cleaned === 'FL' || /^FL\d{1,2}$/.test(cleaned)) {
    LOCATION_CACHE.set(rawStr, cleaned);
    return cleaned;
  }

  cleaned = cleaned
    .replace(/عام/g, '')
    .replace(/غير محدد/g, '')
    .replace(/موقع[:\s]*/g, '')
    .replace(/[\[\]\(\)\{\}\=\|\&\~\\\@\#\$\%\^\*\+\?\!\;\:\"\'\`<>—\-]/g, ' ')
    .replace(/\b(002\s*02|0020|002|001|C006|C008|C00S|COOS|C00|M016|MO16|MOTE|MOIS|D04D|DO4D|STORAGE\s*BIN|BIN|LOC)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    LOCATION_CACHE.set(rawStr, '');
    return '';
  }

  if (cleaned === 'D' || /^D\d{1,3}$/.test(cleaned) || cleaned === 'FL' || /^FL\d{1,2}$/.test(cleaned)) {
    LOCATION_CACHE.set(rawStr, cleaned);
    return cleaned;
  }

  // إصلاحات مخصصة لأكواد أرفف SAP القياسية (N01..N19)
  let sapFixed = cleaned
    .replace(/\bN\s+([01OIl][0-9OIlSsEeGgZz])\b/g, 'N$1')
    .replace(/\bN[Oo0][Ili|!tT1]/g, 'N01')
    .replace(/\bN[Oo0]W/g, 'N01')
    .replace(/\bN[Ili|!tT1][Ss5]/g, 'N15')
    .replace(/\bN[Ili|!tT1][EeGg6]/g, 'N16')
    .replace(/\bN[Ili|!tT1MVNA][Ili|!tT1]/g, 'N11')
    .replace(/\bN[Ili|!tT1][Zz2]/g, 'N12')
    .replace(/\b([A-Z])[Oo](\d)/g, '$10$2')
    .replace(/\b([A-Z]\d)[Oo]/g, '$10')
    .replace(/\b([A-Z])[Il|tT](\d)/g, '$11$2')
    .replace(/\b([A-Z]\d)[Il|tT]([A-Z])/g, '$11$2')
    // دمج المسافة إن وُجدت بين رقم الممر Nxx ورمز الرف (مثل N01 A1 -> N01A1 أو N15 BB2 -> N15BB2)
    .replace(/\b(N\d{2})\s+(FL[12Il|!tT]|BB[12Il|!tT]|[A-D][12Il|!tT])\b/g, '$1$2')
    // إصلاح رمز الرف المزدوج BB (مثل N158B2, N158BR2, N15BR2, N15882 -> N15BB2)
    .replace(/\b(N\d{2})(?:8B|B8|88|8BR|BR|BBR)([12Il|!tT])\b/g, '$1BB$2')
    // إصلاح حرف D حين يُقرأ 0 بين رقمين (مثل N1502 -> N15D2 و N1101 -> N11D1)
    .replace(/\b(N\d{2})0([12])\b/g, '$1D$2')
    // إصلاح FL1 و FL2 (مثل FLI, FLY, FL4 -> FL1 و FLZ, FLQ, FLe -> FL2)
    .replace(/\b(N\d{2})F[LI1][Ili|!tTY41]\b/g, '$1FL1')
    .replace(/\b(N\d{2})F[LI1][ZzQRe2]\b/g, '$1FL2')
    // إصلاح N01A1 / N01A2 / N01B1
    .replace(/\b(N\d{2})A[Ili|!tTYLD]\b/g, '$1A1')
    .replace(/\b(N\d{2})A[ZzR2]\b/g, '$1A2')
    .replace(/\b(N\d{2})[B8][Ili|!tT1]\b/g, '$1B1')
    .replace(/\b(N\d{2})[B8][Zz2]\b/g, '$1B2')
    .replace(/([A-Z]{1,3})[Il|tT]\b/g, '$11')
    .replace(/([A-Z]{1,3})[Oo]\b/g, '$10');

  const splitSapMatch = sapFixed.match(/^([A-Z]\d{2})\s+([A-Z]{1,3}\d{0,2})$/);
  if (splitSapMatch) {
    sapFixed = `${splitSapMatch[1]}${splitSapMatch[2]}`;
  }

  const compactBinMatch = sapFixed.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{1,2})\b/);
  if (compactBinMatch) {
    const candidate = compactBinMatch[1].toUpperCase();
    if (!['C006', 'M016', 'D04D'].includes(candidate)) {
      LOCATION_CACHE.set(rawStr, candidate);
      return candidate;
    }
  }

  const spacedBinMatch = sapFixed.match(/\b([A-Z]\d{2})\s+([A-Z]{1,3}\d{1,2})\b/);
  if (spacedBinMatch) {
    const candidate = `${spacedBinMatch[1]}${spacedBinMatch[2]}`.toUpperCase();
    if (!['C006', 'M016', 'D04D'].includes(candidate)) {
      LOCATION_CACHE.set(rawStr, candidate);
      return candidate;
    }
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
    checkCol === 'XX' ||
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
 * 4. خوارزمية السياق الذكي وتنعيم الساندويتش للورقة الكاملة (Context-Aware & Sandwich Sheet Resolver):
 * - أوراق جرد SAP مرتبة تسلسلياً حسب الموقع (Storage Bin).
 * - تملأ المواقع المطموسة من السطر المجاور، وتصحح أي انحراف فردي معزول واقع بين سطرين لهما نفس الموقع تماماً.
 */
export function resolveSheetLocationsWithContext<T extends { location?: string; location_code?: string }>(
  rows: T[]
): T[] {
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

  // 1. Forward Fill للسطور الفارغة
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

  // 2. Backward Fill للسطور الأولى إن كانت فارغة
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

  // 3. Sandwich Context Smoothing: إذا كان السطر السابق واللاحق لهما نفس الموقع تماماً (مثلاً N01A1 و N01A1)،
  // فالسطر الأوسط حتماً ينتمي لنفس الرف في جدول SAP المرتب تسلسلياً
  for (let i = 1; i < normalized.length - 1; i++) {
    const prevLoc = normalized[i - 1].location_code;
    const nextLoc = normalized[i + 1].location_code;
    const currLoc = normalized[i].location_code;
    if (
      prevLoc &&
      prevLoc === nextLoc &&
      currLoc !== prevLoc &&
      isValidSpecificLocation(prevLoc)
    ) {
      normalized[i].location = prevLoc;
      normalized[i].location_code = prevLoc;
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
  const filtered = strict10DigitRegexFilter(raw);
  if (filtered) return filtered;
  return String(raw || '').replace(/[^0-9]/g, '').trim();
};

export const sanitizeQuantity = charToDigitMapper;
export const sanitizeLocationCode = (raw: string | null | undefined): string => {
  return dynamicLocationNormalizer(raw);
};

export function sanitizeDescription(raw: string | null | undefined): { cleaned: string; isValid: boolean } {
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
