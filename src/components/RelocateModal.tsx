import React, { useState, useEffect, useMemo } from 'react';
import { InventoryItem } from '../types';
import { sanitizeLocationCode, isValidSpecificLocation } from '../utils/regexSanitizer';
import { getAdjacentStorageBins } from '../services/transferSuggestions';
import { MapPin, ArrowRightLeft, CheckCircle2, X } from 'lucide-react';

interface RelocateModalProps {
  isOpen: boolean;
  item: InventoryItem | null;
  onClose: () => void;
  onConfirm: (partNumber: string, newLocation: string) => Promise<void>;
  popularLocations?: string[];
}

export const RelocateModal: React.FC<RelocateModalProps> = ({
  isOpen,
  item,
  onClose,
  onConfirm,
  popularLocations = [],
}) => {
  const [newLocation, setNewLocation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (item) {
      setNewLocation('');
      setError('');
    }
  }, [item, isOpen]);

  const suggestedBins = useMemo(() => {
    if (!item) return [];
    const adjacent = getAdjacentStorageBins(item.location_code, popularLocations, 6);
    return adjacent.filter((loc) => loc !== item.location_code);
  }, [item, popularLocations]);

  if (!isOpen || !item) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitizeLocationCode(newLocation.trim()) || newLocation.trim().toUpperCase();
    if (!clean || !isValidSpecificLocation(clean)) {
      setError('يرجى إدخال رمز الموقع الجديد بشكل صحيح (مثل N11C2 أو N12A1)');
      return;
    }

    if (clean === item.location_code) {
      setError('الموقع الجديد مطابق للموقع الحالي؛ اختر موقعاً جديداً مختلفاً');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await onConfirm(item.part_number, clean);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'تعذر نقل القطعة؛ تأكد من اعتماد المشرف');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="نقل القطعة لموقع جديد"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
      dir="rtl"
    >
      <div className="w-full max-w-md bg-[#241712] border-2 border-emerald-500/50 rounded-2xl shadow-2xl overflow-hidden text-right">
        {/* ترويسة مبسطة */}
        <div className="p-4 bg-[#1C120E] border-b border-emerald-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-white">نقل القطعة إلى موقع جديد 🟢</h2>
              <p className="text-xs text-neutral-300">
                تنتقل القطعة فوراً لموقعها الجديد بعد اعتماد المشرف
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-neutral-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* بيانات القطعة باختصار ووضوح */}
          <div className="p-3.5 rounded-xl bg-[#19100C] border border-[#3D2820] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono font-black text-base text-amber-300">
                رقم القطعة: {item.part_number}
              </span>
              <span className="text-xs font-mono text-emerald-400 font-bold">
                الكمية: {item.qty_remaining}
              </span>
            </div>
            <p className="text-xs font-bold text-white">
              {item.description_ar || item.description_en}
            </p>
          </div>

          {/* مسار النقل الواضح: من -> إلى */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center bg-[#1C120E] p-3.5 rounded-xl border border-[#3D2820]">
            <div>
              <span className="text-xs text-neutral-400 block mb-1">من الموقع الحالي:</span>
              <div className="px-3 py-2.5 rounded-xl bg-stone-900 border border-amber-600/40 text-amber-300 font-mono font-black text-sm flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{item.location_code}</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-emerald-300 block mb-1">
                إلى الموقع الجديد:
              </label>
              <input
                type="text"
                value={newLocation}
                onChange={(e) => {
                  setNewLocation(e.target.value.toUpperCase());
                  setError('');
                }}
                placeholder="مثال: N11FL2"
                autoFocus
                required
                dir="ltr"
                className="w-full px-3 py-2.5 rounded-xl bg-[#120B09] border-2 border-emerald-500/60 focus:border-emerald-400 focus:outline-none text-white font-mono font-black text-sm text-center"
              />
            </div>
          </div>

          {/* مواقع مقترحة متقاربة بضغطة واحدة */}
          {suggestedBins.length > 0 && (
            <div>
              <span className="text-xs text-neutral-300 font-bold block mb-1.5">
                أو اختر موقعاً متقارباً بضغطة واحدة:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {suggestedBins.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => {
                      setNewLocation(loc);
                      setError('');
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition-all cursor-pointer ${
                      newLocation === loc
                        ? 'bg-emerald-600 text-white border-emerald-400 shadow'
                        : 'bg-[#2E1E18] text-amber-200 border-[#4D3429] hover:bg-[#3D2921]'
                    }`}
                  >
                    {loc}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="p-2.5 rounded-xl bg-red-950 border border-red-500 text-red-200 text-xs font-bold">
              ⚠️ {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#3D2820]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-neutral-300 text-xs font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !newLocation.trim()}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-lg cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {isSubmitting ? 'جارٍ الاعتماد والنقل...' : 'اعتماد ونقل القطعة للموقع الجديد 🟢'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
