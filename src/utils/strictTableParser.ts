/**
 * محلل جدول أسمو الصارم والموسع فائق السرعة (Strict & Resilient High-Speed SAP Table Parser)
 * يقرأ أي ورقة جرد SAP Inventory Controller قراءة فعلية مباشرة مع خوارزميات التصحيح السياقي:
 * 1. رقم القطعة (Material): 10 أرقام تبدأ بـ 100 مع تصحيح الأخطاء البصرية (1007->1001, 1900->1000, 1090->1000) وفصل الأرقام الملتصقة بخطوط الجدول.
 * 2. الموقع (Storage Bin): مثل N15BB2, N11C2, N11FL1, N01A1, N15D2 مع تنعيم الساندويتش السياقي للسطور المتجاورة.
 * 3. الكمية (QTY): استخراج الرقم بعد وحدة القياس (EA, SET, PK, SH, CO, AY, KG, PAA, ZYD, KIT, PCS, ROL, BOX).
 * 4. العلامات والملاحظات (Check & Remark): استخراج علامة × (غير موجودة) والملاحظات مثل -1, -4 واستبعاد الزيادات (F1, F2, F4).
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

  // فصل رقم القطعة (100xxxxxxx) حتى لو التصق قبله رقم تسلسل السطر (1..99) أو خط الجدول العمودي أو كود المصنع بعده
  const gluedMatch = line.match(/(?:^|[^0-9])\d{0,2}[|Il!tT[\]().:\-\/\\]?(100\d{7})(?:\d{0,2}|C006|M016|002)?(?=[^0-9]|$)/i);
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
      .replace(/[^A-Za-z0-9°'"%¢]/g, '');
    if (cleaned.length >= 9 && cleaned.length <= 15) {
      const repaired = cleaned
        .replace(/^(?:aot|aoo|qop|roo|too|loo|ioo|190|109|160|180)/i, '100')
        .replace(/^[Il|!rRtTsS74]/, '1')
        .replace(/[OoQD°@U]/g, '0')
        .replace(/[Il|!t'"rR]/g, '1')
        .replace(/[Zz]/g, '2')
        .replace(/[Ss$§]/g, '5')
        .replace(/[Gg%]/g, '6')
        .replace(/[BbeE]/g, '8')
        .replace(/[aA]/g, '4')
        .replace(/[dD]/g, '0')
        .replace(/[¢cC]/g, '9')
        .replace(/[^0-9]/g, '');

      const prefixFixed = normalizeSapMaterialPrefix(repaired);
      if (/^100\d{7}$/.test(prefixFixed)) {
        return prefixFixed;
      }
      if (repaired.length >= 11 && repaired.length <= 14) {
        for (let offset = 0; offset <= repaired.length - 10; offset++) {
          const candidate10 = normalizeSapMaterialPrefix(repaired.slice(offset, offset + 10));
          if (/^100[01]\d{6}$/.test(candidate10)) {
            return candidate10;
          }
        }
      }
      if (/^\d{1,2}100\d{7}$/.test(repaired)) {
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
 * استخراج رمز الموقع (Storage Bin): N15BB2, N11C2, N11FL1, N11D1, N01A1, N01B1, D1, D2...
 */
export function extractStrictStorageBin(line: string, partNumber: string): string {
  const withoutPart = line
    .replace(partNumber, ' ')
    .replace(/_/g, ' ')
    .replace(
      /\b(?:[0Oo]{2}2[TI|l]?|001|C[0Oo]{2}[68bBsS]?|M[0Oo][1Il|itT][6bBsS]|D[0Oo]4D|coos|cove|coo6|coob|more|mote|mo16|mois)\b/gi,
      ' '
    );

  const normalizedBinsLine = withoutPart
    .replace(/\bT?N\s+([01OIl][0-9OIlSsEeGgZz])\b/gi, 'N$1')
    .replace(/\bT?N[Oo0][Ili|!tT1]/gi, 'N01')
    .replace(/\bT?N[Oo0]W/gi, 'N01')
    .replace(/\bT?N[Ili|!tT1][Ss5]/gi, 'N15')
    .replace(/\bT?N[Ili|!tT1][EeGg6]/gi, 'N16')
    .replace(/\bT?N[Ili|!tT1MVNA][Ili|!tT1]/gi, 'N11')
    .replace(/\bT?N[Ili|!tT1][Zz2]/gi, 'N12')
    .replace(/\bT?N[Oo](\d)/gi, 'N0$1')
    .replace(/\bT?N(\d)[Oo]/gi, 'N$10')
    .replace(/\bT?N[Ili|!tT](\d)/gi, 'N1$1')
    .replace(/\bT?N(\d)[Ili|!tT]/gi, 'N$11')
    .replace(/\b(N\d{2})\s+(FL[12Il|!tT]|BB[12Il|!tT]|[A-D][12Il|!tT])\b/gi, '$1$2')
    .replace(/\b(N\d{2})(?:8B|B8|88|8BR|BR|BBR)([12Il|!tT])\b/gi, '$1BB$2')
    .replace(/\b(N\d{2})0([12])\b/gi, '$1D$2')
    .replace(/\b(N\d{2})F[LI1][Ili|!tTY41]\b/gi, '$1FL1')
    .replace(/\b(N\d{2})F[LI1][ZzQRe2]\b/gi, '$1FL2')
    .replace(/\b(N\d{2})V?A[TRIl|!yLD1]\b/gi, '$1A1')
    .replace(/\b(N\d{2})V?A[ZzR2]\b/gi, '$1A2')
    .replace(/\b(N\d{2})[EB8][TRIl|!y1]\b/gi, '$1B1')
    .replace(/\b(N\d{2})[EB8][Zz2]\b/gi, '$1B2')
    .replace(/\bN[1Il|i]s[oO0dD]([12])\b/gi, 'N15D$1')
    .replace(/\b(N\d{2}[A-Z]{1,2})[TRIl|!y]\b/gi, '$11');

  const sapBinMatch = normalizedBinsLine.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{1,2})\b/i);
  if (sapBinMatch) {
    const candidate = dynamicLocationNormalizerFromCandidate(sapBinMatch[1].toUpperCase());
    if (candidate && !['C006', 'M016', 'D04D'].includes(candidate)) {
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

function dynamicLocationNormalizerFromCandidate(cand: string): string {
  return sanitizeLocationCode(cand) || cand;
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

const UNIT_PATTERN = '(?:EA|EFA|FA|tA|cA|SET|PK|SH|CO|AY|KG|PAA|ZYD|KIT|OKIT|PCS|ROL|BOX|FT|M|L)';
const QTY_FIELD = new RegExp(
  `^\\s*(?:[|\\[\\]()—\\-~°.]+\\s*)?(?:${UNIT_PATTERN}[\\s|\\[\\]()—\\-~°.]+)?(\\d{1,9})(?=\\s|\\||\\[|\\]|$)`,
  'i'
);

export function extractStrictQuantity(
  line: string,
  _partNumber: string,
  storageBin: string
): { total: number; out: number } {
  const afterBin = textAfterStorageBin(line, storageBin);
  const match = afterBin?.match(QTY_FIELD);
  if (match) {
    const val = Number(match[1]);
    return { total: val > 0 ? val : 1, out: 0 };
  }

  const unitQtyMatch = line.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:°.]+(\\d{1,6})\\b`, 'i')
  );
  if (unitQtyMatch) {
    const val = Number(unitQtyMatch[1]);
    return { total: val > 0 ? val : 1, out: 0 };
  }

  const unitOcrOneMatch = line.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:°.]+(?:ot|a1|to|[Il|!ti])\\b`, 'i')
  );
  if (unitOcrOneMatch) {
    return { total: 1, out: 0 };
  }

  return { total: 1, out: 0 };
}

/**
 * استخراج الملاحظات وعلامة الفحص (Check & Remark) من السطر بعد الكمية
 */
export function extractCheckAndRemark(
  line: string,
  storageBin: string
): { isMissing: number; remark: string; shortage: number } {
  const tail = textAfterStorageBin(line, storageBin) || line;
  const qtyMatch = tail.match(QTY_FIELD);
  const afterQty = qtyMatch ? tail.slice(qtyMatch[0].length).trim() : tail;

  const isMissing = /(?:^|\s|\||\[|\])([Xx×✗✘]{1,2})(?=\s|\||\[|\]|$)/.test(afterQty) ? 1 : 0;
  let remark = '';
  let shortage = 0;

  // اعتماد علامة الناقص فقط (-N) لإنقاص العدد واستبعاد الزيادة (+N أو F1/F2) نهائياً
  const minusMatch =
    afterQty.match(/(?:^|\s|\||\[|\])(?:\d{1,4}\s*[-−–—]\s*(\d{1,4})|[-−–—]\s*(\d{1,4}))(?=\s|\||\[|\]|$)/) ||
    afterQty.match(/(?:^|\s|\||\[|\])[-−–—]\s*([Il|!])(?=\s|\||\[|\]|$)/);
  if (minusMatch) {
    const rawShortage = minusMatch[1] || minusMatch[2] || '';
    shortage = /^[Il|!]$/.test(rawShortage) ? 1 : Number(rawShortage || 0);
    if (shortage > 0) {
      remark = `-${shortage}`;
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
  const upper = withoutPart.toUpperCase();
  let minStart = -1;

  for (let i = 0; i < TECHNICAL_TERMS_REGEXES.length; i++) {
    const m = upper.match(TECHNICAL_TERMS_REGEXES[i]);
    if (m && m.index !== undefined && (minStart === -1 || m.index < minStart)) {
      minStart = m.index;
    }
  }

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
    // إزالة أكواد المصنع والمستودع والموقع والكمية من بداية السطر للحصول على الوصف الحقيقي المكتوب في الورقة
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
 * استخراج حقيقي صارم لرقم القطعة المكون من 10 أرقام (Real 10-Digit SAP Material Extractor):
 * يقرأ فقط أرقام قطع SAP الفعلية من الورقة (10 أرقام تبدأ بـ 100) مع تصحيح الحروف المتشابهة بصرياً
 * ويمنع منعاً باتاً توليد أي أرقام وهمية أو تكميل أرقام عشوائية بأصفار.
 */
export function extractInclusiveMaterialNumber(line: string, _rowIndex = 0): string | null {
  if (/^\s*(?:MATERIAL|ITEM|NO\.|STORAGE\s+BIN|QTY|DESCRIPTION|INVENTORY|PAGE)\b/i.test(line)) {
    return null;
  }

  const strict = extractStrictMaterialNumber(line);
  if (strict) return strict;

  // تحويل الحروف البصرية المتشابهة في الأرقام المكونة من 9 إلى 12 خانة أو المقسومة بمسافة (مثل 1O01O353O9 أو 1O01 035309 -> 1001035309)
  const visualNormalized = line
    .replace(
      /\b([1Il|!74][0OoQD°]{2}[0-9OoQD°Il|!Ss$ZzBbGg]{0,5})[\s.\-:]+([0-9OoQD°Il|!Ss$ZzBbGg]{2,7})\b/g,
      (_m, p1, p2) => `${p1}${p2}`
    )
    .replace(/(?:^|(?<=[\s|;,\[\]{}().:\-\/]))[1Il|!74]?[0OoQD°]{2}[0-9OoQD°Il|!Ss$ZzBbGg¢]{6,9}(?=$|[\s|;,\[\]{}().:\-\/])/g, (tok) =>
      tok
        .replace(/^[Il|!74]/, '1')
        .replace(/[OoQD°]/g, '0')
        .replace(/[Il|!]/g, '1')
        .replace(/[Ss$]/g, '5')
        .replace(/[Zz]/g, '2')
        .replace(/[Bb]/g, '8')
        .replace(/[Gg]/g, '6')
        .replace(/[¢]/g, '9')
    );

  return extractStrictMaterialNumber(visualNormalized);
}

/**
 * تقسيم السطر الواحد إذا دمج محرك الـ OCR سطرين متجاورين من الجدول في سطر نصي واحد
 */
function splitMergedOcrTableLines(rawLines: string[]): string[] {
  const expanded: string[] = [];
  const matPattern = /(?:^|(?<=[\s|;,\[\]{}().:\-\/\\]))[1Il|!74][0OoQD°]{2}[01OoQD°Il|!][0-9OoQD°Il|!Ss$ZzBbGg]{6}(?=$|[\s|;,\[\]{}().:\-\/\\]|C006|M016)/gi;

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    // البحث عن كافة مواضع أرقام القطع المكونة من 10 خانات (100xxxxxxx أو ما يكافئها بصرياً) داخل نفس السطر
    const matches = Array.from(line.matchAll(matPattern));
    if (matches.length <= 1) {
      expanded.push(line);
      continue;
    }

    // إذا وُجد رقمان مختلفان في نفس السطر بينهما مسافة كافية (أعمدة موقع/كمية/وصف)، نفصل السطرين
    const distinctStarts: number[] = [0];
    for (let mIdx = 1; mIdx < matches.length; mIdx++) {
      const prevMatch = matches[mIdx - 1];
      const currMatch = matches[mIdx];
      const prevIdx = prevMatch.index ?? 0;
      const currIdx = currMatch.index ?? 0;
      if (currIdx - prevIdx >= 16 && currMatch[0] !== prevMatch[0]) {
        // التراجع قليلاً قبل الرقم الثاني إذا سبقه رقم تسلسل السطر (1..99)
        const between = line.slice(prevIdx + 10, currIdx);
        const seqSuffix = between.match(/(\s+\d{1,2}\s*[|[\]().:\-]?\s*)$/);
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

export function parseStrictAsmoTable(rawText: string): ExtractedSparePart[] {
  if (!rawText) return [];

  const lines = splitMergedOcrTableLines(rawText.split(/\r?\n/));
  const intermediateRows: Array<{
    rawLine: string;
    part_number: string;
    location_code: string;
    location?: string;
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const partNumber = extractInclusiveMaterialNumber(line, i);
    if (!partNumber) {
      // إذا انقسم سطر الجدول في الـ OCR ونزل الوصف أو الموقع للسطر التالي بدون رقم قطعة، ندمجه بالسطر السابق إذا كان السطر السابق ناقصاً
      if (
        intermediateRows.length > 0 &&
        !/^\s*(?:MATERIAL|ITEM|NO\.|STORAGE\s+BIN|QTY|DESCRIPTION|INVENTORY|PAGE|CONTROLLER)\b/i.test(line) &&
        /[A-Za-z]{2,}/.test(line)
      ) {
        const prevRow = intermediateRows[intermediateRows.length - 1];
        const prevDesc = extractStrictDescription(prevRow.rawLine, prevRow.part_number, prevRow.location_code).descEn;
        const startsWithTableColumn = /^\s*(?:C006|M016|N\d{2}|EA|SET|PK|SH|PAA|ZYD|KIT|PCS|ROL|BOX)\b/i.test(line);
        if (!isValidSpecificLocation(prevRow.location_code) || prevDesc === 'غير محدد' || startsWithTableColumn) {
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
    intermediateRows.push({
      rawLine: line,
      part_number: partNumber,
      location_code: storageBin,
      location: storageBin,
    });
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
    const loc = isValidSpecificLocation(row.location_code)
      ? row.location_code
      : fallbackSheetLoc;
    if (isValidSpecificLocation(loc)) {
      fallbackSheetLoc = loc;
    }

    const { total } = extractStrictQuantity(row.rawLine, row.part_number, loc);
    const { isMissing, remark, shortage } = extractCheckAndRemark(row.rawLine, loc);
    const { descEn, descAr, category } = extractStrictDescription(row.rawLine, row.part_number, loc);
    const out = isMissing ? 0 : Math.min(total, shortage);

    finalResults.push({
      part_number: row.part_number,
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

  return finalResults;
}

function enrichSingleSparePartRow(primary: ExtractedSparePart, alt: ExtractedSparePart): ExtractedSparePart {
  const isInvalidDesc = (d: string) => !d || d === 'غير محدد' || d === 'SPARE PART ASMO';
  const betterDescEn =
    isInvalidDesc(primary.description_en) && !isInvalidDesc(alt.description_en)
      ? alt.description_en
      : !isInvalidDesc(primary.description_en) &&
        !isInvalidDesc(alt.description_en) &&
        alt.description_en.length > primary.description_en.length + 4
      ? alt.description_en
      : primary.description_en;

  const betterDescAr = betterDescEn !== primary.description_en ? alt.description_ar : primary.description_ar;
  const betterCategory = betterDescEn !== primary.description_en ? alt.category : primary.category;
  const betterLoc = isValidSpecificLocation(primary.location_code)
    ? primary.location_code
    : isValidSpecificLocation(alt.location_code)
    ? alt.location_code
    : primary.location_code || alt.location_code;
  const betterTotal =
    primary.qty_total === 1 && alt.qty_total > 1 ? alt.qty_total : primary.qty_total;
  const betterRemark = primary.remark || alt.remark;
  const betterOut = Math.max(primary.qty_out || 0, alt.qty_out || 0);
  const betterMissing = primary.is_missing === 1 || alt.is_missing === 1 ? 1 : 0;

  return {
    ...primary,
    location_code: betterLoc,
    description_en: betterDescEn,
    description_ar: betterDescAr,
    category: betterCategory,
    qty_total: betterTotal,
    remark: betterRemark,
    qty_out: betterMissing ? 0 : betterOut,
    qty_remaining: betterMissing ? 0 : Math.max(0, betterTotal - betterOut),
    is_missing: betterMissing,
    status: betterMissing ? 'غير موجودة' : primary.status,
  };
}

/**
 * دمج شامل (Union) لتمريرتين مع الحفاظ التام على ترتيب السطور في الورقة وعدم إسقاط أي سطر ظهر في إحدى التمريرتين فقط
 */
export function unionOrderedRowSequences(
  passA: ExtractedSparePart[],
  passB: ExtractedSparePart[]
): ExtractedSparePart[] {
  const cleanA = (passA || []).filter(Boolean);
  const cleanB = (passB || []).filter(Boolean);
  if (!cleanA.length) return [...cleanB];
  if (!cleanB.length) return [...cleanA];

  const primary = cleanB.length > cleanA.length ? [...cleanB] : [...cleanA];
  const secondary = cleanB.length > cleanA.length ? cleanA : cleanB;

  const matchedPrimaryIndices = new Set<number>();
  const secondaryToPrimaryMap = new Map<number, number>();

  // 1. مطابقة السطور الموجودة في التمريرتين وإثراء بياناتها
  let lastMatchedPIdx = -1;
  for (let sIdx = 0; sIdx < secondary.length; sIdx++) {
    const sRow = secondary[sIdx];
    let foundPIdx = -1;

    // البحث للأمام أولاً للحفاظ على الترتيب التسلسلي للورقة
    for (let pIdx = Math.max(0, lastMatchedPIdx); pIdx < primary.length; pIdx++) {
      if (!matchedPrimaryIndices.has(pIdx) && primary[pIdx].part_number === sRow.part_number) {
        foundPIdx = pIdx;
        break;
      }
    }
    // إذا لم يُعثر عليه للأمام، نبحث في كامل المصفوفة
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

  // 2. إدراج السطور التي قرأتها التمريرة الثانوية وسقطت من التمريرة الأساسية في موضعها الصحيح
  const result: ExtractedSparePart[] = [...primary];
  const findCurrentIndexInResult = (targetRef: ExtractedSparePart): number => result.indexOf(targetRef);

  for (let sIdx = 0; sIdx < secondary.length; sIdx++) {
    if (secondaryToPrimaryMap.has(sIdx)) continue;
    const missingRow = secondary[sIdx];

    // تجنب الإدراج إذا كان الرقم موجوداً بالفعل في النتيجة بنفس الرقم تماماً (إلا إذا كان مكرراً فعلياً في الورقة)
    const alreadyExistsExact = result.some((r) => r.part_number === missingRow.part_number);
    const countInSecondary = secondary.filter((r) => r.part_number === missingRow.part_number).length;
    const countInResult = result.filter((r) => r.part_number === missingRow.part_number).length;
    if (alreadyExistsExact && countInResult >= countInSecondary) {
      continue;
    }

    // تحديد موضع الإدراج الدقيق بناءً على أقرب سطر سابق أو لاحق تمتد له مطابقة
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
      // ربط هذا السطر المضاف ليصبح مرجعاً للسطور التالية له مباشرة
      const newPIdx = primary.push(missingRow) - 1;
      secondaryToPrimaryMap.set(sIdx, newPIdx);
    } else {
      result.splice(insertAt, 0, missingRow);
      const newPIdx = primary.push(missingRow) - 1;
      secondaryToPrimaryMap.set(sIdx, newPIdx);
    }
  }

  return resolveSheetLocationsWithContext(result);
}

/**
 * دمج مصفوفات السطور المستخرجة من شرائح متعددة متداخلة (Band Sequence Alignment Merger)
 * يحافظ على الأرقام المتتالية (مثل 1001035309..1001035312) والسطور المكررة الحقيقية (1000428938) دون حذفها
 * مع دمج منطقة التداخل بالكامل دون إسقاط أي سطر قرأته إحدى الشريحتين فقط.
 */
export function mergeOverlappingBandRows(bands: ExtractedSparePart[][]): ExtractedSparePart[] {
  const nonEmpty = bands.filter((b) => b && b.length > 0);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) return nonEmpty[0];

  let merged: ExtractedSparePart[] = [...nonEmpty[0]];
  for (let bIdx = 1; bIdx < nonEmpty.length; bIdx++) {
    const nextBand = nonEmpty[bIdx];
    const tailStart = Math.max(0, merged.length - 10);
    const headLimit = Math.min(10, nextBand.length);
    let cutMergedAt = -1;
    let startNextAt = -1;

    // 1. البحث عن مطابقة تامة لرقم القطعة على حدود التداخل
    for (let ti = tailStart; ti < merged.length; ti++) {
      for (let ni = 0; ni < headLimit; ni++) {
        if (merged[ti].part_number === nextBand[ni].part_number) {
          cutMergedAt = ti;
          startNextAt = ni;
          break;
        }
      }
      if (cutMergedAt !== -1) break;
    }

    if (cutMergedAt !== -1 && startNextAt !== -1) {
      // الاحتفاظ بأي سطر ظهر في أعلى الشريحة الثانية قبل نقطة التطابق ولم يظهر في نهاية الشريحة الأولى
      const recentMergedParts = new Set(
        merged.slice(Math.max(0, cutMergedAt - 8), cutMergedAt).map((r) => r.part_number)
      );
      const uniqueLeadingFromNext = nextBand
        .slice(0, startNextAt)
        .filter((r) => !recentMergedParts.has(r.part_number));

      // دمج منطقة التداخل وما بعدها عبر unionOrderedRowSequences لضمان عدم سقوط أي سطر
      const unifiedOverlapAndTail = unionOrderedRowSequences(
        merged.slice(cutMergedAt),
        nextBand.slice(startNextAt)
      );

      merged = [
        ...merged.slice(0, cutMergedAt),
        ...uniqueLeadingFromNext,
        ...unifiedOverlapAndTail,
      ];
    } else {
      // في حال عدم وجود سطر مشترك في حد التداخل، نجمع الشريحتين بالكامل دون إسقاط أي سطر
      const tailSet = new Set(merged.slice(tailStart).map((r) => r.part_number));
      const nonDupNext = [
        ...nextBand.slice(0, headLimit).filter((r) => !tailSet.has(r.part_number)),
        ...nextBand.slice(headLimit),
      ];
      merged = [...merged, ...nonDupNext];
    }
  }

  return resolveSheetLocationsWithContext(merged);
}
