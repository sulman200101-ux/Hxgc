import React, { useState } from 'react';
import { dbService } from '../services/db';
import { pinSecurity, normalizePinDigits } from '../services/security';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

export function DataSafetyPanel({ onRefresh }: { onRefresh: () => void }) {
  const [message, setMessage] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [isConfigured, setIsConfigured] = useState(() => pinSecurity.configured());
  const [autoBackupInfo, setAutoBackupInfo] = useState(() => dbService.hasAutoEmergencyBackup());

  const triggerBrowserDownload = (jsonText: string, fileName: string) => {
    const url = URL.createObjectURL(
      new Blob([jsonText], { type: 'application/json;charset=utf-8' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <details open dir="rtl" className="m-4 p-4 border border-amber-800 rounded-xl bg-[#1E1410] space-y-3">
      <summary className="font-bold text-amber-300 cursor-pointer">
        🔒 حفظ واستعادة البيانات والنسخ الاحتياطي الشامل (JSON / Excel CSV)
      </summary>
      <p className="text-xs text-neutral-300 mt-2">
        يمكنك حفظ نسخة احتياطية كاملة (تشمل كافة القطع والمواقع وقائمة قين وسجل تقارير النقل اليومية تقرير 1، تقرير 2...) أو استيراد ملف نسخة احتياطية JSON أو ملف Excel CSV دون فقدان أي بيانات.
      </p>
      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <button
          type="button"
          className="px-4 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold cursor-pointer shadow"
          onClick={async () => {
            try {
              setMessage('⏳ جاري تجهيز النسخة الاحتياطية الكاملة...');
              const jsonText = await dbService.exportBackup();
              const fileName = `asmo-backup-${new Date().toISOString().split('T')[0]}.json`;
              if (Capacitor.isNativePlatform()) {
                try {
                  await Filesystem.writeFile({
                    path: fileName,
                    data: jsonText,
                    directory: Directory.Documents,
                    encoding: Encoding.UTF8,
                  });
                } catch {
                  // ignore if Documents dir requires extra permission
                }
                const saved = await Filesystem.writeFile({
                  path: fileName,
                  data: jsonText,
                  directory: Directory.Cache,
                  encoding: Encoding.UTF8,
                });
                await Share.share({
                  title: 'نسخة احتياطية كاملة لبيانات جرد وتقارير ASMO',
                  text: 'نسخة احتياطية شاملة لكافة القطع والمواقع وقائمة قين وتقارير النقل في تطبيق أسمو',
                  url: saved.uri,
                  dialogTitle: 'حفظ أو مشاركة النسخة الاحتياطية...',
                });
                setMessage('✅ تم حفظ ومشاركة النسخة الاحتياطية الكاملة بنجاح');
              } else {
                triggerBrowserDownload(jsonText, fileName);
                setMessage('✅ تم تنزيل النسخة الاحتياطية الكاملة بنجاح');
              }
              setAutoBackupInfo(dbService.hasAutoEmergencyBackup());
            } catch (e) {
              try {
                const jsonText = await dbService.exportBackup();
                const fileName = `asmo-backup-${new Date().toISOString().split('T')[0]}.json`;
                triggerBrowserDownload(jsonText, fileName);
                setMessage('✅ تم تنزيل النسخة الاحتياطية مباشرة على الجهاز');
              } catch (innerErr) {
                setMessage(`⚠️ ${(innerErr as Error).message || (e as Error).message}`);
              }
            }
          }}
        >
          حفظ ومشاركة نسخة احتياطية كاملة (JSON) 💾
        </button>

        <button
          type="button"
          className="px-3.5 py-2.5 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-amber-200 border border-amber-700/60 text-xs font-bold cursor-pointer"
          onClick={async () => {
            try {
              const jsonText = await dbService.exportBackup();
              await navigator.clipboard.writeText(jsonText);
              setMessage('✅ تم نسخ النسخة الاحتياطية الكاملة للحافظة — يمكنك حفظها أو إرسالها في أي مكان');
            } catch (err) {
              setMessage(`⚠️ ${(err as Error).message || 'تعذر النسخ للحافظة'}`);
            }
          }}
        >
          نسخ النسخة الاحتياطية للحافظة 📋
        </button>

        <label className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold cursor-pointer inline-flex items-center gap-2 shadow">
          <span>استعادة / استيراد ملف نسخة احتياطية (JSON أو CSV) 📂</span>
          <input
            type="file"
            accept="*/*,.json,.csv,.txt,application/json,text/csv,text/plain"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setMessage('⏳ جاري قراءة واستعادة البيانات من الملف...');
                const text = await file.text();
                await dbService.restoreBackup(text);
                onRefresh();
                setAutoBackupInfo(dbService.hasAutoEmergencyBackup());
                setMessage('✅ تم استيراد ودمج كافة البيانات وقائمة قين وتقارير النقل بنجاح دون فقد أي بيانات');
              } catch (err) {
                setMessage(`⚠️ ${(err as Error).message}`);
              }
              e.target.value = '';
            }}
          />
        </label>

        {autoBackupInfo.exists && (
          <button
            type="button"
            className="px-3.5 py-2.5 rounded-xl bg-blue-900/80 hover:bg-blue-800 text-blue-100 border border-blue-500/50 text-xs font-bold cursor-pointer"
            onClick={async () => {
              try {
                const count = await dbService.restoreFromAutoEmergencyBackup();
                onRefresh();
                setMessage(`✅ تمت استعادة (${count}) قطعة وتقارير النقل من النسخة التلقائية المحفوظة بالذاكرة`);
              } catch (err) {
                setMessage(`⚠️ ${(err as Error).message}`);
              }
            }}
          >
            استعادة سريعة من النسخة التلقائية ({autoBackupInfo.itemCount} قطعة) 🔄
          </button>
        )}
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

