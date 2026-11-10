import { suggestTechnicalTranslation, suggestModelTranslation } from '../services/partTranslation';
import React, { useState, useEffect, useMemo } from 'react';
import { InventoryItem } from '../types';
import { categorizeAndTranslate } from '../utils/translator';
import {
  analyzePartsWithGeminiAssistant,
  computeLocalPartEngineeringAnalysis,
} from '../services/transferSuggestions';
import {
  strict10DigitRegexFilter,
  sanitizeQuantity,
  sanitizeDescription,
  sanitizeLocationCode,
  isValidSpecificLocation,
} from '../utils/regexSanitizer';
import { X, Save, Package, Sparkles, ArrowRightLeft, AlertTriangle, Ruler, Scale, MapPin } from 'lucide-react';

interface ItemModalProps {
  isOpen: boolean;
  item: InventoryItem | null;
  onClose: () => void;
  onSave: (itemData: {
    part_number: string;
    location_code: string;
    description_en: string;
    description_ar: string;
    category: string;
    qty_total: number;
    qty_out: number;
    status: InventoryItem['status'];
    gin_code?: string;
  }) => Promise<void>;
  onOpenRelocate?: (item: InventoryItem) => void;
}

export const ItemModal: React.FC<ItemModalProps> = ({
  isOpen,
  item,
  onClose,
  onSave,
  onOpenRelocate,
}) => {
  const [partNumber, setPartNumber] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [descEn, setDescEn] = useState('');
  const [descAr, setDescAr] = useState('');
  const [category, setCategory] = useState('مسامير وروابط');
  const [qtyTotal, setQtyTotal] = useState(1);
  const [qtyOut, setQtyOut] = useState(0);
  const [status, setStatus] = useState<InventoryItem['status']>('غير مدقق');
  const [useGin, setUseGin] = useState<boolean>(false);
  const [ginCode, setGinCode] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setValidationError(null);
    if (item) {
      setPartNumber(item.part_number);
      setLocationCode(item.location_code === 'عام' ? '' : item.location_code);
      setDescEn(item.description_en);
      setDescAr(item.description_ar);
      setCategory(item.category === 'عام' ? 'قطع ميكانيكية متنوعة' : item.category);
      setQtyTotal(item.qty_total);
      setQtyOut(item.qty_out);
      setStatus(item.is_missing === 1 ? 'غير موجودة' : item.status);
      const hasGin = Boolean(item.gin_code && item.gin_code.trim());
      setUseGin(hasGin);
      setGinCode(item.gin_code && item.gin_code !== 'قين' ? item.gin_code : '');
    } else {
      setPartNumber('');
      setLocationCode('');
      setDescEn('');
      setDescAr('');
      setCategory('قطع ميكانيكية متنوعة');
      setQtyTotal(1);
      setQtyOut(0);
      setStatus('غير مدقق');
      setUseGin(false);
      setGinCode('');
    }
  }, [item, isOpen]);

  const liveAnalysis = useMemo(() => {
    if (!descEn.trim()) return null;
    return computeLocalPartEngineeringAnalysis({
      part_number: partNumber || '1000000000',
      description_en: descEn,
      description_ar: descAr,
      location_code: locationCode || 'N11A1',
      qty_remaining: Math.max(1, qtyTotal - qtyOut),
    });
  }, [descEn, descAr, locationCode, partNumber, qtyTotal, qtyOut]);

  if (!isOpen) return null;

  const handleDescEnChange = (val: string) => {
    setDescEn(val);
    if (val.trim()) {
      const { category: cat, descAr: ar } = categorizeAndTranslate(val);
      setCategory(cat);
      setDescAr(ar);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const cleanPart = strict10DigitRegexFilter(partNumber);
    if (!cleanPart) {
      setValidationError('يجب أن يتكون رقم القطعة من 10 أرقام كاملة بالضبط (مثل 1001023714) — يمنع نسخ أرقام ناقصة');
      return;
    }

    const fallbackLoc = liveAnalysis?.recommended_bin || 'N01A1';
    const rawLoc = locationCode.trim() ? locationCode : fallbackLoc;
    const cleanLoc = sanitizeLocationCode(rawLoc) || fallbackLoc;
    if (!isValidSpecificLocation(cleanLoc)) {
      setValidationError('يجب إدخال اسم موقع محدد وفعلي (مثل N11C2 أو N06C1) — يمنع إدخال موقع "عام"');
      return;
    }

    setIsSubmitting(true);
    const { cleaned: cleanDescEn } = sanitizeDescription(descEn);
    const cleanQtyTotal = sanitizeQuantity(qtyTotal, 1);
    const cleanQtyOut = sanitizeQuantity(qtyOut, 0);
    const finalGinValue = useGin ? (ginCode.trim() || 'قين') : '';

    try {
      await onSave({
        part_number: cleanPart,
        location_code: cleanLoc,
        description_en: cleanDescEn,
        description_ar: descAr.trim() || cleanDescEn,
        category,
        qty_total: cleanQtyTotal,
        qty_out: cleanQtyOut,
        status,
        gin_code: finalGinValue,
      });
      onClose();
    } catch (err) {
      setValidationError((err as Error).message || 'تعذر حفظ التعديلات');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-[#2C1E18] border border-[#52382D] w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 bg-[#231713] border-b border-[#3D271F] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-base text-white">
              {item && item.part_number
                ? 'تعديل تفاصيل القطعة'
                : item && item.location_code
                ? `إضافة مادة جديدة مع القطع في الموقع (${item.location_code})`
                : 'إضافة قطعة غيار جديدة (10 أرقام)'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-neutral-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          {validationError && (
            <div className="p-2.5 rounded-xl bg-red-950/90 border border-red-500 text-red-200 font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* خيار (قين) عند الإضافة اليدوية */}
          <div className="p-3 rounded-xl bg-[#1F1511] border border-purple-600/60 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <span className="font-black text-purple-200 text-xs block">
                  إشارة (🔖 قين) في بطاقة القطعة داخل نفس الموقع:
                </span>
                <span className="text-[10px] text-neutral-400">
                  تُحفظ المادة مع القطع في نفس الموقع دائماً، وعند اختيار (قين) توضع إشارة قين على بطاقتها
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setUseGin(true)}
                  className={`px-3 py-1.5 rounded-lg font-black text-[11px] transition-all cursor-pointer border ${
                    useGin
                      ? 'bg-purple-600 text-white border-purple-300 shadow-md'
                      : 'bg-[#2C1E18] text-purple-200 border-purple-800 hover:bg-purple-950'
                  }`}
                >
                  🔖 وضع إشارة (قين)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUseGin(false);
                    setGinCode('');
                  }}
                  className={`px-3 py-1.5 rounded-lg font-black text-[11px] transition-all cursor-pointer border ${
                    !useGin
                      ? 'bg-amber-600 text-white border-amber-300 shadow-md'
                      : 'bg-[#2C1E18] text-neutral-300 border-[#4A342B] hover:bg-[#3A271F]'
                  }`}
                >
                  تجاهل (قين) — تضاف كما في السابق
                </button>
              </div>
            </div>

            {useGin && (
              <div className="pt-1">
                <input
                  type="text"
                  value={ginCode}
                  onChange={(e) => setGinCode(e.target.value)}
                  placeholder="بيان أو رقم قين (اختياري — اتركه فارغاً لتظهر إشارة 🔖 قين على بطاقة القطعة)"
                  className="w-full px-3 py-2 rounded-xl bg-[#140D0A] border border-purple-500/60 text-purple-200 font-bold focus:outline-none focus:border-purple-400"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Part Number */}
            <div>
              <label className="block text-neutral-300 font-semibold mb-1">
                رقم القطعة (10 أرقام - Material)
              </label>
              <input
                type="text"
                maxLength={10}
                value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)}
                required
                placeholder="1001023714"
                className="w-full px-3 py-2 rounded-xl bg-[#1F1511] border border-[#4A342B] text-amber-300 font-mono font-bold focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Location Code */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-neutral-300 font-semibold">اسم الموقع (Storage Bin)</label>
                {item && onOpenRelocate && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenRelocate(item);
                    }}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1 cursor-pointer bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-500/40"
                  >
                    <ArrowRightLeft className="w-3 h-3" />
                    <span>نقل الموقع 🟢</span>
                  </button>
                )}
              </div>
              <input
                type="text"
                value={locationCode}
                onChange={(e) => setLocationCode(e.target.value)}
                placeholder="N11C2 أو N06C1 (تلقائي عند الترك)"
                className="w-full px-3 py-2 rounded-xl bg-[#1F1511] border border-[#4A342B] text-neutral-100 font-mono font-bold focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <fieldset className="border border-amber-900 rounded-xl p-3 space-y-2">
            <legend>اسم القطعة</legend>
          {/* Description AR */}
          <div>
            <label className="block text-neutral-300 font-semibold mb-1">
              اسم ووصف القطعة بالعربية
            </label>
            <input
              type="text"
              value={descAr}
              onChange={(e) => setDescAr(e.target.value)}
              placeholder="جازكيت حلزوني مدعم 3 بوصة..."
              className="w-full px-3 py-2 rounded-xl bg-[#1F1511] border border-[#4A342B] text-neutral-100 font-bold focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Description EN */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-neutral-300 font-semibold">
                الوصف باللغة الإنجليزية (Material Description)
              </label>
              <span className="text-[10px] text-amber-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> تعريب وتصنيف تلقائي
              </span>
            </div>
            <input
              type="text"
              value={descEn}
              onChange={(e) => handleDescEnChange(e.target.value)}
              placeholder="e.g. GASKET SPIRAL WOUND 3 INCH 150#"
              dir="ltr"
              className="w-full px-3 py-2 rounded-xl bg-[#1F1511] border border-[#4A342B] text-neutral-100 font-sans focus:outline-none focus:border-amber-500"
            />
          </div>

          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDescAr(suggestTechnicalTranslation(descEn).arabic)}
              className="px-3 py-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-amber-200 font-bold border border-[#52382D] cursor-pointer"
            >
              ترجمة بالقاموس الصناعي
            </button>
            <button
              type="button"
              disabled={isSubmitting || !descEn.trim()}
              onClick={async () => {
                setIsSubmitting(true);
                try {
                  const aiRes = await analyzePartsWithGeminiAssistant([
                    {
                      part_number: partNumber || '1000000000',
                      description_en: descEn,
                      location_code: locationCode || 'N11A1',
                      qty_remaining: Math.max(1, qtyTotal - qtyOut),
                    },
                  ]);
                  if (aiRes.length > 0) {
                    setDescAr(aiRes[0].description_ar);
                    if (aiRes[0].recommended_bin) {
                      setLocationCode(aiRes[0].recommended_bin);
                    }
                  } else {
                    const result = await suggestModelTranslation(descEn);
                    setDescAr(result.arabic);
                  }
                } catch (err) {
                  setValidationError((err as Error).message);
                } finally {
                  setIsSubmitting(false);
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-black flex items-center gap-1 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>مساعد جمني: ترجمة وحسبة المقاس والرف المناسب ✨</span>
            </button>
          </div>

          {liveAnalysis && (
            <div className="p-3 rounded-xl bg-[#1A110D] border border-amber-600/50 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="font-black text-amber-300 flex items-center gap-1">
                  <Ruler className="w-3.5 h-3.5" />
                  <span>حسبة المقاس: {liveAnalysis.dimensions_calculation_ar}</span>
                </span>
                <span className="font-bold text-orange-300 flex items-center gap-1">
                  <Scale className="w-3.5 h-3.5" />
                  <span>{liveAnalysis.size_category} ({liveAnalysis.weight_label_ar})</span>
                </span>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-[#32211A]">
                <span className="text-emerald-300 font-bold flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>
                    الرف المقترح للحجم والوزن: <strong className="font-mono">{liveAnalysis.recommended_bin}</strong> ({liveAnalysis.size_category})
                  </span>
                </span>
                {locationCode.trim().toUpperCase() !== liveAnalysis.recommended_bin && (
                  <button
                    type="button"
                    onClick={() => setLocationCode(liveAnalysis.recommended_bin)}
                    className="px-2.5 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-black cursor-pointer"
                  >
                    اعتماد الرف {liveAnalysis.recommended_bin} 🟢
                  </button>
                )}
              </div>
            </div>
          )}

          <p className="text-xs text-amber-300">الترجمة اقتراح يحتاج مراجعة؛ يبقى الاسم الإنجليزي والمواصفات محفوظة.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Category */}
            <div>
              <label className="block text-neutral-300 font-semibold mb-1">التصنيف (Category)</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#1F1511] border border-[#4A342B] text-neutral-100 focus:outline-none focus:border-amber-500"
              >
                <option value="مسامير وروابط">مسامير وروابط</option>
                <option value="كهرباء وإضاءة">كهرباء وإضاءة</option>
                <option value="جازكيت وموانع تسرب">جازكيت وموانع تسرب</option>
                <option value="صمامات ومحابس">صمامات ومحابس</option>
                <option value="فلاتر ومصافي">فلاتر ومصافي</option>
                <option value="رولمان بلي ومحامل">رولمان بلي ومحامل</option>
                <option value="أنابيب ووصلات">أنابيب ووصلات</option>
                <option value="مضخات وقطع ميكانيكية">مضخات وقطع ميكانيكية</option>
                <option value="أجهزة قياس">أجهزة قياس</option>
                <option value="قطع ميكانيكية متنوعة">قطع ميكانيكية متنوعة</option>
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-neutral-300 font-semibold mb-1">حالة الجرد (Status)</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as InventoryItem['status'])}
                className="w-full px-3 py-2 rounded-xl bg-[#1F1511] border border-[#4A342B] text-neutral-100 focus:outline-none focus:border-amber-500"
              >
                <option value="مضاف">✓ موجودة / مضاف</option>
                <option value="غير موجودة">× غير موجودة (معلمة بـ × في الجدول)</option>
                <option value="مدقق">مدقق</option>
                <option value="غير مدقق">غير مدقق</option>
                <option value="تم النقل">تم النقل 🟢</option>
              </select>
            </div>
          </div>

          {/* Quantities */}
          <div className="grid grid-cols-3 gap-2.5 bg-[#1F1511] p-3 rounded-xl border border-[#4A342B]">
            <div>
              <label className="block text-neutral-400 font-medium mb-1 text-[11px]">
                المخزون (Total)
              </label>
              <input
                type="number"
                min="0"
                value={qtyTotal}
                onChange={(e) => setQtyTotal(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-[#271B15] border border-[#432d24] text-amber-300 font-bold font-mono text-center focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-neutral-400 font-medium mb-1 text-[11px]">
                الخارج (Out)
              </label>
              <input
                type="number"
                min="0"
                value={qtyOut}
                onChange={(e) => setQtyOut(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-[#271B15] border border-[#432d24] text-orange-400 font-bold font-mono text-center focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-neutral-400 font-medium mb-1 text-[11px]">
                المتبقي (Remaining)
              </label>
              <div className="w-full px-2.5 py-1.5 rounded-lg bg-[#271B15] border border-[#432d24] text-emerald-400 font-bold font-mono text-center">
                {status === 'غير موجودة' ? 0 : Math.max(0, qtyTotal - qtyOut)}
              </div>
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="pt-3 border-t border-[#3D271F] flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-neutral-300 font-bold transition-colors cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold flex items-center gap-1.5 shadow-md shadow-amber-900/40 disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{item ? 'حفظ التعديلات' : 'إضافة القطعة'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
