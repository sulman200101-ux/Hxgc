import React, { useState } from 'react';
import { Trash2, ShieldAlert, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirmWipe: () => Promise<void>;
  totalItemsCount: number;
  totalLocationsCount: number;
}

export function WipeDatabaseModal({
  isOpen,
  onClose,
  onConfirmWipe,
  totalItemsCount,
  totalLocationsCount,
}: Props) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="مسح شامل للبرنامج"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      dir="rtl"
    >
      <div className="bg-[#241712] border-2 border-red-600/60 p-6 rounded-2xl text-white max-w-md w-full space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-red-900/40 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-red-950 border border-red-500/50 flex items-center justify-center text-red-400">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-black text-base sm:text-lg text-white">
                مسح شامل للبرنامج وتصفير البيانات
              </h2>
              <p className="text-xs text-red-300">
                حذف جميع القطع ({totalItemsCount}) والمواقع ({totalLocationsCount}) والمستندات
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-neutral-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800/50 text-xs text-neutral-200 space-y-1.5 leading-relaxed">
          <p className="font-bold text-red-200 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
            <span>تنبيه المسح الشامل:</span>
          </p>
          <p>
            سيتم مسح جميع القطع والمواقع وأوراق الجرد وطلبات النقل من البرنامج بالكامل ولن يبقى فيه أي سجل سابق، وذلك بعد إدخال رمز اعتماد المشرف.
          </p>
        </div>

        {error && (
          <p role="alert" className="p-2.5 rounded-xl bg-red-950 border border-red-500 text-red-200 text-xs font-bold">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-neutral-200 text-xs font-bold cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onConfirmWipe();
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="px-5 py-2.5 rounded-xl bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-black flex items-center gap-2 cursor-pointer shadow-lg"
          >
            <Trash2 className="w-4 h-4" />
            <span>{busy ? 'جارٍ المسح الشامل...' : 'طلب الاعتماد وتنفيذ المسح الشامل'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
