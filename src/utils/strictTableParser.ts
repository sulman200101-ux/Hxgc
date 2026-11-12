/**
 * محلل جدول أسمو الصارم (Strict Zero-Guessing SAP Table Parser)
 * يقرأ فقط ما هو مرئي بوضوح تام في السطر دون أي بيانات مخزنة أو استنتاج من السطور الأخرى.
 * أي حقل لم يتمكن من قراءته يُترك فارغاً تماماً ("").
 */

import { ExtractedSparePart } from '../services/localOcr';
import { categorizeAndTranslate } from './translator';
import {
  sanitizeLocationCode,
  isValidSpecificLocation,
  strict10DigitRegexFilter,
} from './regexSanitizer';

export function isRandomNoiseOrGibberish(text: string): boolean {
  if (!text || text.length < 2) return true;
  return false;
}

/**
 * استخراج رقم القطعة الصارم: 10 أرقام قياسية في جداول SAP مع معالجة المسافات والحروف المتشابهة بصرياً.
 */
export function extractStrictMaterialNumber(line: string): string | null {
  if (!line) return null;
  const exactMatch = line.match(/\b(\d{10})\b/);
  if (exactMatch) return exactMatch[1];

  const tokens = line.split(/[\s|;,\[\]{}()]+/);
  for (const tok of tokens) {
    const cleaned = strict10DigitRegexFilter(tok);
    if (cleaned) return cleaned;
  }

  return null;
}

/**
 * استخراج رمز الموقع المرئي في نفس السطر مع تطبيع أكواد أسمو (مثل N11A1, N07BB1, D1, FL1).
 */
export function extractStrictStorageBin(line: string, partNumber: string): string {
  if (!line) return '';
  const withoutPart = partNumber ? line.replace(partNumber, ' ') : line;
  const sapBinMatch = withoutPart.match(/\b(N\d{2}(?:FL|BB|[A-Z]{1,2})\d{1,2})\b/i);
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
  '(?:EA|SET|PK|SH|CO|AY|KG|PAA|ZYD|KIT|PCS|ROL|BOX|PC)';

/**
 * استخراج الكمية المرئية سواء جاءت بعد رمز الوحدة (EA 5) أو قبله (5 EA) أو بجوار رمز الموقع المخزني.
 */
export function extractStrictQuantity(
  line: string,
  partNumber: string,
  storageBin: string
): { total: number; out: number } {
  const partIdx = partNumber ? line.indexOf(partNumber) : -1;
  const afterPart = partIdx >= 0 ? line.slice(partIdx + partNumber.length) : line;

  // 1. نمط: EA 5
  const unitBeforeQty = afterPart.match(
    new RegExp(`\\b${UNIT_PATTERN}[\\s|\\[\\]()—\\-~:°.]+(\\d{1,5})\\b`, 'i')
  );
  if (unitBeforeQty) {
    const val = Number(unitBeforeQty[1]);
    return { total: val >= 0 ? val : 0, out: 0 };
  }

  // 2. نمط: 5 EA
  const qtyBeforeUnit = afterPart.match(
    new RegExp(`\\b(\\d{1,5})[\\s|\\[\\]()—\\-~:°.]+${UNIT_PATTERN}\\b`, 'i')
  );
  if (qtyBeforeUnit) {
    const val = Number(qtyBeforeUnit[1]);
    return { total: val >= 0 ? val : 0, out: 0 };
  }

  // 3. نمط: رقم كمية مستقل بعد كود الموقع المخزني مباشرة
  if (storageBin) {
    const binIdx = afterPart.indexOf(storageBin);
    if (binIdx >= 0) {
      const afterBin = afterPart.slice(binIdx + storageBin.length);
      const qtyAfterBin = afterBin.match(/^\s*[|\[\]()—\-~:°.]*\s*(\d{1,4})\b/);
      if (qtyAfterBin) {
        const val = Number(qtyAfterBin[1]);
        return { total: val >= 0 ? val : 0, out: 0 };
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
  const checkRemarkWindow = tail.slice(0, 45);

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
 * استخراج الوصف الإنجليزي بدقة سواء كان العمود بعد الكمية/الموقع أو بين رقم القطعة والموقع.
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
  let rawDesc = mUnit && mUnit[1] && /[A-Za-z]{3,}/.test(mUnit[1]) ? mUnit[1] : '';

  if (!rawDesc && storageBin) {
    const binIdx = withoutPart.indexOf(storageBin);
    if (binIdx >= 0) {
      const afterBin = withoutPart.slice(binIdx + storageBin.length);
      const beforeBin = withoutPart.slice(0, binIdx);
      rawDesc = /[A-Za-z]{3,}/.test(afterBin) ? afterBin : beforeBin;
    }
  }

  if (!rawDesc) {
    rawDesc = withoutPart;
  }

  if (storageBin) {
    rawDesc = rawDesc.replace(new RegExp(`\\b${storageBin}\\b`, 'gi'), ' ');
  }
  rawDesc = rawDesc.replace(new RegExp(`\\b${UNIT_PATTERN}\\b\\s*\\d{0,5}`, 'gi'), ' ');

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
      remark: remark || undefined,
      mark_symbol: markSymbol,
      audit_meaning: auditMeaning,
      status,
      confidence: 'قراءة فعلية من الورقة',
    });
  }

  return finalResults;
}

export function unionOrderedRowSequences(
  passA: ExtractedSparePart[],
  passB: ExtractedSparePart[]
): ExtractedSparePart[] {
  const cleanA = (passA || []).filter(Boolean);
  const cleanB = (passB || []).filter(Boolean);
  if (!cleanA.length) return [...cleanB];
  if (!cleanB.length) return [...cleanA];

  const primary = cleanA.length >= cleanB.length ? [...cleanA] : [...cleanB];
  const secondary = cleanA.length >= cleanB.length ? cleanB : cleanA;

  const byPart = new Map<string, ExtractedSparePart>();
  for (const row of secondary) {
    if (row.part_number) {
      byPart.set(row.part_number, row);
    }
  }

  const merged = primary.map((row) => {
    const match = row.part_number ? byPart.get(row.part_number) : undefined;
    if (!match) return row;
    byPart.delete(row.part_number);
    return {
      ...row,
      location_code: row.location_code || match.location_code,
      description_en:
        row.description_en.length >= match.description_en.length
          ? row.description_en
          : match.description_en,
      description_ar: row.description_ar || match.description_ar,
      category: row.category || match.category,
      qty_total: row.qty_total > 0 ? row.qty_total : match.qty_total,
      qty_remaining: row.qty_remaining > 0 ? row.qty_remaining : match.qty_remaining,
      remark: row.remark || match.remark,
      mark_symbol: row.mark_symbol || match.mark_symbol,
      audit_meaning: row.audit_meaning || match.audit_meaning,
    };
  });

  for (const leftover of byPart.values()) {
    merged.push(leftover);
  }

  return merged;
}
