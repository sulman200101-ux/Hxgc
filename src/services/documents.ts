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
export interface StockDocument {
  id: string;
  batchId?: string;
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
export function interpretMark(check: string, remark: string) {
  const mark = check.trim().toUpperCase();
  const note = remark.trim().toUpperCase();
  return {
    status: /^[X×✗✘]$/.test(mark) ? 'غير موجودة' : /^(✓|✔|CHECK)$/.test(mark) ? 'مدقق' : 'غير مدقق',
    shortage: /^-\s*\d+$/.test(note) ? Number(note.slice(1).trim()) : 0,
    excludedIncrease: /^F\d+$/.test(note),
  } as const;
}
export function validateDocument(doc: StockDocument) {
  if (!doc.id.trim() || !doc.requester.trim() || !doc.lines.length || !['issue','receipt','inventory','transfer'].includes(doc.kind)) throw new Error('أكمل رقم المستند واسم مقدم الطلب والسطور');
  const seen = new Set<string>();
  for (const line of doc.lines) {
    if (!/^\d{10}$/.test(line.part_number) || seen.has(line.part_number) || !line.reviewed) throw new Error('راجع جميع السطور وأرقام القطع؛ يمنع تكرار رقم داخل المستند');
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0 || (doc.kind !== 'inventory' && line.quantity === 0)) throw new Error('الكمية يجب أن تكون عددًا صحيحًا صالحًا');
    if (!line.location.trim() || !line.description_en.trim()) throw new Error('أكمل الموقع والوصف');
    seen.add(line.part_number);
  }
  if (doc.kind === 'transfer' && !doc.reason.trim()) throw new Error('اذكر سبب طلب النقل');
}

export const canonicalDocumentId = (value: string) => value.normalize('NFKC').replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/\s+/g, '').toUpperCase();
