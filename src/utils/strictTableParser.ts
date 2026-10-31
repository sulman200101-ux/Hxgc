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

  const gluedMatch = line.match(/(?:^|[^0-9])(100\d{7})\d{0,2}(?=[^0-9]|$)/);
  if (gluedMatch) {
    return normalizeSapMaterialPrefix(gluedMatch[1]);
  }

  const splitMatch = line.match(/\b(100\d{3,6})\s+(\d{1,4})\b/);
  if (splitMatch && (splitMatch[1] + splitMatch[2]).length === 10) {
    return normalizeSapMaterialPrefix(splitMatch[1] + splitMatch[2]);
  }

  const isSapTableLine =
    /\b(?:C006|C008|C00S|COOS|C00|CO06|C08|M016|MO16|MOTE|MOIS|D04D|DO4D|002|EA|EFA|FA|SET|PK|PAA|SH|ZYD|KIT|N[01OIl]\d[A-Z]{1,3}\d?)\b/i.test(
      line
    );

  if (isSapTableLine) {
    const nineDigitMatch = line.match(/(?:^|[^0-9])(00[01]\d{6})(?=[^0-9]|$)/);
    if (nineDigitMatch) {
      return `1${nineDigitMatch[1]}`;
    }
  }

  const tokens = line.split(/[\s|;,\[\]{}()]+/);
  for (const token of tokens) {
    const cleaned = token.replace(/[^A-Za-z0-9°'"%¢]/g, '');
    if (cleaned.length >= 8 && cleaned.length <= 12) {
      const repaired = cleaned
        .replace(/^(?:aot|aoo|qop|roo|too|190|109)/i, '100')
        .replace(/^[Il|!rRtTsS74]/, '1')
        .replace(/[OoQD°]/g, '0')
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
      if (isSapTableLine && /^[147]100\d{7}$/.test(repaired)) {
        return normalizeSapMaterialPrefix(repaired.slice(1));
      }
      if (isSapTableLine && /^100\d{7}\d{1,2}$/.test(repaired)) {
        return normalizeSapMaterialPrefix(repaired.slice(0, 10));
      }
      if (isSapTableLine && /^00[01]\d{6}$/.test(repaired)) {
        return `1${repaired}`;
      }
      if (isSapTableLine && /^1001\d{5}$/.test(repaired)) {
        return `10011${repaired.slice(4)}`;
      }
      if (isSapTableLine && /^1000\d{5}$/.test(repaired)) {
        return `${repaired}1`;
      }
    }
    const fallbackRepaired = repair10DigitMaterialCode(token);
    if (fallbackRepaired) return fallbackRepaired;
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
      /\b(?:[0Oo]{2}2[TI|l]?|C[0Oo]{2}[68bBsS]?|M[0Oo][1Il|itT][6bBsS]|D[0Oo]4D|coos|cove|coo6|coob|more|mote|mo16|mois)\b/gi,
      ' '
    );

  const normalizedBinsLine = withoutPart
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

  const compoundMatch = normalizedBinsLine.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+\s+[0-9A-Z]+)\b/i);
  if (compoundMatch) {
    return compoundMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
  }

  const twoPartMatch = normalizedBinsLine.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]{2,4})\b/i);
  if (twoPartMatch) {
    return sanitizeLocationCode(twoPartMatch[1]) || twoPartMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
  }

  const dBinMatch = normalizedBinsLine.match(/\b(D\d{1,2})\b/i);
  if (dBinMatch && dBinMatch[1].toUpperCase() !== 'D04D') {
    return dBinMatch[1].toUpperCase();
  }

  const locMatch = normalizedBinsLine.match(/\b(LOC-[A-Z0-9-]{3,10})\b/i);
  if (locMatch) {
    return locMatch[1].toUpperCase();
  }

  return sanitizeLocationCode(normalizedBinsLine);
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
  const minusMatch = afterQty.match(/(?:^|\s|\||\[|\])(?:\d{1,4}\s*-\s*(\d{1,4})|-\s*(\d{1,4}))(?=\s|\||\[|\]|$)/);
  if (minusMatch) {
    shortage = Number(minusMatch[1] || minusMatch[2] || 0);
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
  const withoutPart = line.replace(partNumber, '');
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
      `\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:°.]+(?:\\d{1,6}|ot|a1|[Il|!ti])\\b(.*)$`,
      'i'
    );
    const mUnit = withoutPart.match(unitQtyRegex);
    if (mUnit && mUnit[1]) {
      candidateFromTail = cleanOcrDescriptionTail(mUnit[1]);
    }
  }

  const chosen =
    candidateFromDict.length >= 3
      ? candidateFromDict
      : candidateFromTail.length >= 3
      ? candidateFromTail
      : candidateFromDict || candidateFromTail;

  const descEn = chosen && /[A-Za-z]{2,}/.test(chosen) ? chosen : 'SPARE PART ASMO';
  const { category, descAr } = categorizeAndTranslate(descEn);
  return { descEn, descAr, category };
}

/**
 * استخراج شامل لرقم القطعة (Inclusive Material Extractor):
 * يقبل الرقم المكون من 10 أرقام، أو يكمل الأرقام الجزئية (5-9 أرقام) ببادئة SAP 100،
 * أو يستخرج السطر إذا احتوى على موقع ووصف فني واضح حتى لو كان الرقم مطموساً.
 */
export function extractInclusiveMaterialNumber(line: string, rowIndex: number): string | null {
  if (/^\s*(?:MATERIAL|ITEM|NO\.|STORAGE\s+BIN|QTY|DESCRIPTION|INVENTORY|PAGE)\b/i.test(line)) {
    return null;
  }

  const strict = extractStrictMaterialNumber(line);
  if (strict) return strict;

  const hasTableContext =
    /\b(?:C006|C008|C00S|COOS|C00|M016|MO16|MOTE|MOIS|D04D|002|EA|EFA|FA|SET|PK|PAA|SH|ZYD|KIT|PCS|ROL|BOX|N[01OIl]\d[A-Z0-9]{1,4})\b/i.test(
      line
    );

  // البحث عن أي رقم جزئي من 6 إلى 9 أرقام في السطر وإكماله إلى 10 أرقام ببادئة 100
  const partialMatches = line.match(/\b(\d{6,9})\b/g);
  if (partialMatches) {
    for (const num of partialMatches) {
      if (/^(?:05\d{7,8}|966\d{6,8})$/.test(num)) continue;
      if (num.startsWith('100')) {
        return num.padEnd(10, '0').slice(0, 10);
      }
      return `100${num.slice(-7).padStart(7, '0')}`;
    }
  }

  if (hasTableContext) {
    const fiveDigitMatch = line.match(/\b(10\d{3,5}|\d{5})\b/);
    if (fiveDigitMatch) {
      const d = fiveDigitMatch[1];
      return `100${d.slice(-7).padStart(7, '0')}`;
    }

    const candidateBin = extractStrictStorageBin(line, '');
    const hasTechTerm = TECHNICAL_TERMS_REGEXES.some((rx) => rx.test(line));
    if (isValidSpecificLocation(candidateBin) && hasTechTerm) {
      return `100999${String(rowIndex + 1).padStart(4, '0')}`;
    }
  }

  return null;
}

export function parseStrictAsmoTable(rawText: string): ExtractedSparePart[] {
  if (!rawText) return [];

  const lines = rawText.split(/\r?\n/);
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
  let fallbackSheetLoc = 'N01A1';
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
      confidence: 'اقتراح غير مؤكد: راجع رقم القطعة والكمية والعلامات مقابل الأصل',
    });
  }

  return finalResults;
}

/**
 * دمج مصفوفات السطور المستخرجة من شرائح متعددة متداخلة (Band Sequence Alignment Merger)
 * يحافظ على الأرقام المتتالية (مثل 1001035309..1001035312) والسطور المكررة الحقيقية (1000428938) دون حذفها
 * مع إزالة تكرار حد التداخل فقط.
 */
export function mergeOverlappingBandRows(bands: ExtractedSparePart[][]): ExtractedSparePart[] {
  const nonEmpty = bands.filter((b) => b && b.length > 0);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) return nonEmpty[0];

  const rowsMatchAtBoundary = (a: ExtractedSparePart, b: ExtractedSparePart): boolean => {
    if (a.part_number === b.part_number) return true;
    if (a.part_number.slice(-2) === b.part_number.slice(-2)) {
      let sameDigits = 0;
      for (let k = 0; k < 10; k++) {
        if (a.part_number[k] === b.part_number[k]) sameDigits++;
      }
      if (sameDigits >= 8) return true;
    }
    return false;
  };

  let merged: ExtractedSparePart[] = [...nonEmpty[0]];
  for (let bIdx = 1; bIdx < nonEmpty.length; bIdx++) {
    const nextBand = nonEmpty[bIdx];
    const tailStart = Math.max(0, merged.length - 5);
    let cutMergedAt = merged.length;
    let startNextAt = 0;
    let found = false;

    for (let ti = tailStart; ti < merged.length; ti++) {
      for (let ni = 0; ni < Math.min(3, nextBand.length); ni++) {
        if (rowsMatchAtBoundary(merged[ti], nextBand[ni])) {
          cutMergedAt = ti;
          startNextAt = ni;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    merged = [...merged.slice(0, cutMergedAt), ...nextBand.slice(startNextAt)];
  }

  return resolveSheetLocationsWithContext(merged);
}
