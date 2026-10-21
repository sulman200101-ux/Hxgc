import React, { useState, useEffect } from 'react';
import { InventoryItem } from '../types';
import { sanitizeLocationCode } from '../utils/regexSanitizer';
import { MapPin, ArrowRightLeft, CheckCircle2, X, Sparkles, Building2 } from 'lucide-react';

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
  popularLocations = ['N02 FL1 2', 'K01 FL2 4', 'B01 RK2 1', 'N01 FL1 1', 'A02 RK1 3'],
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

  if (!isOpen || !item) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitizeLocationCode(newLocation.trim());
    if (!clean) {
      setError('يرجى إدخال كود الموقع الجديد بشكل صحيح');
      return;
    }

    if (clean === item.location_code) {
      setError('الموقع الجديد مطابق للموقع الحالي! يرجى اختيار موقع مختلف للنقل.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await onConfirm(item.part_number, clean);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء نقل الموقع');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-lg bg-[#241712] border-2 border-emerald-500/40 rounded-3xl shadow-2xl shadow-emerald-950/50 overflow-hidden text-right flex flex-col"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-emerald-950/70 via-[#2A1C16] to-[#241712] border-b border-emerald-500/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-400 shadow-md shadow-emerald-950/50">
              <ArrowRightLeft className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                نقل موقع القطعة 🟢
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                  Relocate Action
                </span>
              </h2>
              <p className="text-xs text-neutral-300">
                تحديث موقع التخزين في قاعدة البيانات وتسجيل تاريخ النقل
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Item Summary Card */}
        <div className="p-5 space-y-4">
          <div className="p-4 rounded-2xl bg-[#1C120E] border border-[#3D2820] space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-neutral-400">رقم القطعة:</span>
                <div className="text-lg font-mono font-bold text-amber-300 tracking-wider">
                  {item.part_number}
                </div>
              </div>

              {/* Status Badge */}
              <div className="text-left">
                <span className="text-xs text-neutral-400 block mb-1">الحالة الحالية:</span>
                {item.status === 'تم النقل' || item.is_moved === 1 ? (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1.5 shadow-sm">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    تم النقل 🟢
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                    لم تنتقل 🟠
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-white leading-tight">
                {item.description_ar || item.description_en}
              </div>
              <div className="text-xs font-mono text-neutral-400 mt-0.5" dir="ltr">
                {item.description_en}
              </div>
            </div>

            {/* Old / Current Location Banner */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#2D1D16] border border-amber-500/20">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-neutral-300">الموقع الحالي في المستودع:</span>
              </div>
              <span className="text-sm font-bold font-mono text-amber-300 px-3 py-0.5 rounded-lg bg-black/40 border border-amber-500/30">
                {item.location_code}
              </span>
            </div>

            {item.old_location && (
              <div className="text-[11px] text-neutral-400 flex items-center justify-between px-1">
                <span>الموقع الأولي السابق:</span>
                <span className="font-mono text-neutral-300">{item.old_location}</span>
              </div>
            )}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-emerald-300 mb-2 flex items-center gap-1.5">
                <Building2 className="w-4 h-4" />
                الموقع الجديد (New Storage Bin):
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={newLocation}
                  onChange={(e) => {
                    setNewLocation(e.target.value.toUpperCase());
                    setError('');
                  }}
                  placeholder="مثال: N02 FL1 2 أو K01 FL2 4 أو B01 RK2 1"
                  autoFocus
                  className="w-full px-4 py-3 rounded-2xl bg-[#190F0C] border-2 border-emerald-500/50 focus:border-emerald-400 focus:outline-none text-white text-base font-mono font-bold tracking-wider placeholder-neutral-500 transition-all shadow-inner"
                  dir="ltr"
                />
              </div>
              <p className="text-[11px] text-neutral-400 mt-1.5">
                سيتم فك ارتباط القطعة بالموقع القديم ({item.location_code}) وربطها بالموقع الجديد فوراً.
              </p>
            </div>

            {/* Quick Suggestions */}
            <div>
              <div className="text-[11px] text-neutral-400 mb-2 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                اقتراحات مواقع سريعة:
              </div>
              <div className="flex flex-wrap gap-2">
                {popularLocations
                  .filter((loc) => loc !== item.location_code)
                  .slice(0, 5)
                  .map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setNewLocation(loc)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border transition-all cursor-pointer ${
                        newLocation === loc
                          ? 'bg-emerald-600 text-white border-emerald-400 shadow-md'
                          : 'bg-[#2E1E18] text-amber-200 border-[#4D3429] hover:bg-[#3D2921]'
                      }`}
                    >
                      {loc}
                    </button>
                  ))}
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-950/80 border border-red-500/50 text-red-200 text-xs font-bold flex items-center gap-2">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-5 py-2.5 rounded-xl bg-[#2D1D16] hover:bg-[#3D2921] text-neutral-300 text-xs font-bold border border-[#4A3125] transition-colors cursor-pointer"
              >
                إلغاء
              </button>

              <button
                type="submit"
                disabled={isSubmitting || !newLocation.trim()}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/60 transition-all cursor-pointer border border-emerald-400/40"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isSubmitting ? 'جاري تحديث الموقع...' : 'تأكيد النقل إلى الموقع الجديد 🟢'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
