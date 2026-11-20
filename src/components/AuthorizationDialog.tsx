import React, { useEffect, useState } from 'react';
import { pinSecurity, normalizePinDigits, resetPendingAuthorization } from '../services/security';
import { ShieldAlert, Lock, CheckCircle2, X } from 'lucide-react';

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="إدخال الرقم السري لتأكيد المسح"
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      dir="rtl"
    >
      <form
        className="bg-[#231611] text-white rounded-2xl p-6 space-y-4 max-w-sm w-full border-2 border-red-600/70 shadow-2xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const cleanPin = normalizePinDigits(pin);
            const cleanConf = normalizePinDigits(confirmation);
            if (!/^\d{4}$/.test(cleanPin)) {
              throw new Error('يرجى إدخال رقم سري مكون من 4 أرقام');
            }
            if (setup) {
              if (cleanPin !== cleanConf) throw new Error('تأكيد الرقم السري غير متطابق');
              await pinSecurity.setup(cleanPin);
            } else if (!(await pinSecurity.verify(cleanPin))) {
              throw new Error('الرقم السري غير صحيح — تم منع المسح لحماية البيانات');
            }
            finish(true);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-start justify-between gap-2 border-b border-red-900/50 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-red-950 border border-red-500/60 flex items-center justify-center text-red-400 shrink-0">
              {setup ? <Lock className="w-5 h-5 text-amber-400" /> : <ShieldAlert className="w-5 h-5 text-red-400" />}
            </div>
            <div>
              <h2 className="font-black text-sm sm:text-base text-amber-300">
                {setup ? 'تعيين رقم سري لمنع المسح (لأول مرة)' : '🔒 حماية البيانات من المسح'}
              </h2>
              <p className="text-xs text-red-200 font-bold mt-0.5">
                العملية المطلوبة: {action}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => finish(false)}
            className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-neutral-300 cursor-pointer"
            title="إلغاء"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-neutral-300 leading-relaxed bg-red-950/30 border border-red-800/40 rounded-xl p-2.5">
          {setup
            ? 'لمنع فقدان أي بيانات عن طريق الخطأ، اختر رقماً سرياً من 4 أرقام. سيُطلب هذا الرقم قبل أي عملية مسح أو حذف مستقبلاً (الحفظ يتم فوراً بدون رقم سري).'
            : 'هذه العملية تؤدي إلى مسح بيانات. يُرجى إدخال الرقم السري المكون من 4 أرقام لتأكيد المسح، أو اضغط إلغاء للحفاظ على البيانات.'}
        </p>

        <label className="block text-xs font-bold space-y-1.5">
          <span className="text-amber-200">الرمز (4 أرقام)</span>
          <input
            autoFocus
            aria-label="الرمز"
            placeholder="••••"
            className="bg-[#160E0B] border-2 border-amber-600/60 focus:border-amber-400 rounded-xl p-2.5 w-full text-center font-mono text-xl tracking-[0.5em] text-white outline-none"
            type="password"
            inputMode="numeric"
            maxLength={4}
            required
            value={pin}
            onChange={(e) => setPin(normalizePinDigits(e.target.value))}
          />
        </label>

        {setup && (
          <label className="block text-xs font-bold space-y-1.5">
            <span className="text-amber-200">تأكيد الرمز (4 أرقام)</span>
            <input
              aria-label="تأكيد الرمز"
              placeholder="••••"
              className="bg-[#160E0B] border-2 border-amber-600/60 focus:border-amber-400 rounded-xl p-2.5 w-full text-center font-mono text-xl tracking-[0.5em] text-white outline-none"
              type="password"
              inputMode="numeric"
              maxLength={4}
              required
              value={confirmation}
              onChange={(e) => setConfirmation(normalizePinDigits(e.target.value))}
            />
          </label>
        )}

        {error && (
          <p role="alert" className="p-2.5 rounded-xl bg-red-950 border border-red-500 text-red-200 text-xs font-bold text-center">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2.5 pt-1">
          <button
            disabled={busy}
            type="submit"
            className="flex-1 py-2.5 px-4 rounded-xl bg-red-700 hover:bg-red-600 disabled:opacity-50 font-black text-xs text-white cursor-pointer flex items-center justify-center gap-1.5 shadow-lg"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{busy ? 'جارٍ التحقق...' : setup ? 'حفظ الرقم السري وتأكيد المسح' : 'تأكيد الرقم السري وتنفيذ المسح'}</span>
          </button>
          <button
            disabled={busy}
            type="button"
            onClick={() => finish(false)}
            className="py-2.5 px-4 rounded-xl bg-stone-800 hover:bg-stone-700 font-bold text-xs text-neutral-200 cursor-pointer"
          >
            إلغاء وحفظ البيانات
          </button>
        </div>
      </form>
    </div>
  );
}

