export interface DocumentLine {
  part_number: string;
  quantity: number;
  location: string;
  old_location?: string;
  description_en: string;
  description_ar: string;
  check: string;
  remark: string;
  reviewed: boolean;
}

export interface SkippedOcrRow {
  rowIndex: number;
  reason: string;
  rawText?: string;
}

export interface IncompleteLineIssue {
  lineNumber: number;
  part_number: string;
  location: string;
  issues: string[];
}

export interface DuplicatePartGroup {
  part_number: string;
  lineNumbers: number[];
  quantities: number[];
  totalQuantity: number;
  location: string;
  locations: string[];
  hasLocationConflict: boolean;
  hasMarkConflict: boolean;
}

export interface ShortageLineSummary {
  lineNumber: number;
  part_number: string;
  location: string;
  qtyTotal: number;
  shortage: number;
  qtyRemaining: number;
  remark: string;
}

export interface MissingLineSummary {
  lineNumber: number;
  part_number: string;
  location: string;
  qtyTotal: number;
}

export interface SheetCompletenessReport {
  expectedRowCount: number;
  extractedRowCount: number;
  missingFromOcrCount: number;
  skippedRows: SkippedOcrRow[];
  incompleteLines: IncompleteLineIssue[];
  unreviewedLines: number[];
  duplicateGroups: DuplicatePartGroup[];
  mergedDuplicateRowCount: number;
  netUniquePartsCount: number;
  shortageLines: ShortageLineSummary[];
  missingMarkLines: MissingLineSummary[];
  hasAnyShortageOrWarning: boolean;
  hasBlockingErrors: boolean;
}

export interface StockDocument {
  id: string;
  batchId?: string;
  duplicateResolution?: 'sum';
  kind: 'issue' | 'receipt' | 'inventory' | 'transfer';
  requester: string;
  reason: string;
  lines: DocumentLine[];
  original?: Blob;
  status: 'pending' | 'approved';
  createdAt: string;
  executedAt?: string;
  approvedBy?: string;
}

function normalizeDigitsAndMinus(val: string): string {
  return val
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[−–—]/g, '-')
    .trim()
    .toUpperCase();
}

function parseShortageValue(raw: string): number {
  if (!raw) return 0;
  // نمط -3 أو - 4
  const directMinus = raw.match(/^-\s*(\d+)$/);
  if (directMinus) return Number(directMinus[1]);
  // نمط 4 - 3 (العدد الأصلي مطروحاً منه العدد الناقص)
  const exprMinus = raw.match(/^\d+\s*-\s*(\d+)$/);
  if (exprMinus) return Number(exprMinus[1]);
  return 0;
}

export function interpretMark(check: string, remark: string) {
  const mark = normalizeDigitsAndMinus(check);
  const note = normalizeDigitsAndMinus(remark);
  const shortage = parseShortageValue(note) || parseShortageValue(mark);
  const isCross = /^[X×✗✘]$/.test(mark);
  const isVerified = /^(✓|✔|CHECK)$/.test(mark) || (!isCross && parseShortageValue(mark) > 0);
  const excludedIncrease =
    /^(?:F\s*\d+|\+\s*\d+)$/.test(note) || /^(?:F\s*\d+|\+\s*\d+)$/.test(mark);
  return {
    status: isCross ? 'غير موجودة' : isVerified ? 'مدقق' : 'غير مدقق',
    shortage: excludedIncrease ? 0 : shortage,
    excludedIncrease,
  } as const;
}

/**
 * محرك تدقيق اكتمال سطور الورقة وكشف أي نقص في القراءة أو الحفظ أو الكميات
 */
export function auditSheetCompleteness(
  lines: DocumentLine[],
  options?: { expectedRows?: number; skippedRows?: SkippedOcrRow[] }
): SheetCompletenessReport {
  const skippedRows = options?.skippedRows || [];
  const extractedRowCount = lines.length;
  const expectedRowCount = Math.max(
    extractedRowCount + skippedRows.length,
    options?.expectedRows || 0
  );
  const missingFromOcrCount = Math.max(0, expectedRowCount - extractedRowCount);

  const incompleteLines: IncompleteLineIssue[] = [];
  const unreviewedLines: number[] = [];
  const shortageLines: ShortageLineSummary[] = [];
  const missingMarkLines: MissingLineSummary[] = [];
  const partMap = new Map<
    string,
    { lineNumbers: number[]; quantities: number[]; locations: string[]; checks: string[] }
  >();

  lines.forEach((line, idx) => {
    const lineNumber = idx + 1;
    const cleanPart = (line.part_number || '').trim();
    const cleanLoc = (line.location || '').trim();
    const cleanDesc = (line.description_en || '').trim();
    const issues: string[] = [];

    if (!/^\d{10}$/.test(cleanPart)) {
      issues.push(
        cleanPart
          ? `رقم القطعة (${cleanPart}) غير مكتمل — يجب أن يكون 10 أرقام`
          : 'رقم القطعة مفقود'
      );
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0) {
      issues.push('الكمية غير مقروءة أو غير صالحة');
    }
    if (!cleanLoc) {
      issues.push('رمز الموقع (Storage Bin) مفقود');
    }
    if (!cleanDesc) {
      issues.push('الوصف الإنجليزي للقطعة مفقود');
    }

    if (issues.length > 0) {
      incompleteLines.push({
        lineNumber,
        part_number: cleanPart || 'غير مقروء',
        location: cleanLoc || 'غير محدد',
        issues,
      });
    }

    if (!line.reviewed) {
      unreviewedLines.push(lineNumber);
    }

    const marks = interpretMark(line.check, line.remark);
    const safeQty = Number.isFinite(line.quantity) ? line.quantity : 0;

    if (marks.status === 'غير موجودة') {
      missingMarkLines.push({
        lineNumber,
        part_number: cleanPart || `سطر #${lineNumber}`,
        location: cleanLoc || '—',
        qtyTotal: safeQty,
      });
    } else if (marks.shortage > 0) {
      shortageLines.push({
        lineNumber,
        part_number: cleanPart || `سطر #${lineNumber}`,
        location: cleanLoc || '—',
        qtyTotal: safeQty,
        shortage: marks.shortage,
        qtyRemaining: Math.max(0, safeQty - marks.shortage),
        remark: line.remark,
      });
    }

    if (cleanPart) {
      const group = partMap.get(cleanPart) || {
        lineNumbers: [],
        quantities: [],
        locations: [],
        checks: [],
      };
      group.lineNumbers.push(lineNumber);
      group.quantities.push(safeQty);
      group.locations.push(cleanLoc.toUpperCase());
      group.checks.push(marks.status);
      partMap.set(cleanPart, group);
    }
  });

  const duplicateGroups: DuplicatePartGroup[] = [];
  let mergedDuplicateRowCount = 0;

  for (const [part_number, group] of partMap.entries()) {
    if (group.lineNumbers.length > 1) {
      const uniqueLocs = Array.from(new Set(group.locations.filter(Boolean)));
      const hasLocationConflict = uniqueLocs.length > 1;
      const hasMarkConflict = group.checks.some(
        (c) => (c === 'غير موجودة') !== (group.checks[0] === 'غير موجودة')
      );
      const totalQuantity = group.quantities.reduce((a, b) => a + b, 0);
      duplicateGroups.push({
        part_number,
        lineNumbers: group.lineNumbers,
        quantities: group.quantities,
        totalQuantity,
        location: uniqueLocs[0] || '—',
        locations: uniqueLocs,
        hasLocationConflict,
        hasMarkConflict,
      });
      mergedDuplicateRowCount += group.lineNumbers.length - 1;
    }
  }

  const netUniquePartsCount = Math.max(0, extractedRowCount - mergedDuplicateRowCount);
  const hasAnyShortageOrWarning =
    missingFromOcrCount > 0 ||
    skippedRows.length > 0 ||
    incompleteLines.length > 0 ||
    duplicateGroups.length > 0 ||
    shortageLines.length > 0 ||
    missingMarkLines.length > 0;

  const hasBlockingErrors =
    extractedRowCount === 0 ||
    incompleteLines.length > 0 ||
    duplicateGroups.some((g) => g.hasLocationConflict || g.hasMarkConflict);

  return {
    expectedRowCount,
    extractedRowCount,
    missingFromOcrCount,
    skippedRows,
    incompleteLines,
    unreviewedLines,
    duplicateGroups,
    mergedDuplicateRowCount,
    netUniquePartsCount,
    shortageLines,
    missingMarkLines,
    hasAnyShortageOrWarning,
    hasBlockingErrors,
  };
}

export function validateDocument(doc: StockDocument) {
  if (
    !doc.id.trim() ||
    !doc.requester.trim() ||
    !doc.lines.length ||
    !['issue', 'receipt', 'inventory', 'transfer'].includes(doc.kind)
  ) {
    throw new Error('أكمل رقم المستند واسم مقدم الطلب والسطور');
  }
  const seen = new Set<string>();
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i];
    const rowLabel = ` (السطر #${i + 1})`;
    if (
      !/^\d{10}$/.test(line.part_number) ||
      (seen.has(line.part_number) && doc.duplicateResolution !== 'sum') ||
      !line.reviewed
    ) {
      throw new Error(
        'راجع جميع السطور وأرقام القطع؛ يمنع تكرار رقم داخل المستند' + rowLabel
      );
    }
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 0 ||
      (doc.kind !== 'inventory' && line.quantity === 0)
    ) {
      throw new Error('الكمية يجب أن تكون عددًا صحيحًا صالحًا' + rowLabel);
    }
    if (!line.location.trim() || !line.description_en.trim()) {
      throw new Error('أكمل الموقع والوصف' + rowLabel);
    }
    seen.add(line.part_number);
  }
  if (doc.duplicateResolution === 'sum') {
    if (!['inventory', 'receipt'].includes(doc.kind)) {
      throw new Error('جمع السطور المكررة متاح للجرد والتوريد فقط');
    }
    for (const part of seen) {
      const rows = doc.lines.filter((line) => line.part_number === part);
      if (rows.length > 1) {
        const hasLocationConflict = rows.some((line) => line.location !== rows[0].location);
        const firstStatus = interpretMark(rows[0].check, rows[0].remark).status;
        const hasMissingConflict = rows.some(
          (line) =>
            (interpretMark(line.check, line.remark).status === 'غير موجودة') !==
            (firstStatus === 'غير موجودة')
        );
        if (hasLocationConflict || hasMissingConflict) {
          throw new Error(
            'راجع مواقع وعلامات السطور المكررة وأزل الملاحظات الملتبسة قبل جمعها'
          );
        }
      }
    }
  }
  if (doc.kind === 'transfer' && !doc.reason.trim()) {
    throw new Error('اذكر سبب طلب النقل');
  }
}

export const canonicalDocumentId = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/\s+/g, '')
    .toUpperCase();

export function approvalLines(doc: StockDocument): DocumentLine[] {
  if (doc.duplicateResolution !== 'sum') return doc.lines;
  const groups = new Map<
    string,
    { line: DocumentLine; count: number; totalShortage: number; allExcludedF: boolean }
  >();
  for (const line of doc.lines) {
    const existing = groups.get(line.part_number);
    const marks = interpretMark(line.check, line.remark);
    if (!existing) {
      groups.set(line.part_number, {
        line: { ...line },
        count: 1,
        totalShortage: marks.shortage,
        allExcludedF: marks.excludedIncrease,
      });
    } else {
      const totalQuantity = existing.line.quantity + line.quantity;
      const totalShortage = existing.totalShortage + marks.shortage;
      const allExcludedF = existing.allExcludedF && marks.excludedIncrease;
      let mergedRemark = existing.line.remark || line.remark;
      if (totalShortage > 0) {
        mergedRemark = `-${totalShortage}`;
      } else if (!allExcludedF && /^F\d+$/i.test(mergedRemark.trim())) {
        // إذا كان أحد السطرين عادياً والآخر يحمل ملاحظة F، نحتفظ بالملاحظة دون حجب السطر المدمج
        mergedRemark = `${mergedRemark.trim()} (مدمج)`;
      }
      groups.set(line.part_number, {
        line: {
          ...existing.line,
          quantity: totalQuantity,
          check: existing.line.check || line.check,
          remark: mergedRemark,
        },
        count: existing.count + 1,
        totalShortage,
        allExcludedF,
      });
    }
  }
  const mergedList = Array.from(groups.values()).map((g) => g.line);
  if (mergedList.some((line) => !Number.isSafeInteger(line.quantity))) {
    throw new Error('مجموع الكميات غير صالح');
  }
  return mergedList;
}

