/**
 * وحدة الخوارزميات المساعدة الذكية لقراءة وتصحيح أوراق جرد أسمو (SAP Inventory Controller Assistive Engine)
 * 1. خوارزمية الإصلاح الذكي لرقم القطعة (Smart 10-Digit Material Auto-Repair):
 *    - استخراج الـ 10 أرقام الكاملة حتى لو التصق بها رقم التسلسل (#) أو رمز الوحدة (EA/PK)
 *    - تصحيح الحروف المتشابهة بصرياً (O->0, I/l/|->1, Z->2, S->5, G->6, B->8)
 *    - ترميم ذكي للأرقام المكونة من 9 خانات إذا طمست حدود الجدول الرقم الأول (1) أو أحد أصفار البادئة (1000)
 * 2. خوارزمية التصحيح والاستنتاج السياقي للمواقع (Smart Storage Bin Normalizer & Neighbor Context Resolver):
 *    - تصحيح الأخطاء الشائعة في رموز المواقع مثل (NO1B2 -> N01B2) و (N01FLI -> N01FL1)
 *    - استنتاج رمز الموقع تلقائياً من السطر المجاور في نفس الورقة إذا غطت علامة اليد (✓ أو ×) خانة الموقع
 *    - منع إدخال موقع "عام" نهائياً
 * 3. خوارزمية التمييز المرن لعلامات اليد (✓ صح = موجودة | × خطأ = غير موجودة) بدون رفض الأوراق
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
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!]/g, '1')
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
 * 1. خوارزمية الإصلاح والمطابقة الذكية لرقم القطعة (Smart 10-Digit SAP Material Filter & Repair)
 * - تستخرج 10 أرقام كاملة من عمود Material
 * - تتجاهل أرقام العمود التسلسلي (#) القصيرة (3-5 خانات مثل 654، 8428)
 * - تصلح الأخطاء البصرية الناتجة عن خط اليد أو خطوط الجدول
 */
export function strict10DigitRegexFilter(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let cleaned = String(raw).trim();
  if (!cleaned) return null;

  // تحويل الحروف المتشابهة بصرياً مع الأرقام
  const normalizedChars = cleaned
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/[Gg]/g, '6')
    .replace(/[Bb]/g, '8');

  // 1. البحث المباشر عن 10 أرقام تبدأ بـ 10 (مثل 1001523111 أو 1000082689) حتى لو كان حولها نص أو رقم تسلسلي
  const exactSap10 = normalizedChars.match(/(10\d{8})/);
  if (exactSap10) {
    return exactSap10[1];
  }

  // إزالة كافة الفواصل والرموز
  const digitsOnly = normalizedChars.replace(/[^0-9]/g, '');

  // 2. إذا كان الرقم 10 خانات بالضبط
  if (/^\d{10}$/.test(digitsOnly)) {
    // إذا قرأ الموديل الرقم الأول 4 أو 7 بدلاً من 1 قبل 00 (مثل 7000082689 -> 1000082689)
    if (/^[47]00\d{7}$/.test(digitsOnly)) {
      return '1' + digitsOnly.slice(1);
    }
    return digitsOnly;
  }

  // 3. خوارزمية المساعدة للـ 9 أرقام في أوراق SAP:
  // أ) إذا طمس خط الجدول الأيسر رقم (1) في البداية فقرئت 9 أرقام تبدأ بـ 00 (مثل 000082689 أو 001523111)
  if (/^00\d{7}$/.test(digitsOnly)) {
    return '1' + digitsOnly;
  }
  // ب) إذا اندمج أحد الأصفار بعد 100 بسبب الظل فقرئت 9 أرقام تبدأ بـ 100 (مثل 100082689 -> 1000082689)
  if (/^100\d{6}$/.test(digitsOnly)) {
    return '1000' + digitsOnly.slice(3);
  }

  // 4. إذا التصق رقم من العمود المجاور فأصبح 11 أو 12 رقماً ويحتوي بداخله على (100xxxxxxx)
  if (digitsOnly.length > 10) {
    const embedded10 = digitsOnly.match(/(100\d{7})/) || digitsOnly.match(/(10\d{8})/);
    if (embedded10) {
      return embedded10[1];
    }
  }

  return null;
}

/**
 * فحص هل الموقع حقيقي ومحدد وليس موقعاً عاماً أو فارغاً أو كود مصنع
 */
export function isValidSpecificLocation(loc: string | null | undefined): boolean {
  if (!loc) return false;
  const trimmed = String(loc).trim().toUpperCase();
  if (trimmed.length < 2) return false;

  const forbiddenLocations = new Set([
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
  ]);

  if (forbiddenLocations.has(trimmed)) return false;
  if (trimmed.includes('عام')) return false;

  // قبول كافة رموز المواقع الصناعية الحقيقية (سواء بدأت بحرف أو رقم مثل N01B2, N01BB1, N11FL2, 01A1, RACK-1)
  return /^[A-Z0-9][A-Z0-9\s\/._-]{1,18}$/i.test(trimmed) && /[A-Z]/i.test(trimmed);
}

/**
 * 2. خوارزمية التصحيح الذكي لأسماء المواقع (Smart SAP Storage Bin Normalizer)
 * - تصلح الأخطاء البصرية الشائعة في رموز المواقع مثل:
 *   NO1B2 -> N01B2 | N01BI -> N01B1 | N01FLI -> N01FL1 | N01 B2 -> N01B2
 * - تمنع إدخال موقع "عام" تحت أي ظرف
 */
export function dynamicLocationNormalizer(raw: string | null | undefined): string {
  if (!raw) return '';

  let cleaned = String(raw).trim().toUpperCase();

  // إزالة الكلمات العربية أو كلمة عام أو أكواد المصنع (Plant/Area)
  cleaned = cleaned
    .replace(/عام/g, '')
    .replace(/موقع[:\s]*/g, '')
    .replace(/[\[\]\(\)\{\}\=\|\&\~\\\@\#\$\%\^\*\+\?\!\;\:\"\'\`<>]/g, ' ')
    .replace(/\b(002\s*02|0020|002|C006|M016|D04D|STORAGE\s*BIN|BIN|LOC)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  // إصلاح ذكي لرموز SAP التي يُقرأ فيها الصفر حرف O أو الواحد حرف I/L
  // مثل: NO1B2 -> N01B2, N0IBO1 -> N01B01, N01FLI -> N01FL1, N01BBI -> N01BB1
  let sapFixed = cleaned
    .replace(/\b([A-Z])[Oo](\d)/g, '$10$2')
    .replace(/\b([A-Z]\d)[Oo]/g, '$10')
    .replace(/\b([A-Z])[Il|](\d)/g, '$11$2')
    .replace(/\b([A-Z]\d)[Il|]([A-Z])/g, '$11$2')
    .replace(/([A-Z]{1,3})[Il|]\b/g, '$11')
    .replace(/([A-Z]{1,3})[Oo]\b/g, '$10');

  // دمج المسافات داخل رمز الرف الواحد في SAP مثل "N01 B2" -> "N01B2" أو "N01 BB1" -> "N01BB1" أو "N01 FL1" -> "N01FL1"
  const splitSapMatch = sapFixed.match(/^([A-Z]\d{2})\s+([A-Z]{1,3}\d{0,2})$/);
  if (splitSapMatch) {
    sapFixed = `${splitSapMatch[1]}${splitSapMatch[2]}`;
  }

  // 1. نمط SAP Storage Bin المتصل (مثل N01B1, N01B2, N01BB1, N01BB2, N01C1, N01C2, N01D1, N01D2, N01FL1, N06C)
  const compactBinMatch = sapFixed.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{0,2})\b/);
  if (compactBinMatch) {
    const candidate = compactBinMatch[1].toUpperCase();
    if (!['C006', 'M016', 'D04D'].includes(candidate)) {
      return candidate;
    }
  }

  // 2. نمط SAP المركب ذو 3 مقاطع (مثل N02 FL1 2 أو P01 FL1 1)
  const spacedBinMatch3 = sapFixed.match(/\b([A-Z]\d{2}\s+[A-Z0-9]+\s+[A-Z0-9]+)\b/);
  if (spacedBinMatch3) {
    return spacedBinMatch3[1].replace(/\s+/g, ' ').trim();
  }

  // 3. نمط SAP ذو مقطعين
  const spacedBinMatch2 = sapFixed.match(/\b([A-Z]\d{2}\s+[A-Z0-9]+)\b/);
  if (spacedBinMatch2) {
    return spacedBinMatch2[1].replace(/\s+/g, ' ').trim();
  }

  // 4. أي رمز موقع صناعي صالح آخر
  if (isValidSpecificLocation(sapFixed)) {
    return sapFixed;
  }

  return '';
}

/**
 * 3. خوارزمية التمييز الذكي لعلامة اليد في عمود Check (✓ صح = موجودة | × خطأ = غير موجودة)
 * - لا تفشل ولا ترفض السطر أبداً بسبب شكل علامة الصح أو الخطأ
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

  // علامات (× / X) الصريحة فقط تعني غير موجودة
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
 * 4. خوارزمية السياق الذكي للورقة الكاملة (Context-Aware Sheet Resolver):
 * - أوراق جرد SAP مرتبة تسلسلياً حسب الموقع (Storage Bin).
 * - إذا غطت علامة القلم اليدوية (✓ أو ×) اسم الموقع في سطر واحد بينما رقم القطعة (10 أرقام) واضح،
 *   تستنتج الخوارزمية اسم الموقع الفعلي من السطر المجاور في نفس الورقة تلقائياً حتى لا تُرفض الورقة!
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

  // تمريرة للأمام (Forward Fill من السطر السابق في نفس الورقة إذا كان السطر الحالي مطموس الموقع)
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

  // تمريرة للخلف (Backward Fill للسطر الأول إذا كان مطموس الموقع والسطر الثاني واضح)
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
  const cleanPart = strict10DigitRegexFilter(rawPart);
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
