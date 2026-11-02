/**
 * وحدة الخوارزميات المساعدة الذكية لقراءة وتصحيح أوراق جرد أسمو (SAP Inventory Controller Assistive Engine)
 * مصممة خصيصاً لمساعدة Gemini Vision ومحرك القراءة على تحقيق قراءة سريعة ودقيقة 100%:
 * 1. خوارزمية الإصلاح الذكي لرقم القطعة (Smart 10-Digit Material Auto-Repair):
 *    - استخراج الـ 10 أرقام الكاملة حتى لو التصق بها رقم التسلسل (#) أو رمز الوحدة (EA/PK) أو خط الجدول (|)
 *    - تصحيح الحروف المتشابهة بصرياً (O->0, I/l/r/t->1, Z->2, A->4, S->5, G->6, B->8, e/¢->9)
 *    - تصحيح التباس البادئة في خطوط SAP (1007xxxxxx -> 1001xxxxxx, 1900xxxxxx -> 1000xxxxxx, 1090xxxxxx -> 1000xxxxxx)
 * 2. خوارزمية التصحيح والاستنتاج السياقي للمواقع (Smart Storage Bin Normalizer & Sandwich Context Resolver):
 *    - تصحيح الأخطاء الشائعة في رموز المواقع مثل (NIS8B2 -> N15BB2, NOIAT -> N01A1, N1502 -> N15D2, N16O1 -> N16D1, Nivar -> N17A1, niva2 -> N17A2, nive1 -> N17B1, N11EL1 -> N11FL1)
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
  // في نظام SAP الخاص بأسمو (1000000000 .. 1001599999):
  // إذا كانت الخانة الخامسة 3 أو 4 أو 6 أو 7 أو 8 أو 9، فالخانة الرابعة هي دائماً 0 (1000xxxxxx)
  if (/^100[1-9][346789]\d{5}$/.test(code10)) {
    return `1000${code10.slice(4)}`;
  }
  // إذا كانت الخانة الخامسة 0 أو 1 أو 2 أو 5 وقُرئت الخانة الرابعة 7 أو 4 أو 3 أو 2 بسبب زاوية خط الرقم 1
  if (/^100[7432][0125]\d{5}$/.test(code10)) {
    return `1001${code10.slice(4)}`;
  }
  if (/^100[8695][0125]\d{5}$/.test(code10)) {
    return `1000${code10.slice(4)}`;
  }
  // قد يُقرأ الصفر الأول أو الثاني كـ 9 أو 6 أو 8 (1900/1901 أو 1090/1091 أو 1600/1800)
  if (/^1[968]0[01]\d{6}$/.test(code10)) {
    return `100${code10.slice(3)}`;
  }
  if (/^10[968][01]\d{6}$/.test(code10)) {
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

  // 1. فحص وجود 10 أرقام صحيحة تبدأ بـ 1000 أو 1001 حتى لو التصقت برقم التسلسل في البداية أو كود مصنع في النهاية
  const directGlued = trimmed.match(/(?:^|[^0-9])\d{0,5}(100\d{7})(?:C006|M016|002|\b|[^0-9])/i);
  if (directGlued) return normalizeSapMaterialPrefix(directGlued[1]);

  // 2. إزالة خطوط الجدول والرموز الطرفية قبل تحويل الحروف البصرية المتشابهة
  const strippedPipes = trimmed
    .replace(/^[|\[\](){}.:;,\-_/\\'"`\s]+|[|\[\](){}.:;,\-_/\\'"`\s]+$/g, '')
    .replace(/\b(?:C006|C008|M016|MO16|D04D)\b/gi, '');

  const mapped = strippedPipes
    .replace(/^(?:aot|aoo|qop|roo|too|loo|ioo|soo|yoo|voo|noo|f00|\+00|190|109|160|180)/i, '100')
    .replace(/^[Il|!tTrRfFyYvVsSaAnN+74](?=[0OoQD°]{2})/i, '1')
    .toUpperCase()
    .replace(/[OQD°@U]/g, '0')
    .replace(/[IL!|'"`/RTF+]/g, '1')
    .replace(/[Z?]/g, '2')
    .replace(/[A<]/g, '4')
    .replace(/[S$§]/g, '5')
    .replace(/[G%]/g, '6')
    .replace(/[B&]/g, '8')
    .replace(/[¢E]/g, '9');

  const exact10 = mapped.match(/(?:^|[^0-9])\d{0,5}(100\d{7})(?=[^0-9]|$)/);
  if (exact10) return normalizeSapMaterialPrefix(exact10[1]);

  const digitsOnly = mapped.replace(/[^0-9]/g, '');
  if (/^\d{10}$/.test(digitsOnly)) {
    const fixed = normalizeSapMaterialPrefix(digitsOnly);
    if (/^100\d{7}$/.test(fixed)) return fixed;
  }

  // البحث من اليمين إلى اليسار أولاً (لأن رقم التسلسل 1..19500 يلتصق من اليسار دائماً) عن 10 أرقام صريحة تبدأ بـ 1000 أو 1001
  if (digitsOnly.length >= 11 && digitsOnly.length <= 16) {
    for (let offset = digitsOnly.length - 10; offset >= 0; offset--) {
      const rawSub = digitsOnly.slice(offset, offset + 10);
      if (/^100[01]\d{6}$/.test(rawSub)) {
        return normalizeSapMaterialPrefix(rawSub);
      }
    }
    for (let offset = digitsOnly.length - 10; offset >= 0; offset--) {
      const sub = normalizeSapMaterialPrefix(digitsOnly.slice(offset, offset + 10));
      if (/^100[01]\d{6}$/.test(sub)) {
        return sub;
      }
    }
  }

  // إذا التصق رقم واحد في البداية من خط الجدول العمودي (مثل 71001078850 أو 41001087218)
  if (/^[147]100\d{7}$/.test(digitsOnly)) {
    return normalizeSapMaterialPrefix(digitsOnly.slice(1));
  }
  // ترميم إذا سقط الرقم الأول (1) وبقي 000xxxxxx أو 001xxxxxx (9 أرقام تبدأ بـ 00)
  if (/^00[0174]\d{6}$/.test(digitsOnly)) {
    return normalizeSapMaterialPrefix(`1${digitsOnly}`);
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

  // صيغة أرفف SAP القياسية: N01A1, N15BB2, N11FL1, N12C2, N16D2, N17A1, N17B1
  if (/^[A-Z]\d{2}(?:FL|BB|[A-D])\d{1,2}$/.test(trimmed)) {
    return true;
  }

  if (/^[A-Z]\d{2}[A-Z]{1,3}\d{0,2}$/.test(trimmed)) {
    if (['C006', 'M016', 'D04D'].includes(trimmed)) return false;
    // منع قبول حروف غير صالحة كأرفف مثل O1, EL1, RL1 قبل تطبيعها
    if (/^N\d{2}(?:O|EL|RL)\d$/i.test(trimmed)) return false;
    return true;
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
 * NIS8B2 -> N15BB2 | NOIAT -> N01A1 | NOTAZ -> N01A2 | NOWB1 -> N01B1 | N1502 -> N15D2 | N16O1 -> N16D1 | Nivar -> N17A1 | niva2 -> N17A2 | nive1 -> N17B1 | N11EL1 -> N11FL1
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
    .replace(/[\[\]\(\)\{\}\=\|\&\~\\\@\#\$\%\^\*\+\?\!\;\:\"\'\`<>—\-_]/g, ' ')
    .replace(
      /\b(002\s*02|0020|002T?|001|C006|C008|C00S|COOS|COO6|COOB|COVE|C00|M016|MO16|MOTE|MORE|MOIS|M076|D04D|DO4D|STORAGE\s*BIN|BIN|LOC)\b/gi,
      ' '
    )
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

  // إصلاحات مخصصة وشاملة لأكواد أرفف SAP القياسية (N01..N19)
  let sapFixed = cleaned
    .replace(/\bN\s+([01OIl][0-9OIlSsEeGgZz7vV])\b/g, 'N$1')
    // N01 variants (NO1, NOT, NOW, N0W, W01, NOIA, NOTA, NOVER)
    .replace(/\b[TNW]?N?[Oo0][Ili|!tT1W](?=[A-DF]|BB|FL)/gi, 'N01')
    .replace(/\bN[Oo0]VER\b/gi, 'N01B1')
    .replace(/\bN[Oo0]RES\b/gi, 'N01B1')
    // N17 variants (NI7, NT7, N17, NIV, NAV, NA7, WIV, U7)
    .replace(/\b[TNW]?N[Ili|!tT1A][7vV](?=[A-DFEe]|BB|FL)/gi, 'N17')
    .replace(/\b(?:WIV|NIV|NT7|NI7|NA7|U7|A7)A[1Ili|!tTrR]\b/gi, 'N17A1')
    .replace(/\b(?:WIV|NIV|NT7|NI7|NA7|U7|A7)V?A[2Zz]\d?\b/gi, 'N17A2')
    .replace(/\b(?:NIV|NT7|NI7)E[1Ili|!tTrR]?\b/gi, 'N17B1')
    .replace(/\bNAVARA\b/gi, 'N17A1')
    // N16 variants (N16, NI6, NIG, NIE, NNIE)
    .replace(/\b(?:NN|T)?N[Ili|!tT1][EeGg6](?=[A-DFOo0]|BB|FL)/gi, 'N16')
    // N15 variants (N15, NIS, N1S, NNIS)
    .replace(/\b(?:NN|T)?N[Ili|!tT1][Ss5](?=[A-DFOo0rReE]|BB|FL)/gi, 'N15')
    // N12 variants (N12, NI2, NT2)
    .replace(/\b[TNW]?N[Ili|!tT1]2(?=[A-DF]|BB|FL)/gi, 'N12')
    // N11 variants (N11, NI1, NII, NTI, NU, WN11)
    .replace(/\b(?:WN|T)?N[Ili|!tT1MVNAU][Ili|!tT1](?=[A-DFEeRr]|BB|FL)/gi, 'N11')
    .replace(/\bNU(?:FL|IRU|RUR|RS)([12]|\b)/gi, 'N11FL$1')
    // General digit repairs after aisle letter
    .replace(/\b([A-Z])[Oo](\d)/g, '$10$2')
    .replace(/\b([A-Z]\d)[Oo]/g, '$10')
    .replace(/\b([A-Z])[Il|tT](\d)/g, '$11$2')
    .replace(/\b([A-Z]\d)[Il|tT]([A-Z])/g, '$11$2')
    // دمج المسافة إن وُجدت بين رقم الممر Nxx ورمز الرف
    .replace(/\b(N\d{2})\s+(FL[12Il|!tT]|BB[12Il|!tT]|[A-D][12Il|!tT])\b/g, '$1$2')
    // إصلاح رمز الرف المزدوج BB (مثل N158B2, N158BR2, N15BR2, N15882, N15AN2, N15EE2 -> N15BB2)
    .replace(/\b(N\d{2})S?(?:8B|B8|88|8BR|BR|BBR|AN|EE|SS88|SB|BB)([12Il|!tT])\b/g, '$1BB$2')
    // إصلاح حرف D حين يُقرأ 0 أو O أو Q بين رقم الممر ورقم الرف (مثل N1502 -> N15D2, N16O1 -> N16D1, N1601 -> N16D1, N15O1 -> N15D1)
    .replace(/\b(N\d{2})[0OoQqV]([12Il|!tT])\b/g, '$1D$2')
    // إصلاح FL1 و FL2 (بما فيها EL1, RL1, FTR1, FLI, FLY, FL4, FLZ, FLQ, FLe, FU2, EC2, ETA, EUZ)
    .replace(/\b(N\d{2})(?:F[LI1tTrR]|E[LI1tT]|R[LI1tT]|SE[UT])[Ili|!tTY41sS]\b/g, '$1FL1')
    .replace(/\b(N\d{2})(?:F[LI1tTrRU]|E[LI1tTC]|R[LI1tT]|SE[UTCA])[ZzQRe2uU]\b/g, '$1FL2')
    // إصلاح NxxA1 / NxxA2 / NxxB1 / NxxB2 / NxxC1 / NxxC2
    .replace(/\b(N\d{2})V?A[Ili|!tTYLDrR1]\b/g, '$1A1')
    .replace(/\b(N\d{2})V?A[ZzR2]\d?\b/g, '$1A2')
    .replace(/\b(N\d{2})[B8E][Ili|!tTrR1]\b/g, '$1B1')
    .replace(/\b(N\d{2})[B8E][Zz2]\b/g, '$1B2')
    .replace(/\b(N\d{2})C[Ili|!tTrR1]\b/g, '$1C1')
    .replace(/\b(N\d{2})C[ZzE2]\b/g, '$1C2')
    .replace(/\b(N\d{2})D[Ili|!tTrR1]\b/g, '$1D1')
    .replace(/\b(N\d{2})D[Zz2]\b/g, '$1D2')
    .replace(/([A-Z]{1,3})[Il|tT]\b/g, '$11')
    .replace(/([A-Z]{1,3})[Oo]\b/g, '$10');

  const splitSapMatch = sapFixed.match(/^([A-Z]\d{2})\s+([A-Z]{1,3}\d{0,2})$/);
  if (splitSapMatch) {
    sapFixed = `${splitSapMatch[1]}${splitSapMatch[2]}`;
  }

  const stdSapBinMatch = sapFixed.match(/\b(N\d{2}(?:FL|BB|[A-D])[12])\b/);
  if (stdSapBinMatch) {
    const candidate = stdSapBinMatch[1].toUpperCase();
    LOCATION_CACHE.set(rawStr, candidate);
    return candidate;
  }

  const compactBinMatch = sapFixed.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{1,2})\b/);
  if (compactBinMatch) {
    let candidate = compactBinMatch[1].toUpperCase();
    candidate = candidate
      .replace(/^(N\d{2})O([12])$/, '$1D$2')
      .replace(/^(N\d{2})(?:EL|RL)([12])$/, '$1FL$2');
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

  // 3. Sandwich Context Smoothing (نوافذ 1 أو 2 سطر بين سطرين متطابقين في الموقع)
  for (let pass = 0; pass < 2; pass++) {
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
    for (let i = 1; i < normalized.length - 2; i++) {
      const prevLoc = normalized[i - 1].location_code;
      const afterTwoLoc = normalized[i + 2].location_code;
      if (
        prevLoc &&
        prevLoc === afterTwoLoc &&
        isValidSpecificLocation(prevLoc) &&
        (normalized[i].location_code !== prevLoc || normalized[i + 1].location_code !== prevLoc)
      ) {
        normalized[i].location = prevLoc;
        normalized[i].location_code = prevLoc;
        normalized[i + 1].location = prevLoc;
        normalized[i + 1].location_code = prevLoc;
      }
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
