import React, { useState } from 'react';
import { dbService } from '../services/db';
import { pinSecurity, normalizePinDigits } from '../services/security';

export function DataSafetyPanel({ onRefresh }: { onRefresh: () => void }) {
  const [message, setMessage] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [sapBatchText, setSapBatchText] = useState('');
  const [busy, setBusy] = useState(false);
  const [isConfigured, setIsConfigured] = useState(() => pinSecurity.configured());

  return (
    <details dir="rtl" className="m-4 p-4 border border-amber-800 rounded-xl bg-[#1E1410] space-y-3">
      <summary className="font-bold text-amber-300 cursor-pointer">
        🔒 حماية البيانات من المسح والنسخ الاحتياطي واستيراد الدفعات النصية
      </summary>
      <p className="text-xs text-neutral-300 mt-2">
        يُطلب الرقم السري (4 أرقام) حصرياً لمنع أي عملية مسح أو حذف (حذف قطعة، حذف موقع، حذف ورقة، أو مسح شامل)، بينما يتم حفظ القراءة والإضافة فوراً بدون رقم سري.
      </p>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          className="px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold cursor-pointer"
          onClick={async () => {
            try {
              const url = URL.createObjectURL(
                new Blob([await dbService.exportBackup()], { type: 'application/json' })
              );
              const a = document.createElement('a');
              a.href = url;
              a.download = `asmo-backup-${Date.now()}.json`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          تنزيل نسخة احتياطية وسجل العمليات
        </button>

        <label className="text-xs text-neutral-200 font-bold">
          استعادة بالدمج (دون حذف المخزون الحالي){' '}
          <input
            type="file"
            accept="application/json"
            className="text-xs mr-2"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                await dbService.restoreBackup(await file.text());
                onRefresh();
                setMessage('تم دمج المخزون؛ سجل العمليات الحالي محفوظ');
              } catch (err) {
                setMessage((err as Error).message);
              }
              e.target.value = '';
            }}
          />
        </label>
      </div>

      <div className="border-t border-amber-900/50 pt-3 space-y-2 text-xs">
        <p className="font-bold text-amber-200">
          📋 استيراد نص أو جدول SAP مباشرة إلى قاعدة البيانات (بدون حفظ في الكود)
        </p>
        <textarea
          rows={4}
          dir="ltr"
          value={sapBatchText}
          onChange={(e) => setSapBatchText(e.target.value)}
          placeholder="ألصق هنا أسطر أوراق الجرد بصيغة SAP (| Material | Plant | Area | Storage Bin | ...)"
          className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-[11px] font-mono text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-amber-500"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || !sapBatchText.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await dbService.importSapBatchText(sapBatchText);
                if (res.total === 0) {
                  setMessage('لم يتم العثور على سطور قطع صالحة في النص الملصق.');
                } else {
                  onRefresh();
                  setSapBatchText('');
                  setMessage(
                    `✅ تم حفظ ${res.total} قطعة فريدة (من ${res.stats.rawRowsParsed} سطر في ${res.stats.sheetsDetected} ورقة) في قاعدة البيانات المباشرة.`
                  );
                }
              } catch (err) {
                setMessage((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold cursor-pointer"
          >
            استيراد وحفظ الدفعة في القاعدة مباشرة
          </button>
        </div>
      </div>

      <form
        className="border-t border-amber-900/50 pt-3 space-y-2 text-xs"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const cleanNew = normalizePinDigits(newPin);
            const cleanConf = normalizePinDigits(confirmation);
            if (!/^\d{4}$/.test(cleanNew)) throw new Error('الرقم السري يجب أن يتكون من 4 أرقام');
            if (cleanNew !== cleanConf) throw new Error('تأكيد الرمز غير متطابق');
            if (isConfigured) {
              await pinSecurity.change(normalizePinDigits(oldPin), cleanNew);
              setMessage('✅ تم تغيير الرقم السري لحماية البيانات من المسح');
            } else {
              await pinSecurity.setup(cleanNew);
              setIsConfigured(true);
              setMessage('✅ تم تفعيل الرقم السري لحماية البيانات من المسح');
            }
            setOldPin('');
            setNewPin('');
            setConfirmation('');
          } catch (err) {
            setMessage((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="font-bold text-amber-200">
          {isConfigured ? 'تغيير الرقم السري لمنع المسح (4 أرقام)' : 'إعداد الرقم السري لمنع المسح لأول مرة (4 أرقام)'}
        </p>
        {isConfigured && (
          <label className="block">
            الرمز الحالي
            <input
              className="bg-stone-800 border border-stone-600 rounded px-2 py-1 m-2 font-mono text-center w-28"
              type="password"
              inputMode="numeric"
              maxLength={4}
              required
              value={oldPin}
              onChange={(e) => setOldPin(normalizePinDigits(e.target.value))}
            />
          </label>
        )}
        <label className="block">
          الرمز الجديد
          <input
            className="bg-stone-800 border border-stone-600 rounded px-2 py-1 m-2 font-mono text-center w-28"
            type="password"
            inputMode="numeric"
            maxLength={4}
            required
            value={newPin}
            onChange={(e) => setNewPin(normalizePinDigits(e.target.value))}
          />
        </label>
        <label className="block">
          تأكيد الرمز
          <input
            className="bg-stone-800 border border-stone-600 rounded px-2 py-1 m-2 font-mono text-center w-28"
            type="password"
            inputMode="numeric"
            maxLength={4}
            required
            value={confirmation}
            onChange={(e) => setConfirmation(normalizePinDigits(e.target.value))}
          />
        </label>
        <button
          disabled={busy}
          className="px-4 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold cursor-pointer"
        >
          {isConfigured ? 'تغيير الرمز بعد التحقق من الحالي' : 'حفظ وتفعيل الرقم السري لمنع المسح'}
        </button>
      </form>
      <p role="status" className="text-amber-300 font-bold text-xs">
        {message}
      </p>
    </details>
  );
}

