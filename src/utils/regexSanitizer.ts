/**
 * وحدة تنقية البيانات المستخرجة من أوراق الجرد بدون أي تخمين أو بيانات مخزنة.
 * أي حقل لم يتمكن الـ OCR من قراءته بوضوح يُترك فارغاً تماماً ("").
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

export function charToDigitMapper(raw: string | number | null | undefined, defaultValue: number = 0): number {
  if (raw === null || raw === undefined || raw === '') return defaultValue;
  if (typeof raw === 'number') {
    return isNaN(raw) ? defaultValue : Math.max(0, Math.floor(raw));
  }

  const str = String(raw)
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .trim();
  const numMatch = str.match(/\d+/);
  if (!numMatch) return defaultValue;

  const parsed = parseInt(numMatch[0], 10);
  return isNaN(parsed) ? defaultValue : Math.max(0, parsed);
}

function mapOcrLookalikeDigits(token: string): string {
  return token
    .replace(/[OoQq]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/[Gg]/g, '6')
    .replace(/[Bb]/g, '8');
}

export function normalizeSapMaterialPrefix(code10: string): string {
  const trimmed = String(code10 || '').trim();
  return /^\d{10}$/.test(trimmed) ? trimmed : '';
}

export function strict10DigitRegexFilter(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw)
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .trim();
  if (!value) return null;
  if (/^\d{10}$/.test(value)) return value;

  // إزالة المسافات أو الشرطات الداخلية بين أرقام القطعة الواحدة (مثل 1000 123456)
  const compact = value.replace(/[\s\-_.]/g, '');
  if (/^\d{10}$/.test(compact)) return compact;

  // تصحيح الحروف المتشابهة بصرياً مع الأرقام إذا كان الطول 10 خانات وأغلبها أرقام
  if (compact.length === 10) {
    const digitCount = (compact.match(/\d/g) || []).length;
    if (digitCount >= 8) {
      const mapped = mapOcrLookalikeDigits(compact);
      if (/^\d{10}$/.test(mapped)) return mapped;
    }
  }

  const exactMatch = value.match(/\b(\d{10})\b/);
  if (exactMatch) return exactMatch[1];

  return null;
}

/**
 * قبول رقم القطعة بدقة (10 أرقام قياسية لـ SAP مع معالجة أخطاء القراءة البصرية للحروف المتشابهة).
 */
export function repair10DigitMaterialCode(raw: string | null | undefined): string | null {
  return strict10DigitRegexFilter(raw);
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
  'PCS',
  'ROL',
  'BOX',
  'STORAGE',
  'BIN',
  'LOCATION',
  'MATERIAL',
  'DESCRIPTION',
  'QTY',
  'QUANTITY',
  'UNIT',
  'ITEM',
]);

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

  if (/^(?:304L?|316L?|A105|B16|A234|SCH\d+|PN\d+|CL\d+)$/i.test(trimmed)) {
    return false;
  }

  if (/^[A-Z]\d{2}(?:FL|BB|[A-D])\d{1,2}$/.test(trimmed)) {
    return true;
  }

  if (/^[A-Z]\d{1,3}[A-Z]{1,3}\d{0,3}$/.test(trimmed)) {
    return true;
  }

  if (/^[A-Z]\d{1,3}\s+[A-Z]{1,3}\d{0,3}$/.test(trimmed)) {
    return true;
  }

  if (/^(?:LOC|BIN|RACK|SH|ZONE)-[A-Z0-9-]{1,10}$/.test(trimmed)) {
    return true;
  }

  if (/^(?:FL|[A-Z]|BB|C4)\d{1,3}$/.test(trimmed)) {
    return true;
  }

  // قبول أكواد المواقع المخزنية التي تجمع بين حروف وأرقام (مثل A-01 أو N11-A1)
  if (/^[A-Z]{1,4}[-_]?[A-Z0-9]{1,8}(?:[-_][A-Z0-9]{1,4})?$/.test(trimmed) && /\d/.test(trimmed) && /[A-Z]/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * قراءة الموقع الفعلي كما ظهر في السطر مع تطبيع المسافات والشرطات وأخطاء OCR الشائعة في أكواد أسمو (مثل N11A1)
 */
export function dynamicLocationNormalizer(raw: string | null | undefined): string {
  if (!raw) return '';
  let cleaned = String(raw)
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .trim()
    .toUpperCase()
    .replace(/عام/g, '')
    .replace(/غير محدد/g, '')
    .replace(/\s+/g, '');

  if (!cleaned || cleaned === 'NULL' || cleaned === 'UNDEFINED') return '';

  // إصلاح القراءة البصرية لأكواد الممرات مثل NII -> N11 أو NO7 -> N07
  cleaned = cleaned.replace(/^N([IOl|]{2})(?=[A-Z])/i, (_, p1) => {
    return 'N' + p1.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');
  });
  cleaned = cleaned.replace(/^N([Oo])(\d)/i, 'N0$2').replace(/^N(\d)([Oo])/i, 'N$10');
  cleaned = cleaned.replace(/^(N\d{2})[-_]+([A-Z]+\d*)$/, '$1$2');

  if (cleaned === 'D' || /^D\d{1,3}$/.test(cleaned) || cleaned === 'FL' || /^FL\d{1,2}$/.test(cleaned)) {
    return cleaned;
  }

  const stdSapBinMatch = cleaned.match(/\b([A-Z]\d{2}(?:FL|BB|[A-Z]{1,2})\d{1,2})\b/);
  if (stdSapBinMatch) {
    return stdSapBinMatch[1].toUpperCase();
  }

  if (isValidSpecificLocation(cleaned)) {
    return cleaned;
  }

  return '';
}

export function detectMissingFromCheckMark(rawItem: any): boolean {
  if (!rawItem) return false;
  if (rawItem.is_missing === true || rawItem.is_missing === 1 || rawItem.is_missing === 'true') {
    return true;
  }
  if (rawItem.status === 'غير موجودة' || rawItem.status === 'غير موجود') return true;

  const checkCol = String(
    rawItem.mark_symbol ?? rawItem.check ?? rawItem.check_mark ?? rawItem.checkMark ?? rawItem.status_mark ?? ''
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
 * عدم نسخ أو استنتاج المواقع من السطور المجاورة: كل سطر يحتفظ بالموقع المقروء فيه فقط، وإذا لم يُقرأ يُترك فارغاً ("")
 */
export function resolveSheetLocationsWithContext<T extends { location?: string; location_code?: string }>(
  rows: T[]
): T[] {
  if (!rows || rows.length === 0) return rows;

  return rows.map((r) => {
    const rawLoc = r.location_code ?? r.location ?? '';
    const normLoc = dynamicLocationNormalizer(rawLoc);
    return {
      ...r,
      location: normLoc,
      location_code: normLoc,
    };
  });
}

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
  const cleanPart = strict10DigitRegexFilter(rawPart) || '';
  const cleanLocation = dynamicLocationNormalizer(rawItem.location || rawItem.location_code);
  const isMissing = detectMissingFromCheckMark(rawItem) ? 1 : 0;
  const qtyTotal = Math.max(0, charToDigitMapper(rawItem.quantity ?? rawItem.qty_total, 0));
  const qtyOut = 0;
  const qtyRemaining = isMissing ? 0 : qtyTotal;
  const remark = rawItem.remark ? String(rawItem.remark).trim() : undefined;
  const cleanDesc = String(rawItem.description_en || '').trim();

  if (!cleanPart) {
    return {
      isValid: false,
      part_number: '',
      location_code: cleanLocation,
      qty_total: qtyTotal,
      qty_out: qtyOut,
      qty_remaining: qtyRemaining,
      description_en: cleanDesc,
      is_missing: isMissing,
      remark,
      rejectedReason: 'رقم القطعة غير مقروء — تُرك فارغاً',
    };
  }

  return {
    isValid: true,
    part_number: cleanPart,
    location_code: cleanLocation,
    qty_total: qtyTotal,
    qty_out: qtyOut,
    qty_remaining: qtyRemaining,
    description_en: cleanDesc,
    is_missing: isMissing,
    remark,
  };
}

export const sanitizePartNumber = (raw: string | null | undefined): string => {
  const filtered = strict10DigitRegexFilter(raw);
  return filtered || '';
};

export const sanitizeQuantity = charToDigitMapper;
export const sanitizeLocationCode = (raw: string | null | undefined): string => {
  return dynamicLocationNormalizer(raw);
};

export function sanitizeDescription(raw: string | null | undefined): { cleaned: string; isValid: boolean } {
  if (!raw) return { cleaned: '', isValid: false };
  let cleaned = String(raw).trim();
  if (cleaned === 'غير محدد' || cleaned === 'SPARE PART ASMO' || cleaned === 'SPARE PART') {
    return { cleaned: '', isValid: false };
  }
  cleaned = cleaned.replace(/[\[\]\(\)\{\}\=\|\&\~\\@#\$\%\^\*\+\?\!\;\`<>_]/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  const valid = cleaned.length >= 2;
  return { cleaned: valid ? cleaned : '', isValid: valid };
}

export function sanitizeExtractedRow(raw: any): any {
  return applyPostProcessingPipeline(raw);
}

export function extractDynamicLocationFromLine(line: string): string | null {
  if (!line) return null;
  const m = line.match(/\b(N\d{2}(?:FL|BB|[A-D])\d{1,2})\b/i);
  return m ? m[1].toUpperCase() : null;
}
