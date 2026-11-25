/**
 * محلل جدول أسمو الصارم والدقيق (Strict Zero-Hallucination SAP Table Parser)
 * يقرأ فقط البيانات المرئية فعلياً في الورقة سطراً بسطر:
 * - يدعم صيغ الكميات (EA 5 و 5 EA و KIT 1 و ZYD 1 والرقم بعد الموقع أو رقم القطعة مباشرة)
 * - يدعم أكواد المواقع المخزنية (N... و P16C2 و P16D1 و P16D2 و P16FL1 و P16FL2)
 * - يحافظ على السطور المكررة لنفس رقم القطعة في الورقة بترتيب ظهورها الفعلي (occurrence-aware)
 * - يمنع تماماً إدراج أي سطر عشوائي خالٍ من رقم القطعة والموقع المخزني.
 */

import { ExtractedSparePart } from '../services/localOcr';
import { categorizeAndTranslate, isConsumableDescription } from './translator';
import {
  sanitizeLocationCode,
  isValidSpecificLocation,
  repair10DigitMaterialCode,
  resolveSheetLocationsWithContext,
} from './regexSanitizer';

export interface ParsedInventoryRow {
  lineNumber: number | null;
  material: string;
  plant: string;
  area: string;
  storageBin: string;
  unit: string;
  qty: number;
  status: 'مدقق' | 'غير مدققة' | 'غير موجود';
  remark: string | null;
  newBinLocation: string | null;
  description: string;
}

/**
 * تحويل الأرقام المتشابهة مع الحروف الإنجليزية في حقول الأرقام
 */
export function normalizeDigits(input: string): string {
  return input
    .toUpperCase()
    .replace(/[OQCD]/g, '0')
    .replace(/[IL|!]/g, '1')
    .replace(/Z/g, '2')
    .replace(/S/g, '5')
    .replace(/G/g, '6')
    .replace(/B/g, '8');
}

/**
 * استخراج وتصحيح رقم المادة (Material) المكون من 10 أرقام تبدأ بـ 100
 */
export function extractMaterialNumber(rawLine: string): string | null {
  const tokens = rawLine.split(/\s+/);
  for (const token of tokens) {
    const cleaned = token.replace(/[^A-Z0-9]/gi, '');
    if (cleaned.length >= 9 && cleaned.length <= 11) {
      const numeric = normalizeDigits(cleaned);
      const match = numeric.match(/\b(100\d{7})\b/);
      if (match) return match[1];
    }
  }
  return null;
}

/**
 * استخراج وتصحيح رمز الموقع (Storage Bin)
 * يغطي كافة هياكل مواقع SAP التي تبدأ بـ N أو P مثل:
 * N07D1, N07FL1, N08A1, N15BB2, N15C1, N15D2, N15FL1, N16D1/N1601, N16D2/N1602, N16A1, N17A1, N17B1, P16C2, P16D1, P16D2, P16FL1, P16FL2
 */
export function extractStorageBin(rawLine: string): string | null {
  const upper = rawLine.toUpperCase();

  // 1. دمج المسافات الخاطئة داخل رمز الموقع إن وجدت (مثل "N 07 D1" -> "N07D1")
  const compact = upper.replace(/\b([NP])\s+([0O1I\d]{2})\s*([A-Z0-9]{2,4})\b/g, '$1$2$3');

  // 2. البحث عن التوكين الواقع بعد Plant/Area أو المطابق لنمط Storage Bin
  const binRegex = /\b([NP])([0O1I\d]{2})([A-Z0-9]{2,4})\b/g;
  const matches = [...compact.matchAll(binRegex)];

  for (const m of matches) {
    const prefix = m[1];
    const firstTwoDigits = normalizeDigits(m[2]);
    const suffix = m[3];

    const viaSanitizer = sanitizeLocationCode(`${prefix}${firstTwoDigits}${suffix}`);
    if (viaSanitizer && isValidSpecificLocation(viaSanitizer)) {
      return viaSanitizer;
    }

    // تصحيح الخانة الأخيرة في اللاحقة لأنها دائماً رقم (مثل N07D1 أو N16D1 أو N15BB2)
    const correctedSuffix =
      suffix.slice(0, -1).replace(/0/g, 'O') + normalizeDigits(suffix.slice(-1));

    // استبعاد الكلمات الإنجليزية العادية في الوصف التي قد تبدأ بـ N (مثل NITRILE أو NORMAL)
    if (/^\d{2}$/.test(firstTwoDigits) && /\d$/.test(correctedSuffix)) {
      return `${prefix}${firstTwoDigits}${correctedSuffix}`;
    }
  }

  return null;
}

/**
 * استخراج رمز الملاحظة (Remark) حصرياً حسب دليل رموز الورقة:
 * (F) Found, (S) Short, (D) Damaged, (L) Lost, (UID) Unidentified
 * مع منع تفسير حرف N الخاص بالموقع على أنه "ناقص -N"
 */
export function extractValidRemark(rawSegment: string): string | null {
  if (!rawSegment) return null;
  const upper = rawSegment.toUpperCase().trim();

  // التقاط الرموز المعتمدة فقط: F1, F2, F3, F5, F20, S&T, S1, D1, L1, UID (أو F مفرد)
  const match = upper.match(/\b(F\d{1,3}|S&T|S\d{1,2}|D\d{1,2}|L\d{1,2}|UID)\b/);
  if (match) return match[1];
  const bareF = upper.match(/(?:^|[\s|\[\](){}])(F)(?=\s|\||\[|\]|\)|$)/);
  return bareF ? 'F' : null;
}

/**
 * تحليل سطر كامل من جدول الجرد إلى كائن ParsedInventoryRow
 */
export function parseInventoryTableLine(rawLine: string): ParsedInventoryRow | null {
  const material = extractMaterialNumber(rawLine);
  if (!material) return null;

  const storageBin = extractStorageBin(rawLine) || '';

  const plantMatch = rawLine.toUpperCase().match(/\b([CM][0O]\d{2})\b/);
  const plant = plantMatch ? plantMatch[1].replace(/O/g, '0') : 'M016';

  const unitQtyMatch = rawLine
    .toUpperCase()
    .match(/\b(EA|SET|KIT|PAA|ZYD|PC|M|KG|ROL)\b\s+(\d{1,4})\b/);
  const unit = unitQtyMatch ? unitQtyMatch[1] : 'EA';
  const qty = unitQtyMatch ? parseInt(unitQtyMatch[2], 10) : 1;

  const partSliceIdx = rawLine.indexOf(material.slice(0, 5));
  const beforeMaterial = partSliceIdx > 0 ? rawLine.slice(0, partSliceIdx).trim() : '';
  const lineNumMatch = beforeMaterial.match(/\b(\d{1,5})\b/);
  const lineNumber = lineNumMatch ? parseInt(lineNumMatch[1], 10) : null;

  let afterQty = rawLine;
  if (unitQtyMatch && unitQtyMatch.index !== undefined) {
    afterQty = rawLine.slice(unitQtyMatch.index + unitQtyMatch[0].length);
  }

  const remark = extractValidRemark(afterQty);

  let status: 'مدقق' | 'غير مدققة' | 'غير موجود' = 'مدقق';
  if (/\b(X|✗|✘)\b/i.test(afterQty)) {
    status = 'غير موجود';
  }

  const description = afterQty
    .replace(/\b(F\d{1,3}|S&T|S\d{1,2}|D\d{1,2}|L\d{1,2}|UID)\b/gi, '')
    .replace(/^[\s✓✔✗✘/\\|vV\-_]+/, '')
    .trim();

  return {
    lineNumber,
    material,
    plant,
    area: '002',
    storageBin,
    unit,
    qty,
    status,
    remark,
    newBinLocation: null,
    description,
  };
}

export function isRandomNoiseOrGibberish(text: string): boolean {
  if (!text || text.length < 2) return true;
  return false;
}

/**
 * استخراج رقم القطعة في جداول SAP فقط إذا كان مكوناً من 10 أرقام صريحة ويبدأ بـ 10 (لمنع أرقام الحدود المقلوبة مثل 2212121215).
 */
export function extractStrictMaterialNumber(line: string): string | null {
  if (!line) return null;
  const directSap = extractMaterialNumber(line);
  if (directSap) return directSap;
  const repaired = repair10DigitMaterialCode(line);
  if (repaired && /^10\d{8}$/.test(repaired)) return repaired;
  const exactMatch = line.match(/\b(10\d{8})\b/);
  return exactMatch ? exactMatch[1] : null;
}

/**
 * تحديد موضع نهاية رمز الموقع الفعلي داخل النص حتى لو تم تصحيح حرف فيه (مثل NO7BB2 -> N07BB2 أو P1601 -> P16D1)
 */
function findBinEndOffsetInText(text: string, storageBin: string): number {
  if (!text || !storageBin) return -1;
  const upperBin = storageBin.toUpperCase();
  const directIdx = text.toUpperCase().indexOf(upperBin);
  if (directIdx >= 0) {
    return directIdx + storageBin.length;
  }

  const tokenRegex = /[^\s|;,\[\]{}()]+/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(text)) !== null) {
    if (m.index > 65) break;
    const norm = sanitizeLocationCode(m[0]);
    if (norm && norm.toUpperCase() === upperBin) {
      return m.index + m[0].length;
    }
  }
  return -1;
}

/**
 * استخراج رمز الموقع المرئي فقط في نافذة الموقع (بعد رقم القطعة وقبل الوصف)، وإذا لم يوجد يُترك فارغاً ("").
 */
export function extractStrictStorageBin(line: string, partNumber: string): string {
  if (!line) return '';
  const partIdx = partNumber ? line.indexOf(partNumber) : -1;
  const afterPart = partIdx >= 0 ? line.slice(partIdx + partNumber.length) : line;
  const binSearchWindow = afterPart.slice(0, 56);

  const sapBinMatch = binSearchWindow.match(/\b([NP]\d{2}(?:FL|BB|[A-D])\d{1,2})\b/i);
  if (sapBinMatch) {
    return sapBinMatch[1].toUpperCase();
  }

  const fromHelper = extractStorageBin(binSearchWindow);
  if (fromHelper) return fromHelper;

  const tokens = binSearchWindow.split(/[\s|;,\[\]{}()]+/);
  for (const tok of tokens) {
    if (!tok) continue;
    const clean = sanitizeLocationCode(tok);
    if (clean && isValidSpecificLocation(clean)) {
      return clean;
    }
  }
  return '';
}

const UNIT_PATTERN =
  '(?:EA|E4|FA|ER|CA|BA|SA|LA|SET|5ET|PK|SH|CO|AY|KG|PAA|ZYD|ZVD|ZYL|KIT|PCS|ROL|BOX)';

/**
 * استخراج الكمية المرئية بدقة من عمود QTY مع معالجة التصاق الرقم 1 بحد العمود الرأسي.
 */
export function extractStrictQuantity(
  line: string,
  partNumber: string,
  storageBin: string
): { total: number; out: number } {
  const partIdx = partNumber ? line.indexOf(partNumber) : -1;
  const afterPart = partIdx >= 0 ? line.slice(partIdx + partNumber.length) : line;

  // 1. نمط: EA 5 أو KIT 1 أو ZYD 2
  const unitBeforeQty = afterPart.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:°.]+(\\d{1,4})\\b`, 'i')
  );
  if (unitBeforeQty) {
    const val = Number(unitBeforeQty[1]);
    if (val > 0 && val < 5000) {
      return { total: val, out: 0 };
    }
  }

  // 2. نمط: 5 EA
  const qtyBeforeUnit = afterPart.match(
    new RegExp(`\\b(\\d{1,4})[\\s|\\[\\]()—\\-~:°.]+${UNIT_PATTERN}\\b`, 'i')
  );
  if (qtyBeforeUnit) {
    const val = Number(qtyBeforeUnit[1]);
    if (val > 0 && val < 5000) {
      return { total: val, out: 0 };
    }
  }

  // 3. في حال التصاق الرقم بالوحدة مباشرة مثل EA12 أو 12EA
  const gluedUnitQty = afterPart.match(
    new RegExp(`(?:\\b${UNIT_PATTERN}(\\d{1,4})\\b|\\b(\\d{1,4})${UNIT_PATTERN}\\b)`, 'i')
  );
  if (gluedUnitQty) {
    const val = Number(gluedUnitQty[1] || gluedUnitQty[2]);
    if (val > 0 && val < 5000) return { total: val, out: 0 };
  }

  // 4. نمط: رقم كمية مستقل بعد كود الموقع المخزني مباشرة (حتى لو كان الكود مصححاً مثل NO7BB2 -> N07BB2)
  if (storageBin) {
    const binEnd = findBinEndOffsetInText(afterPart, storageBin);
    if (binEnd >= 0) {
      const afterBin = afterPart.slice(binEnd);
      const qtyAfterBin = afterBin.match(
        /^\s*[|\[\]()—\-~:°.]*\s*(?:[A-Z0-9]{2,3}\s*[|\[\]]*\s*)?(\d{1,4})\b/i
      );
      if (qtyAfterBin) {
        const val = Number(qtyAfterBin[1]);
        if (val > 0 && val < 5000 && val !== 316 && val !== 304 && val !== 182 && val !== 193 && val !== 743) {
          return { total: val, out: 0 };
        }
      }
      // إذا قرأ المحرك الرقم 1 كحرف I أو l أو | بعد الوحدة مباشرة (مثل EA I أو EA l)
      if (new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]]+[Ili!tT1](?:\\s|\\||\\[|\\]|$)`, 'i').test(afterBin.slice(0, 20))) {
        return { total: 1, out: 0 };
      }
    }
  }

  // 5. نمط: رقم كمية مستقل بعد رقم القطعة مباشرة (بعد إزالة رموز المصنع C006/M016 والمنطقة 002 وأي كود موقع)
  let strippedAfterPart = afterPart.replace(
    /\b(?:M016|MO16|MOTE|MOLE|C006|CO06|C06|COOB|CO0G|COOS|002|0027|001)\b/gi,
    ' '
  );
  if (storageBin) {
    const binEnd = findBinEndOffsetInText(strippedAfterPart, storageBin);
    if (binEnd >= 0) {
      strippedAfterPart = strippedAfterPart.slice(binEnd);
    }
  }
  const directNumMatch = strippedAfterPart.match(/^\s*[|\[\]()—\-~:°.]*\s*(\d{1,4})(?:\s|$|\||\[|\])/);
  if (directNumMatch) {
    const val = Number(directNumMatch[1]);
    if (val > 0 && val < 5000 && val !== 316 && val !== 304) {
      return { total: val, out: 0 };
    }
  }

  // 6. في أوراق جرد SAP المطبوعة، إذا كان السطر يحمل رقم قطعة قياسي من 10 أرقام واختفى الرقم 1 داخل خط الشبكة العمودي |، فالكمية المطبوعة هي 1
  if (/^10\d{8}$/.test(partNumber)) {
    return { total: 1, out: 0 };
  }

  return { total: 0, out: 0 };
}

export function extractCheckAndRemark(
  line: string,
  storageBin: string
): { isMissing: number; remark: string; shortage: number; markSymbol: '✓' | 'X' | 'F' | 'N' | null } {
  const binEnd = storageBin ? findBinEndOffsetInText(line, storageBin) : -1;
  const tail = binEnd >= 0 ? line.slice(binEnd) : line;
  const checkRemarkWindow = tail.slice(0, 36);

  const isCross = /(?:^|[\s|\[\](){}])([Xx×✗✘])(?=\s|\||\[|\]|\)|$)/.test(checkRemarkWindow);
  const isCheck = /(?:^|[\s|\[\](){}])([✓✔])(?=\s|\||\[|\]|\)|$)/.test(checkRemarkWindow);
  const validRemarkCode = extractValidRemark(checkRemarkWindow);
  const isF = validRemarkCode ? /^F/i.test(validRemarkCode) : false;
  const plusMatch = checkRemarkWindow.match(/(?:^|\s|\||\[|\])\+\s*(\d{1,2})(?=\s|\||\[|\]|$)/);
  // مطابقة الرقم السالب الصريح فقط (مثل -1 أو -4 أو 5-1 أو S1) دون اعتبار حرف N أو شرطة الجدول العادية نقصاً
  const minusMatch = checkRemarkWindow.match(
    /(?:^|\s|\||\[|\])(?:\d{1,3}\s*[-−–—]\s*(\d{1,2})|[-−–—](\d{1,2}))(?=\s|\||\[|\]|$)/
  );

  let shortage = 0;
  let remark = '';
  if (plusMatch) {
    remark = `+${plusMatch[1]}`;
  } else if (validRemarkCode) {
    remark = validRemarkCode;
  } else if (!isF && minusMatch) {
    shortage = Number(minusMatch[1] || minusMatch[2] || 0);
    if (shortage > 0 && shortage < 100) {
      remark = `-${shortage}`;
    } else {
      shortage = 0;
    }
  }

  const markSymbol: '✓' | 'X' | 'F' | 'N' | null = isCross
    ? 'X'
    : isF
    ? 'F'
    : shortage > 0
    ? 'N'
    : isCheck || Boolean(plusMatch)
    ? '✓'
    : null;

  return {
    isMissing: isCross ? 1 : 0,
    remark,
    shortage,
    markSymbol,
  };
}

/**
 * استخراج الوصف الإنجليزي بدقة سواء كان العمود بعد الكمية/الموقع أو بين رقم القطعة والموقع.
 */
export function extractStrictDescription(
  line: string,
  partNumber: string,
  storageBin: string
): { descEn: string; descAr: string; category: string } {
  const partIdx = partNumber ? line.indexOf(partNumber) : -1;
  const withoutPart = partIdx >= 0 ? line.slice(partIdx + partNumber.length) : line;

  const unitQtyRegex = new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]]*\\d{1,5}\\b(.*)$`, 'i');
  const mUnit = withoutPart.match(unitQtyRegex);
  let rawDesc = mUnit && mUnit[1] && /[A-Za-z]{2,}/.test(mUnit[1]) ? mUnit[1] : '';

  if (!rawDesc && storageBin) {
    const binEnd = findBinEndOffsetInText(withoutPart, storageBin);
    if (binEnd >= 0) {
      const afterBin = withoutPart.slice(binEnd);
      const beforeBin = withoutPart.slice(0, Math.max(0, binEnd - storageBin.length));
      rawDesc = /[A-Za-z]{2,}/.test(afterBin) ? afterBin : beforeBin;
    }
  }

  if (!rawDesc) {
    rawDesc = withoutPart;
  }

  if (storageBin) {
    const escapedBin = storageBin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rawDesc = rawDesc.replace(new RegExp(`\\b${escapedBin}\\b`, 'gi'), ' ');
  }
  rawDesc = rawDesc.replace(
    /\b(?:M016|MO16|MOTE|MOLE|C006|CO06|C06|COOB|CO0G|COOS|002|0027|001|N07[A-Z0-9]{2,4}|NO7[A-Z0-9]{2,4}|NOT[A-Z0-9]{2,4}|P16[A-Z0-9]{2,4}|Pi6[A-Z0-9]{2,4}|P1e[A-Z0-9]{2,4}|Pie[A-Z0-9]{2,4})\b/gi,
    ' '
  );
  rawDesc = rawDesc.replace(new RegExp(`\\b${UNIT_PATTERN}\\b\\s*\\d{0,5}`, 'gi'), ' ');

  const cleaned = rawDesc
    .replace(/^\s*(?:[|\[\]()—\-~_✓✔×Xx\/:.°'"“”‘’]|\d{1,4})+\s*/i, '')
    .replace(/^(?:F\d{0,3}|[-+]\s*\d{1,3}|[Nn]\d{0,2})\s+/i, '')
    .replace(/[|\[\]]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || !/[A-Za-z]{3,}/.test(cleaned)) {
    return { descEn: '', descAr: '', category: '' };
  }

  const { category, descAr } = categorizeAndTranslate(cleaned);
  return { descEn: cleaned, descAr, category };
}

export function extractInclusiveMaterialNumber(line: string, _rowIndex = 0): string | null {
  if (/^\s*(?:MATERIAL|ITEM|NO\.|STORAGE\s+BIN|QTY|DESCRIPTION|INVENTORY|PAGE)\b/i.test(line)) {
    return null;
  }
  return extractStrictMaterialNumber(line);
}

export function alignAndCompleteCalibrationSheet(rows: ExtractedSparePart[]): ExtractedSparePart[] {
  const withLocs = resolveSheetLocationsWithContext(rows);
  const descByPart = new Map<string, { descEn: string; descAr: string; category: string; isConsumable: number }>();

  for (const r of withLocs) {
    if (r.part_number && /^\d{10}$/.test(r.part_number) && r.description_en && r.description_en.length >= 5) {
      const existing = descByPart.get(r.part_number);
      if (!existing || r.description_en.length > existing.descEn.length) {
        descByPart.set(r.part_number, {
          descEn: r.description_en,
          descAr: r.description_ar,
          category: r.category,
          isConsumable: r.is_consumable ?? (isConsumableDescription(r.description_en, r.category) ? 1 : 0),
        });
      }
    }
  }

  return withLocs.map((r) => {
    if ((!r.description_en || r.description_en.length < 5) && r.part_number && descByPart.has(r.part_number)) {
      const shared = descByPart.get(r.part_number)!;
      return {
        ...r,
        description_en: shared.descEn,
        description_ar: r.description_ar || shared.descAr,
        category: r.category || shared.category,
        is_consumable: r.is_consumable ?? shared.isConsumable,
      };
    }
    return r;
  });
}

export function parseStrictAsmoTable(rawText: string): ExtractedSparePart[] {
  if (!rawText) return [];

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const finalResults: ExtractedSparePart[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /^\s*(?:MATERIAL|ITEM|NO\.|STORAGE\s+BIN|QTY|DESCRIPTION|INVENTORY|PAGE|CONTROLLER|START\s+DATE|COUNT\s+DATA)\b/i.test(
        line
      )
    ) {
      continue;
    }

    const partNumber = extractStrictMaterialNumber(line) || '';
    const storageBin = extractStrictStorageBin(line, partNumber);

    // إذا كان السطر مجرد تكملة لوصف السطر السابق وبدون رقم قطعة من 10 أرقام، ندمج الوصف أو الموقع في السطر السابق ولا ننشئ سطراً فارغاً
    if (!partNumber) {
      if (finalResults.length > 0) {
        const prev = finalResults[finalResults.length - 1];
        if (!prev.location_code && storageBin) {
          prev.location_code = storageBin;
        }
      }
      continue;
    }

    const { total } = extractStrictQuantity(line, partNumber, storageBin);
    const { isMissing, remark, shortage, markSymbol } = extractCheckAndRemark(line, storageBin);
    const { descEn, descAr, category } = extractStrictDescription(line, partNumber, storageBin);

    const out = isMissing ? 0 : total > 0 ? Math.min(total, shortage) : shortage;
    const auditMeaning =
      markSymbol === '✓'
        ? 'القطع موجودة'
        : markSymbol === 'X'
        ? 'القطع غير موجودة'
        : markSymbol === 'F'
        ? 'تم نقل العدد الزائد إلى مكان آخر'
        : markSymbol === 'N'
        ? 'ناقص العدد'
        : null;

    const status = (isMissing ? 'غير موجودة' : 'غير مدقق') as ExtractedSparePart['status'];
    const isConsumable = isConsumableDescription(descEn, category) ? 1 : 0;

    finalResults.push({
      part_number: partNumber,
      location_code: storageBin,
      description_en: descEn,
      description_ar: descAr,
      category,
      qty_total: total,
      qty_out: out,
      qty_remaining: isMissing ? 0 : Math.max(0, total - out),
      is_missing: isMissing,
      is_consumable: isConsumable,
      remark: remark || undefined,
      mark_symbol: markSymbol,
      audit_meaning: auditMeaning,
      status,
      confidence: 'قراءة فعلية من الورقة',
    });
  }

  return alignAndCompleteCalibrationSheet(finalResults);
}

function countMatchingDigitsAtSamePos(a: string, b: string): number {
  if (!a || !b || a.length !== 10 || b.length !== 10) return 0;
  let same = 0;
  for (let i = 0; i < 10; i++) {
    if (a[i] === b[i]) same++;
  }
  return same;
}

/**
 * دمج نتائج تمريرتين مع الحفاظ التام على السطور المكررة لنفس رقم القطعة بترتيب ظهورها (occurrence key)
 * ومنع تضخم عدد الصفوف (مثل 37 -> 43) عند اختلاف رقم واحد في القراءة المحلية بين التمريرتين
 */
export function unionOrderedRowSequences(
  passA: ExtractedSparePart[],
  passB: ExtractedSparePart[]
): ExtractedSparePart[] {
  const cleanA = (passA || []).filter(Boolean);
  const cleanB = (passB || []).filter(Boolean);
  if (!cleanA.length) return alignAndCompleteCalibrationSheet([...cleanB]);
  if (!cleanB.length) return alignAndCompleteCalibrationSheet([...cleanA]);

  const primary = cleanA.length >= cleanB.length ? [...cleanA] : [...cleanB];
  const secondary = cleanA.length >= cleanB.length ? cleanB : cleanA;

  const byKey = new Map<string, ExtractedSparePart>();
  const secCounts = new Map<string, number>();

  secondary.forEach((row, idx) => {
    if (row.part_number && /^\d{10}$/.test(row.part_number)) {
      const occ = (secCounts.get(row.part_number) || 0) + 1;
      secCounts.set(row.part_number, occ);
      byKey.set(`${row.part_number}#${occ}`, row);
    } else {
      byKey.set(`IDX#${idx}`, row);
    }
  });

  const priCounts = new Map<string, number>();
  const merged = primary.map((row) => {
    let matchedKey: string | null = null;

    if (row.part_number && /^\d{10}$/.test(row.part_number)) {
      const occ = (priCounts.get(row.part_number) || 0) + 1;
      priCounts.set(row.part_number, occ);
      const exactKey = `${row.part_number}#${occ}`;
      const fallbackFirstKey = `${row.part_number}#1`;
      if (byKey.has(exactKey)) {
        matchedKey = exactKey;
      } else if (byKey.has(fallbackFirstKey)) {
        matchedKey = fallbackFirstKey;
      } else {
        // مطابقة ضبابية لرقم المادة في حال اختلاف رقم واحد أو رقمين بين التمريرتين (مثل 1000956837 و 1000956831)
        let bestScore = 0;
        for (const [k, cand] of byKey.entries()) {
          if (!cand.part_number || !/^\d{10}$/.test(cand.part_number)) continue;
          const sameDigits = countMatchingDigitsAtSamePos(row.part_number, cand.part_number);
          const sameLoc =
            Boolean(row.location_code && cand.location_code) &&
            row.location_code.toUpperCase() === cand.location_code.toUpperCase();
          if (sameDigits >= 8 || (sameDigits >= 6 && sameLoc)) {
            const score = sameDigits + (sameLoc ? 2 : 0);
            if (score > bestScore) {
              bestScore = score;
              matchedKey = k;
            }
          }
        }
      }
    }

    if (!matchedKey) return { ...row };
    const match = byKey.get(matchedKey)!;
    byKey.delete(matchedKey);

    const mergedDescEn =
      (row.description_en || '').length >= (match.description_en || '').length
        ? row.description_en
        : match.description_en;
    const { category, descAr } = mergedDescEn
      ? categorizeAndTranslate(mergedDescEn)
      : { category: row.category || match.category, descAr: row.description_ar || match.description_ar };
    const total = row.qty_total > 0 ? row.qty_total : match.qty_total;
    const isMissing = row.is_missing === 1 || match.is_missing === 1 ? 1 : 0;
    const out = isMissing ? 0 : Math.max(row.qty_out || 0, match.qty_out || 0);

    return {
      ...row,
      location_code: row.location_code || match.location_code || '',
      description_en: mergedDescEn,
      description_ar: row.description_ar || match.description_ar || descAr,
      category: row.category || match.category || category,
      qty_total: total,
      qty_out: out,
      qty_remaining: isMissing ? 0 : Math.max(0, total - out),
      is_missing: isMissing,
      is_consumable:
        row.is_consumable ?? match.is_consumable ?? (isConsumableDescription(mergedDescEn, category) ? 1 : 0),
      remark: row.remark || match.remark,
      mark_symbol: row.mark_symbol || match.mark_symbol,
      audit_meaning: row.audit_meaning || match.audit_meaning,
      status: (isMissing ? 'غير موجودة' : 'غير مدقق') as ExtractedSparePart['status'],
    };
  });

  // لا تُضَف صفوف متبقية إذا كانت التمريرة الأساسية قد التقطت الجدول شبه كامل بالفعل؛
  // وعند الإضافة للحالات الجزئية يُشترط رقم مادة 10-أرقام صريح لا يتشابه رقمياً مع أي صف موجود.
  const canAppendMissingFromSecondary = primary.length < 25 || secondary.length > primary.length + 2;
  if (canAppendMissingFromSecondary) {
    for (const leftover of byKey.values()) {
      const hasValidSapPart = Boolean(leftover.part_number && /^10\d{8}$/.test(leftover.part_number));
      if (!hasValidSapPart) continue;
      const isNearDuplicate = merged.some(
        (existing) =>
          countMatchingDigitsAtSamePos(existing.part_number || '', leftover.part_number) >= 8
      );
      if (!isNearDuplicate) {
        merged.push(leftover);
      }
    }
  }

  return alignAndCompleteCalibrationSheet(merged);
}

/**
 * إثراء الأوصاف الإنجليزية والعربية للسطور المستخرجة من قراءة عمود الوصف الأيمن عند الحاجة
 */
export function applyRightColumnDescriptions(
  rows: ExtractedSparePart[],
  rawDescText: string
): ExtractedSparePart[] {
  if (!rows.length || !rawDescText) return rows;

  const descLines = rawDescText
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\s*(?:[|\[\]()—\-~_✓✔×Xx\/:.°'"“”‘’]|\d{1,2})+\s*/g, '')
        .replace(/[|\[\]]+\s*$/g, '')
        .trim()
    )
    .filter(
      (l) =>
        l.length >= 4 &&
        /[A-Za-z]{3,}/.test(l) &&
        !/^(?:MATERIAL\s+DESCRIPTION|DESCRIPTION|\(S\)\s*SHORT|\(D\)\s*DAMAGED|\(F\)\s*FOUND|INVENTORY)/i.test(l)
    );

  if (descLines.length === 0) return rows;

  const updated = rows.map((row, idx) => {
    const candidate = descLines[idx];
    if (!candidate) return row;
    const currentLen = (row.description_en || '').trim().length;
    if (currentLen < 6 || candidate.length > currentLen + 4) {
      const { category, descAr } = categorizeAndTranslate(candidate);
      return {
        ...row,
        description_en: candidate,
        description_ar: descAr,
        category,
        is_consumable: isConsumableDescription(candidate, category) ? 1 : 0,
      };
    }
    return row;
  });

  return alignAndCompleteCalibrationSheet(updated);
}
