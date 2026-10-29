import React, { useEffect, useState } from 'react';
import { pinSecurity, resetPendingAuthorization } from '../services/security';

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
      setSetup(!pinSecurity.configured());
      setPin('');
      setConfirmation('');
      setError('');
    };
    window.addEventListener('asmo-authorize-request', handler);
    return () => {
      window.removeEventListener('asmo-authorize-request', handler);
      resetPendingAuthorization();
    };
  }, []);

  const finish = (approved: boolean) => {
    setAction('');
    window.dispatchEvent(new CustomEvent('asmo-authorize-result', { detail: approved }));
  };

  if (!action) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" dir="rtl">
      <form
        className="bg-stone-900 text-white rounded-2xl p-6 space-y-4 max-w-sm w-full border border-amber-700/50 shadow-2xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            if (setup) {
              if (pin !== confirmation) throw new Error('تأكيد الرمز غير متطابق');
              await pinSecurity.setup(pin);
            } else if (!(await pinSecurity.verify(pin))) {
              throw new Error('الرمز غير صحيح');
            }
            finish(true);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="font-bold text-base text-amber-300">
          {setup ? 'إعداد رمز المشرف لأول مرة' : 'اعتماد المشرف'} — {action}
        </h2>
        <p className="text-xs text-neutral-300">
          هذا الجهاز يعمل بحساب مشرف محلي واحد (4 أرقام). لا يثبت الرمز هوية مستخدمين متعددين.
        </p>
        <label className="block text-xs font-bold space-y-1">
          <span>الرمز</span>
          <input
            autoFocus
            aria-label="الرمز"
            className="bg-stone-800 border border-stone-600 rounded-lg p-2 w-full text-center font-mono text-lg tracking-widest"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            required
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </label>
        {setup && (
          <label className="block text-xs font-bold space-y-1">
            <span>تأكيد الرمز</span>
            <input
              aria-label="تأكيد الرمز"
              className="bg-stone-800 border border-stone-600 rounded-lg p-2 w-full text-center font-mono text-lg tracking-widest"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
        )}
        <p role="alert" className="text-red-400 text-xs font-bold">
          {error}
        </p>
        <div className="flex items-center gap-2 pt-1">
          <button
            disabled={busy}
            type="submit"
            className="flex-1 py-2 px-4 rounded-xl bg-amber-700 hover:bg-amber-600 font-bold text-xs cursor-pointer"
          >
            {busy ? 'جارٍ التحقق' : 'اعتماد'}
          </button>
          <button
            disabled={busy}
            type="button"
            onClick={() => finish(false)}
            className="py-2 px-4 rounded-xl bg-stone-800 hover:bg-stone-700 font-bold text-xs cursor-pointer"
          >
            إلغاء
          </button>
        </div>
      </form>
    </div>
  );
}
