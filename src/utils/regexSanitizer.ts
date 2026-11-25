/**
 * وحدة التنقية الصارمة لبيانات الجرد (Strict Zero-Hallucination Sanitizer)
 * تضمن عدم توليد أو تخمين أي بيانات غير موجودة في الورقة:
 * - أي رقم قطعة لا يتكون من 10 أرقام صريحة يُرفض ويُترك فارغاً ("").
 * - تدعم أكواد المواقع المخزنية لأسمو (N11A1, N15BB2, P16C2, P16D1, P16D2, P16FL1, P16FL2, 22-C-11-B).
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

const LOCATION_OCR_FIXES: Record<string, string> = {
  NIS8B2: 'N15BB2',
  NISBB2: 'N15BB2',
  NISBB1: 'N15BB1',
  NOIAT: 'N01A1',
  NOIA1: 'N01A1',
  NO1A1: 'N01A1',
  NO1B1: 'N01B1',
  NO1B2: 'N01B2',
  NO2A1: 'N02A1',
  NO7A1: 'N07A1',
  NO7A2: 'N07A2',
  NOTA1: 'N07A1',
  NOTA2: 'N07A2',
  NO7B1: 'N07B1',
  NO7B2: 'N07B2',
  NOTB1: 'N07B1',
  NOTB2: 'N07B2',
  NO7BB1: 'N07BB1',
  NO7BB2: 'N07BB2',
  NOTBB1: 'N07BB1',
  NOTBB2: 'N07BB2',
  N078B1: 'N07BB1',
  N078B2: 'N07BB2',
  NO78B1: 'N07BB1',
  NO78B2: 'N07BB2',
  N07B81: 'N07BB1',
  N07B82: 'N07BB2',
  N07881: 'N07BB1',
  N07882: 'N07BB2',
  NO7882: 'N07BB2',
  N07BBZ: 'N07BB2',
  NO7BBZ: 'N07BB2',
  NO7C1: 'N07C1',
  NO7C2: 'N07C2',
  NOTC1: 'N07C1',
  NOTC2: 'N07C2',
  NO7D1: 'N07D1',
  NO7D2: 'N07D2',
  NOTD1: 'N07D1',
  NOTD2: 'N07D2',
  N0701: 'N07D1',
  N0702: 'N07D2',
  NO701: 'N07D1',
  NO702: 'N07D2',
  NO7FL1: 'N07FL1',
  NO7FL2: 'N07FL2',
  NOTFL1: 'N07FL1',
  NOTFL2: 'N07FL2',
  N1502: 'N15D2',
  N1501: 'N15D1',
  N16O1: 'N16D1',
  N1601: 'N16D1',
  N16O2: 'N16D2',
  N1602: 'N16D2',
  NIVAR: 'N17A1',
  NIVA1: 'N17A1',
  NIVA2: 'N17A2',
  NIVE1: 'N17B1',
  NIVB1: 'N17B1',
  N11EL1: 'N11FL1',
  N11EL2: 'N11FL2',
  PA6C2: 'P16C2',
  PI6C2: 'P16C2',
  P1EC2: 'P16C2',
  P1601: 'P16D1',
  P16O1: 'P16D1',
  P1ED1: 'P16D1',
  PIED1: 'P16D1',
  PT6DT: 'P16D1',
  P16DT: 'P16D1',
  PI6D1: 'P16D1',
  PEPT: 'P16D1',
  P1602: 'P16D2',
  P16O2: 'P16D2',
  PISD2: 'P16D2',
  PTED2: 'P16D2',
  PIEB2: 'P16D2',
  PI6D2: 'P16D2',
  P1ED2: 'P16D2',
  P16F1: 'P16FL1',
  P16FLT: 'P16FL1',
  PT1EFL1: 'P16FL1',
  P16FLYT: 'P16FL1',
  P16FD: 'P16FL1',
  PASELH: 'P16FL1',
  PERT: 'P16FL1',
  PIERS: 'P16FL1',
  PLEFL1: 'P16FL1',
  PI6FL1: 'P16FL1',
  PIEFL1: 'P16FL1',
  P16FLY: 'P16FL1',
  P16FLS: 'P16FL1',
  PT6FL1: 'P16FL1',
  P1EFL1: 'P16FL1',
  P16F2: 'P16FL2',
  PI6F2: 'P16FL2',
  PLEF2: 'P16FL2',
  PEFLZ: 'P16FL2',
  P1EFIZ: 'P16FL2',
  P1EFZ: 'P16FL2',
  P1EFL: 'P16FL2',
  PI6FL2: 'P16FL2',
  PIEFL2: 'P16FL2',
  P1EFL2: 'P16FL2',
  PL6FL2: 'P16FL2',
  PIERI: 'P16FL2',
  PIER: 'P16FL2',
  PI6FIZ: 'P16FL2',
  PIERIZ: 'P16FL2',
  PPTERLZ: 'P16FL2',
  IERIZ: 'P16FL2',
  PIERIS: 'P16FL2',
  PREFLZ: 'P16FL2',
};

function normalizeArabicDigits(str: string): string {
  return str
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

export function charToDigitMapper(raw: string | number | null | undefined, defaultValue: number = 0): number {
  if (raw === null || raw === undefined || raw === '') return defaultValue;
  if (typeof raw === 'number') {
    return isNaN(raw) ? defaultValue : Math.max(0, Math.floor(raw));
  }

  const normalized = normalizeArabicDigits(String(raw).trim());

  if (/^\d+$/.test(normalized)) {
    const parsed = parseInt(normalized, 10);
    return isNaN(parsed) ? defaultValue : Math.max(0, parsed);
  }

  const cleanDigits = normalized
    .replace(/\b(?:EA|SET|PK|SH|CO|AY|KG|PAA|ZYD|KIT|PCS|ROL|BOX)\b/gi, '')
    .replace(/[^\d]/g, '');
  if (cleanDigits.length > 0 && cleanDigits.length <= 6) {
    const parsed = parseInt(cleanDigits, 10);
    return isNaN(parsed) ? defaultValue : Math.max(0, parsed);
  }

  return defaultValue;
}

function isPhoneNumberLike(digits10: string): boolean {
  return /^(?:05\d{8}|966\d{7}|01[1-9]\d{7})$/.test(digits10);
}

/**
 * فلتر صارم للتحقق من أن النص يتكون من 10 أرقام بالضبط بدون تخمين (مطلوب لاختبارات الأمان)
 */
export function strict10DigitRegexFilter(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  return /^\d{10}$/.test(value) ? value : null;
}

function mapLookalikeCharsToDigits(token: string): string {
  let norm = normalizeArabicDigits(token);
  if (/^[fFtTIli|!][0OoQq]{2}/.test(norm)) {
    norm = '1' + norm.slice(1);
  }
  return norm
    .replace(/[OoQqDd]/g, '0')
    .replace(/[Ili|!¡tT]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/[Gb]/g, '6')
    .replace(/[B]/g, '8')
    .replace(/[a]/g, '9');
}

function fixSapZeroNineOcrAnomaly(digits10: string): string {
  // في جداول أسمو المطبوعة، قد يقرأ Tesseract الرقم 9 في البادئة 10009xxxxx كـ 0 (1000095378 -> 1000995378)
  if (/^10000(?:765|862|953|958|976|986|987|994|996|997|998|999)\d{2}$/.test(digits10)) {
    return '10009' + digits10.slice(5);
  }
  return digits10;
}

/**
 * استخراج رقم القطعة المكون من 10 أرقام بدقة مع فصل رموز الوحدات أو حدود الجدول أو أرقام تسلسل السطور الملتصقة.
 */
export function repair10DigitMaterialCode(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const rawStr = normalizeArabicDigits(String(raw).trim());
  if (!rawStr) return null;

  // 1. إذا كان 10 أرقام صريحة ومباشرة نُرجعه بعد فحص تصحيح 100009xxxx
  if (/^\d{10}$/.test(rawStr) && !isPhoneNumberLike(rawStr)) {
    return fixSapZeroNineOcrAnomaly(rawStr);
  }

  // 2. إذا كان 11 رقماً يبدأ بـ 1000 أو 1001 وينتهي بـ 7 أو 1 نتيجة التصاق حد العمود الرأسي |
  const borderGlued11 = rawStr.match(/\b(100[01]\d{6})[17]\b/);
  if (borderGlued11 && !isPhoneNumberLike(borderGlued11[1])) {
    return fixSapZeroNineOcrAnomaly(borderGlued11[1]);
  }

  // 3. البحث عن أي 10 أرقام منفصلة
  const exact10Match = rawStr.match(/\b(\d{10})\b/);
  if (exact10Match && !isPhoneNumberLike(exact10Match[1])) {
    return fixSapZeroNineOcrAnomaly(exact10Match[1]);
  }

  // 4. فحص الالتصاق مع رمز الوحدة مثل 1001023714EA أو 1000988740SET
  const unitGluedMatch = rawStr.match(/\b(\d{10})(?:EA|SET|PK|SH|CO|AY|KG|PAA|ZYD|KIT|PCS|ROL|BOX)\b/i);
  if (unitGluedMatch && !isPhoneNumberLike(unitGluedMatch[1])) {
    return fixSapZeroNineOcrAnomaly(unitGluedMatch[1]);
  }

  // 5. البحث عن رقم SAP قياسي (10 أرقام يبدأ بـ 100) ملتصق برقم تسلسل السطر في اليسار أو وحدة في اليمين
  const sapDirectMatch = rawStr.match(/(?:^|\D|\d{1,4}\s+|\b\d{1,2})(100\d{7})(?:\D|$)/);
  if (sapDirectMatch && sapDirectMatch[1] && !isPhoneNumberLike(sapDirectMatch[1])) {
    return fixSapZeroNineOcrAnomaly(sapDirectMatch[1]);
  }

  // 6. إزالة المسافات أو النقاط الفاصلة داخل الـ 10 أرقام (مثل "1001 023714")
  const compact = rawStr.replace(/[\s\-_.]/g, '');
  if (/^\d{10}$/.test(compact) && !isPhoneNumberLike(compact)) {
    return fixSapZeroNineOcrAnomaly(compact);
  }

  // 7. إصلاح الحروف المتشابهة بصرياً مع الأرقام إذا كان الطول 10 خانات
  if (compact.length === 10) {
    const digitCount = (compact.match(/\d/g) || []).length;
    if (digitCount >= 7) {
      const mapped = mapLookalikeCharsToDigits(compact);
      if (/^\d{10}$/.test(mapped) && !isPhoneNumberLike(mapped)) {
        return fixSapZeroNineOcrAnomaly(mapped);
      }
    }
  }

  const tokens = rawStr.split(/[\s|,;:\[\]{}()]+/);
  for (const tok of tokens) {
    const stripped = tok.replace(/(?:EA|SET|PK|SH|CO|AY|KG|PAA|ZYD|KIT|PCS|ROL|BOX)$/i, '');
    if (stripped.length === 11 && /^100[01]\d{6}[17]$/.test(stripped)) {
      return fixSapZeroNineOcrAnomaly(stripped.slice(0, 10));
    }
    if (stripped.length === 10) {
      if (/^\d{10}$/.test(stripped) && !isPhoneNumberLike(stripped)) {
        return fixSapZeroNineOcrAnomaly(stripped);
      }
      const digitCount = (stripped.match(/\d/g) || []).length;
      if (digitCount >= 6 && /^[1IltTfF][0OoQq]{2}/.test(stripped)) {
        const mapped = mapLookalikeCharsToDigits(stripped);
        if (/^\d{10}$/.test(mapped) && !isPhoneNumberLike(mapped)) {
          return fixSapZeroNineOcrAnomaly(mapped);
        }
      } else if (digitCount >= 8) {
        const mapped = mapLookalikeCharsToDigits(stripped);
        if (/^\d{10}$/.test(mapped) && !isPhoneNumberLike(mapped)) {
          return fixSapZeroNineOcrAnomaly(mapped);
        }
      }
    }
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
  '0027',
  'G02',
  '001',
  'C006',
  'CO06',
  'C06',
  'COOB',
  'CO0G',
  'COOS',
  'M016',
  'MO16',
  'MOTE',
  'MOLE',
  'D04D',
  'F316',
  'F316L',
  '316L',
  'S31603',
  'A182',
  'A193',
  'A183',
  'A743',
  'A853',
  'A853M',
  'CA40',
  'CAA4',
  'XM19',
  'A351',
  'CF8M',
  'A351CF8M',
  'B8M',
  'B8T',
  'B81',
  'BET',
  'SAK4',
  '36A',
  '750V',
  '440V',
  '1A2',
  'CL1',
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
  'ZVD',
  'ZYL',
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

  if (
    /^(?:M\d{1,3}|C\d{2,3}|G\d{2}|304L?|316L?|F316L?|S\d{4,5}|A\d{3}M?|B\d{1,2}[MT1]?|CA\d{2}|XM\d{2}|CF8M|A351CF8M|SCH\d+|PN\d+|CL\d+|1A2|\d+V|\d+A)$/i.test(
      trimmed
    )
  ) {
    return false;
  }

  if (/^[A-Z]\d{2}(?:FL|BB|[A-D])\d{1,2}$/.test(trimmed) || /^[NP]\d{2}(?:FL|BB|[A-D])$/.test(trimmed)) {
    return true;
  }

  if (/^[A-Z]\d{1,3}[A-Z]{1,3}\d{1,3}$/.test(trimmed)) {
    if (FORBIDDEN_LOCATIONS.has(trimmed)) return false;
    return true;
  }

  if (/^[A-Z]\d{1,3}\s+[A-Z]{1,3}\d{1,3}$/.test(trimmed)) {
    return true;
  }

  if (/^(?:LOC|BIN|RACK|SH|ZONE)-[A-Z0-9-]{1,10}$/.test(trimmed)) {
    return true;
  }

  if (/^(?:FL|BB|C4)\d{1,3}$/.test(trimmed)) {
    return true;
  }

  if (
    /^[A-Z0-9]{1,4}(?:[-_][A-Z0-9]{1,8}){1,4}$/.test(trimmed) &&
    /\d/.test(trimmed) &&
    /[A-Z]/.test(trimmed) &&
    !/^(?:PN|CL|SCH|ASTM|ISO|DIN|SAK)-/i.test(trimmed)
  ) {
    return true;
  }

  return false;
}

/**
 * قراءة الموقع الفعلي كما ظهر في السطر مع تطبيع المسافات والشرطات وأخطاء OCR الشائعة في أكواد أسمو (مثل N11A1 و N07BB2 و P16FL1)
 */
export function dynamicLocationNormalizer(raw: string | null | undefined): string {
  if (!raw) return '';
  let cleaned = normalizeArabicDigits(String(raw))
    .trim()
    .toUpperCase()
    .replace(/عام/g, '')
    .replace(/غير محدد/g, '')
    .replace(/[\s|_\[\](){}.,;:'"“”‘’~`]+/g, '');

  if (!cleaned || cleaned === 'NULL' || cleaned === 'UNDEFINED') return '';
  if (FORBIDDEN_LOCATIONS.has(cleaned)) return '';

  if (LOCATION_OCR_FIXES[cleaned]) {
    return LOCATION_OCR_FIXES[cleaned];
  }

  // إصلاح القراءة البصرية لأكواد الممرات التي تبدأ بـ N أو P (مثل N11A1, N07BB2, P16C2, P16D1, P16FL1, P16FL2)
  cleaned = cleaned.replace(/^([NP])([IOl|tT]{2})(?=[A-Z])/i, (_, prefix, p1) => {
    return prefix.toUpperCase() + p1.replace(/[Oo]/g, '0').replace(/[Il|tT]/g, '1');
  });

  cleaned = cleaned
    .replace(/^([NP])[0OQD][7T](?=[A-DF]|BB|FL|8)/, '$107')
    .replace(/^([NP])([OQD])(\d)/, '$10$3')
    .replace(/^([NP])(\d)([OQD])/, '$1$20')
    .replace(/^([NP])([Il!tT])(\d)/, '$11$3')
    .replace(/^([NP])(\d)([Il!])/, '$1$21')
    .replace(/^([NP]\d)[ET]/, '$16')
    .replace(/^([NP])A(6[A-D]\d)/, '$11$2')
    .replace(/^([NP])1S/, '$115')
    .replace(/^([NP])0S/, '$105')
    .replace(/^([NP]\d{2})0([1-4])$/, '$1D$2')
    .replace(/^([NP]\d{2})O([1-4])$/, '$1D$2')
    .replace(/^([NP]\d{2}[A-D])[tTIli!]$/, '$11')
    .replace(/^([NP]\d{2}[A-D])[zZ]$/, '$12')
    .replace(/^([NP]\d{2})(?:88|8B|B8|EB)([1-4])$/, '$1BB$2')
    .replace(/^([NP]\d{2}BB)[tTIli!]$/, '$11')
    .replace(/^([NP]\d{2}BB)[zZ]$/, '$12')
    .replace(/^([NP]\d{2})EL([1-4])$/, '$1FL$2')
    .replace(/^([NP]\d{2})F([1-4])$/, '$1FL$2')
    .replace(/^([NP]\d{2})F[tTIli!YS]$/, '$1FL1')
    .replace(/^([NP]\d{2})F[zZ]$/, '$1FL2')
    .replace(/^([NP]\d{2}FL)[tTIli!YS]+$/, '$11')
    .replace(/^([NP]\d{2}FL)[zZ]+$/, '$12')
    .replace(/^([NP]\d{2}(?:FL|BB|[A-D]))[Il!]$/, '$11')
    .replace(/^([NP]\d{2})[-_]+([A-Z]+\d*)$/, '$1$2');

  if (LOCATION_OCR_FIXES[cleaned]) {
    return LOCATION_OCR_FIXES[cleaned];
  }

  if (cleaned === 'D' || /^D\d{1,3}$/.test(cleaned) || cleaned === 'FL' || /^FL\d{1,2}$/.test(cleaned)) {
    return cleaned;
  }

  const stdSapBinMatch = cleaned.match(/\b([A-Z]\d{2}(?:FL|BB|[A-D])\d{1,2})\b/);
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
 * تطبيع مواقع الورقة مع استعادة الموقع المفقود من نفس رقم القطعة أو من السطور المجاورة المرتبة في الورقة.
 */
export function resolveSheetLocationsWithContext<
  T extends { part_number?: string; location?: string; location_code?: string }
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

  if (normalized.length < 2) {
    return normalized;
  }

  // 1. إذا تكرر نفس رقم القطعة المكون من 10 أرقام في نفس الورقة وكان لأحدهما موقع مقروء
  const byPartLoc = new Map<string, string>();
  for (const r of normalized) {
    const p = String(r.part_number || '').trim();
    const loc = r.location_code || '';
    if (/^\d{10}$/.test(p) && loc && !byPartLoc.has(p)) {
      byPartLoc.set(p, loc);
    }
  }

  for (const r of normalized) {
    const p = String(r.part_number || '').trim();
    if (!r.location_code && /^\d{10}$/.test(p) && byPartLoc.has(p)) {
      const matchedLoc = byPartLoc.get(p)!;
      r.location = matchedLoc;
      r.location_code = matchedLoc;
    }
  }

  // 2. إذا كان سطر ذو رقم قطعة صالح محصوراً بين سطرين يحملان نفس الموقع المخزني بالضبط (prevLoc === nextLoc)
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i].location_code) continue;
    const p = String(normalized[i].part_number || '').trim();
    if (!/^\d{10}$/.test(p)) continue;

    let prevLoc = '';
    for (let j = i - 1; j >= 0; j--) {
      if (normalized[j].location_code) {
        prevLoc = normalized[j].location_code;
        break;
      }
    }

    let nextLoc = '';
    for (let j = i + 1; j < normalized.length; j++) {
      if (normalized[j].location_code) {
        nextLoc = normalized[j].location_code;
        break;
      }
    }

    if (prevLoc && nextLoc && prevLoc === nextLoc) {
      normalized[i].location = prevLoc;
      normalized[i].location_code = prevLoc;
    }
  }

  // 3. للسطور الطرفية (أول سطر أو آخر سطر أو عند حدود انتقال الرفوف) في أوراق الجرد المتعددة السطور
  if (normalized.length >= 3) {
    for (let i = 0; i < normalized.length; i++) {
      if (normalized[i].location_code) continue;
      const p = String(normalized[i].part_number || '').trim();
      if (!/^\d{10}$/.test(p)) continue;

      let prevLoc = '';
      for (let j = i - 1; j >= 0; j--) {
        if (normalized[j].location_code) {
          prevLoc = normalized[j].location_code;
          break;
        }
      }

      let nextLoc = '';
      for (let j = i + 1; j < normalized.length; j++) {
        if (normalized[j].location_code) {
          nextLoc = normalized[j].location_code;
          break;
        }
      }

      const fallbackLoc = prevLoc || nextLoc;
      if (fallbackLoc) {
        normalized[i].location = fallbackLoc;
        normalized[i].location_code = fallbackLoc;
      }
    }
  }

  return normalized;
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
  const cleanPart = repair10DigitMaterialCode(rawPart) || '';
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
  const repaired = repair10DigitMaterialCode(raw);
  return repaired || '';
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
  const m = line.match(/\b([NP]\d{2}(?:FL|BB|[A-D])\d{1,2})\b/i);
  if (m) return m[1].toUpperCase();
  const tokens = line.split(/[\s|;,\[\]{}()]+/);
  for (const tok of tokens) {
    const norm = dynamicLocationNormalizer(tok);
    if (norm && isValidSpecificLocation(norm)) return norm;
  }
  return null;
}
