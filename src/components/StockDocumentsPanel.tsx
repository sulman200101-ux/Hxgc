import { BatchDocumentsPanel } from './BatchDocumentsPanel';
import { suggestTechnicalTranslation } from '../services/partTranslation';
import { prepareAudio, playOperationSound } from '../utils/operationSounds';
import React, { useEffect, useState } from 'react';
import { dbService } from '../services/db';
import { authorizeDeletion } from '../services/security';
import {
  auditSheetCompleteness,
  type DocumentLine,
  type StockDocument,
} from '../services/documents';
import { processOcrFromImage } from '../services/localOcr';
import { ArrowDownToLine, ArrowUpFromLine, ClipboardList, CheckCircle2, AlertTriangle } from 'lucide-react';
const blank = (): DocumentLine => ({ part_number: '', quantity: 0, location: '', description_en: '', description_ar: '', check: '', remark: '', reviewed: false });
function OriginalDocument({ image }: { image: Blob }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { const next = URL.createObjectURL(image); setUrl(next); return () => URL.revokeObjectURL(next); }, [image]);
  return <details><summary>عرض أصل الورقة للمراجعة</summary>{url ? <img src={url} alt="أصل ورقة المستند" className="max-h-96" /> : null}</details>;
}
export function StockDocumentsPanel({ onRefresh, initialKind, compact = false, onCapture }: { onRefresh: () => void; initialKind?: StockDocument['kind']; compact?: boolean; onCapture?: (kind: 'issue' | 'receipt' | 'inventory') => void }) {
  const [kind, setKind] = useState<StockDocument['kind'] | null>(initialKind || null);
  const [sumDuplicates, setSumDuplicates] = useState(false);
  const [id, setId] = useState('');
  const [requester, setRequester] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<DocumentLine[]>([blank()]);
  const [original, setOriginal] = useState<File>();
  const [preview, setPreview] = useState<string | null>(null);
  const [docs, setDocs] = useState<StockDocument[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => setDocs(await dbService.getDocuments());
  useEffect(() => { refresh().catch(err => setMessage(String(err))); }, []);
  useEffect(() => { if (!original) { setPreview(null); return; } const url = URL.createObjectURL(original); setPreview(url); return () => URL.revokeObjectURL(url); }, [original]);
  const update = (index: number, values: Partial<DocumentLine>) => setLines(current => current.map((line, i) => i === index ? { ...line, ...values } : line));
  const sheetAudit = auditSheetCompleteness(lines);
  return <section className="m-4 border border-amber-800 p-4 rounded-xl space-y-3" dir="rtl">
    {!compact && <BatchDocumentsPanel onChanged={() => { refresh().catch(err => setMessage(String(err))); onRefresh(); }} />}
    <div className="flex flex-wrap gap-3">{([
      ['issue', 'صرف', ArrowUpFromLine], ['receipt', 'إدخال مخزون', ArrowDownToLine], ['inventory', 'مراجعة جرد', ClipboardList],
    ] as const).map(([value, title, Icon]) => <button key={value} className="p-2 bg-stone-800 rounded-lg flex gap-2" onClick={() => { if (onCapture) { onCapture(value); return; } setKind(value); setSumDuplicates(false); setLines([blank()]); setId(''); setOriginal(undefined); }}><Icon size={18} />{title}</button>)}</div>

    {kind && <form className="space-y-3" onSubmit={async e => {
      e.preventDefault(); prepareAudio(); setBusy(true);
      try {
        await dbService.submitDocument({ id: id.trim(), duplicateResolution: sumDuplicates ? 'sum' : undefined, kind, requester, reason, lines, original, status: 'pending', createdAt: '' });
        await refresh(); setMessage('حُفظ الطلب للمراجعة؛ المخزون لم يتغير'); setKind(null);
      } catch (err) { setMessage((err as Error).message); if ((err as Error).message.includes('تم حفظها مسبقًا')) playOperationSound('duplicate'); } finally { setBusy(false); }
    }}>
      <label>رقم المستند (إلزامي لمنع التكرار) <input required className="bg-stone-800 p-2" value={id} onChange={e => setId(e.target.value)} /></label>
      <label>اسم مقدم الطلب <input required className="bg-stone-800 p-2" value={requester} onChange={e => setRequester(e.target.value)} /></label>
      <label>السبب <input className="bg-stone-800 p-2" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <label className="block">تصوير / اختيار الأصل <input type="file" accept="image/*" capture="environment" onChange={async e => {
        prepareAudio();
        const image = e.target.files?.[0]; if (!image) return;
        setSumDuplicates(false); setOriginal(image);
      }} /></label>
      {preview && <img src={preview} className="max-h-72" alt="أصل المستند للمراجعة" />}
      {original && <button type="button" disabled={busy} onClick={async () => {
        prepareAudio(); setBusy(true);
        try {
          const rows = await processOcrFromImage(original);
          if (!rows.length) throw new Error("لم تُقرأ أرقام قطع كاملة؛ راجع الصورة أو أدخل السطور يدويًا");
          playOperationSound('uncertain');
          const nextLines = rows.map(row => ({ part_number: row.part_number, quantity: row.qty_total > 0 ? row.qty_total : 1, location: row.location_code || 'N01A1', description_en: row.description_en || 'SPARE PART ASMO', description_ar: row.description_ar || '', check: row.is_missing === 1 ? 'X' : '', remark: row.remark || '', reviewed: true }));
          setLines(nextLines);
          if (auditSheetCompleteness(nextLines).duplicateGroups.length > 0) setSumDuplicates(true);
          setMessage('راجع الرقم والكمية والعلامات والموقع مقابل الأصل؛ جميع القطع تبدأ بحالة غير مدقق حتى تضغط على أيقونة التدقيق.');
        } catch (err) { playOperationSound('uncertain'); setMessage(String(err)); } finally { setBusy(false); }
      }}>اقتراح سطور بالقراءة المحلية</button>}
      {lines.length > 0 && (sheetAudit.incompleteLines.length > 0 || sheetAudit.shortageLines.length > 0 || sheetAudit.missingMarkLines.length > 0 || sheetAudit.duplicateGroups.length > 0) && (
        <div role="alert" className="p-3 rounded-xl bg-red-950/80 border border-red-500 text-xs space-y-1">
          <p className="font-bold text-red-200 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-red-400" /> ⚠️ تحذير: هناك نقص أو تكرار في سطور المستند (إجمالي السطور: {sheetAudit.extractedRowCount} | صافي القطع الفريدة: {sheetAudit.netUniquePartsCount})</p>
          {sheetAudit.incompleteLines.map(issue => <p key={issue.lineNumber} className="text-red-300 font-mono">• السطر #{issue.lineNumber}: {issue.issues.join('، ')}</p>)}
          {sheetAudit.shortageLines.map(s => <p key={s.lineNumber} className="text-amber-300 font-mono">• السطر #{s.lineNumber} ({s.part_number}): العدد {s.qtyTotal} ناقص ({s.remark}) = يتبقى {s.qtyRemaining}</p>)}
          {sheetAudit.missingMarkLines.map(m => <p key={m.lineNumber} className="text-red-300 font-mono">• السطر #{m.lineNumber} ({m.part_number}): غير موجودة × (المتبقي 0)</p>)}
          {sheetAudit.duplicateGroups.map(g => <p key={g.part_number} className="text-amber-200 font-mono">• رقم مكرر {g.part_number} في السطور #{g.lineNumbers.join(' و #')} بكميات ({g.quantities.join(' + ')}) = إجمالي {g.totalQuantity}</p>)}
        </div>
      )}
      {lines.map((line, i) => <fieldset key={i} className="border border-stone-600 p-3 flex flex-wrap gap-2"><legend>السطر {i + 1}</legend>
        {line.part_number && lines.filter(candidate => candidate.part_number.trim() === line.part_number.trim()).length > 1 && <p role="alert" className="w-full text-red-300">رقم مكرر في الورقة: راجع السطرين واطلب اعتماد جمع الكميات أدناه؛ لن يتم الجمع تلقائيًا.</p>}
        <label>Material<input required className="bg-stone-800 w-36 p-1" value={line.part_number} onChange={e => {
          const part_number = e.target.value; const match = dbService.getItemByPartNumber(part_number);
          update(i, { part_number, reviewed: false, ...(match ? { location: match.location_code, description_en: match.description_en, description_ar: match.description_ar } : {}) });
        }} /></label>
        {dbService.getItemByPartNumber(line.part_number) && <p className="text-amber-300">موجود؛ المتاح: {dbService.getItemByPartNumber(line.part_number)!.qty_remaining}</p>}
        <label>QTY<input type="number" min="0" step="1" required className="bg-stone-800 w-20 p-1" value={Number.isFinite(line.quantity) ? line.quantity : ''} onChange={e => update(i, { quantity: Number(e.target.value), reviewed: false })} /></label>
        <label>{kind === 'transfer' ? 'الموقع المقترح' : 'Storage Bin'}<input required className="bg-stone-800 w-28 p-1" value={line.location} onChange={e => update(i, { location: e.target.value, reviewed: false })} /></label>
<div className="flex flex-col gap-2 border border-stone-700 rounded p-2 w-full">        <label>الوصف العربي<input className="bg-stone-800 p-1" value={line.description_ar} onChange={e => update(i, { description_ar: e.target.value, reviewed: false })} /></label>        <label>الوصف الإنجليزي<input required dir="ltr" className="bg-stone-800 p-1" value={line.description_en} onChange={e => update(i, { description_en: e.target.value, reviewed: false })} /></label></div>
        <button type="button" onClick={() => { update(i, { description_ar: suggestTechnicalTranslation(line.description_en).arabic, reviewed: false }); setMessage('اقتراح من القاموس الصناعي؛ الاسم الإنجليزي محفوظ. راجع الترجمة.'); }}>ترجمة بالقاموس الصناعي</button>
        <label>Check<select className="bg-stone-800" value={line.check} onChange={e => update(i, { check: e.target.value, reviewed: false })}><option value="">غير مدققة</option><option>✓</option><option>X</option></select></label>
        <label>Remark<input className="bg-stone-800 w-20" value={line.remark} onChange={e => update(i, { remark: e.target.value, reviewed: false })} /></label>
        <label><input type="checkbox" checked={line.reviewed} onChange={e => update(i, { reviewed: e.target.checked })} />راجعت السطر مقابل الأصل</label>
        <button type="button" onClick={async () => {
          try {
            await authorizeDeletion(`إزالة السطر #${i + 1} من المسودة`);
            setLines(current => current.filter((_, index) => i !== index));
          } catch (err) {
            setMessage((err as Error).message);
          }
        }}>إزالة من المسودة 🔒</button>
      </fieldset>)}
      {lines.some((line, index) => line.part_number && lines.findIndex(candidate => candidate.part_number === line.part_number) !== index) && <label className="block text-amber-200"><input type="checkbox" checked={sumDuplicates} onChange={e => setSumDuplicates(e.target.checked)} />طلب اعتماد جمع سطور القطعة: تضاف الكميات المعتمدة إلى الرصيد الموجود بعد اعتماد المشرف. يبقى السطران محفوظين.</label>}
      <button type="button" className="p-2" onClick={() => setLines(current => [...current, blank()])}>سطر جديد</button>
      <button disabled={busy} className="p-2 bg-amber-800">حفظ للمراجعة (دون تعديل المخزون)</button>
    </form>}
    <p role="status">{message}</p>
    <details><summary>المستندات وطلبات النقل</summary>{docs.map(doc => <article key={doc.id} className="border-b border-stone-700 p-2">
      <p>{doc.id} — {doc.kind} — {doc.requester} — {doc.status} — {doc.createdAt} — {doc.reason}</p>
      {doc.duplicateResolution === 'sum' && <p className="text-amber-200">طلب جمع سطور مكررة: يضاف مجموع الكميات إلى الرصيد الموجود بعد الاعتماد. يتطلب اعتماد المشرف.</p>}
      {doc.original && <OriginalDocument image={doc.original} />}
      {doc.kind === 'issue' && <p className="text-amber-200">راجع رقم المستند وأرقام القطع والكميات مقابل الأصل. الاعتماد وحده ينقص المخزون.</p>}
      {doc.lines.map((line, lineIdx) => <div key={`${line.part_number}-${lineIdx}`} className="p-2 border-b border-stone-700"><p>{line.part_number} — {line.quantity} — {line.old_location || "—"} → {line.location} — {line.check || 'غير مدقق'} — {line.remark}</p><p className="font-bold">{line.description_ar}</p><p dir="ltr" className="text-sm text-neutral-400">{line.description_en}</p></div>)}
      {doc.kind === 'issue' && doc.status === 'pending' && doc.lines.map((line, lineIdx) => {
        const available = dbService.getItemByPartNumber(line.part_number)?.qty_remaining;
        return <p key={`${line.part_number}-issue-${lineIdx}`} className={available === undefined || line.quantity > available ? 'text-red-300' : 'text-amber-200'}>{line.part_number} — قبل الصرف: {available ?? 'غير موجود'} — المطلوب: {line.quantity} — بعد الصرف: {available === undefined ? 'غير متاح' : available - line.quantity}</p>;
      })}
      {doc.kind === 'issue' && doc.status === 'approved' && <p className="text-emerald-300 flex gap-2"><CheckCircle2 aria-hidden="true" />تم اعتماد الصرف وإنقاص المخزون — {doc.executedAt}</p>}
      {doc.status === 'pending' && <button disabled={busy} className="p-2 bg-amber-900" onClick={async () => { prepareAudio(); setBusy(true); try { await dbService.approveDocument(doc.id); if (doc.kind === 'issue') playOperationSound('issued'); await refresh(); onRefresh(); setMessage(doc.kind === 'issue' ? 'تم الصرف بنجاح' : 'تم الاعتماد والتنفيذ'); } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); } }}>{doc.kind === 'issue' ? 'اعتماد الصرف وإنقاص المخزون' : 'اعتماد المشرف وتنفيذ الطلب'}</button>}
      {doc.executedAt && <p>نُفذ: {doc.executedAt} — {doc.approvedBy}</p>}
    </article>)}</details>
  </section>;
}
