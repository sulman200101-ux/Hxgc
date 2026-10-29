import React, { useState } from 'react';
import { dbService } from '../services/db';
import { generateReportPdfBlob } from '../utils/pdfExportUtil';
export function ReportsPanel() {
  const [kind, setKind] = useState('inventory');
  const [rows, setRows] = useState<string[][]>([]);
  const [message, setMessage] = useState('');
  const titles: Record<string, string> = { inventory: 'الجرد', missing: 'النقص والمفقود', unverified: 'القطع غير المدققة', issue: 'الصرف', receipt: 'إدخال المخزون', transfer: 'طلبات النقل والاعتماد', audit: 'سجل العمليات' };
  const prepare = async () => {
    const items = dbService.getAllItems();
    const docs = await dbService.getDocuments();
    if (['inventory','missing','unverified'].includes(kind)) {
      const selected = items.filter(item => kind === 'missing' ? item.is_missing === 1 || /^-\s*\d+$/.test(item.remark || '') : kind === 'unverified' ? item.status === 'غير مدقق' : true);
      setRows([['رقم القطعة','الوصف','الموقع','الإجمالي','المصروف','المتبقي','الحالة','الملاحظات'], ...selected.map(item => [item.part_number, `${item.description_ar}\n${item.description_en}`, item.location_code, String(item.qty_total), String(item.qty_out), String(item.qty_remaining), item.status, item.remark || ''])]);
    } else if (kind === 'audit') {
      const backup = JSON.parse(await dbService.exportBackup());
      setRows([['التاريخ','العملية','المستخدم','المستند','قبل','بعد'], ...backup.audit.map((entry: any) => [entry.at || '', entry.action || '', entry.actor || '', entry.documentId || '', JSON.stringify(entry.before || ''), JSON.stringify(entry.after || '')])]);
    } else {
      setRows([['المستند','مقدم الطلب','الحالة','القطعة','الكمية','الموقع القديم','الموقع المقترح','السبب','اعتماد المشرف','التنفيذ'], ...docs.filter(doc => doc.kind === kind).flatMap(doc => doc.lines.map(line => [doc.id, doc.requester, doc.status, line.part_number, String(line.quantity), line.old_location || '', line.location, doc.reason, doc.approvedBy || '', doc.executedAt || '']))]);
    }
  };
  return <details className="m-4 p-4 border border-amber-800 rounded-xl" dir="rtl"><summary>تقارير PDF</summary>
    <select className="bg-stone-800 p-2" value={kind} onChange={e => { setKind(e.target.value); setRows([]); }}>{Object.entries(titles).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select>
    <button className="p-2" onClick={() => prepare().catch(err => setMessage(String(err)))}>إعداد التقرير</button>
    {rows.length > 0 && <><button onClick={async () => { try { const result = await generateReportPdfBlob({ reportElementId: 'asmo-operation-report' }); const a = document.createElement('a'); a.href = result.downloadUrl; a.download = `${kind}-${Date.now()}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(result.downloadUrl), 1000); } catch (err) { setMessage(String(err)); } }}>تنزيل PDF</button>
      <div id="asmo-operation-report" style={{ background: 'white', color: '#111', padding: 24, overflowWrap: 'anywhere', fontFamily: 'sans-serif' }}><h1>ASMO — {titles[kind]}</h1><p>{new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })}</p><table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} style={{ whiteSpace: 'pre-line', border: '1px solid #999', padding: 5, fontWeight: i === 0 ? 'bold' : 'normal' }}>{cell}</td>)}</tr>)}</tbody></table></div>
    </>}
    <p role="status">{message}</p>
  </details>;
}
