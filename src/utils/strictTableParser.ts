/**
 * محلل جدول أسمو الصارم (Strict Zero-Guessing SAP Table Parser)
 * يقرأ فقط ما هو مرئي بوضوح تام في السطر دون أي بيانات مخزنة أو استنتاج من السطور الأخرى.
 * أي حقل لم يتمكن من قراءته يُترك فارغاً تماماً ("").
 * لا يتم تسجيل أي قطعة كـ "مدقق" أو "منقول" تلقائياً؛ التدقيق والنقل يتمان حصراً من قِبل المستخدم.
 */

import { ExtractedSparePart } from '../services/localOcr';
import { categorizeAndTranslate, isConsumableDescription } from './translator';
import {
  sanitizeLocationCode,
  isValidSpecificLocation,
} from './regexSanitizer';

export function isRandomNoiseOrGibberish(text: string): boolean {
  if (!text || text.length < 2) return true;
  return false;
}

/**
 * استخراج رقم القطعة الصارم: 10 أرقام دقيقة فقط، وإذا كان غير مقروء يُرجع null ليُترك فارغاً.
 */
export function extractStrictMaterialNumber(line: string): string | null {
  if (!line) return null;
  const exactMatch = line.match(/\b(\d{10})\b/);
  return exactMatch ? exactMatch[1] : null;
}

/**
 * استخراج رمز الموقع المرئي فقط في نفس السطر، وإذا لم يُقرأ يُرجع "" (فارغ).
 */
export function extractStrictStorageBin(line: string, partNumber: string): string {
  if (!line) return '';
  const withoutPart = partNumber ? line.replace(partNumber, ' ') : line;
  const sapBinMatch = withoutPart.match(/\b(N\d{2}(?:FL|BB|[A-D])\d{1,2})\b/i);
  if (sapBinMatch) {
    return sapBinMatch[1].toUpperCase();
  }

  const tokens = withoutPart.split(/[\s|;,\[\]{}()]+/);
  for (const tok of tokens) {
    const clean = sanitizeLocationCode(tok);
    if (clean && isValidSpecificLocation(clean)) {
      return clean;
    }
  }
  return '';
}

const UNIT_PATTERN =
  '(?:EA|SET|PK|SH|CO|AY|KG|PAA|ZYD|KIT|PCS|ROL|BOX)';

/**
 * استخراج الكمية المرئية بوضوح فقط، وإذا لم يتمكن من قراءتها يُرجع 0 (حقل فارغ) بدلاً من افتراض 1.
 */
export function extractStrictQuantity(
  line: string,
  partNumber: string,
  storageBin: string
): { total: number; out: number } {
  const partIdx = partNumber ? line.indexOf(partNumber) : -1;
  const afterPart = partIdx >= 0 ? line.slice(partIdx + partNumber.length) : line;

  // 1. النمط القياسي بوجود رمز الوحدة (EA, PK, PAA, ZYD, SET...)
  const unitQtyMatch = afterPart.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:°.]+(\\d{1,5})\\b`, 'i')
  );
  if (unitQtyMatch) {
    const val = Number(unitQtyMatch[1]);
    return { total: val > 0 ? val : 0, out: 0 };
  }

  // 2. النمط المباشر بعد رمز الموقع (Storage Bin) عندما لا يظهر رمز الوحدة في السطر
  if (storageBin) {
    const binIdx = afterPart.toUpperCase().indexOf(storageBin.toUpperCase());
    if (binIdx >= 0) {
      const afterBin = afterPart.slice(binIdx + storageBin.length);
      const directQtyMatch = afterBin.match(/^\s*(?:[|\[\]()—\-~:°.]+\s*)*(\d{1,5})(?=\s|\||$)/);
      if (directQtyMatch) {
        const val = Number(directQtyMatch[1]);
        if (val > 0 && val !== 2 && val !== 16) {
          return { total: val, out: 0 };
        } else if (val > 0) {
          return { total: val, out: 0 };
        }
      }
    }
  }

  return { total: 0, out: 0 };
}

export function extractCheckAndRemark(
  line: string,
  storageBin: string
): { isMissing: number; remark: string; shortage: number; markSymbol: '✓' | 'X' | 'F' | 'N' | null } {
  const binIdx = storageBin ? line.indexOf(storageBin) : -1;
  const tail = binIdx >= 0 ? line.slice(binIdx + storageBin.length) : line;
  const checkRemarkWindow = tail.slice(0, 35);

  const isCross = /(?:^|[\s|\[\](){}])([Xx×✗✘])(?=\s|\||\[|\]|\)|$)/.test(checkRemarkWindow);
  const isCheck = /(?:^|[\s|\[\](){}])([✓✔])(?=\s|\||\[|\]|\)|$)/.test(checkRemarkWindow);
  const isF = /(?:^|[\s|\[\](){}])([Ff]\d*)(?=\s|\||\[|\]|\)|$)/.test(checkRemarkWindow);
  const minusMatch = checkRemarkWindow.match(
    /(?:^|\s|\||\[|\])(?:\d{1,3}\s*[-−–—]\s*(\d{1,2})|[-−–—]\s*(\d{1,2})|[Nn]\s*(\d{0,2}))(?=\s|\||\[|\]|$)/
  );

  let shortage = 0;
  let remark = '';
  if (!isF && minusMatch) {
    shortage = Number(minusMatch[1] || minusMatch[2] || minusMatch[3] || 1);
    if (shortage > 0 && shortage < 100) {
      remark = `-${shortage}`;
    }
  } else if (isF) {
    remark = 'F';
  }

  const markSymbol: '✓' | 'X' | 'F' | 'N' | null = isCross
    ? 'X'
    : isF
    ? 'F'
    : shortage > 0
    ? 'N'
    : isCheck
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
 * استخراج الوصف المرئي فقط، وإذا لم يُقرأ يُترك فارغاً ("") تماماً بدون أي نص افتراضي.
 */
export function extractStrictDescription(
  line: string,
  partNumber: string,
  storageBin: string
): { descEn: string; descAr: string; category: string } {
  const partIdx = partNumber ? line.indexOf(partNumber) : -1;
  const withoutPart = partIdx >= 0 ? line.slice(partIdx + partNumber.length) : line;

  const unitQtyRegex = new RegExp(`\\b${UNIT_PATTERN}\\s+\\d{1,5}\\b(.*)$`, 'i');
  const mUnit = withoutPart.match(unitQtyRegex);
  let rawDesc = mUnit && mUnit[1] ? mUnit[1] : '';

  if (!rawDesc && storageBin) {
    const binIdx = withoutPart.toUpperCase().indexOf(storageBin.toUpperCase());
    if (binIdx >= 0) {
      rawDesc = withoutPart
        .slice(binIdx + storageBin.length)
        .replace(/^\s*\d{1,5}\b\s*/, '');
    }
  }

  const cleaned = rawDesc
    .replace(/^\s*(?:[|\[\]()—\-~_✓✔×Xx\/:.°'"])+\s*/i, '')
    .replace(/^(?:F\d{0,3}|-\s*\d{1,3}|[Nn]\d{0,2})\s+/i, '')
    .replace(/[|\[\]]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || !/[A-Za-z]{2,}/.test(cleaned)) {
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

/**
 * عدم حقن أو استكمال أي سطور من بيانات مخزنة — تُرجع السطور كما قُرئت من الورقة فقط.
 */
export function alignAndCompleteCalibrationSheet(rows: ExtractedSparePart[]): ExtractedSparePart[] {
  return rows;
}

export function parseStrictAsmoTable(rawText: string): ExtractedSparePart[] {
  if (!rawText) return [];

  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const finalResults: ExtractedSparePart[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:MATERIAL|ITEM|NO\.|STORAGE\s+BIN|QTY|DESCRIPTION|INVENTORY|PAGE|CONTROLLER)\b/i.test(line)) {
      continue;
    }

    const partNumber = extractStrictMaterialNumber(line) || '';
    const storageBin = extractStrictStorageBin(line, partNumber);
    const { total } = extractStrictQuantity(line, partNumber, storageBin);
    const { isMissing, remark, shortage, markSymbol } = extractCheckAndRemark(line, storageBin);
    const { descEn, descAr, category } = extractStrictDescription(line, partNumber, storageBin);

    if (!partNumber && !storageBin && !descEn) {
      continue;
    }

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

    // لا يتم تسجيل أي قطعة كـ "مدقق" أو "تم النقل" تلقائياً؛ التدقيق والنقل يتمان حصراً من قِبل المستخدم
    const status = isMissing ? 'غير موجودة' : 'غير مدقق';
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

  return finalResults;
}

/**
 * دمج نتائج تمريرتي قراءة ضوئية بحيث تُستكمل الحقول الناقصة للسطر نفسه دون أي تخمين
 */
export function unionOrderedRowSequences(
  passA: ExtractedSparePart[],
  passB: ExtractedSparePart[]
): ExtractedSparePart[] {
  const cleanA = (passA || []).filter(Boolean);
  const cleanB = (passB || []).filter(Boolean);
  if (!cleanA.length) return [...cleanB];
  if (!cleanB.length) return [...cleanA];

  const primary = cleanA.length >= cleanB.length ? cleanA : cleanB;
  const secondary = cleanA.length >= cleanB.length ? cleanB : cleanA;

  const secByPart = new Map<string, ExtractedSparePart>();
  for (const row of secondary) {
    if (row.part_number && /^\d{10}$/.test(row.part_number) && !secByPart.has(row.part_number)) {
      secByPart.set(row.part_number, row);
    }
  }

  return primary.map((row) => {
    if (!row.part_number) return { ...row };
    const comp = secByPart.get(row.part_number);
    if (!comp) return { ...row };
    const mergedDescEn =
      row.description_en && row.description_en.length >= (comp.description_en?.length || 0)
        ? row.description_en
        : comp.description_en || row.description_en;
    const { category, descAr } = mergedDescEn
      ? categorizeAndTranslate(mergedDescEn)
      : { category: row.category || comp.category, descAr: row.description_ar || comp.description_ar };
    const total = row.qty_total > 0 ? row.qty_total : comp.qty_total;
    const isMissing = row.is_missing === 1 || comp.is_missing === 1 ? 1 : 0;
    const out = isMissing ? 0 : Math.max(row.qty_out || 0, comp.qty_out || 0);
    return {
      ...row,
      location_code: row.location_code || comp.location_code || '',
      description_en: mergedDescEn,
      description_ar: row.description_ar || descAr,
      category: row.category || category,
      qty_total: total,
      qty_out: out,
      qty_remaining: isMissing ? 0 : Math.max(0, total - out),
      is_missing: isMissing,
      status: isMissing ? 'غير موجودة' : 'غير مدقق',
    };
  });
}
