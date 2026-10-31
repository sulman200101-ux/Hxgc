/**
 * المحلل الصارم السريع لجداول SAP (Strict & Resilient High-Speed SAP Table Parser)
 * يقرأ أي ورقة جرد SAP Inventory Controller قراءة فعلية مباشرة دون أي أرقام مخزنة مسبقاً:
 * 1. رقم القطعة (Material): 10 أرقام تبدأ بـ 100 أو 101 مع تصحيح البادئة البصرية (normalizeSapMaterialPrefix) وفصل الأرقام الملتصقة بخطوط الجدول (|).
 * 2. الموقع (Storage Bin): مثل N13B1, N13B2, N11C2, N11FL1, N16D1, D1 مع تنعيم الساندويتش السياقي (resolveSheetLocationsWithContext).
 * 3. الكمية (QTY): استخراج الرقم بعد وحدة القياس (EA, SET, PK, SH, CO, AY, KG, PAA, ZYD, KIT, PCS, ROL, BOX).
 * 4. العلامات والملاحظات (Check & Remark): استخراج علامة × (غير موجودة) والملاحظات مثل -1, -4 واستبعاد الزيادات (F1, F2, F4).
 * 5. خوارزمية محاذاة التداخل المتسلسل (mergeOverlappingBandRows): تدمج الشرائح المتداخلة مع الحفاظ التام على الأرقام المتتالية (1001035309..1001035312) والمكررة (1000428938).
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

function isLikelySapRowLine(line: string): boolean {
  if (
    /\b(?:C[0Oo]{2}[6bB8]|M[0Oo][1Il|i][6bB8]|[0Oo]{2}2|EA|SET|PK|SH|CO|AY|KG|PAA|ZYD|KIT|PCS|ROL|BOX|N[0Oo1Il|i\d]{2}[A-Za-z]{1,3}[0-9Il|!12]?)\b/i.test(
      line
    )
  ) {
    return true;
  }
  const upper = line.toUpperCase();
  for (let i = 0; i < TECHNICAL_TERMS_REGEXES.length; i++) {
    if (TECHNICAL_TERMS_REGEXES[i].test(upper)) return true;
  }
  return false;
}

export function extractMaterialWithRepairInfo(
  line: string
): { partNumber: string; needsReview: boolean } | null {
  const exactMatch = line.match(/\b(10[01]\d{7})\b/);
  if (exactMatch) {
    return { partNumber: exactMatch[1], needsReview: false };
  }

  const gluedMatch = line.match(/(?:^|[^0-9])(10[01]\d{7})\d{0,2}(?=[^0-9]|$)/);
  if (gluedMatch) {
    return { partNumber: gluedMatch[1], needsReview: false };
  }

  const splitMatch = line.match(/\b(10[01]\d{2,6})\s+(\d{1,5})\b/);
  if (splitMatch && (splitMatch[1] + splitMatch[2]).length === 10) {
    return { partNumber: splitMatch[1] + splitMatch[2], needsReview: false };
  }

  const isSapTableLine = isLikelySapRowLine(line);
  if (isSapTableLine) {
    const nineDigitMatch = line.match(/(?:^|[^0-9])(00[012]\d{6})(?=[^0-9]|$)/);
    if (nineDigitMatch) {
      return { partNumber: `1${nineDigitMatch[1]}`, needsReview: false };
    }
  }

  const tokens = line.split(/[\s|;,\[\]{}()]+/);
  for (const token of tokens) {
    const cleaned = token.replace(/[^A-Za-z0-9]/g, '');
    if (cleaned.length >= 8 && cleaned.length <= 13) {
      const normalized = normalizeSapMaterialPrefix(cleaned);
      if (/^10[01]\d{7}$/.test(normalized)) {
        return { partNumber: normalized, needsReview: false };
      }
      if (/^10\d{8}$/.test(normalized)) {
        return { partNumber: normalized, needsReview: false };
      }
      if (isSapTableLine && /^10[01]\d{7}\d{1,3}$/.test(normalized)) {
        return { partNumber: normalized.slice(0, 10), needsReview: false };
      }
      if (isSapTableLine && /^00\d{7}$/.test(normalized)) {
        return { partNumber: `1${normalized}`, needsReview: false };
      }
    }
    const fallbackRepaired = repair10DigitMaterialCode(token);
    if (fallbackRepaired) {
      return { partNumber: fallbackRepaired, needsReview: false };
    }
  }

  if (isSapTableLine) {
    for (const token of tokens) {
      const stripped = normalizeSapMaterialPrefix(token);
      if (stripped.length === 9) {
        const code = stripped.startsWith('00')
          ? `1${stripped}`
          : stripped.startsWith('100')
          ? `${stripped}0`
          : `1${stripped}`;
        return { partNumber: code, needsReview: true };
      }
      if (stripped.length === 8) {
        const code = stripped.startsWith('00')
          ? `10${stripped}`
          : stripped.startsWith('100')
          ? `${stripped}00`
          : `10${stripped}`;
        return { partNumber: code, needsReview: true };
      }
      if (stripped.length === 7 && (stripped.startsWith('0') || stripped.startsWith('1'))) {
        const code = stripped.startsWith('100') ? `${stripped}000` : `100${stripped}`;
        return { partNumber: code.slice(0, 10), needsReview: true };
      }
    }
  }

  return null;
}

export function extractStrictMaterialNumber(line: string): string | null {
  const res = extractMaterialWithRepairInfo(line);
  return res ? res.partNumber : null;
}

/**
 * استخراج رمز الموقع (Storage Bin): N13B1, N13B2, N11C2, N11FL1, N11D1, N16D1, N17A1, D1, D2...
 */
export function extractStrictStorageBin(line: string, partNumber: string): string {
  const withoutPart = line
    .replace(partNumber, ' ')
    .replace(/_/g, ' ')
    .replace(
      /\b(?:[0Oo]{2}2[TI|l]?|C[0Oo]{2}[6bB]|M[0Oo][1Il|i][6bB]|coos|cove|coo6|coob|more|mote|mo16|mois)\b/gi,
      ' '
    );

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

  const sapBinMatch = normalizedBinsLine.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{1,2})\b/i);
  if (sapBinMatch) {
    const candidate = sapBinMatch[1].toUpperCase();
    if (!['C006', 'M016', 'D04D'].includes(candidate)) {
      return candidate;
    }
  }

  const compoundMatch = normalizedBinsLine.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+\s+[0-9A-Z]+)\b/i);
  if (compoundMatch) {
    return compoundMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
  }

  const twoPartMatch = normalizedBinsLine.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]{2,4})\b/i);
  if (twoPartMatch) {
    return (
      sanitizeLocationCode(twoPartMatch[1]) ||
      twoPartMatch[1].replace(/\s+/g, ' ').trim().toUpperCase()
    );
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

function textAfterStorageBin(line: string, storageBin: string): string | null {
  if (!storageBin) return null;
  const tokens = Array.from(line.matchAll(/\S+/g));
  for (let i = 0; i < tokens.length; i++) {
    for (let width = 1; width <= 3 && i + width <= tokens.length; width++) {
      const last = tokens[i + width - 1];
      const candidate = line.slice(tokens[i].index!, last.index! + last[0].length);
      if (sanitizeLocationCode(candidate) === storageBin)
        return line.slice(last.index! + last[0].length);
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

  const unitQtyMatch = line.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:]+(\\d{1,6})\\b`, 'i')
  );
  if (unitQtyMatch) {
    const val = Number(unitQtyMatch[1]);
    return { total: val > 0 ? val : 1, out: 0 };
  }

  const unitOcrOneMatch = line.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:]+(?:ot|a1|[Il|!ti])\\b`, 'i')
  );
  if (unitOcrOneMatch) {
    return { total: 1, out: 0 };
  }

  return { total: 1, out: 0 };
}

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
  const minusMatch = afterQty.match(
    /(?:^|\s|\||\[|\])(?:\d{1,4}\s*-\s*(\d{1,4})|-\s*(\d{1,4}))(?=\s|\||\[|\]|$)/
  );
  if (minusMatch) {
    shortage = Number(minusMatch[1] || minusMatch[2] || 0);
    if (shortage > 0) {
      remark = `-${shortage}`;
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

/**
 * خوارزمية محاذاة التداخل المتسلسل (Sequential Overlap Band Alignment):
 * تدمج الشرائح المتداخلة (مثلاً الشريحة العلوية والوسطى والسفلية، أو النصف العلوي والسفلي)
 * من خلال فحص نافذة التداخل الطرفية فقط دون حذف الأرقام المكررة الشرعية (مثل 1000428938 بكميتين 3 و 6)
 * ودون إسقاط الأرقام المتتالية (مثل 1001035309, 1001035310, 1001035311, 1001035312).
 */
export function mergeOverlappingBandRows(bands: ExtractedSparePart[][]): ExtractedSparePart[] {
  const nonEmptyBands = (bands || []).filter((b) => Array.isArray(b) && b.length > 0);
  if (nonEmptyBands.length === 0) return [];
  if (nonEmptyBands.length === 1) return [...nonEmptyBands[0]];

  let merged: ExtractedSparePart[] = [...nonEmptyBands[0]];

  for (let bIdx = 1; bIdx < nonEmptyBands.length; bIdx++) {
    const nextBand = nonEmptyBands[bIdx];
    const maxOverlapWindow = Math.min(10, merged.length, nextBand.length);
    const tailStart = merged.length - maxOverlapWindow;

    // 1. محاولة إيجاد نقطة التقاء متسلسلة (Anchor Alignment) بين ذيل الشريحة السابقة ورأس الشريحة التالية
    let bestAnchorTailIdx = -1;
    let bestAnchorHeadIdx = -1;

    for (let t = tailStart; t < merged.length; t++) {
      for (let h = 0; h < Math.min(8, nextBand.length); h++) {
        const tailRow = merged[t];
        const headRow = nextBand[h];
        if (
          tailRow.part_number === headRow.part_number &&
          tailRow.qty_total === headRow.qty_total &&
          tailRow.location_code === headRow.location_code
        ) {
          bestAnchorTailIdx = t;
          bestAnchorHeadIdx = h;
          break;
        }
      }
      if (bestAnchorTailIdx !== -1) break;
    }

    if (bestAnchorTailIdx !== -1 && bestAnchorHeadIdx !== -1) {
      // ترقية أي وصف ناقص في منطقة التداخل ثم إلحاق بقية الشريحة التالية بالترتيب
      const overlapCount = Math.min(
        merged.length - bestAnchorTailIdx,
        nextBand.length - bestAnchorHeadIdx
      );
      for (let k = 0; k < overlapCount; k++) {
        const existing = merged[bestAnchorTailIdx + k];
        const candidate = nextBand[bestAnchorHeadIdx + k];
        if (
          existing &&
          candidate &&
          existing.part_number === candidate.part_number &&
          existing.description_en === 'SPARE PART ASMO' &&
          candidate.description_en !== 'SPARE PART ASMO'
        ) {
          merged[bestAnchorTailIdx + k] = candidate;
        }
      }

      const usedTailIndices = new Set<number>();
      for (let i = bestAnchorHeadIdx; i < nextBand.length; i++) {
        const candidate = nextBand[i];
        const relativeIdx = i - bestAnchorHeadIdx;
        if (relativeIdx < merged.length - bestAnchorTailIdx) {
          const tailIdx = bestAnchorTailIdx + relativeIdx;
          if (
            merged[tailIdx].part_number === candidate.part_number &&
            merged[tailIdx].qty_total === candidate.qty_total
          ) {
            usedTailIndices.add(tailIdx);
            continue;
          }
        }

        // فحص نافذة التداخل القريبة فقط (مع اشتراط تطابق رقم القطعة والكمية والموقع معاً لعدم حذف المكرر الشرعي)
        let matchedInTail = false;
        if (i < 8) {
          for (let t = tailStart; t < merged.length; t++) {
            if (
              !usedTailIndices.has(t) &&
              merged[t].part_number === candidate.part_number &&
              merged[t].qty_total === candidate.qty_total &&
              merged[t].location_code === candidate.location_code
            ) {
              usedTailIndices.add(t);
              matchedInTail = true;
              break;
            }
          }
        }
        if (!matchedInTail) {
          merged.push(candidate);
        }
      }
    } else {
      // 2. في حال عدم وجود نقطة ارتكاز متطابقة، نفحص أول 7 أسطر فقط من الشريحة الجديدة مقابل آخر 8 أسطر من الشريحة السابقة
      const usedTailIndices = new Set<number>();
      for (let i = 0; i < nextBand.length; i++) {
        const candidate = nextBand[i];
        let isOverlapDup = false;
        if (i < 7) {
          for (let t = tailStart; t < merged.length; t++) {
            if (
              !usedTailIndices.has(t) &&
              merged[t].part_number === candidate.part_number &&
              merged[t].qty_total === candidate.qty_total &&
              merged[t].location_code === candidate.location_code
            ) {
              usedTailIndices.add(t);
              if (
                merged[t].description_en === 'SPARE PART ASMO' &&
                candidate.description_en !== 'SPARE PART ASMO'
              ) {
                merged[t] = candidate;
              }
              isOverlapDup = true;
              break;
            }
          }
        }
        if (!isOverlapDup) {
          merged.push(candidate);
        }
      }
    }
  }

  return merged;
}

export function parseStrictAsmoTable(rawText: string): ExtractedSparePart[] {
  if (!rawText) return [];

  const lines = rawText.split(/\r?\n/);
  const intermediateRows: Array<{
    rawLine: string;
    part_number: string;
    location_code: string;
    location?: string;
    needsReview?: boolean;
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const matInfo = extractMaterialWithRepairInfo(line);
    if (!matInfo) {
      continue;
    }

    const storageBin = extractStrictStorageBin(line, matInfo.partNumber);
    intermediateRows.push({
      rawLine: line,
      part_number: matInfo.partNumber,
      location_code: storageBin,
      location: storageBin,
      needsReview: matInfo.needsReview,
    });
  }

  const locationResolved = resolveSheetLocationsWithContext(intermediateRows);

  const finalResults: ExtractedSparePart[] = [];
  for (const row of locationResolved) {
    let loc = row.location_code;
    if (!isValidSpecificLocation(loc)) {
      if (locationResolved.length >= 4 && !row.rawLine.includes('عام')) {
        loc = 'D1';
      } else {
        continue;
      }
    }

    const { total } = extractStrictQuantity(row.rawLine, row.part_number, loc);
    const { isMissing, remark, shortage } = extractCheckAndRemark(row.rawLine, loc);
    const { descEn, descAr, category } = extractStrictDescription(
      row.rawLine,
      row.part_number,
      loc
    );
    const out = isMissing ? 0 : Math.min(total, shortage);
    const finalDescAr = row.needsReview ? `⚠️ راجع الرقم — ${descAr}` : descAr;

    finalResults.push({
      part_number: row.part_number,
      location_code: loc,
      description_en: descEn,
      description_ar: finalDescAr,
      category,
      qty_total: total,
      qty_out: out,
      qty_remaining: isMissing ? 0 : Math.max(0, total - out),
      is_missing: isMissing,
      remark: remark || undefined,
      status: isMissing ? 'غير موجودة' : 'غير مدقق',
      confidence: row.needsReview
        ? '⚠️ رقم المادة غير واضح جزئياً: يرجى مراجعته مقابل الورقة'
        : 'اقتراح غير مؤكد: راجع رقم القطعة والكمية والعلامات مقابل الأصل',
    });
  }

  return finalResults;
}
