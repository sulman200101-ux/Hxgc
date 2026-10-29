import React, { useEffect, useState } from 'react';
import { pinSecurity } from '../services/security';
export function AuthorizationDialog() {
  const [action, setAction] = useState('');
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    const handler = (event: Event) => {
      setAction((event as CustomEvent).detail.action);
      setSetup(!pinSecurity.configured()); setPin(''); setConfirmation(''); setError('');
    };
    window.addEventListener('asmo-authorize-request', handler);
    return () => window.removeEventListener('asmo-authorize-request', handler);
  }, []);
  const finish = (approved: boolean) => { setAction(''); window.dispatchEvent(new CustomEvent('asmo-authorize-result', { detail: approved })); };
  if (!action) return null;
  return <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center" dir="rtl">
    <form className="bg-stone-900 text-white rounded-xl p-6 space-y-4 max-w-sm" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try {
        if (setup) {
          if (pin !== confirmation) throw new Error('تأكيد الرمز غير متطابق');
          await pinSecurity.setup(pin);
        } else if (!await pinSecurity.verify(pin)) throw new Error('الرمز غير صحيح');
        finish(true);
      } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    }}>
      <h2>{setup ? 'إعداد رمز المشرف لأول مرة' : 'اعتماد المشرف'} — {action}</h2>
      <p className="text-sm">هذا الجهاز يعمل بحساب مشرف محلي واحد. لا يثبت الرمز هوية مستخدمين متعددين.</p>
      <label className="block">الرمز <input autoFocus aria-label="الرمز" className="bg-stone-700 p-2" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required value={pin} onChange={e => setPin(e.target.value)} /></label>
      {setup && <label className="block">تأكيد الرمز <input aria-label="تأكيد الرمز" className="bg-stone-700 p-2" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}
      <p role="alert">{error}</p>
      <button disabled={busy} type="submit" className="p-2 bg-amber-700">{busy ? 'جارٍ التحقق' : 'اعتماد'}</button>
      <button disabled={busy} type="button" onClick={() => finish(false)} className="p-2">إلغاء</button>
    </form>
  </div>;
}
