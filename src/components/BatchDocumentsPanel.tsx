import React, { useEffect, useState } from 'react';
import { dbService } from '../services/db';
import type { DocumentLine, StockDocument } from '../services/documents';
import { processOcrFromImage } from '../services/localOcr';
import { readImageBatch } from '../services/batchOcr';
import { prepareAudio, playOperationSound } from '../utils/operationSounds';
interface Sheet {
  key: string; id: string; original: File; lines: DocumentLine[];
  state: 'waiting' | 'reading' | 'review' | 'error'; message: string;
}
const blank = (): DocumentLine => ({ part_number: '', quantity: Number.NaN, location: '', description_en: '', description_ar: '', check: '', remark: '', reviewed: false });
function SheetImage({ image }: { image: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(image); setUrl(next); return () => URL.revokeObjectURL(next); }, [image]);
  return <details><summary>مراجعة الصورة الأصلية</summary><img src={url} alt="أصل ورقة الدفعة" className="max-h-96" /></details>;
}
export function BatchDocumentsPanel({ onChanged }: { onChanged: () => void }) {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [requester, setRequester] = useState('');
  const [kind, setKind] = useState<'inventory' | 'receipt' | 'issue'>('inventory');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [documents, setDocuments] = useState<StockDocument[]>([]);
  const refresh = async () => setDocuments(await dbService.getDocuments());
  useEffect(() => { refresh().catch(err => setMessage(String(err))); }, []);
  const patch = (key: string, update: Partial<Sheet>) => setSheets(current => current.map(sheet => sheet.key === key ? { ...sheet, ...update } : sheet));
  const patchLine = (key: string, index: number, update: Partial<DocumentLine>) => setSheets(current => current.map(sheet => sheet.key !== key ? sheet : {
    ...sheet, lines: sheet.lines.map((line, i) => i === index ? { ...line, ...update } : line),
  }));
  const batches = new Map<string, StockDocument[]>();
  for (const doc of documents) if (doc.batchId) batches.set(doc.batchId, [...(batches.get(doc.batchId) || []), doc]);
  return <details className="border border-amber-600 rounded-xl p-3" dir="rtl">
    <summary className="font-bold cursor-pointer">قراءة وحفظ عدة أوراق دفعة واحدة</summary>
    <p>اختر صور الأوراق معًا. تُقرأ بالتتابع، ثم تراجع جميع السطور وأرقام المستندات. الحفظ لا يعدّل المخزون؛ الاعتماد خطوة مستقلة.</p>
    <p>في الجرد: تُضاف القطع الجديدة بعد الاعتماد، والقطع الموجودة لا تتكرر ولا يُستبدل رصيدها بالكمية المقروءة. النقص -N يحتاج اعتمادًا. استخدم «توريد» لإضافة كميات واردة.</p>
    <form onSubmit={async e => {
      e.preventDefault(); prepareAudio(); setBusy(true);
      try {
        if (!sheets.length || sheets.some(sheet => sheet.state !== 'review')) throw new Error('راجع كل الأوراق، بما فيها الأوراق التي تعذرت قراءتها');
        const batchId = 'BATCH-' + crypto.randomUUID();
        await dbService.submitDocuments(sheets.map(sheet => ({ id: sheet.id, batchId, kind, requester, reason: 'دفعة صور مراجعة', lines: sheet.lines, original: sheet.original, status: 'pending', createdAt: '' })));
        await refresh(); onChanged(); setMessage(`حُفظت ${sheets.length} أوراق للمراجعة؛ المخزون لم يتغير`); setSheets([]);
      } catch (err) {
        setMessage((err as Error).message);
        if ((err as Error).message.includes('تم حفظها مسبقًا')) playOperationSound('duplicate');
      } finally { setBusy(false); }
    }}>
      <label className="block">نوع الدفعة <select disabled={busy} className="bg-stone-800 p-2" value={kind} onChange={e => setKind(e.target.value as typeof kind)}>
        <option value="inventory">أوراق جرد</option><option value="receipt">أوراق توريد مخزون</option><option value="issue">أوراق صرف</option>
      </select></label>
      <label className="block">اسم مقدم الدفعة <input disabled={busy} required className="bg-stone-800 p-2" value={requester} onChange={e => setRequester(e.target.value)} /></label>
      <label className="block">اختيار صور الأوراق <input disabled={busy} type="file" accept="image/*" multiple onChange={e => {
        const files = Array.from(e.target.files || []);
        setSheets(current => [...current, ...files.map(original => ({ key: crypto.randomUUID(), id: '', original, lines: [], state: 'waiting' as const, message: '' }))]);
        e.target.value = '';
      }} /></label>
      <p>عدد الأوراق: {sheets.length} — جاهزة للمراجعة: {sheets.filter(sheet => sheet.state === 'review').length} — أخطاء: {sheets.filter(sheet => sheet.state === 'error').length}</p>
      <button type="button" className="p-2 bg-stone-700 rounded" disabled={busy || !sheets.some(sheet => sheet.state === 'waiting' || sheet.state === 'error')} onClick={async () => {
        prepareAudio(); setBusy(true);
        try {
          await readImageBatch(sheets.filter(sheet => sheet.state === 'waiting' || sheet.state === 'error'), processOcrFromImage,
            (key, index, total) => { patch(key, { state: 'reading', message: '' }); setMessage(`قراءة الورقة ${index} من ${total}`); },
            result => {
              if (result.state === 'error') { patch(result.key, { state: 'error', message: result.message }); return; }
              patch(result.key, { state: 'review', lines: result.rows.map(row => ({ part_number: row.part_number, quantity: row.qty_total > 0 ? row.qty_total : Number.NaN, location: row.location_code,
                description_en: row.description_en, description_ar: row.description_ar, check: row.is_missing === 1 ? 'X' : '', remark: row.remark || '', reviewed: false })) });
            });
          playOperationSound('uncertain'); setMessage('انتهت القراءة الأولية؛ راجع كل ورقة وكمية ورقم قطعة مقابل أصلها، وصحح الأوراق غير الواضحة.');
        } catch (err) { setMessage(String(err)); playOperationSound('uncertain'); }
        finally { setBusy(false); }
      }}>قراءة جميع الأوراق المنتظرة</button>
      {sheets.map((sheet, sheetIndex) => <fieldset key={sheet.key} disabled={busy} className="border border-stone-600 rounded p-3 my-3" data-sheet-index={sheetIndex}>
        <legend>الورقة {sheetIndex + 1}: {sheet.original.name} — {{ waiting: 'بانتظار القراءة', reading: 'جارٍ القراءة', review: 'تحتاج مراجعتك', error: 'تعذرت القراءة' }[sheet.state]}</legend>
        <SheetImage image={sheet.original} />
        <label>رقم مستند الورقة <input required className="bg-stone-800 p-1" value={sheet.id} placeholder="أدخل رقم الورقة الصحيح لمنع تكرار اعتمادها" onChange={e => patch(sheet.key, { id: e.target.value })} /></label>
        {sheet.message && <p className="text-red-300">{sheet.message}</p>}
        {sheet.lines.map((line, index) => <div key={index} className="border-b border-stone-700 py-3 space-y-2">
          {line.part_number && sheet.lines.filter(candidate => candidate.part_number.trim() === line.part_number.trim()).length > 1 && <p role="alert" className="text-red-300">رقم مكرر داخل الورقة: راجع الكميات وحدد السطر الصحيح؛ لا يتم جمعها أو حذفها تلقائيًا.</p>}
          <label>رقم القطعة <input required pattern="[0-9]{10}" className="bg-stone-800 p-1" value={line.part_number} onChange={e => patchLine(sheet.key, index, { part_number: e.target.value, reviewed: false })} /></label>
          <label>الكمية <input required type="number" min="0" step="1" className="bg-stone-800 p-1 w-24" value={Number.isFinite(line.quantity) ? line.quantity : ''} onChange={e => patchLine(sheet.key, index, { quantity: e.target.value === '' ? Number.NaN : Number(e.target.value), reviewed: false })} /></label>
          <label>الموقع <input required className="bg-stone-800 p-1 w-28" value={line.location} onChange={e => patchLine(sheet.key, index, { location: e.target.value, reviewed: false })} /></label>
          {dbService.getItemByPartNumber(line.part_number) && <p className="text-amber-200">قطعة موجودة — الرصيد الحالي: {dbService.getItemByPartNumber(line.part_number)!.qty_remaining}. لن يُنشأ سجل مكرر.</p>}
          <div className="flex flex-col gap-2"><label>الترجمة العربية <input className="bg-stone-800 p-1" value={line.description_ar} onChange={e => patchLine(sheet.key, index, { description_ar: e.target.value, reviewed: false })} /></label>
            <label>الاسم الأصلي <input required dir="ltr" className="bg-stone-800 p-1" value={line.description_en} onChange={e => patchLine(sheet.key, index, { description_en: e.target.value, reviewed: false })} /></label></div>
          <label>العلامة <select className="bg-stone-800 p-1" value={line.check} onChange={e => patchLine(sheet.key, index, { check: e.target.value, reviewed: false })}><option value="">غير مدققة</option><option>✓</option><option>X</option></select></label>
          <label>الملاحظة <input className="bg-stone-800 p-1 w-24" value={line.remark} onChange={e => patchLine(sheet.key, index, { remark: e.target.value, reviewed: false })} /></label>
          <label><input type="checkbox" checked={line.reviewed} onChange={e => patchLine(sheet.key, index, { reviewed: e.target.checked })} />راجعت هذا السطر مقابل الصورة</label>
          <button type="button" className="p-2" onClick={() => patch(sheet.key, { lines: sheet.lines.filter((_, i) => i !== index) })}>إزالة سطر من المسودة</button>
        </div>)}
        <button type="button" className="p-2" onClick={() => patch(sheet.key, { state: 'review', lines: [...sheet.lines, blank()] })}>إضافة سطر يدوي لهذه الورقة</button>
        <button type="button" className="p-2" onClick={() => setSheets(current => current.filter(candidate => candidate.key !== sheet.key))}>إزالة الورقة من المسودة</button>
      </fieldset>)}
      <button disabled={busy || !sheets.length} className="bg-amber-800 p-2 rounded">حفظ جميع أوراق الدفعة للمراجعة</button>
    </form>
    <p role="status">{message}</p>
    {Array.from(batches, ([batchId, docs]) => {
      const pending = docs.filter(doc => doc.status === 'pending');
      return <div key={batchId} className="border-t border-stone-700 p-2"><p>دفعة {docs[0].createdAt} — {docs.length} أوراق — معتمدة: {docs.length - pending.length}</p>
        <p>{docs.map(doc => doc.id).join('، ')}</p>
        {!!pending.length && <button disabled={busy} className="bg-emerald-900 p-2 rounded" onClick={async () => {
          prepareAudio(); setBusy(true);
          try {
            await dbService.approveDocuments(pending.map(doc => doc.id));
            await refresh(); onChanged(); if (pending.some(doc => doc.kind === 'issue')) playOperationSound('issued'); setMessage('تم اعتماد الدفعة وتنفيذها بالكامل');
          } catch (err) { setMessage((err as Error).message + ' — لم تُنفذ أي ورقة من طلب الاعتماد الحالي'); }
          finally { setBusy(false); }
        }}>اعتماد جميع الأوراق المتبقية وتنفيذها</button>}
      </div>;
    })}
  </details>;
}
