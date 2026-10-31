/**
 * محلل جدول أسمو الصارم والموسع فائق السرعة (Strict & Resilient High-Speed SAP Table Parser)
 * يقرأ أي ورقة جرد SAP Inventory Controller قراءة فعلية مباشرة دون أي أرقام مخزنة مسبقاً:
 * 1. رقم القطعة (Material): 10 أرقام تبدأ بـ 100 مع تصحيح الأخطاء البصرية للـ OCR وفصل الأرقام الملتصقة بخطوط الجدول (|) أو المقسومة بمسافة.
 * 2. الموقع (Storage Bin): مثل N13B1, N13B2, N11C2, N11FL1, N16D1, D1 مع استنتاج الموقع من السطور المجاورة عند تغطيته بعلامة القلم.
 * 3. الكمية (QTY): استخراج الرقم بعد وحدة القياس (EA, SET, PK, SH, CO, AY, KG, PAA, ZYD, KIT, PCS, ROL, BOX) حتى لو فصلت بينهما خطوط جدول (| أو [ أو ])، مع ضمان عدم إرجاع 0 أو NaN.
 * 4. العلامات والملاحظات (Check & Remark): استخراج علامة × (غير موجودة) والملاحظات مثل -1, -4 واستبعاد الزيادات (F1, F2, F4).
 * 5. الوصف الكامل (Material Description): استخراج الوصف الإنجليزي من السطر بعد خانة الكمية أو عبر القاموس الهندسي الموسع دون إرجاع SPARE PART ASMO طالما وجد نص إنجليزي.
 */

import { ExtractedSparePart } from '../services/localOcr';
import { categorizeAndTranslate } from './translator';
import {
  sanitizeLocationCode,
  isValidSpecificLocation,
  resolveSheetLocationsWithContext,
  repair10DigitMaterialCode,
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
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
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
 * استخراج رقم القطعة الصارم: 10 أرقام تبدأ بـ 100، مع دعم إصلاح الحروف المتشابهة بصرياً في مخرجات Tesseract
 * وفصل الرقم حتى لو التصق بخط جدول عمودي (|) أو كود مصنع (M016 / C006) أو انقسم بمسافة.
 */
export function extractStrictMaterialNumber(line: string): string | null {
  const exactMatch = line.match(/\b(100\d{7})\b/);
  if (exactMatch) {
    return exactMatch[1];
  }

  // فحص إذا التصق رقم الـ Material بحدود جدول أو أرقام إضافية ناتجة عن قراءة خط الجدول العمودي | كرقم (مثل 100047007147)
  const gluedMatch = line.match(/(?:^|[^0-9])(100\d{7})\d{0,2}(?=[^0-9]|$)/);
  if (gluedMatch) {
    return gluedMatch[1];
  }

  // فحص إذا انقسم رقم القطعة المكون من 10 أرقام بمسافة داخلية (مثل: 10010886 18)
  const splitMatch = line.match(/\b(100\d{3,6})\s+(\d{1,4})\b/);
  if (splitMatch && (splitMatch[1] + splitMatch[2]).length === 10) {
    return splitMatch[1] + splitMatch[2];
  }

  // فحص إذا كان السطر سطر جدول SAP حقيقي (يحتوي على C006/M016/002 أو موقع أو وحدة قياس) وابتلع خط الجدول الرقم 1 الأول فبقي 9 أرقام تبدأ بـ 000 أو 001
  const isSapTableLine = /\b(?:C006|M016|002|EA|SET|PK|PAA|ZYD|KIT|N\d{2}[A-Z]{1,2}\d)\b/i.test(line);
  if (isSapTableLine) {
    const nineDigitMatch = line.match(/(?:^|[^0-9])(00[01]\d{6})(?=[^0-9]|$)/);
    if (nineDigitMatch) {
      return `1${nineDigitMatch[1]}`;
    }
  }

  // فحص الرموز التي تبدو كرقم قطعة من 10 خانات مع تداخل حرف بصري مثل O أو I أو l أو r أو t أو S أو B أو G
  const tokens = line.split(/[\s|;,\[\]{}()]+/);
  for (const token of tokens) {
    const cleaned = token.replace(/[^A-Za-z0-9]/g, '');
    if (cleaned.length >= 9 && cleaned.length <= 12) {
      const repaired = cleaned
        .replace(/^[Il|!rRtTsS]/, '1')
        .replace(/[OoQD]/g, '0')
        .replace(/[Il|!t]/g, '1')
        .replace(/[Zz]/g, '2')
        .replace(/[Ss$]/g, '5')
        .replace(/[Gg]/g, '6')
        .replace(/[Bb]/g, '8');
      if (/^100\d{7}$/.test(repaired)) {
        return repaired;
      }
      if (isSapTableLine && /^100\d{7}\d{1,2}$/.test(repaired)) {
        return repaired.slice(0, 10);
      }
      if (isSapTableLine && /^00[01]\d{6}$/.test(repaired)) {
        return `1${repaired}`;
      }
    }
    const fallbackRepaired = repair10DigitMaterialCode(token);
    if (fallbackRepaired) return fallbackRepaired;
  }

  return null;
}

/**
 * استخراج رمز الموقع (Storage Bin): N13B1, N13B2, N11C2, N11FL1, N11D1, N16D1, N17A1, D1, D2...
 */
export function extractStrictStorageBin(line: string, partNumber: string): string {
  const withoutPart = line
    .replace(partNumber, ' ')
    .replace(/_/g, ' ')
    .replace(/\b(?:[0Oo]{2}2[TI|l]?|C[0Oo]{2}[6bB]|M[0Oo][1Il|i][6bB]|coos|cove|coo6|coob|more|mote|mo16|mois)\b/gi, ' ');

  // تصحيح الأخطاء البصرية الشائعة في رمز الموقع من Tesseract (مثل Ni7A1_ -> N17A1 أو NO1A1 -> N01A1 أو N1781 -> N17B1 أو N15d2 -> N15D2)
  const normalizedBinsLine = withoutPart
    .replace(/\bT?N[Oo](\d)/gi, 'N0$1')
    .replace(/\bT?N(\d)[Oo]/gi, 'N$10')
    .replace(/\bT?N[Ili|!](\d)/gi, 'N1$1')
    .replace(/\bT?N(\d)[Ili|!]/gi, 'N$11')
    .replace(/\bT?(N[0Oo1Il|i\d][0Oo1Il|i\d][A-Za-z]{1,2}[12Il|i])\b/gi, (_m, bin) =>
      bin
        .toUpperCase()
        .replace(/^N[O]/, 'N0')
        .replace(/^N(\d)[O]/, 'N$10')
        .replace(/^N[IL|]/, 'N1')
        .replace(/^N(\d)[IL|]/, 'N$11')
        .replace(/[IL|]$/, '1')
    )
    .replace(/\b(N\d{2})8([12])\b/gi, '$1B$2')
    .replace(/\b(N\d{2})V?A[TRIl|!y1]\b/gi, '$1A1')
    .replace(/\b(N\d{2})[EB8]1\b/gi, '$1B1')
    .replace(/\b(N\d{2})[EB8]2\b/gi, '$1B2')
    .replace(/\bN[1Il|i]s[oO0dD]([12])\b/gi, 'N16D$1')
    .replace(/\b(N\d{2}[A-Z]{1,2})[TRIl|!y]\b/gi, '$11');

  // 1. نمط SAP القياسي مثل N11C2, N11FL1, N11FL2, N01BB1, N11D1, N16D1, N17A2, N13B1
  const sapBinMatch = normalizedBinsLine.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{1,2})\b/i);
  if (sapBinMatch) {
    const candidate = sapBinMatch[1].toUpperCase();
    if (!['C006', 'M016', 'D04D'].includes(candidate)) {
      return candidate;
    }
  }

  // 2. النمط المركب الديناميكي مثل N02 FL1 2 أو P01 FL1 1
  const compoundMatch = normalizedBinsLine.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+\s+[0-9A-Z]+)\b/i);
  if (compoundMatch) {
    return compoundMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
  }

  // 3. نمط الرف الثنائي مثل N03 A01 أو P01 FL1 أو N11 D1
  const twoPartMatch = normalizedBinsLine.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]{2,4})\b/i);
  if (twoPartMatch) {
    return sanitizeLocationCode(twoPartMatch[1]) || twoPartMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
  }

  // 4. نمط موقع القطع الثقيلة المباشر D أو D1 أو D2
  const dBinMatch = normalizedBinsLine.match(/\b(D\d{1,2})\b/i);
  if (dBinMatch && dBinMatch[1].toUpperCase() !== 'D04D') {
    return dBinMatch[1].toUpperCase();
  }

  // 5. نمط LOC-A1-04
  const locMatch = normalizedBinsLine.match(/\b(LOC-[A-Z0-9-]{3,10})\b/i);
  if (locMatch) {
    return locMatch[1].toUpperCase();
  }

  return sanitizeLocationCode(normalizedBinsLine);
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

const UNIT_PATTERN = '(?:EA|SET|PK|SH|CO|AY|KG|PAA|ZYD|KIT|PCS|ROL|BOX|FT|M|L)';
const QTY_FIELD = new RegExp(
  `^\\s*(?:[|\\[\\]()—\\-~]+\\s*)?(?:${UNIT_PATTERN}[\\s|\\[\\]()—\\-~]+)?(\\d{1,9})(?=\\s|\\||\\[|\\]|$)`,
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

  // بحث مرن بعد وحدة القياس حتى لو فصلت بينهما خطوط جدول (مثل: EA | 2 أو EA [ 1 أو PAA | 5)
  const unitQtyMatch = line.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:]+(\\d{1,6})\\b`, 'i')
  );
  if (unitQtyMatch) {
    const val = Number(unitQtyMatch[1]);
    return { total: val > 0 ? val : 1, out: 0 };
  }

  // إذا قرأ الـ OCR الرقم 1 بعد EA كحرف مثل EA | t أو EA | I أو EA | l أو EA | ot
  const unitOcrOneMatch = line.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:]+(?:ot|a1|[Il|!ti])\\b`, 'i')
  );
  if (unitOcrOneMatch) {
    return { total: 1, out: 0 };
  }

  // ضمان عدم إرجاع 0 (الذي يتحول إلى NaN ويعطل حفظ الورقة) عندما يكون السطر سطر قطعة صحيح
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

  const isMissing = /(?:^|\s|\||\[|\])([Xx×✗✘])(?=\s|\||\[|\]|$)/.test(afterQty) ? 1 : 0;
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
    .replace(/^\s*(?:[|\[\]()—\-~_✓✔×Xx\/]|e~|ep|e=|ot|u~|o~)+\s*/i, '')
    .replace(/^(?:F\d{1,3}|-\s*\d{1,3}|\+\s*\d{1,3})\s+/i, '')
    .replace(/^\s*(?:[|\[\]()—\-~_✓✔×Xx\/])+\s*/i, '')
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

  let candidateFromDict = minStart >= 0 ? cleanOcrDescriptionTail(withoutPart.slice(minStart)) : '';

  // استخراج النص الواقع بعد خانة الوحدة والكمية (مثلاً بعد EA | 1 | ...) حتى لو لم يكن المصطلح في القاموس
  let candidateFromTail = '';
  const tailAfterBin = textAfterStorageBin(withoutPart, storageBin);
  if (tailAfterBin) {
    const qtyMatch = tailAfterBin.match(QTY_FIELD);
    const rawAfterQty = qtyMatch ? tailAfterBin.slice(qtyMatch[0].length) : tailAfterBin;
    candidateFromTail = cleanOcrDescriptionTail(rawAfterQty);
  }

  if (!candidateFromTail) {
    const unitQtyRegex = new RegExp(
      `\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:]+(?:\\d{1,6}|ot|a1|[Il|!ti])\\b(.*)$`,
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

    const partNumber = extractStrictMaterialNumber(line);
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

  // أولاً: استنتاج الموقع من السطور المجاورة للسطور التي غطت فيها علامة القلم خانة الموقع
  const locationResolved = resolveSheetLocationsWithContext(intermediateRows);

  // ثانياً: استخراج الكمية والملاحظات والوصف الكامل بعد معرفة الموقع الصحيح لكل سطر
  const finalResults: ExtractedSparePart[] = [];
  for (const row of locationResolved) {
    const loc = row.location_code;
    if (!isValidSpecificLocation(loc)) continue;

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
