/**
 * وحدة خوارزميات ما بعد القراءة والفلترة الصارمة لجدول جرد أسمو (SAP Inventory Controller)
 * 1. خوارزمية المطابقة الصارمة لأرقام القطع (Strict 10-Digit Material Filter: r'^\d{10}$')
 *    - ترفض أرقام التسلسل (#) ذات الـ 3-5 خانات مثل 8428 و 8429 و 8650
 *    - ترفض أي رقم قطعة ناقص (أقل من 10 أرقام) ولا تقوم بترقيعه
 * 2. خوارزمية استخراج وتوحيد أسماء المواقع الحقيقية (Exact Storage Bin Normalizer)
 *    - تحافظ على اسم الموقع الفعلي كما في الجدول (مثل N11C2, N11FL2, N12A1, N06BB2, N06C1, N07A1)
 *    - تمنع إدخال أي موقع باسم "عام" نهائياً
 * 3. خوارزمية اكتشاف علامة (×) بخط اليد في عمود Check لتحديد القطع "غير موجودة"
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
    .replace(/[Oo]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Gg]/g, '6')
    .replace(/[q]/g, '9');

  const digitsOnly = str.replace(/[^0-9]/g, '');
  if (!digitsOnly) return defaultValue;

  const parsed = parseInt(digitsOnly, 10);
  return isNaN(parsed) ? defaultValue : Math.max(0, parsed);
}

/**
 * 1. خوارزمية المطابقة الصارمة لأرقام القطع (Strict 10-Digit Material Filter)
 * - تقبل فقط رقم القطعة المكتمل المكون من 10 أرقام بالضبط (مثل 1001023714 أو 1000995878)
 * - ترفض تماماً أرقام العمود التسلسلي (#) مثل 8428، 8429، 8650، 11470
 * - ترفض أي رقم ناقص (أقل من 10 أرقام) لضمان عدم نسخ أرقام قطع ناقصة
 */
export function strict10DigitRegexFilter(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let cleaned = String(raw).trim();

  // إزالة الرموز والأقواس والمسافات
  cleaned = cleaned.replace(/[\[\]\(\)\{\}\=\|\&\~\\\/@\#\$\%\^\*\+\?\!\;\:\"\'\`<>_\s-]/g, '');

  // تصحيح أخطاء OCR الحرفية داخل حقل الأرقام فقط إذا كان الطول 10 خانات
  cleaned = cleaned
    .replace(/[Oo]/g, '0')
    .replace(/[Il|!]/g, '1');

  // إذا كان النص يحتوي على سلسلة من 10 أرقام تبدأ بـ 100 وسط نص، نستخرجها
  const exact10Match = cleaned.match(/(10\d{8})/);
  if (exact10Match && cleaned.length === 10) {
    return exact10Match[1];
  }

  const digitsOnly = cleaned.replace(/[^0-9]/g, '');

  // شرط صارم: يجب أن يتكون من 10 أرقام كاملة بالضبط (لا نقبل 4 أو 5 أو 7 أو 8 أو 9 أرقام أبداً)
  if (/^\d{10}$/.test(digitsOnly)) {
    return digitsOnly;
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

  // منع المواقع العامة أو المجهولة أو أكواد Plant/Area مثل C006, M016, D04D, 002
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
  ]);

  if (forbiddenLocations.has(trimmed)) return false;
  if (trimmed.includes('عام')) return false;

  // يجب أن يحتوي رمز الموقع على حرف إنجليزي واحد على الأقل ورقم أو حرفين (مثل N11C2, N06C, N11FL2, P01 FL1 1)
  return /^[A-Z][A-Z0-9\s-]{1,14}$/i.test(trimmed);
}

/**
 * 2. خوارزمية استخراج وتوحيد أسماء المواقع (Exact SAP Storage Bin Normalizer)
 * - تحافظ على رمز Storage Bin الحقيقي كما هو في أوراق الجرد:
 *   N11C2, N11D1, N11D2, N11FL1, N11FL2, N12A1, N12A2,
 *   N06BB2, N06C, N06C1, N06C2, N06D2, N06FL1, N06FL2, N07A1
 * - لا تُدخل موقع "عام" تحت أي ظرف
 */
export function dynamicLocationNormalizer(raw: string | null | undefined): string {
  if (!raw) return '';

  let cleaned = String(raw).trim().toUpperCase();

  // إزالة الكلمات العربية أو كلمة عام أو البادئات غير المرغوبة
  cleaned = cleaned
    .replace(/عام/g, '')
    .replace(/موقع[:\s]*/g, '')
    .replace(/[\[\]\(\)\{\}\=\|\&\~\\\/@\#\$\%\^\*\+\?\!\;\:\"\'\`<>_]/g, ' ')
    .replace(/^(002\s*02\s*|0020\s*|002\s*|C006\s*|M016\s*|D04D\s*|STORAGE\s*BIN\s*|BIN\s*|LOC[:\s]*)/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  // إذا كان الكود على نمط SAP Storage Bin المتصل (مثل N11C2, N11FL1, N11FL2, N06BB2, N06C, N06C1, N12A1, K01A1)
  const compactBinMatch = cleaned.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{0,2})\b/);
  if (compactBinMatch) {
    const candidate = compactBinMatch[1].toUpperCase();
    if (!['C006', 'M016', 'D04D'].includes(candidate)) {
      return candidate;
    }
  }

  // إذا كان الكود على نمط SAP Storage Bin ذو المسافات (مثل N02 FL1 2 أو P01 FL1 1 أو N03 A01)
  const spacedBinMatch3 = cleaned.match(/\b([A-Z]\d{2}\s+[A-Z0-9]+\s+[A-Z0-9]+)\b/);
  if (spacedBinMatch3) {
    return spacedBinMatch3[1].replace(/\s+/g, ' ').trim();
  }

  const spacedBinMatch2 = cleaned.match(/\b([A-Z]\d{2}\s+[A-Z0-9]+)\b/);
  if (spacedBinMatch2) {
    return spacedBinMatch2[1].replace(/\s+/g, ' ').trim();
  }

  // نمط LOC-A1-04
  const locDashMatch = cleaned.match(/\b(LOC-[A-Z0-9-]+)\b/);
  if (locDashMatch) {
    return locDashMatch[1];
  }

  if (isValidSpecificLocation(cleaned)) {
    return cleaned;
  }

  return '';
}

/**
 * 3. فحص هل السطر يحتوي على علامة (× / X) بخط اليد في عمود Check (أي القطعة غير موجودة)
 */
export function detectMissingFromCheckMark(rawItem: any): boolean {
  if (!rawItem) return false;
  if (rawItem.is_missing === true || rawItem.is_missing === 1) return true;
  if (rawItem.status === 'غير موجودة') return true;

  const checkCol = String(
    rawItem.check ?? rawItem.check_mark ?? rawItem.checkMark ?? rawItem.status_mark ?? ''
  ).trim().toUpperCase();

  if (
    checkCol === 'X' ||
    checkCol === '×' ||
    checkCol === '✗' ||
    checkCol === '✘' ||
    checkCol === 'MISSING' ||
    checkCol === 'NOT FOUND' ||
    checkCol.includes('غير موجود')
  ) {
    return true;
  }

  return false;
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
      rejectedReason: `الموقع غير محدد أو عام — يجب قراءة رمز الموقع الفعلي من عمود Storage Bin (مثل N11C2 أو N06C1)`,
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
  const lineCleaned = line
    .replace(/\b(002\s+02|0020|002|C006|M016|D04D)\s+/gi, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();

  // مطابقة أكواد SAP Storage Bin المتصلة مثل N11C2, N11FL1, N11FL2, N06BB2, N06C1, N12A1
  const matchCompact = lineCleaned.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{0,2})\b/);
  if (matchCompact && !['C006', 'M016', 'D04D'].includes(matchCompact[1])) {
    return matchCompact[1];
  }

  const match3 = lineCleaned.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+\s+[0-9A-Z]+)\b/);
  if (match3) return match3[1].replace(/\s+/g, ' ').trim();
  const match2 = lineCleaned.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+)\b/);
  if (match2) return match2[1].replace(/\s+/g, ' ').trim();
  return null;
}
