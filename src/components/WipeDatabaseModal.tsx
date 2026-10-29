import React, { useState } from 'react';
interface Props { isOpen: boolean; onClose: () => void; onConfirmWipe: () => Promise<void>; totalItemsCount: number; totalLocationsCount: number; }
export function WipeDatabaseModal({ isOpen, onClose, onConfirmWipe, totalItemsCount }: Props) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!isOpen) return null;
  return <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center" dir="rtl"><div className="bg-stone-900 p-6 rounded-xl text-white space-y-4">
    <h2>مسح {totalItemsCount} قطعة</h2><p>احفظ نسخة احتياطية أولًا. يبقى سجل التدقيق محفوظًا.</p>
    <p role="alert">{error}</p><button disabled={busy} onClick={async () => { setBusy(true); try { await onConfirmWipe(); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>متابعة إلى اعتماد المشرف</button>
    <button disabled={busy} onClick={onClose}>إلغاء</button>
  </div></div>;
}
