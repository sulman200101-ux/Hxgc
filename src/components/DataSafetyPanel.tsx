import React, { useState } from 'react';
import { dbService } from '../services/db';
import { pinSecurity } from '../services/security';
export function DataSafetyPanel({ onRefresh }: { onRefresh: () => void }) {
  const [message, setMessage] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  return <details dir="rtl" className="m-4 p-3 border border-amber-800 rounded-xl">
    <summary>حماية البيانات والنسخ الاحتياطي</summary>
    <p>حساب مشرف محلي واحد. احتفظ بالنسخ خارج الجهاز. النسخة تتضمن بيانات المخزون وسجل العمليات ولا تتضمن الرمز.</p>
    <button className="p-2" onClick={async () => {
      try {
        const url = URL.createObjectURL(new Blob([await dbService.exportBackup()], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = `asmo-backup-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) { setMessage((e as Error).message); }
    }}>تنزيل نسخة احتياطية وسجل العمليات</button>
    <label>استعادة بالدمج (قد تستبدل سجلات بنفس الرقم)
      <input type="file" accept="application/json" onChange={async e => {
        const file = e.target.files?.[0]; if (!file) return;
        try { await dbService.restoreBackup(await file.text()); onRefresh(); setMessage('تم دمج المخزون؛ سجل العمليات الحالي محفوظ'); }
        catch (err) { setMessage((err as Error).message); }
        e.target.value = '';
      }} />
    </label>
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true);
      try {
        if (newPin !== confirmation) throw new Error('تأكيد الرمز غير متطابق');
        await pinSecurity.change(oldPin, newPin); setMessage('تم تغيير الرمز'); setOldPin(''); setNewPin(''); setConfirmation('');
      } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
    }}>
      <p>تغيير رمز المشرف</p>
      {([['الرمز الحالي', oldPin, setOldPin], ['الرمز الجديد', newPin, setNewPin], ['تأكيد الرمز', confirmation, setConfirmation]] as const).map(([label, value, setter]) => <label key={label} className="block">{label}<input className="bg-stone-800 m-2" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required value={value} onChange={e => setter(e.target.value)} /></label>)}
      <button disabled={busy}>تغيير الرمز بعد التحقق من الحالي</button>
    </form>
    <p role="status">{message}</p>
  </details>;
}
