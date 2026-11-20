import type { InventoryItem } from '../types';
import { interpretMark } from '../services/documents';
import { repair10DigitMaterialCode, sanitizeLocationCode } from './regexSanitizer';
import { categorizeAndTranslate } from './translator';
import { isConsumablePart } from '../services/transferSuggestions';

export interface ParsedSapBatchStats {
  sheetsDetected: number;
  skippedSheets: string[];
  rawRowsParsed: number;
  uniquePartsMerged: number;
  duplicateMerges: number;
  missingCount: number;
  shortageCount: number;
  foundCount: number;
}

interface ParsedCandidateRow {
  part_number: string;
  location_code: string;
  description_en: string;
  qty_total: number;
  check: string;
  remark: string;
  new_bin: string;
  sheetLabel: string;
}

function cleanZeroWidth(line: string): string {
  return line
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    .trim();
}

function splitPipeOrTabColumns(line: string): string[] {
  if (line.includes('|')) {
    return line.split('|').map((c) => c.trim());
  }
  if (line.includes('\t')) {
    return line.split('\t').map((c) => c.trim());
  }
  return [];
}

function extractLabeledValue(cell: string, labelPattern: RegExp): string | null {
  const m = cell.match(labelPattern);
  return m ? cell.slice(m[0].length).trim() : null;
}

function extractMaterialFromCell(cell: string, allowExplicitFallback: boolean): string {
  const cleanedDigits = cell.replace(/[^\d]/g, '');
  if (allowExplicitFallback && /^\d{8,12}$/.test(cell.trim())) {
    return /^\d{10}$/.test(cleanedDigits)
      ? repair10DigitMaterialCode(cleanedDigits) || cleanedDigits
      : cleanedDigits;
  }
  const repaired = repair10DigitMaterialCode(cell);
  if (repaired && /^\d{10}$/.test(repaired)) {
    return repaired;
  }
  if (allowExplicitFallback && /^\d{8,12}$/.test(cleanedDigits)) {
    return cleanedDigits;
  }
  return '';
}

function parseKeyValueSapLine(cols: string[], sheetLabel: string): ParsedCandidateRow | null {
  let partNum = '';
  let locationCode = '';
  let qtyTotal = 0;
  let check = '';
  let remark = '';
  let newBin = '';
  let descEn = '';

  for (const rawCell of cols) {
    const cell = rawCell.trim();
    if (!cell) continue;

    const matVal = extractLabeledValue(cell, /^Material\s*:\s*/i);
    if (matVal !== null) {
      partNum = extractMaterialFromCell(matVal, true);
      continue;
    }

    const binVal = extractLabeledValue(cell, /^Storage\s*Bin\s*:\s*/i);
    if (binVal !== null) {
      locationCode = sanitizeLocationCode(binVal) || binVal.trim().toUpperCase();
      continue;
    }

    const newBinVal = extractLabeledValue(cell, /^New\s*BIN(?:\s*Location)?\s*:\s*/i);
    if (newBinVal !== null) {
      const sanitizedNew = sanitizeLocationCode(newBinVal);
      if (sanitizedNew) {
        newBin = sanitizedNew;
      } else if (newBinVal) {
        remark = remark ? `${remark} | ${newBinVal}` : newBinVal;
      }
      continue;
    }

    const qtyVal = extractLabeledValue(cell, /^QTY\s*:\s*/i);
    if (qtyVal !== null) {
      const digits = qtyVal.replace(/[^\d]/g, '');
      qtyTotal = digits ? parseInt(digits, 10) : 0;
      continue;
    }

    const checkVal = extractLabeledValue(cell, /^Check\s*:\s*/i);
    if (checkVal !== null) {
      check = checkVal;
      continue;
    }

    const remarkVal = extractLabeledValue(cell, /^Remark\s*:\s*/i);
    if (remarkVal !== null) {
      if (remarkVal) {
        remark = remark ? `${remarkVal} | ${remark}` : remarkVal;
      }
      continue;
    }

    const descVal = extractLabeledValue(cell, /^(?:Material\s+)?Description\s*:\s*/i);
    if (descVal !== null) {
      descEn = descVal;
      continue;
    }
  }

  if (!partNum || !locationCode) return null;

  return {
    part_number: partNum,
    location_code: locationCode,
    description_en: descEn,
    qty_total: Number.isFinite(qtyTotal) && qtyTotal >= 0 ? qtyTotal : 0,
    check,
    remark,
    new_bin: newBin,
    sheetLabel,
  };
}

function parsePipeOrTabLine(line: string, sheetLabel: string): ParsedCandidateRow | null {
  const cols = splitPipeOrTabColumns(line);
  if (cols.length < 6) return null;

  // إزالة عمود فارغ في البداية أو النهاية إن وجد (مثل "| Material | ...")
  const trimmedCols = [...cols];
  if (trimmedCols.length > 0 && trimmedCols[0] === '') trimmedCols.shift();

  // دعم الأسطر المهيكلة بمسميات الأعمدة الصريحة (مثل: * 7458 | Material: 1000979854 | ... | Storage Bin: N12FL2 | ... | QTY: 2 | ...)
  const hasExplicitFieldLabels = trimmedCols.some((c) => /^(?:Material|Storage\s*Bin|QTY)\s*:/i.test(c.trim()));
  if (hasExplicitFieldLabels) {
    return parseKeyValueSapLine(trimmedCols, sheetLabel);
  }

  // تخطي سطر الترويسة
  const joinedHeader = trimmedCols.join(' ').toUpperCase();
  if (
    joinedHeader.includes('MATERIAL DESCRIPTION') ||
    (joinedHeader.includes('MATERIAL') && joinedHeader.includes('STORAGE BIN'))
  ) {
    return null;
  }

  // استخراج رقم المادة المكون من 10 أرقام (عادة في العمود 1 بعد رقم السطر، أو العمود 0)
  let partIdx = -1;
  let partNum = '';
  for (let i = 0; i <= Math.min(2, trimmedCols.length - 1); i++) {
    const repaired = repair10DigitMaterialCode(trimmedCols[i]);
    if (repaired && /^\d{10}$/.test(repaired)) {
      partIdx = i;
      partNum = repaired;
      break;
    }
  }
  if (!partNum || partIdx === -1) return null;

  // هيكل الجدول القياسي بعد partIdx:
  // partIdx+1: Plant (C006/M016/D04D)
  // partIdx+2: Area (002)
  // partIdx+3: Storage Bin (N01A1 / N10A ...)
  // partIdx+4: Bun (EA / KIT / SET / PAA / PK / AY)
  // partIdx+5: QTY
  // partIdx+6: Check (✓ / ✓✓ / X)
  // partIdx+7: Remark (+1 / -4 / F1 / X)
  // partIdx+8: New BIN Location
  // partIdx+9..: Material Description

  let locationCode = '';
  let qtyTotal = 0;
  let check = '';
  let remark = '';
  let newBin = '';
  let descEn = '';

  if (trimmedCols.length >= partIdx + 7) {
    const rawBin = trimmedCols[partIdx + 3] || '';
    locationCode = sanitizeLocationCode(rawBin) || rawBin.trim().toUpperCase();

    const rawQty = (trimmedCols[partIdx + 5] || '').replace(/[^\d]/g, '');
    qtyTotal = rawQty ? parseInt(rawQty, 10) : 0;

    check = (trimmedCols[partIdx + 6] || '').trim();
    remark = (trimmedCols[partIdx + 7] || '').trim();
    const rawNewBin = (trimmedCols[partIdx + 8] || '').trim();
    newBin = sanitizeLocationCode(rawNewBin);
    if (rawNewBin && !newBin) {
      remark = remark ? `${remark} | ${rawNewBin}` : rawNewBin;
    }

    descEn = trimmedCols
      .slice(partIdx + 9)
      .join(' | ')
      .trim();
  } else {
    // مسار مرن للأسطر ذات الأعمدة الأقل
    for (let i = partIdx + 1; i < trimmedCols.length; i++) {
      const cell = trimmedCols[i];
      if (!locationCode) {
        const loc = sanitizeLocationCode(cell);
        if (loc) {
          locationCode = loc;
          continue;
        }
      }
      if (qtyTotal === 0 && /^\d{1,5}$/.test(cell) && cell !== '002') {
        qtyTotal = parseInt(cell, 10);
        continue;
      }
      if (!check && /^[✓✔X×✗]+$/.test(cell)) {
        check = cell;
        continue;
      }
      if (i === trimmedCols.length - 1 && cell.length >= 2) {
        descEn = cell;
      }
    }
  }

  if (!locationCode) return null;

  return {
    part_number: partNum,
    location_code: locationCode,
    description_en: descEn,
    qty_total: Number.isFinite(qtyTotal) && qtyTotal >= 0 ? qtyTotal : 0,
    check,
    remark,
    new_bin: newBin,
    sheetLabel,
  };
}

function buildInventoryItemFromCandidate(
  row: ParsedCandidateRow,
  nowIso: string
): { item: InventoryItem; shortage: number; isMissing: boolean; isFoundTransfer: boolean } {
  const effectiveLoc = row.new_bin || row.location_code;
  const checkClean = row.check.replace(/✓+/g, '✓');
  const marks = interpretMark(checkClean, row.remark);
  const isMissing = marks.status === 'غير موجودة';
  const isFoundTransfer = marks.mark_symbol === 'F';
  const shortage = isMissing ? 0 : Math.min(row.qty_total, marks.shortage);
  const remaining = isMissing ? 0 : Math.max(0, row.qty_total - shortage);

  const { category, descAr } = row.description_en
    ? categorizeAndTranslate(row.description_en)
    : { category: 'قطع ميكانيكية متنوعة', descAr: '' };

  const cleanRemark = row.remark
    ? row.remark
    : shortage > 0
    ? `-${shortage}`
    : '';

  const isMovedFlag = row.new_bin && row.new_bin !== row.location_code ? 1 : isFoundTransfer ? 1 : 0;

  const isConsumable = isConsumablePart({
    description_en: row.description_en,
    description_ar: descAr,
    category,
  })
    ? 1
    : 0;

  const item: InventoryItem = {
    part_number: row.part_number,
    location_code: effectiveLoc,
    old_location:
      row.new_bin && row.new_bin !== row.location_code ? row.location_code : undefined,
    description_en: row.description_en,
    description_ar: descAr || row.description_en || 'غير محدد',
    category,
    qty_total: row.qty_total,
    qty_out: shortage,
    qty_remaining: remaining,
    is_moved: isMovedFlag,
    is_missing: isMissing ? 1 : 0,
    remark: cleanRemark || undefined,
    mark_symbol: marks.mark_symbol,
    audit_meaning: marks.audit_meaning,
    is_consumable: isConsumable,
    is_manual_audit: isMissing ? 0 : marks.mark_symbol === '✓' ? 1 : 0,
    manual_audited_at: !isMissing && marks.mark_symbol === '✓' ? nowIso : undefined,
    status: isMissing
      ? 'غير موجودة'
      : isMovedFlag
      ? 'تم النقل'
      : marks.status,
    updated_at: nowIso,
  };

  return { item, shortage, isMissing, isFoundTransfer };
}

/**
 * تحليل دفعة نصوص أوراق الجرد (صيغة SAP المنسوخة) وتحويلها إلى سجلات مخزون نظيفة
 * دون تخزين أي بيانات ثابتة في الكود البرمجي.
 */
export function parseSapPipeBatchText(
  rawText: string,
  options?: { nowIso?: string; skipDuplicatePages?: boolean }
): { items: InventoryItem[]; stats: ParsedSapBatchStats } {
  const nowIso = options?.nowIso || new Date().toISOString();
  const skipDuplicatePages = options?.skipDuplicatePages !== false;

  const lines = String(rawText || '').split(/\r?\n/);
  let currentSheetLabel = 'ورقة مباشرة';
  let skipCurrentSheet = false;
  let sheetsDetected = 0;
  const skippedSheets: string[] = [];
  const candidates: ParsedCandidateRow[] = [];

  for (const rawLine of lines) {
    const line = cleanZeroWidth(rawLine);
    if (!line) continue;

    // رصد رأس ورقة جديدة مثل: "الورقة 9 (...)" أو "--- الصفحة 1 (...) ---" أو "--- الصفحة الصادرة من الصورة ... ---"
    if (/^(?:---\s*)?(?:الورقة\s+\d+|الصفحة(?:\s|$))/.test(line)) {
      sheetsDetected++;
      currentSheetLabel = line;
      const isDuplicateSheetHeader =
        skipDuplicatePages &&
        (/نسخة\s+مكررة/i.test(line) || /مكررة\s+في\s+الدفعة/i.test(line));
      skipCurrentSheet = isDuplicateSheetHeader;
      if (isDuplicateSheetHeader) {
        skippedSheets.push(line);
      }
      continue;
    }

    if (
      skipDuplicatePages &&
      (/مطابقة\s+تماماً\s+للورقة/i.test(line) || /نفس\s+الأرقام\s+والبيانات/i.test(line))
    ) {
      if (!skipCurrentSheet) {
        skipCurrentSheet = true;
        skippedSheets.push(currentSheetLabel);
      }
      continue;
    }

    if (skipCurrentSheet) continue;

    const parsed = parsePipeOrTabLine(line, currentSheetLabel);
    if (parsed) {
      candidates.push(parsed);
    }
  }

  if (sheetsDetected === 0 && candidates.length > 0) {
    sheetsDetected = 1;
  }

  const mergedMap = new Map<string, InventoryItem>();
  let duplicateMerges = 0;

  for (const cand of candidates) {
    const built = buildInventoryItemFromCandidate(cand, nowIso);
    const nextItem = built.item;
    const existing = mergedMap.get(nextItem.part_number);

    if (!existing) {
      mergedMap.set(nextItem.part_number, nextItem);
      continue;
    }

    duplicateMerges++;

    const existingMissing = existing.is_missing === 1;
    const nextMissing = nextItem.is_missing === 1;

    // إذا كان السجل السابق غير موجود (X) والجديد موجود في موقع آخر (مثل 1000082689 من N01B2 إلى N01BB2)
    if (existingMissing && !nextMissing) {
      mergedMap.set(nextItem.part_number, {
        ...nextItem,
        old_location: existing.location_code !== nextItem.location_code ? existing.location_code : nextItem.old_location,
        description_en: nextItem.description_en || existing.description_en,
        description_ar:
          nextItem.description_ar !== 'غير محدد'
            ? nextItem.description_ar
            : existing.description_ar,
        category: nextItem.category || existing.category,
      });
      continue;
    }

    // إذا كان السابق موجوداً والجديد X غير موجود في موقع آخر، نحتفظ بالموجود ونوثق الموقع المفقود في old_location
    if (!existingMissing && nextMissing) {
      mergedMap.set(nextItem.part_number, {
        ...existing,
        old_location: existing.old_location || (nextItem.location_code !== existing.location_code ? nextItem.location_code : undefined),
      });
      continue;
    }

    // كلاهما موجود أو كلاهما مفقود: جمع الكميات (M016 + C006 أو موقعين نشطين)
    const combinedTotal = existing.qty_total + nextItem.qty_total;
    const combinedOut =
      existingMissing && nextMissing
        ? 0
        : Math.min(combinedTotal, existing.qty_out + nextItem.qty_out);
    const combinedRemaining =
      existingMissing && nextMissing ? 0 : Math.max(0, combinedTotal - combinedOut);

    const remarks = [existing.remark, nextItem.remark]
      .filter((r): r is string => Boolean(r && r.trim()))
      .filter((v, idx, arr) => arr.indexOf(v) === idx);
    if (
      nextItem.location_code &&
      existing.location_code &&
      nextItem.location_code !== existing.location_code
    ) {
      const altBinNote = `موقع آخر: ${nextItem.location_code}`;
      if (!remarks.includes(altBinNote)) remarks.push(altBinNote);
    }

    mergedMap.set(nextItem.part_number, {
      ...existing,
      description_en: existing.description_en || nextItem.description_en,
      description_ar:
        existing.description_ar && existing.description_ar !== 'غير محدد'
          ? existing.description_ar
          : nextItem.description_ar,
      qty_total: combinedTotal,
      qty_out: combinedOut,
      qty_remaining: combinedRemaining,
      remark: remarks.length > 0 ? remarks.join(' | ') : undefined,
      is_missing: existingMissing && nextMissing ? 1 : 0,
      is_moved: existing.is_moved || nextItem.is_moved ? 1 : 0,
      status:
        existingMissing && nextMissing
          ? 'غير موجودة'
          : existing.status === 'تم النقل' || nextItem.status === 'تم النقل'
          ? 'تم النقل'
          : 'مدقق',
      updated_at: nowIso,
    });
  }

  const finalItems = Array.from(mergedMap.values());
  let missingCount = 0;
  let shortageCount = 0;
  let foundCount = 0;

  for (const it of finalItems) {
    if (it.is_missing === 1) missingCount++;
    if (it.qty_out > 0) shortageCount++;
    if (it.mark_symbol === 'F') foundCount++;
  }

  return {
    items: finalItems,
    stats: {
      sheetsDetected,
      skippedSheets,
      rawRowsParsed: candidates.length,
      uniquePartsMerged: finalItems.length,
      duplicateMerges,
      missingCount,
      shortageCount,
      foundCount,
    },
  };
}
