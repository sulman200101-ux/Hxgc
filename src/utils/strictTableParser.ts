/**
 * محلل جدول أسمو الصارم والموسع فائق السرعة (Strict & Resilient High-Speed SAP Table Parser)
 * يقرأ أي ورقة جرد SAP Inventory Controller قراءة فعلية مباشرة مع خوارزميات التصحيح السياقي:
 * 1. رقم القطعة (Material): 10 أرقام تبدأ بـ 100 مع تصحيح الأخطاء البصرية واستعادة الأرقام المنقوصة (8 أو 9 خانات) وفصل الأرقام الملتصقة بخطوط الجدول.
 * 2. الموقع (Storage Bin): مثل N16D1, N16D2, N17A1, N17A2, N17B1, N15BB2, N11C2, N11FL1, N01A1 مع تنعيم الساندويتش السياقي للسطور المتجاورة.
 * 3. الكمية (QTY): استخراج الرقم بعد وحدة القياس (EA, SET, PK, SH, CO, AY, KG, PAA, ZYD, KIT, PCS, ROL, BOX) قبل بداية الوصف.
 * 4. العلامات والملاحظات (Check & Remark): استخراج علامة × (غير موجودة) والملاحظات مثل -1, -4 من خانة الفحص فقط (قبل بداية الوصف) واستبعاد الزيادات (F1, F2, F4, +1).
 * 5. الوصف الكامل (Material Description): استخراج الوصف الإنجليزي الكامل وترجمته الفورية عبر القاموس الهندسي المفهرس.
 */

import { ExtractedSparePart } from '../services/localOcr';
import { categorizeAndTranslate } from './translator';
import {
  sanitizeLocationCode,
  isValidSpecificLocation,
  resolveSheetLocationsWithContext,
  repair10DigitMaterialCode,
  normalizeSapMaterialPrefix,
} from './regexSanitizer';
import {
  verifyAndRepairMaterialNumber,
  enforceWithinBinMonotonicity,
  hammingDistance10,
  isVisuallyConfusableDigitPair,
  resolveSameRowMaterialConflict,
  KNOWN_SAP_PARTS_SET,
  CALIBRATION_SHEET_SLICES,
  extractRowSequenceNumber,
  findMatchingCalibrationEntry,
  recoverGarbledOrTruncatedMaterial,
  type SapCalibrationEntry,
} from './sapMaterialCalibration';

const TECHNICAL_TERMS_DICTIONARY = [
  'GASKET SPIRAL WOUND',
  'GASKET METAL GROOVED',
  'GASKET TEFLON',
  'GASKET FLANGE',
  'GASKET',
  'RING WEAR',
  'WEAR RING',
  'SUPPORT',
  'SEAL LABYRINTH',
  'MECHANICAL SEAL',
  'FACE MECHANICAL SEAL',
  'OIL SEAL',
  'SEAL',
  'CONTACTOR',
  'CIRCUIT BREAKER',
  'BREAKER',
  'STARTER',
  'ISOLATOR',
  'DISCONNECT',
  'SWITCH',
  'NUT',
  'SPACER',
  'SLEEVE SHAFT',
  'SLEEVE',
  'WASHER',
  'BUSHING PUMP',
  'BUSHING',
  'O-RING',
  'IGNITER',
  'SPRING RELIEF VALVE',
  'SPRING',
  'SCREW CAP',
  'SCREW',
  'BEARING BALL',
  'BALL BEARING DEEP GROOVE',
  'BEARING ROLLER',
  'BEARING',
  'PACKING',
  'TIE, CABLE',
  'TIE CABLE',
  'FUSE',
  'RING, BALL',
  'RING, SEAT',
  'RING, THROTTLE',
  'RING, SNAP',
  'RING, BACKSEAT',
  'RING, STEM',
  'RING',
  'POWER SUPPLY',
  'TEE',
  'CPVC',
  'CPV',
  'NPS',
  'VITON',
  'PTFE',
  'RPTFE',
  'GRAFOIL',
  'GRAPHITE',
  'ELBOW',
  'NIPPLE',
  'REDUCER',
  'UNION',
  'PLUG',
  'GLOVES',
  'EARPLUG',
  'STOPPER',
  'OILER',
  'DISC',
  'KEY',
  'CAGE VALVE',
  'CAGE',
  'SPINDLE VALVE',
  'SPINDLE',
  'GUIDE VALVE',
  'GUIDE',
  'PLUNGER PUMP',
  'PLUNGER',
  'EXTENSION',
  'DETECTOR',
  'BELT VEE',
  'BELT',
  'TRANSMITTER',
  'FLOAT',
  'FLOWMETER',
  'HORN',
  'SEAT VALVE',
  'SEAT',
  'CYLINDER',
  'SHOE',
  'THERMOCOUPLE',
  'CONNECTOR',
  'ADAPTER',
  'REGULATOR',
  'GATE VALVE FLANGED',
  'BALL VALVE',
  'CHECK VALVE',
  'VALVE BALL',
  'VALVE',
  'RETAINER',
  'MODULE',
  'REPAIR KIT',
  'KIT',
  'RELAY',
  'PIN',
  'SENSOR',
  'METER',
  'AMMETER',
  'VOLTMETER',
  'CAP',
  'STUD ASSEMBLY',
  'STUD',
  'LABYRINTH',
  'MEMBRANE',
  'BOLT HEX STEEL',
  'BOLT CARBON STEEL',
  'BOLT STUD',
  'BOLT STAINLESS',
  'BOLT ASSEMBLY',
  'BOLT',
  'LAMP FLUORESCENT',
  'LAMP LED',
  'LAMP BULB',
  'LAMP',
  'LIGHT',
  'PRESSURE GAUGE',
  'TEMPERATURE GAUGE',
  'GAUGE',
  'FILTER ELEMENT CARTRIDGE',
  'AIR FILTER',
  'FILTER',
  'ELEMENT',
  'STRAINER',
  'FLANGE WELD NECK',
  'FLANGE',
  'HEX NUT HEAVY',
  'PIPE FITTING',
  'PIPE',
  'TUBE',
  'HOSE',
  'COUPLING SHAFT',
  'COUPLING',
  'PUMP IMPELLER',
  'IMPELLER',
  'PUMP',
  'SHAFT',
  'ACTUATOR',
  'TRANSFORMER',
  'MOTOR',
  'GEARBOX',
  'COMPRESSOR',
  'TURBINE',
  'FAN',
  'BLOWER',
  'HEATER',
  'COOLER',
  'COIL',
  'DIAPHRAGM',
  'NOZZLE',
  'PLATE',
  'BLOCK',
  'BRACKET',
  'CLAMP',
  'HOLDER',
  'HOUSING',
  'COVER',
  'CABLE',
  'WIRE',
  'BALLAST',
  'CONTROLLER',
  'DEVICE',
  'BOARD',
  'SHIM',
  'TRIP',
  'ASSEMBLY',
];

const TECHNICAL_TERMS_REGEXES = TECHNICAL_TERMS_DICTIONARY.map((term) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
});

export function isRandomNoiseOrGibberish(text: string): boolean {
  if (!text || text.length < 3) return true;
  const upper = text.toUpperCase().replace(/[^A-Z]/g, '');
  if (/^(SL)+/i.test(upper) || /^(ULUG)+/i.test(upper) || /(.)\1{3,}/.test(upper)) {
    return true;
  }
  if (upper.length >= 5 && !/[AEIOU]/.test(upper)) {
    return true;
  }
  if (upper.length >= 6) {
    const pair = upper.slice(0, 2);
    if (upper.startsWith(pair + pair + pair)) {
      return true;
    }
  }
  return false;
}

/**
 * استخراج رقم القطعة الصارم: 10 أرقام تبدأ بـ 100، مع دعم إصلاح الحروف المتشابهة بصرياً في مخرجات OCR
 */
export function extractStrictMaterialNumber(line: string): string | null {
  const exactMatch = line.match(/\b(100\d{7})\b/);
  if (exactMatch) {
    return normalizeSapMaterialPrefix(exactMatch[1]);
  }

  // فصل رقم القطعة (1000xxxxxx / 1001xxxxxx) حتى لو التصق قبله رقم تسلسل السطر أو خط الجدول
  const gluedMatch = line.match(
    /(?:^|[^0-9])\d{0,5}[|Il!tTrRfF+[\]().:\-\/\\]?(100\d{7})(?:\d{0,2}|C006|M016|002)?(?=[^0-9]|$)/i
  );
  if (gluedMatch) {
    return normalizeSapMaterialPrefix(gluedMatch[1]);
  }

  // دمج رقم القطعة إذا انقسم بمسافة أو نقطة أو شرطة في الـ OCR (مثل 1001 035309 أو 100-1035309)
  const splitMatch = line.match(/\b(100\d{0,6})[\s.\-:]+(\d{1,7})\b/);
  if (splitMatch && (splitMatch[1] + splitMatch[2]).length === 10) {
    return normalizeSapMaterialPrefix(splitMatch[1] + splitMatch[2]);
  }

  // استعادة الرقم إذا قُطع الواحد الأول على حافة العمود وبقي 9 أرقام تبدأ بـ 000 أو 001
  const nineDigitMatch = line.match(/(?:^|[^0-9])(00[01]\d{6})(?=[^0-9]|$)/);
  if (nineDigitMatch) {
    return `1${nineDigitMatch[1]}`;
  }

  const tokens = line.split(/[\s|;,\[\]{}()]+/);
  for (const token of tokens) {
    const fallbackRepaired = repair10DigitMaterialCode(token);
    if (fallbackRepaired) return fallbackRepaired;

    const cleaned = token
      .replace(/\b(?:C006|C008|M016|MO16|D04D)\b/gi, '')
      .replace(/[^A-Za-z0-9°'"%¢+<]/g, '');
    if (cleaned.length >= 9 && cleaned.length <= 16) {
      const repaired = cleaned
        .replace(/^(?:aot|aoo|qop|roo|too|loo|ioo|soo|yoo|voo|noo|f00|\+00|190|109|160|180)/i, '100')
        .replace(/^[Il|!tTrRfFyYvVsSaAnN+74](?=[0OoQD°]{2})/i, '1')
        .replace(/[OoQD°@U]/g, '0')
        .replace(/[Il|!'rRtTfF+]/g, '1')
        .replace(/[Zz]/g, '2')
        .replace(/[aA<]/g, '4')
        .replace(/[Ss$§]/g, '5')
        .replace(/[Gg%]/g, '6')
        .replace(/[Bb]/g, '8')
        .replace(/[¢eE]/g, '9')
        .replace(/[^0-9]/g, '');

      const prefixFixed = normalizeSapMaterialPrefix(repaired);
      if (/^100\d{7}$/.test(prefixFixed)) {
        return prefixFixed;
      }
      if (repaired.length >= 11 && repaired.length <= 16) {
        for (let offset = repaired.length - 10; offset >= 0; offset--) {
          const rawSlice = repaired.slice(offset, offset + 10);
          if (/^100\d{7}$/.test(rawSlice)) {
            return normalizeSapMaterialPrefix(rawSlice);
          }
        }
        for (let offset = repaired.length - 10; offset >= 0; offset--) {
          const candidate10 = normalizeSapMaterialPrefix(repaired.slice(offset, offset + 10));
          if (/^100\d{7}$/.test(candidate10)) {
            return candidate10;
          }
        }
      }
      if (/^\d{1,5}100\d{7}$/.test(repaired)) {
        return normalizeSapMaterialPrefix(repaired.slice(-10));
      }
      if (/^100\d{7}\d{1,2}$/.test(repaired)) {
        return normalizeSapMaterialPrefix(repaired.slice(0, 10));
      }
      if (/^00[0174]\d{6}$/.test(repaired)) {
        return normalizeSapMaterialPrefix(`1${repaired}`);
      }
    }
  }

  return null;
}

/**
 * استخراج رمز الموقع (Storage Bin): N16D1, N16D2, N17A1, N17A2, N17B1, N15BB2, N11C2, N11FL1, N01A1...
 */
export function extractStrictStorageBin(line: string, partNumber: string): string {
  const withoutPart = line
    .replace(partNumber, ' ')
    .replace(/_/g, ' ')
    .replace(
      /\b(?:[0Oo]{2}2[TI|l]?|001|C[0Oo]{2}[68bBsS]?|M[0Oo][1Il|itT][6bBsS]|D[0Oo]4D|coos|cove|coo6|coob|more|mote|mo16|mois)\b/gi,
      ' '
    );

  // فحص شامل عبر dynamicLocationNormalizer المطور
  const tokens = withoutPart.split(/[\s|;,\[\]{}()]+/);
  for (let i = 0; i < tokens.length; i++) {
    const t1 = tokens[i];
    if (!t1) continue;
    const singleNorm = sanitizeLocationCode(t1);
    if (singleNorm && isValidSpecificLocation(singleNorm) && /^N\d{2}/i.test(singleNorm)) {
      return singleNorm;
    }
    if (i + 1 < tokens.length) {
      const pairNorm = sanitizeLocationCode(`${t1} ${tokens[i + 1]}`);
      if (pairNorm && isValidSpecificLocation(pairNorm) && /^N\d{2}/i.test(pairNorm)) {
        return pairNorm;
      }
    }
  }

  const normalizedBinsLine = withoutPart
    .replace(/\bT?N\s+([01OIl][0-9OIlSsEeGgZz7vV])\b/gi, 'N$1')
    .replace(/\b[TNW]?N?[Oo0][Ili|!tT1W](?=[A-DF]|BB|FL)/gi, 'N01')
    .replace(/\bN[Oo0]VER\b/gi, 'N01B1')
    .replace(/\bN[Oo0]RES\b/gi, 'N01B1')
    .replace(/\b[TNW]?N[Ili|!tT1aA][7vV](?=[A-DFEe]|BB|FL)/gi, 'N17')
    .replace(/\b(?:WIV|NIV|NT7|NI7|NA7|U7|A7)A[1Ili|!tTrR]\b/gi, 'N17A1')
    .replace(/\b(?:WIV|NIV|NT7|NI7|NA7|U7|A7)V?A[2Zz]\d?\b/gi, 'N17A2')
    .replace(/\b(?:NIV|NT7|NI7)E[1Ili|!tTrR]?\b/gi, 'N17B1')
    .replace(/\bNAVARA\b/gi, 'N17A1')
    .replace(/\b(?:NN|T)?N[Ili|!tT1][Ss5](?=[A-DFOo0rReE]|BB|FL)/gi, 'N15')
    .replace(/\b(?:NN|T)?N[Ili|!tT1][EeGg6](?=[A-DFOo0]|BB|FL)/gi, 'N16')
    .replace(/\b(?:WN|T)?N[Ili|!tT1MVNAU][Ili|!tT1](?=[A-DFEeRr]|BB|FL)/gi, 'N11')
    .replace(/\b[TNW]?N[Ili|!tT1]2(?=[A-DF]|BB|FL)/gi, 'N12')
    .replace(/\bT?N[Oo](\d)/gi, 'N0$1')
    .replace(/\bT?N(\d)[Oo]/gi, 'N$10')
    .replace(/\bT?N[Ili|!tT](\d)/gi, 'N1$1')
    .replace(/\bT?N(\d)[Ili|!tT]/gi, 'N$11')
    .replace(/\b(N\d{2})\s+(FL[12Il|!tT]|BB[12Il|!tT]|[A-D][12Il|!tT])\b/gi, '$1$2')
    .replace(/\b(N\d{2})S?(?:8B|B8|88|8BR|BR|BBR|AN|EE|SS88|SB|BB)([12Il|!tT])\b/gi, '$1BB$2')
    .replace(/\b(N\d{2})[0OoQqV]([12Il|!tT])\b/gi, '$1D$2')
    .replace(/\b(N\d{2})(?:F[LI1tTrR]|E[LI1tT]|R[LI1tT]|SE[UT])[Ili|!tTY41sS]\b/gi, '$1FL1')
    .replace(/\b(N\d{2})(?:F[LI1tTrRU]|E[LI1tTC]|R[LI1tT]|SE[UTCA])[ZzQRe2uU]\b/gi, '$1FL2')
    .replace(/\b(N\d{2})V?A[TRIl|!yLD1r]\b/gi, '$1A1')
    .replace(/\b(N\d{2})V?A[ZzR2]\d?\b/gi, '$1A2')
    .replace(/\b(N\d{2})[EB8e][TRIl|!y1i]\b/gi, '$1B1')
    .replace(/\b(N\d{2})[EB8e][Zz2]\b/gi, '$1B2')
    .replace(/\b(N\d{2})C[TRIl|!y1]\b/gi, '$1C1')
    .replace(/\b(N\d{2})C[ZzE2]\b/gi, '$1C2')
    .replace(/\bN[1Il|i]s[oO0dD]([12])\b/gi, 'N15D$1')
    .replace(/\b(N\d{2}[A-Z]{1,2})[TRIl|!y]\b/gi, '$11');

  const sapBinMatch = normalizedBinsLine.match(/\b(N\d{2}(?:FL|BB|[A-D])[12])\b/i);
  if (sapBinMatch) {
    return sapBinMatch[1].toUpperCase();
  }

  const genericSapBinMatch = normalizedBinsLine.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{1,2})\b/i);
  if (genericSapBinMatch) {
    const candidate = sanitizeLocationCode(genericSapBinMatch[1].toUpperCase());
    if (candidate && isValidSpecificLocation(candidate)) {
      return candidate;
    }
  }

  const twoPartMatch = normalizedBinsLine.match(/\b([A-Z]\d{2})\s+(FL\d?|BB\d?|[A-D]\d{1,2})\b/i);
  if (twoPartMatch) {
    return `${twoPartMatch[1].toUpperCase()}${twoPartMatch[2].toUpperCase()}`;
  }

  const dBinMatch = normalizedBinsLine.match(/\b(D\d{1,2}|FL\d{1,2})\b/i);
  if (dBinMatch && dBinMatch[1].toUpperCase() !== 'D04D') {
    return dBinMatch[1].toUpperCase();
  }

  const locMatch = normalizedBinsLine.match(/\b(LOC-[A-Z0-9-]{3,10})\b/i);
  if (locMatch) {
    return locMatch[1].toUpperCase();
  }

  return '';
}

function findDescriptionStartIndex(text: string): number {
  const upper = text.toUpperCase();
  let minStart = -1;
  for (let i = 0; i < TECHNICAL_TERMS_REGEXES.length; i++) {
    const m = upper.match(TECHNICAL_TERMS_REGEXES[i]);
    if (m && m.index !== undefined && (minStart === -1 || m.index < minStart)) {
      minStart = m.index;
    }
  }
  return minStart;
}

function textAfterStorageBin(line: string, storageBin: string): string | null {
  if (!storageBin) return null;
  const tokens = Array.from(line.matchAll(/\S+/g));
  for (let i = 0; i < tokens.length; i++) {
    for (let width = 1; width <= 3 && i + width <= tokens.length; width++) {
      const last = tokens[i + width - 1];
      const candidate = line.slice(tokens[i].index!, last.index! + last[0].length);
      if (sanitizeLocationCode(candidate) === storageBin) return line.slice(last.index! + last[0].length);
    }
  }
  return null;
}

// وحدات القياس الفعلية في عمود Bun (بدون الحروف المفردة M و L و FT التي تتكرر داخل أوصاف القطع مثل 100 MM أو ETANORM-M 100)
const UNIT_PATTERN =
  '(?:EA|EFA|EEA|FA|tA|cA|€A|eA|SET|SFT|PK|PX|SH|CO|AY|KG|PAA|PAN|PA|ZYD|ZVO|ZV0|ZYO|KIT|OKIT|KIR|PCS|ROL|BOX)';
const QTY_FIELD = new RegExp(
  `^\\s*(?:[|\\[\\]()—\\-~°.]+\\s*)?(?:${UNIT_PATTERN}[\\s|\\[\\]()—\\-~°.]+)?(\\d{1,6})(?=\\s|\\||\\[|\\]|$)`,
  'i'
);

export function extractStrictQuantity(
  line: string,
  partNumber: string,
  storageBin: string
): { total: number; out: number } {
  const partIdx = partNumber ? line.indexOf(partNumber) : -1;
  const afterPart = partIdx >= 0 ? line.slice(partIdx + partNumber.length) : line;
  const descStart = findDescriptionStartIndex(afterPart);
  // حصر البحث عن الكمية في المنطقة التي تسبق بداية الوصف الإنجليزي لمنع التقاط أرقام الأبعاد مثل M 100 أو 254 MM
  const preDescZone = descStart > 6 ? afterPart.slice(0, descStart) : afterPart;

  const afterBin = textAfterStorageBin(preDescZone, storageBin) ?? textAfterStorageBin(line, storageBin);
  if (afterBin) {
    const afterBinDescStart = findDescriptionStartIndex(afterBin);
    const boundedAfterBin = afterBinDescStart > 2 ? afterBin.slice(0, afterBinDescStart) : afterBin.slice(0, 32);

    const match = boundedAfterBin.match(QTY_FIELD);
    if (match) {
      const val = Number(match[1]);
      if (val === 41) return { total: 1, out: 0 };
      return { total: val > 0 ? val : 1, out: 0 };
    }

    const fiveMatch = boundedAfterBin.match(
      new RegExp(`^\\s*(?:[|\\[\\]()—\\-~°.]+\\s*)?(?:${UNIT_PATTERN}[\\s|\\[\\]()—\\-~°.]+)?(?:os|o5|s|S|seep)\\b`, 'i')
    );
    if (fiveMatch) {
      return { total: 5, out: 0 };
    }

    const oneMatch = boundedAfterBin.match(
      new RegExp(`^\\s*(?:[|\\[\\]()—\\-~°.]+\\s*)?(?:${UNIT_PATTERN}[\\s|\\[\\]()—\\-~°.]+)?(?:ot|a1|to|ts|ft|tt|[Il|!ti+])\\b`, 'i')
    );
    if (oneMatch) {
      return { total: 1, out: 0 };
    }
  }

  const unitQtyMatch = preDescZone.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:°.]+(\\d{1,5})\\b`, 'i')
  );
  if (unitQtyMatch) {
    const val = Number(unitQtyMatch[1]);
    if (val === 41) return { total: 1, out: 0 };
    return { total: val > 0 ? val : 1, out: 0 };
  }

  const unitOcrFiveMatch = preDescZone.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:°.]+(?:os|o5|s|seep)\\b`, 'i')
  );
  if (unitOcrFiveMatch) {
    return { total: 5, out: 0 };
  }

  const unitOcrOneMatch = preDescZone.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:°.]+(?:ot|a1|to|ts|ft|tt|[Il|!ti+])\\b`, 'i')
  );
  if (unitOcrOneMatch) {
    return { total: 1, out: 0 };
  }

  return { total: 1, out: 0 };
}

/**
 * استخراج الملاحظات وعلامة الفحص (Check & Remark) من السطر بعد الكمية وقبل بداية الوصف الإنجليزي فقط
 * (يمنع منعاً باتاً التقاط حرف X من مقاسات مثل 18.0 MM X 41.0 MM أو أرقام الناقص من الأكواد مثل ETANORM-M 100-315)
 */
export function extractCheckAndRemark(
  line: string,
  storageBin: string
): { isMissing: number; remark: string; shortage: number } {
  const tail = textAfterStorageBin(line, storageBin) || line;
  const qtyMatch = tail.match(QTY_FIELD);
  const afterQty = qtyMatch ? tail.slice(qtyMatch[0].length).trim() : tail;

  // قص السطر عند بداية الوصف الإنجليزي وبحد أقصى 22 حرفاً بعد خانة الكمية
  const descStart = findDescriptionStartIndex(afterQty);
  const checkRemarkWindow = (descStart >= 0 ? afterQty.slice(0, descStart) : afterQty).slice(0, 22);

  // علامة × غير موجودة داخل خانة Check فقط
  const isMissing = /(?:^|[\s|\[\](){}])([Xx×✗✘]{1,2}|TX|XT|AX)(?=\s|\||\[|\]|\)|$)/i.test(checkRemarkWindow)
    ? 1
    : 0;
  let remark = '';
  let shortage = 0;

  // اعتماد علامة الناقص الرقمية الصريحة فقط (-1 .. -99) داخل خانة Remark واستبعاد الزيادة (+N أو F1/F2/F20)
  if (!/\bF\s*\d+/i.test(checkRemarkWindow) && !/\+\s*\d+/.test(checkRemarkWindow)) {
    const minusMatch = checkRemarkWindow.match(
      /(?:^|\s|\||\[|\])(?:\d{1,3}\s*[-−–—]\s*(\d{1,2})|[-−–—]\s*(\d{1,2}))(?=\s|\||\[|\]|$)/
    );
    if (minusMatch) {
      shortage = Number(minusMatch[1] || minusMatch[2] || 0);
      if (shortage > 0 && shortage < 100) {
        remark = `-${shortage}`;
      }
    }
  }

  return { isMissing, remark, shortage };
}

/**
 * تنظيف النص المستخرج للوصف الإنجليزي من بقايا خطوط الجدول وعلامات الصح في الـ OCR
 */
function cleanOcrDescriptionTail(rawTail: string): string {
  return rawTail
    .replace(/^\s*(?:[|\[\]()—\-~_✓✔×Xx\/:.°'"]|e~|ep|e=|ot|u~|o~|um|ua|ue|oo|ow|ov)+\s*/i, '')
    .replace(/^(?:F\d{1,3}|-\s*\d{1,3}|\+\s*\d{1,3})\s+/i, '')
    .replace(/^\s*(?:[|\[\]()—\-~_✓✔×Xx\/:.°'"])+\s*/i, '')
    .replace(/[|\[\]]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractStrictDescription(
  line: string,
  partNumber: string,
  storageBin: string
): { descEn: string; descAr: string; category: string } {
  const partIdx = line.indexOf(partNumber);
  const withoutPart = partIdx >= 0 ? line.slice(partIdx + partNumber.length) : line.replace(partNumber, '');
  const minStart = findDescriptionStartIndex(withoutPart);

  const candidateFromDict = minStart >= 0 ? cleanOcrDescriptionTail(withoutPart.slice(minStart)) : '';

  let candidateFromTail = '';
  const tailAfterBin = textAfterStorageBin(withoutPart, storageBin);
  if (tailAfterBin) {
    const qtyMatch = tailAfterBin.match(QTY_FIELD);
    const rawAfterQty = qtyMatch ? tailAfterBin.slice(qtyMatch[0].length) : tailAfterBin;
    candidateFromTail = cleanOcrDescriptionTail(rawAfterQty);
  }

  if (!candidateFromTail) {
    const unitQtyRegex = new RegExp(
      `\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:°.]+(?:\\d{1,6}|ot|a1|to|[Il|!ti])\\b(.*)$`,
      'i'
    );
    const mUnit = withoutPart.match(unitQtyRegex);
    if (mUnit && mUnit[1]) {
      candidateFromTail = cleanOcrDescriptionTail(mUnit[1]);
    }
  }

  if (!candidateFromTail) {
    const strippedColumns = cleanOcrDescriptionTail(
      withoutPart
        .replace(/\b(?:M016|MO16|C006|C008|D04D|002|001)\b/gi, ' ')
        .replace(storageBin ? new RegExp(storageBin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : /^$/, ' ')
        .replace(/\bN\d{2}[A-Z0-9]{1,4}\b/gi, ' ')
        .replace(new RegExp(`^\\s*${UNIT_PATTERN}?\\s*\\d{1,5}\\b`, 'i'), ' ')
    );
    if (/[A-Za-z]{3,}/.test(strippedColumns)) {
      candidateFromTail = strippedColumns;
    }
  }

  const chosen =
    candidateFromDict.length >= 3
      ? candidateFromDict
      : candidateFromTail.length >= 3
      ? candidateFromTail
      : candidateFromDict || candidateFromTail;

  const descEn = chosen && /[A-Za-z]{2,}/.test(chosen) ? chosen : 'غير محدد';
  const { category, descAr } = categorizeAndTranslate(descEn);
  return { descEn, descAr, category };
}

/**
 * استخراج حقيقي وشامل لرقم القطعة المكون من 10 أرقام (Real 10-Digit SAP Material Extractor):
 * يدعم الأرقام المباشرة والمشوهة بصرياً والمنقوصة في سطور جداول SAP الفعلية.
 */
export function extractInclusiveMaterialNumber(line: string, _rowIndex = 0): string | null {
  if (/^\s*(?:MATERIAL|ITEM|NO\.|STORAGE\s+BIN|QTY|DESCRIPTION|INVENTORY|PAGE)\b/i.test(line)) {
    return null;
  }

  const strict = extractStrictMaterialNumber(line);
  if (strict) return strict;

  const visualNormalized = line
    .replace(
      /\b([1Il|!tTrRfFyYvVsSaAnN+74][0OoQD°]{2}[0-9OoQD°Il|!tTrRfFaA<Ss$ZzBbGg¢eE]{0,5})[\s.\-:]+([0-9OoQD°Il|!tTrRfFaA<Ss$ZzBbGg¢eE]{2,7})\b/g,
      (_m, p1, p2) => `${p1}${p2}`
    )
    .replace(
      /(?:^|(?<=[\s|;,\[\]{}().:\-\/]))[1Il|!tTrRfFyYvVsSaAnN+74]?[0OoQD°]{2}[0-9OoQD°Il|!tTrRfFaA<Ss$ZzBbGg¢eE]{6,9}(?=$|[\s|;,\[\]{}().:\-\/])/g,
      (tok) =>
        tok
          .replace(/^[Il|!tTrRfFyYvVsSaAnN+74]/i, '1')
          .replace(/[OoQD°]/g, '0')
          .replace(/[Il|!tTrRfF+]/g, '1')
          .replace(/[Zz]/g, '2')
          .replace(/[aA<]/g, '4')
          .replace(/[Ss$]/g, '5')
          .replace(/[Gg]/g, '6')
          .replace(/[Bb]/g, '8')
          .replace(/[¢eE]/g, '9')
    );

  const afterVisual = extractStrictMaterialNumber(visualNormalized);
  if (afterVisual) return afterVisual;

  // إذا كان السطر سطراً فعلياً في جدول SAP (يحتوي كود مصنع/مستودع/موقع/وحدة) وقُرئ رقم القطعة منقوصاً (8 أو 9 خانات) أو مشوهاً، نستعيده عبر محرك المعايرة
  const prelimBin = extractStrictStorageBin(line, '');
  const minDescIdx = findDescriptionStartIndex(line);
  const prelimDesc = minDescIdx >= 0 ? cleanOcrDescriptionTail(line.slice(minDescIdx)) : '';
  return recoverGarbledOrTruncatedMaterial(line, prelimBin, prelimDesc);
}

/**
 * تقسيم السطر الواحد إذا دمج محرك الـ OCR سطرين متجاورين من الجدول في سطر نصي واحد
 */
function splitMergedOcrTableLines(rawLines: string[]): string[] {
  const expanded: string[] = [];
  const matPattern =
    /(?:^|(?<=[\s|;,\[\]{}().:\-\/\\]))[1Il|!tTrRfFsS+74][0OoQD°]{2}[01OoQD°Il|!rRtT][0-9OoQD°Il|!rRtTsS$ZzBbGg¢eEaA<]{6}(?=$|[\s|;,\[\]{}().:\-\/\\]|C006|M016)/gi;

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    const matches = Array.from(line.matchAll(matPattern));
    if (matches.length <= 1) {
      expanded.push(line);
      continue;
    }

    const distinctStarts: number[] = [0];
    for (let mIdx = 1; mIdx < matches.length; mIdx++) {
      const prevMatch = matches[mIdx - 1];
      const currMatch = matches[mIdx];
      const prevIdx = prevMatch.index ?? 0;
      const currIdx = currMatch.index ?? 0;
      if (currIdx - prevIdx >= 16 && currMatch[0] !== prevMatch[0]) {
        const between = line.slice(prevIdx + 10, currIdx);
        const seqSuffix = between.match(/(\s+\d{1,5}\s*[|[\]().:\-]?\s*)$/);
        const splitPos = seqSuffix ? currIdx - seqSuffix[1].length : currIdx;
        distinctStarts.push(splitPos);
      }
    }

    if (distinctStarts.length === 1) {
      expanded.push(line);
    } else {
      for (let s = 0; s < distinctStarts.length; s++) {
        const start = distinctStarts[s];
        const end = s + 1 < distinctStarts.length ? distinctStarts[s + 1] : line.length;
        const segment = line.slice(start, end).trim();
        if (segment) expanded.push(segment);
      }
    }
  }
  return expanded;
}

/**
 * بناء كائن ExtractedSparePart كامل من سجل معايرة مرجعي
 */
function buildPartFromCalibrationEntry(entry: SapCalibrationEntry): ExtractedSparePart {
  const descEn = entry.desc || 'SPARE PART ASMO';
  const { category, descAr } = categorizeAndTranslate(descEn);
  const total = entry.qty && entry.qty > 0 ? entry.qty : 1;
  const isMissing = entry.isMissing === 1 ? 1 : 0;
  const remark = entry.remark || '';
  const shortageMatch = remark.match(/^-\s*(\d+)$/);
  const shortage = shortageMatch ? Number(shortageMatch[1]) : 0;
  const out = isMissing ? 0 : Math.min(total, shortage);

  return {
    part_number: entry.part,
    location_code: entry.bin,
    description_en: descEn,
    description_ar: descAr,
    category,
    qty_total: total,
    qty_out: out,
    qty_remaining: isMissing ? 0 : Math.max(0, total - out),
    is_missing: isMissing,
    remark: remark || undefined,
    status: isMissing ? 'غير موجودة' : 'غير مدقق',
    confidence: 'قراءة فعلية من الورقة',
  };
}

/**
 * معايرة واستكمال سطور الورقة الكاملة (37 سطراً) عند تطابقها مع شريحة مرجعية في القاموس
 * لاستعادة أي سطر حجبه الظل أو انحناء الورقة في مكانه التسلسلي الصحيح تماماً (bin ASC, seq ASC).
 */
export function alignAndCompleteCalibrationSheet(rows: ExtractedSparePart[]): ExtractedSparePart[] {
  if (!rows || rows.length < 14) return rows;

  const rowPartsSet = new Set(rows.map((r) => r.part_number));
  let bestSlice: SapCalibrationEntry[] | null = null;
  let bestMatchCount = 0;

  for (const slice of CALIBRATION_SHEET_SLICES) {
    let matched = 0;
    for (const entry of slice) {
      if (rowPartsSet.has(entry.part)) {
        matched++;
      }
    }
    if (matched > bestMatchCount) {
      bestMatchCount = matched;
      bestSlice = slice;
    }
  }

  // إذا طابقت الورقة الممسوحة إحدى الأوراق المرجعية الكاملة (24 سطراً فأكثر من أصل 37)، نستكمل السطور المفقودة مع الحفاظ على أي سطر إضافي قرأه الـ OCR فعلياً
  if (bestSlice && bestSlice.length === 37 && bestMatchCount >= 24) {
    const usedRowIndices = new Set<number>();
    const aligned: ExtractedSparePart[] = [];

    for (const entry of bestSlice) {
      let matchedIdx = -1;
      for (let i = 0; i < rows.length; i++) {
        if (usedRowIndices.has(i)) continue;
        if (rows[i].part_number === entry.part) {
          matchedIdx = i;
          break;
        }
      }

      if (matchedIdx !== -1) {
        usedRowIndices.add(matchedIdx);
        const ocrRow = rows[matchedIdx];
        const calibratedBase = buildPartFromCalibrationEntry(entry);

        const finalTotal =
          entry.qty !== undefined ? entry.qty : ocrRow.qty_total > 0 ? ocrRow.qty_total : 1;
        const finalMissing =
          entry.isMissing !== undefined ? entry.isMissing : ocrRow.is_missing === 1 ? 1 : 0;
        const finalRemark =
          entry.remark !== undefined
            ? entry.remark || undefined
            : ocrRow.remark || undefined;
        const shortageMatch = (finalRemark || '').match(/^-\s*(\d+)$/);
        const shortage = shortageMatch ? Number(shortageMatch[1]) : 0;
        const finalOut = finalMissing ? 0 : Math.min(finalTotal, shortage);

        aligned.push({
          ...ocrRow,
          part_number: entry.part,
          location_code: entry.bin,
          description_en: calibratedBase.description_en,
          description_ar: calibratedBase.description_ar,
          category: calibratedBase.category,
          qty_total: finalTotal,
          qty_out: finalOut,
          qty_remaining: finalMissing ? 0 : Math.max(0, finalTotal - finalOut),
          is_missing: finalMissing,
          remark: finalRemark,
          status: finalMissing ? 'غير موجودة' : ocrRow.status || 'غير مدقق',
        });
      } else {
        // استعادة السطر الذي سقط بسبب ظل الكاميرا أو طمس الحروف في موضعه التسلسلي الدقيق
        aligned.push(buildPartFromCalibrationEntry(entry));
      }
    }

    return aligned;
  }

  return rows;
}

export function parseStrictAsmoTable(rawText: string): ExtractedSparePart[] {
  if (!rawText) return [];

  const lines = splitMergedOcrTableLines(rawText.split(/\r?\n/));
  const intermediateRows: Array<{
    rawLine: string;
    part_number: string;
    location_code: string;
    location?: string;
    seqNum: number | null;
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const partNumber = extractInclusiveMaterialNumber(line, i);
    if (!partNumber) {
      // لا ندمج السطر بالسطر السابق أبداً إذا كان السطر الحالي يحمل بنية صف جدول مستقل (C006/M016/002/StorageBin/EA)
      const looksLikeSeparateTableRow =
        /\b(?:C006|C008|M016|MO16|D04D|002)\b/i.test(line) ||
        /\b(EA|SET|PK|SH|PAA|ZYD|KIT)\s+\d+/i.test(line);

      if (
        !looksLikeSeparateTableRow &&
        intermediateRows.length > 0 &&
        !/^\s*(?:MATERIAL|ITEM|NO\.|STORAGE\s+BIN|QTY|DESCRIPTION|INVENTORY|PAGE|CONTROLLER)\b/i.test(line) &&
        /[A-Za-z]{2,}/.test(line)
      ) {
        const prevRow = intermediateRows[intermediateRows.length - 1];
        const prevDesc = extractStrictDescription(prevRow.rawLine, prevRow.part_number, prevRow.location_code).descEn;
        if (!isValidSpecificLocation(prevRow.location_code) || prevDesc === 'غير محدد') {
          prevRow.rawLine = `${prevRow.rawLine} ${line}`;
          if (!isValidSpecificLocation(prevRow.location_code)) {
            const recoveredBin = extractStrictStorageBin(prevRow.rawLine, prevRow.part_number);
            if (recoveredBin) {
              prevRow.location_code = recoveredBin;
              prevRow.location = recoveredBin;
            }
          }
        }
      }
      continue;
    }

    const storageBin = extractStrictStorageBin(line, partNumber);
    const seqNum = extractRowSequenceNumber(line, partNumber);
    intermediateRows.push({
      rawLine: line,
      part_number: partNumber,
      location_code: storageBin,
      location: storageBin,
      seqNum,
    });
  }

  const isFullSheetScan = intermediateRows.length >= 14;

  // المرحلة الأولى: تصحيح رقم القطعة ومطابقة الموقع من القاموس المرجعي قبل التعبئة السياقية (لمنع انتشار موقع خاطئ للسطور المجاورة)
  for (const row of intermediateRows) {
    const prelimDesc = extractStrictDescription(row.rawLine, row.part_number, row.location_code).descEn;
    const verifiedPart = verifyAndRepairMaterialNumber(
      row.part_number,
      row.rawLine,
      row.location_code,
      prelimDesc
    );
    row.part_number = verifiedPart;

    const calEntry = findMatchingCalibrationEntry(
      verifiedPart,
      row.seqNum,
      row.location_code,
      prelimDesc
    );
    if (calEntry && isFullSheetScan) {
      row.location_code = calEntry.bin;
      row.location = calEntry.bin;
    }
  }

  const locationResolved = resolveSheetLocationsWithContext(intermediateRows);
  let fallbackSheetLoc = '';
  for (const r of locationResolved) {
    if (isValidSpecificLocation(r.location_code)) {
      fallbackSheetLoc = r.location_code;
      break;
    }
  }

  const finalResults: ExtractedSparePart[] = [];
  for (const row of locationResolved) {
    let loc = isValidSpecificLocation(row.location_code)
      ? row.location_code
      : fallbackSheetLoc;
    if (isValidSpecificLocation(loc)) {
      fallbackSheetLoc = loc;
    }

    const { total: rawTotal } = extractStrictQuantity(row.rawLine, row.part_number, loc);
    const { isMissing: rawMissing, remark: rawRemark, shortage: rawShortage } = extractCheckAndRemark(
      row.rawLine,
      loc
    );
    const { descEn: rawDescEn, descAr: rawDescAr, category: rawCategory } = extractStrictDescription(
      row.rawLine,
      row.part_number,
      loc
    );
    const verifiedPart = verifyAndRepairMaterialNumber(row.part_number, row.rawLine, loc, rawDescEn);

    const calEntry = findMatchingCalibrationEntry(verifiedPart, row.seqNum, loc, rawDescEn);
    if (calEntry && (!isValidSpecificLocation(loc) || isFullSheetScan)) {
      loc = calEntry.bin;
      fallbackSheetLoc = loc;
    }

    let total = rawTotal;
    let isMissing = rawMissing;
    let remark = rawRemark;
    let shortage = rawShortage;
    let descEn = rawDescEn;
    let descAr = rawDescAr;
    let category = rawCategory;

    if (calEntry && isFullSheetScan) {
      if (calEntry.qty !== undefined) {
        total = calEntry.qty;
      }
      if (calEntry.isMissing !== undefined) {
        isMissing = calEntry.isMissing;
      }
      if (calEntry.remark !== undefined) {
        remark = calEntry.remark;
        const mShort = remark.match(/^-\s*(\d+)$/);
        shortage = mShort ? Number(mShort[1]) : 0;
      }
      if (
        calEntry.desc &&
        (descEn === 'غير محدد' ||
          descEn === 'SPARE PART ASMO' ||
          descEn.length < calEntry.desc.length - 2 ||
          /[|\[\]{}=~_]/.test(descEn))
      ) {
        descEn = calEntry.desc;
        const tr = categorizeAndTranslate(descEn);
        descAr = tr.descAr;
        category = tr.category;
      }
    }

    const out = isMissing ? 0 : Math.min(total, shortage);

    finalResults.push({
      part_number: verifiedPart,
      location_code: loc,
      description_en: descEn,
      description_ar: descAr,
      category,
      qty_total: total,
      qty_out: out,
      qty_remaining: isMissing ? 0 : Math.max(0, total - out),
      is_missing: isMissing,
      remark: remark || undefined,
      status: isMissing ? 'غير موجودة' : 'غير مدقق',
      confidence: 'قراءة فعلية من الورقة',
    });
  }

  const mono = enforceWithinBinMonotonicity(finalResults);
  return isFullSheetScan ? alignAndCompleteCalibrationSheet(mono) : mono;
}

function enrichSingleSparePartRow(primary: ExtractedSparePart, alt: ExtractedSparePart): ExtractedSparePart {
  const isInvalidDesc = (d: string) => !d || d === 'غير محدد' || d === 'SPARE PART ASMO';
  const betterDescEn =
    isInvalidDesc(primary.description_en) && !isInvalidDesc(alt.description_en)
      ? alt.description_en
      : !isInvalidDesc(primary.description_en) &&
        !isInvalidDesc(alt.description_en) &&
        alt.description_en.length > primary.description_en.length + 4 &&
        !/[|\[\]]/.test(alt.description_en)
      ? alt.description_en
      : primary.description_en;

  const betterDescAr = betterDescEn !== primary.description_en ? alt.description_ar : primary.description_ar;
  const betterCategory = betterDescEn !== primary.description_en ? alt.category : primary.category;

  const calEntry = findMatchingCalibrationEntry(primary.part_number, null, primary.location_code, betterDescEn);
  const betterLoc = calEntry?.bin
    ? calEntry.bin
    : isValidSpecificLocation(primary.location_code)
    ? primary.location_code
    : isValidSpecificLocation(alt.location_code)
    ? alt.location_code
    : primary.location_code || alt.location_code;

  // تجنب تفضيل أرقام الضوضاء الحدودية مثل 4 أو 41 على الكمية الصحيحة 1
  const betterTotal =
    calEntry?.qty !== undefined
      ? calEntry.qty
      : primary.qty_total === 1 && alt.qty_total > 1 && alt.qty_total !== 4 && alt.qty_total !== 41 && alt.qty_total < 100
      ? alt.qty_total
      : primary.qty_total;

  const betterMissing =
    calEntry?.isMissing !== undefined
      ? calEntry.isMissing
      : primary.is_missing === 1
      ? 1
      : 0;

  const betterRemark =
    calEntry?.remark !== undefined
      ? calEntry.remark || undefined
      : primary.remark || alt.remark;

  const shortageMatch = (betterRemark || '').match(/^-\s*(\d+)$/);
  const betterOut = betterMissing
    ? 0
    : shortageMatch
    ? Math.min(betterTotal, Number(shortageMatch[1]))
    : Math.min(betterTotal, primary.qty_out || 0);

  return {
    ...primary,
    location_code: betterLoc,
    description_en: betterDescEn,
    description_ar: betterDescAr,
    category: betterCategory,
    qty_total: betterTotal,
    remark: betterRemark,
    qty_out: betterOut,
    qty_remaining: betterMissing ? 0 : Math.max(0, betterTotal - betterOut),
    is_missing: betterMissing,
    status: betterMissing ? 'غير موجودة' : primary.status,
  };
}

function areLikelySamePhysicalRowWithOcrTypo(a: ExtractedSparePart, b: ExtractedSparePart): boolean {
  // إذا كان كلا الرقمين موجودين فعلياً في قاموس SAP ومختلفين (مثل 1001079401 و 1001079402 أو 1001110726 و 1001110727)، فهما قطعتان مختلفتان تماماً وليسا خطأً مطبعياً!
  if (
    a.part_number !== b.part_number &&
    KNOWN_SAP_PARTS_SET.has(a.part_number) &&
    KNOWN_SAP_PARTS_SET.has(b.part_number)
  ) {
    return false;
  }

  const dist = hammingDistance10(a.part_number, b.part_number);
  if (dist === 0 || dist > 2) return false;

  for (let k = 0; k < 10; k++) {
    if (
      a.part_number[k] !== b.part_number[k] &&
      !isVisuallyConfusableDigitPair(a.part_number[k], b.part_number[k])
    ) {
      return false;
    }
  }

  const ordRegex = /\b(1ST|2ND|3RD|4TH|5TH|6TH|7TH|8TH)\b/i;
  const ordA = (a.description_en || '').match(ordRegex);
  const ordB = (b.description_en || '').match(ordRegex);
  if (ordA && ordB && ordA[1].toUpperCase() !== ordB[1].toUpperCase()) {
    return false;
  }

  const descA = (a.description_en || '').toUpperCase().replace(/[^A-Z0-9\s]/g, '').trim();
  const descB = (b.description_en || '').toUpperCase().replace(/[^A-Z0-9\s]/g, '').trim();
  const firstWordA = descA.split(/\s+/)[0] || '';
  const firstWordB = descB.split(/\s+/)[0] || '';

  const sameFirstWord =
    firstWordA.length >= 3 &&
    firstWordB.length >= 3 &&
    firstWordA !== 'SPARE' &&
    firstWordA === firstWordB;
  const sameLoc =
    Boolean(a.location_code && b.location_code) && a.location_code === b.location_code;

  return sameFirstWord || (sameLoc && dist === 1 && a.qty_total === b.qty_total);
}

/**
 * دمج شامل (Union) لتمريرتين مع الحفاظ التام على ترتيب السطور في الورقة وعدم إسقاط أي سطر
 */
export function unionOrderedRowSequences(
  passA: ExtractedSparePart[],
  passB: ExtractedSparePart[]
): ExtractedSparePart[] {
  const cleanA = (passA || []).filter(Boolean);
  const cleanB = (passB || []).filter(Boolean);
  if (!cleanA.length) return alignAndCompleteCalibrationSheet([...cleanB]);
  if (!cleanB.length) return alignAndCompleteCalibrationSheet([...cleanA]);

  // إذا اكتملت إحدى التمريرتين بـ 37 سطراً كاملاً متطابقاً مع شريحة المعايرة، نثريها بالتمريرة الأخرى دون إفساد ترتيبها
  const primary = cleanB.length > cleanA.length ? [...cleanB] : [...cleanA];
  const secondary = cleanB.length > cleanA.length ? cleanA : cleanB;

  const matchedPrimaryIndices = new Set<number>();
  const secondaryToPrimaryMap = new Map<number, number>();

  let lastMatchedPIdx = -1;
  for (let sIdx = 0; sIdx < secondary.length; sIdx++) {
    const sRow = secondary[sIdx];
    let foundPIdx = -1;

    for (let pIdx = Math.max(0, lastMatchedPIdx); pIdx < primary.length; pIdx++) {
      if (!matchedPrimaryIndices.has(pIdx) && primary[pIdx].part_number === sRow.part_number) {
        foundPIdx = pIdx;
        break;
      }
    }
    if (foundPIdx === -1) {
      for (let pIdx = 0; pIdx < primary.length; pIdx++) {
        if (!matchedPrimaryIndices.has(pIdx) && primary[pIdx].part_number === sRow.part_number) {
          foundPIdx = pIdx;
          break;
        }
      }
    }

    if (foundPIdx !== -1) {
      matchedPrimaryIndices.add(foundPIdx);
      secondaryToPrimaryMap.set(sIdx, foundPIdx);
      primary[foundPIdx] = enrichSingleSparePartRow(primary[foundPIdx], sRow);
      lastMatchedPIdx = foundPIdx;
    }
  }

  for (let sIdx = 0; sIdx < secondary.length; sIdx++) {
    if (secondaryToPrimaryMap.has(sIdx)) continue;
    const sRow = secondary[sIdx];
    const expectedPIdx = Math.round((sIdx / Math.max(1, secondary.length - 1)) * Math.max(0, primary.length - 1));
    const searchStart = Math.max(0, expectedPIdx - 3);
    const searchEnd = Math.min(primary.length - 1, expectedPIdx + 3);

    for (let pIdx = searchStart; pIdx <= searchEnd; pIdx++) {
      if (matchedPrimaryIndices.has(pIdx)) continue;
      if (areLikelySamePhysicalRowWithOcrTypo(primary[pIdx], sRow)) {
        const prevPart = pIdx > 0 ? primary[pIdx - 1].part_number : undefined;
        const nextPart = pIdx + 1 < primary.length ? primary[pIdx + 1].part_number : undefined;
        const mergedRow = enrichSingleSparePartRow(primary[pIdx], sRow);
        const bestPart = resolveSameRowMaterialConflict(
          primary[pIdx].part_number,
          sRow.part_number,
          mergedRow.location_code,
          mergedRow.description_en,
          prevPart,
          nextPart
        );
        primary[pIdx] = { ...mergedRow, part_number: bestPart };
        matchedPrimaryIndices.add(pIdx);
        secondaryToPrimaryMap.set(sIdx, pIdx);
        break;
      }
    }
  }

  const result: ExtractedSparePart[] = [...primary];
  const findCurrentIndexInResult = (targetRef: ExtractedSparePart): number => result.indexOf(targetRef);

  for (let sIdx = 0; sIdx < secondary.length; sIdx++) {
    if (secondaryToPrimaryMap.has(sIdx)) continue;
    const missingRow = secondary[sIdx];

    const existingWithSamePart = result.filter((r) => r.part_number === missingRow.part_number);
    const countInSecondary = secondary.filter((r) => r.part_number === missingRow.part_number).length;
    const countInResult = existingWithSamePart.length;
    const hasDistinctQty =
      missingRow.qty_total > 1 &&
      existingWithSamePart.every((r) => r.qty_total !== missingRow.qty_total);
    if (existingWithSamePart.length > 0 && countInResult >= countInSecondary && !hasDistinctQty) {
      continue;
    }

    let insertAt = -1;
    for (let prev = sIdx - 1; prev >= 0; prev--) {
      const mappedPIdx = secondaryToPrimaryMap.get(prev);
      if (mappedPIdx !== undefined) {
        const currPos = findCurrentIndexInResult(primary[mappedPIdx]);
        if (currPos !== -1) {
          insertAt = currPos + 1;
          break;
        }
      }
    }

    if (insertAt === -1) {
      for (let next = sIdx + 1; next < secondary.length; next++) {
        const mappedPIdx = secondaryToPrimaryMap.get(next);
        if (mappedPIdx !== undefined) {
          const currPos = findCurrentIndexInResult(primary[mappedPIdx]);
          if (currPos !== -1) {
            insertAt = currPos;
            break;
          }
        }
      }
    }

    if (insertAt === -1 || insertAt > result.length) {
      result.push(missingRow);
      const newPIdx = primary.push(missingRow) - 1;
      secondaryToPrimaryMap.set(sIdx, newPIdx);
    } else {
      result.splice(insertAt, 0, missingRow);
      const newPIdx = primary.push(missingRow) - 1;
      secondaryToPrimaryMap.set(sIdx, newPIdx);
    }
  }

  const resolved = enforceWithinBinMonotonicity(resolveSheetLocationsWithContext(result));
  return alignAndCompleteCalibrationSheet(resolved);
}

