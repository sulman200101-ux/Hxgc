import React, { useEffect, useMemo, useState } from 'react';
import type { InventoryItem } from '../types';
import type { StockDocument } from '../services/documents';
import { dbService } from '../services/db';
import { suggestTransfers } from '../services/transferSuggestions';
export function TransferSuggestionsPanel({ items, onClose, onRefresh }: { items: InventoryItem[]; onClose: () => void; onRefresh: () => void }) {
  const [documents,setDocuments]=useState<StockDocument[]>([]);
  const [ready,setReady]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const refresh=async()=>{setDocuments(await dbService.getDocuments());setReady(true);};
  useEffect(()=>{refresh().catch(error=>setMessage(String(error)));},[]);
  const pending=documents.filter(doc=>doc.kind==='transfer' && doc.status==='pending');
  const suggestions=useMemo(()=>suggestTransfers(items,new Set(documents.filter(doc=>doc.kind==='transfer' && doc.status==='pending').flatMap(doc=>doc.lines.map(line=>line.part_number)))),[items,documents]);
  return <div role="dialog" aria-modal="true" aria-label="اقتراحات تجميع القطع" className="fixed inset-0 z-50 bg-black/90 overflow-y-auto p-4" dir="rtl"><section className="max-w-3xl mx-auto bg-stone-900 text-white rounded-xl p-4 space-y-4">
    <header className="flex justify-between items-center"><h2 className="text-lg font-bold">اقتراح تجميع القطع المتشابهة</h2><button onClick={onClose} className="p-2 bg-stone-800 rounded">إغلاق الاقتراحات</button></header>
    <p>اقتراحات حسب العائلة الفنية وترميز المنطقة. تحقق من القرب الفعلي وسعة الموقع قبل طلب النقل. لا تُدمج أرقام القطع ولا يتغير الموقع قبل اعتماد المشرف.</p>
    <p role="status">{message}</p>
    {ready && !suggestions.length && <p>لا توجد اقتراحات مناسبة حاليًا داخل المنطقة نفسها، أو توجد طلبات نقل معلقة لهذه القطع.</p>}
    {ready && suggestions.map(suggestion=>{const item=items.find(candidate=>candidate.part_number===suggestion.partNumber)!;return <article key={suggestion.partNumber} className="border border-amber-900 p-3 rounded-xl space-y-2">
      <strong>{suggestion.partNumber} — {suggestion.family}</strong><p>{item.description_ar}</p><p dir="ltr">{item.description_en}</p>
      <p>الحالي: {suggestion.from} ← المقترح: {suggestion.to} — الكمية: {suggestion.quantity}</p><p className="text-sm text-neutral-300">{suggestion.reason}</p>
      <button disabled={busy} className="bg-amber-800 p-2 rounded" onClick={async()=>{setBusy(true);try {
        await dbService.submitDocument({id:'SUGGEST-'+crypto.randomUUID(),kind:'transfer',requester:'المستخدم المحلي',reason:suggestion.reason,status:'pending',createdAt:'',lines:[{part_number:item.part_number,quantity:suggestion.quantity,location:suggestion.to,description_en:item.description_en,description_ar:item.description_ar,check:'',remark:'',reviewed:true}]});
        await refresh();setMessage('حُفظ طلب النقل للمراجعة؛ الموقع الحالي لم يتغير');
      }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}}>طلب اعتماد الاقتراح</button>
    </article>;})}
    {!!pending.length && <h3 className="font-bold">طلبات نقل بانتظار الاعتماد</h3>}
    {pending.map(doc=><article key={doc.id} className="border border-stone-600 p-3 rounded"><p>{doc.lines.map(line=>`${line.part_number}: ${line.old_location || '—'} ← ${line.location} (${line.quantity})`).join('، ')}</p><p>{doc.reason}</p>
      <button disabled={busy} className="p-2 bg-emerald-900 rounded" onClick={async()=>{setBusy(true);try{await dbService.approveDocument(doc.id);await refresh();onRefresh();setMessage('تم اعتماد النقل وتحديث الموقع وتسجيل العملية');}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}}>اعتماد المشرف وتنفيذ النقل</button>
    </article>)}
  </section></div>;
}
