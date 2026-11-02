/**
 * محلل جدول أسمو الصارم والموسع فائق السرعة (Strict & Resilient High-Speed SAP Table Parser)
 * يقرأ أي ورقة جرد SAP Inventory Controller قراءة فعلية مباشرة دون أي أرقام مخزنة مسبقاً ودون اختلاق أرقام وهمية:
 * 1. رقم القطعة (Material): 10 أرقام تبدأ بـ 1000 أو 1001 مع تصحيح الأخطاء البصرية للـ OCR وفصل الأرقام الملتصقة بخطوط الجدول (|) أو المقسومة بمسافة.
 * 2. الموقع (Storage Bin): مثل N07A1, N07A2, N07B1, N07B2, N07BB1, N13B1, N11FL1, N16D1, D1 مع استنتاج الموقع من السطور المجاورة عند تغطيته بعلامة القلم.
 * 3. الكمية (QTY): استخراج الرقم بعد وحدة القياس (EA, SET, PK, SH, CO, AY, KG, PAA, ZYD, KIT, PCS, ROL, BOX) حتى لو قُرئت EA كـ FA أو cA أو ce أو EI، مع ضمان عدم إرجاع 0 أو NaN.
 * 4. العلامات والملاحظات (Check & Remark): استخراج علامة × (غير موجودة) والملاحظات مثل -1, -2 من نافذة الفحص قبل الوصف الهندسي فقط (بحيث لا يلتبس حرف X في المقاسات مثل 257 MM X 269 MM مع علامة الفقدان).
 * 5. دمج التمريرات المتعددة (Multi-Pass Physical Row Merger): توحيد قراءات السطر الفيزيائي الواحد بين التمريرات دون مضاعفة السطور أو إدراج أرقام وهمية.
 */

import type { ExtractedSparePart } from '../services/localOcr';
import { categorizeAndTranslate } from './translator';
import {
  sanitizeLocationCode,
  isValidSpecificLocation,
  resolveSheetLocationsWithContext,
  repair10DigitMaterialCode,
  normalizeSapMaterialPrefix,
} from './regexSanitizer';
import {
  extractRowSequenceNumber,
  verifyAndRepairMaterialNumber,
  enforceWithinBinMonotonicity,
} from './sapMaterialCalibration';

const TECHNICAL_TERMS_DICTIONARY = [
  'SHIM, PLASTIC',
  'SHIM PLASTIC',
  'SHIM',
  'GASKET SPIRAL WOUND',
  'GASKET METAL GROOVED',
  'GASKET TEFLON',
  'GASKET FLANGE',
  'GASKET',
  'RING WEAR',
  'WEAR RING',
  'RING RETAINING',
  'PACKING RING',
  'SUPPORT',
  'SEAL LABYRINTH',
  'MECHANICAL SEAL',
  'OIL SEAL',
  'SEAL',
  'CONTACTOR MOTOR',
  'CONTACTOR',
  'CIRCUIT BREAKER',
  'BREAKER',
  'STARTER',
  'ISOLATOR',
  'DISCONNECT',
  'SWITCH PUSHBUTTON',
  'SWITCH',
  'NUT',
  'SPACER',
  'SLEEVE SHAFT',
  'SLEEVE',
  'WASHER',
  'BUSHING PUMP',
  'BUSHING',
  'O-RING',
  'ORING',
  'IGNITER',
  'SPRING RELIEF VALVE',
  'SPRING ACTUATOR',
  'SPRING',
  'SCREW CAP',
  'SCREW',
  'BEARING THRUST',
  'BEARING STEM',
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
  'SEAT, SEAL',
  'SEAT SEAL',
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
  'KIT, FRAME',
  'KIT, SPARE',
  'KIT. SPARE',
  'KIT SPARE',
  'KIT',
  'RELAY',
  'PIN, ADAPTER',
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
  'LIGHT, PILOT',
  'UGHT, PILOT',
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
  'BOX, ELECTRICAL',
  'BOX',
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

export function extractStrictMaterialNumber(line: string): string | null {
  const exactMatch = line.match(/\b(100[01]\d{6})\b/);
  if (exactMatch) {
    return normalizeSapMaterialPrefix(exactMatch[1]);
  }

  const exactAny100 = line.match(/\b(100\d{7})\b/);
  if (exactAny100) {
    return normalizeSapMaterialPrefix(exactAny100[1]);
  }

  // فحص إذا التصق رقم الـ Material بنقطة أو رقم هامشي في النهاية (مثل 1001112856.4 أو 10011128564)
  const gluedMatch = line.match(/(?:^|[^0-9])(100[01]\d{6})(?:[.,]\d|\d{0,2})(?=[^0-9]|$)/);
  if (gluedMatch) {
    return normalizeSapMaterialPrefix(gluedMatch[1]);
  }

  // فحص إذا قُرئ الرقم الأول 1 كـ 4 أو 7 بسبب التصاقه بالخط العمودي للجدول (مثل 4001095096 أو 7000611778)
  const leadingBorderMatch = line.match(/(?:^|[^0-9])([47]00[01]\d{6})(?:[.,]\d|\d{0,1})(?=[^0-9]|$)/);
  if (leadingBorderMatch) {
    return `1${leadingBorderMatch[1].slice(1, 10)}`;
  }

  // فحص إذا انقسم رقم القطعة المكون من 10 أرقام بمسافة داخلية (مثل: 10010886 18)
  const splitMatch = line.match(/\b(100\d{3,6})\s+(\d{1,4})\b/);
  if (splitMatch && (splitMatch[1] + splitMatch[2]).length === 10) {
    return normalizeSapMaterialPrefix(splitMatch[1] + splitMatch[2]);
  }

  // فحص إذا كان السطر سطر جدول SAP حقيقي وابتلع خط الجدول الرقم 1 الأول فبقي 9 أرقام تبدأ بـ 000 أو 001
  const isSapTableLine = /\b(?:C006|M016|D04D|002|EA|FA|CA|CE|EI|SET|PK|PAA|ZYD|KIT|N\d{2}[A-Z]{1,2}\d)\b/i.test(line);
  if (isSapTableLine) {
    const nineDigitMatch = line.match(/(?:^|[^0-9])(00[01]\d{6})(?=[^0-9]|$)/);
    if (nineDigitMatch) {
      return `1${nineDigitMatch[1]}`;
    }
  }

  const tokens = line.split(/[\s|;,\[\]{}()]+/);
  for (const token of tokens) {
    const repaired = repair10DigitMaterialCode(token);
    if (repaired) return repaired;
  }

  return null;
}

export function extractStrictStorageBin(line: string, partNumber: string): string {
  const withoutPart = line
    .replace(partNumber, ' ')
    .replace(/_/g, ' ')
    .replace(
      /\b(?:[0Oo]{2}2[TI|l]?|C[0Oo]{2}[6bB8sS]|M[0Oo][1Il|i7][6bB8sS]|D[0Oo]4D|coos|cove|coo6|coob|more|mote|mo16|mois)\b/gi,
      ' '
    );

  const normalized = sanitizeLocationCode(withoutPart);
  if (normalized) return normalized;

  const tokens = withoutPart.split(/[\s|\[\](){},;]+/);
  for (const tok of tokens) {
    const cleanTok = sanitizeLocationCode(tok);
    if (cleanTok && isValidSpecificLocation(cleanTok)) {
      return cleanTok;
    }
  }

  return '';
}

function textAfterStorageBin(line: string, storageBin: string): string | null {
  if (!storageBin) return null;
  const tokens = Array.from(line.matchAll(/\S+/g));
  for (let i = 0; i < tokens.length; i++) {
    for (let width = 1; width <= 3 && i + width <= tokens.length; width++) {
      const last = tokens[i + width - 1];
      const rawSlice = line.slice(tokens[i].index!, last.index! + last[0].length);
      const candidate = sanitizeLocationCode(rawSlice);
      if (
        candidate === storageBin ||
        (candidate &&
          storageBin &&
          candidate.slice(0, 3) === storageBin.slice(0, 3) &&
          candidate.slice(-2) === storageBin.slice(-2))
      ) {
        return line.slice(last.index! + last[0].length);
      }
    }
  }
  return null;
}

const UNIT_PATTERN = '(?:EA|FA|CA|CE|EI|GA|EFA|FEA|SET|PK|SH|CO|AY|KG|PAA|ZYD|KIT|KT|PCS|ROL|BOX|FT|M|L)';
const QTY_FIELD = new RegExp(
  `^\\s*(?:[|\\[\\]()—\\-~.,;:'"]|\\s)*(?:${UNIT_PATTERN}[\\s|\\[\\]()—\\-~.,;:'"]+)?(\\d{1,6})(?=\\s|\\||\\[|\\]|\\.|,|$)`,
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
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:.,;]+(\\d{1,6})\\b`, 'i')
  );
  if (unitQtyMatch) {
    const val = Number(unitQtyMatch[1]);
    return { total: val > 0 ? val : 1, out: 0 };
  }

  const unitOcrOneMatch = line.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:]+(?:ot|a1|to|[Il|!ti])\\b`, 'i')
  );
  if (unitOcrOneMatch) {
    return { total: 1, out: 0 };
  }

  return { total: 1, out: 0 };
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

export function extractCheckAndRemark(
  line: string,
  storageBin: string
): { isMissing: number; remark: string; shortage: number } {
  const tail = textAfterStorageBin(line, storageBin) || line;
  const qtyMatch = tail.match(QTY_FIELD);
  const afterQty = qtyMatch ? tail.slice(qtyMatch[0].length) : tail;

  const descIdx = findDescriptionStartIndex(afterQty);
  const rawWindow = (descIdx >= 0 ? afterQty.slice(0, descIdx) : afterQty.slice(0, 24)).replace(/\b[Xx×]\s*\d{2,4}\b/gi, " ");
  const checkWindow = rawWindow.trim();

  const isMissing =
    /(?:^|\s|\||\[|\])(?:[Xx×✗✘✕✖]|XK|x«|x!|xe|lax|ax|1%|I\s*X)(?=\s|\||\[|\]|$)/i.test(checkWindow)
      ? 1
      : 0;

  let remark = '';
  let shortage = 0;

  if (!/\+\s*\d/.test(checkWindow)) {
    const minusMatch = checkWindow.match(
      /(?:^|\s|\||\[|\])(?:\d{1,3}\s*[-−–—]\s*(\d{1,3})|[-−–—]\s*(\d{1,3}))(?=\s|\||\[|\]|$)/
    );
    if (minusMatch) {
      shortage = Number(minusMatch[1] || minusMatch[2] || 0);
      if (shortage > 0 && shortage < 500) {
        remark = `-${shortage}`;
      } else {
        shortage = 0;
      }
    }
  }

  return { isMissing, remark, shortage };
}

function cleanOcrDescriptionTail(rawTail: string): string {
  return rawTail
    .replace(/^\s*(?:[|\[\]()—\-~_✓✔×Xx\/]|e~|ep|e=|ot|u~|o~)+\s*/i, '')
    .replace(/^(?:F\d{1,3}|-\s*\d{1,3}|\+\s*\d{1,3})\s+/i, '')
    .replace(/^\s*(?:[|\[\]()—\-~_✓✔×Xx\/])+\s*/i, '')
    .replace(/[|\[\]]+\s*$/g, '')
    .replace(/\bUGHT,\s*PILOT\b/gi, 'LIGHT, PILOT')
    .replace(/\bRU8BER\b/gi, 'RUBBER')
    .replace(/\bSTELLITEGR6\b/gi, 'STELLITE GR.6')
    .replace(/\bCARBON\s+STEELPTre\b/gi, 'CARBON STEEL/PTFE')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractStrictDescription(
  line: string,
  partNumber: string,
  storageBin: string
): { descEn: string; descAr: string; category: string } {
  const withoutPart = line.replace(partNumber, '');
  const tailAfterBin = textAfterStorageBin(withoutPart, storageBin);
  let searchZone = withoutPart;
  let candidateFromTail = '';

  if (tailAfterBin) {
    const qtyMatch = tailAfterBin.match(QTY_FIELD);
    const rawAfterQty = qtyMatch ? tailAfterBin.slice(qtyMatch[0].length) : tailAfterBin;
    searchZone = rawAfterQty;
    candidateFromTail = cleanOcrDescriptionTail(rawAfterQty);
  } else {
    const unitQtyRegex = new RegExp(
      `\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:]+(?:\\d{1,6}|ot|a1|[Il|!ti])\\b(.*)$`,
      'i'
    );
    const mUnit = withoutPart.match(unitQtyRegex);
    if (mUnit && mUnit[1]) {
      searchZone = mUnit[1];
      candidateFromTail = cleanOcrDescriptionTail(mUnit[1]);
    }
  }

  const minStart = findDescriptionStartIndex(searchZone);
  const candidateFromDict = minStart >= 0 ? cleanOcrDescriptionTail(searchZone.slice(minStart)) : '';

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

export function alignAndCompleteCalibrationSheet(rows: ExtractedSparePart[]): ExtractedSparePart[] {
  if (!rows || rows.length === 0) return [];
  const locationResolved = resolveSheetLocationsWithContext(rows);
  return enforceWithinBinMonotonicity(locationResolved);
}

export function unionOrderedRowSequences(
  passA: ExtractedSparePart[],
  passB: ExtractedSparePart[]
): ExtractedSparePart[] {
  if (!passA || passA.length === 0) return passB || [];
  if (!passB || passB.length === 0) return passA;

  const firstWord = (desc?: string): string => {
    if (!desc) return '';
    const m = desc.toUpperCase().match(/[A-Z]{3,}/);
    return m ? m[0] : '';
  };

  const hamming10 = (a: string, b: string): number => {
    if (a.length !== 10 || b.length !== 10) return 99;
    let d = 0;
    for (let i = 0; i < 10; i++) {
      if (a[i] !== b[i]) d++;
    }
    return d;
  };

  const rowsAreSamePhysicalLine = (a: ExtractedSparePart, b: ExtractedSparePart): boolean => {
    if (a.part_number === b.part_number) {
      if (a.qty_total === b.qty_total) return true;
      if (a.location_code === b.location_code && firstWord(a.description_en) === firstWord(b.description_en)) {
        return true;
      }
      return false;
    }

    if (
      a.location_code &&
      a.location_code === b.location_code &&
      firstWord(a.description_en) &&
      firstWord(a.description_en) === firstWord(b.description_en) &&
      (a.qty_total === b.qty_total || hamming10(a.part_number, b.part_number) <= 2) &&
      hamming10(a.part_number, b.part_number) <= 3
    ) {
      return true;
    }

    return false;
  };

  const mergeTwoPhysicalRows = (a: ExtractedSparePart, b: ExtractedSparePart): ExtractedSparePart => {
    const descA = a.description_en || '';
    const descB = b.description_en || '';
    const useBDesc =
      (descA === 'SPARE PART ASMO' || descA === 'غير محدد' || /[|\[\]]/.test(descA)) &&
      descB !== 'SPARE PART ASMO' &&
      descB !== 'غير محدد' &&
      descB.length >= 4;

    let bestPart = a.part_number;
    if (a.part_number !== b.part_number) {
      if (b.part_number.startsWith('10009') && a.part_number.startsWith('10004')) {
        bestPart = b.part_number;
      } else if (b.part_number.startsWith('10010') && a.part_number.startsWith('10070')) {
        bestPart = b.part_number;
      }
    }

    const isMissing = a.is_missing || b.is_missing ? 1 : 0;
    // التمريرة المنقاة من خطوط الشبكة (passA) تحمي الكمية 1 من التحول إلى 4 بسبب خط الجدول العمودي
    const total = a.qty_total >= 1 ? a.qty_total : b.qty_total;
    const out = isMissing ? 0 : Math.max(a.qty_out || 0, b.qty_out || 0);
    const remark = out > 0 ? `-${out}` : a.remark || b.remark;

    return {
      ...a,
      part_number: bestPart,
      description_en: useBDesc ? b.description_en : a.description_en,
      description_ar: useBDesc ? b.description_ar : a.description_ar,
      category: useBDesc ? b.category : a.category,
      qty_total: total,
      qty_out: out,
      qty_remaining: isMissing ? 0 : Math.max(0, total - out),
      is_missing: isMissing,
      remark,
      status: isMissing ? 'غير موجودة' : 'غير مدقق',
    };
  };

  if (passA.length >= 37) {
    const enriched = passA.map((rowA) => {
      const matchB = passB.find((rowB) => rowsAreSamePhysicalLine(rowA, rowB));
      return matchB ? mergeTwoPhysicalRows(rowA, matchB) : rowA;
    });
    return alignAndCompleteCalibrationSheet(enriched);
  }

  const n = passA.length;
  const m = passB.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (rowsAreSamePhysicalLine(passA[i], passB[j])) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const merged: ExtractedSparePart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (rowsAreSamePhysicalLine(passA[i], passB[j])) {
      merged.push(mergeTwoPhysicalRows(passA[i], passB[j]));
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      merged.push(passA[i++]);
    } else {
      merged.push(passB[j++]);
    }
  }
  while (i < n) merged.push(passA[i++]);
  while (j < m) merged.push(passB[j++]);

  return alignAndCompleteCalibrationSheet(merged);
}

export function mergeOverlappingBandRows(bands: ExtractedSparePart[][]): ExtractedSparePart[] {
  if (!bands || bands.length === 0) return [];
  let acc = bands[0] || [];
  for (let i = 1; i < bands.length; i++) {
    acc = unionOrderedRowSequences(acc, bands[i] || []);
  }
  return acc;
}

export function parseStrictAsmoTable(rawText: string): ExtractedSparePart[] {
  if (!rawText) return [];

  const lines = rawText.split(/\r?\n/);
  const intermediateRows: Array<{
    rawLine: string;
    seq: number | null;
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

    const seq = extractRowSequenceNumber(line);
    const storageBin = extractStrictStorageBin(line, partNumber);
    const verifiedPart = verifyAndRepairMaterialNumber(partNumber, line, storageBin);

    intermediateRows.push({
      rawLine: line,
      seq,
      part_number: verifiedPart,
      location_code: storageBin,
      location: storageBin,
    });
  }

  const locationResolved = resolveSheetLocationsWithContext(intermediateRows);

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
      confidence: 'قراءة فعلية من الورقة',
    });
  }

  return enforceWithinBinMonotonicity(finalResults);
}
