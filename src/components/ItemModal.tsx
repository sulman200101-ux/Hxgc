import { suggestTechnicalTranslation, suggestModelTranslation } from '../services/partTranslation';
import React, { useState, useEffect, useMemo } from 'react';
import { InventoryItem } from '../types';
import { categorizeAndTranslate } from '../utils/translator';
import {
  analyzePartsWithGeminiAssistant,
  computeLocalPartEngineeringAnalysis,
  isConsumablePart,
  resolveTargetConsumableLocation,
} from '../services/transferSuggestions';
import {
  strict10DigitRegexFilter,
  sanitizeQuantity,
  sanitizeDescription,
  sanitizeLocationCode,
  isValidSpecificLocation,
} from '../utils/regexSanitizer';
import {
  X,
  Save,
  Package,
  Sparkles,
  ArrowRightLeft,
  AlertTriangle,
  Ruler,
  Scale,
  MapPin,
  MessageCircle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

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
    is_consumable?: number;
    is_qain?: number;
    qain_note?: string;
    is_manual_audit?: number;
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
  const [isConsumable, setIsConsumable] = useState<number>(0);
  const [isQain, setIsQain] = useState<number>(0);
  const [qainNote, setQainNote] = useState<string>('');
  const [isManualAudit, setIsManualAudit] = useState<number>(0);
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
      setIsConsumable(item.is_consumable !== undefined ? item.is_consumable : isConsumablePart(item) ? 1 : 0);
      setIsQain(item.is_qain || 0);
      setQainNote(item.qain_note || '');
      setIsManualAudit(item.is_manual_audit || 0);
    } else {
      setPartNumber('');
      setLocationCode('');
      setDescEn('');
      setDescAr('');
      setCategory('قطع ميكانيكية متنوعة');
      setQtyTotal(0);
      setQtyOut(0);
      setStatus('غير مدقق');
      setIsConsumable(0);
      setIsQain(0);
      setQainNote('');
      setIsManualAudit(0);
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
      if (isConsumablePart({ description_en: val, description_ar: ar, category: cat })) {
        setIsConsumable(1);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const normalizedPartDigits = partNumber
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .trim();
    const cleanPart =
      strict10DigitRegexFilter(partNumber) ||
      (/^\d{8,12}$/.test(normalizedPartDigits) ? normalizedPartDigits : null);
    if (!cleanPart) {
      setValidationError('يجب أن يتكون رقم القطعة من 8 إلى 12 رقماً (مثل 1001023714) — يمنع نسخ أرقام ناقصة');
      return;
    }

    const cleanLoc = sanitizeLocationCode(locationCode);
    if (!isValidSpecificLocation(cleanLoc)) {
      setValidationError('يجب إدخال اسم موقع محدد وفعلي (مثل N11C2 أو N06C1) — يمنع إدخال موقع "عام"');
      return;
    }

    setIsSubmitting(true);
    const { cleaned: cleanDescEn } = sanitizeDescription(descEn);
    const cleanQtyTotal =
      typeof qtyTotal === 'number' && Number.isFinite(qtyTotal) && qtyTotal >= 0
        ? Math.round(qtyTotal * 1000) / 1000
        : sanitizeQuantity(qtyTotal, 1);
    const cleanQtyOut =
      typeof qtyOut === 'number' && Number.isFinite(qtyOut) && qtyOut >= 0
        ? Math.round(qtyOut * 1000) / 1000
        : sanitizeQuantity(qtyOut, 0);

    try {
      await onSave({
        part_number: cleanPart,
        location_code: cleanLoc,
        description_en: cleanDescEn,
        description_ar: descAr.trim() || cleanDescEn,
        category,
        qty_total: cleanQtyTotal,
        qty_out: cleanQtyOut,
        status: isManualAudit === 1 ? 'مدقق' : status,
        is_consumable: isConsumable,
        is_qain: isQain,
        qain_note: isQain === 1 ? qainNote.trim() : undefined,
        is_manual_audit: isManualAudit,
      });
      onClose();
    } catch (err) {
      setValidationError((err as Error).message || 'تعذر حفظ التعديلات');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/85 backdrop-blur-sm"
    >
      <div className="bg-[#2C1E18] border border-[#52382D] w-full max-w-lg max-h-[92dvh] rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto">
        {/* Header - Sticky at top */}
        <div className="px-4 py-3 bg-[#231713] border-b border-[#3D271F] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shrink-0">
              <Package className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base text-white leading-tight">
                {item ? 'تعديل بيانات القطعة' : 'إضافة قطعة غيار جديدة'}
              </h3>
              <p className="text-[10px] text-amber-300/80 font-medium">
                جميع الحقول مرتبة وظاهرة — رقم القطعة (10 أرقام) والموقع والكميات
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-neutral-300 hover:text-white cursor-pointer border border-[#52382D]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body - Scrollable middle */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3 text-xs">
          {validationError && (
            <div className="p-2.5 rounded-xl bg-red-950/90 border border-red-500 text-red-200 font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* 1. رقم القطعة واسم الموقع جنباً إلى جنب بشكل واضح */}
          <div className="grid grid-cols-2 gap-2.5 bg-[#221712] p-2.5 rounded-xl border border-[#4A342B]">
            {/* Part Number */}
            <div className="flex flex-col justify-between">
              <label className="block text-amber-300 font-bold mb-1 text-[11px] whitespace-nowrap truncate">
                1. رقم القطعة (10 أرقام)
              </label>
              <input
                type="text"
                maxLength={12}
                value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)}
                required
                dir="ltr"
                placeholder="1001023714"
                className="w-full px-2.5 py-2 rounded-xl bg-[#160F0C] border border-amber-600/50 text-amber-300 font-mono font-black text-center text-xs sm:text-sm focus:outline-none focus:border-amber-400"
              />
            </div>

            {/* Location Code */}
            <div className="flex flex-col justify-between">
              <div className="flex items-center justify-between gap-1 mb-1">
                <label className="text-amber-300 font-bold text-[11px] whitespace-nowrap truncate">
                  2. اسم الموقع (Bin)
                </label>
                {item && onOpenRelocate && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenRelocate(item);
                    }}
                    className="text-[10px] text-emerald-300 hover:text-emerald-200 font-bold inline-flex items-center gap-0.5 cursor-pointer bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-500/40 shrink-0"
                  >
                    <ArrowRightLeft className="w-2.5 h-2.5" />
                    <span>نقل</span>
                  </button>
                )}
              </div>
              <input
                type="text"
                value={locationCode}
                onChange={(e) => setLocationCode(e.target.value)}
                required
                dir="ltr"
                placeholder="P01A1 / N11C2"
                className="w-full px-2.5 py-2 rounded-xl bg-[#160F0C] border border-[#52382D] text-neutral-100 font-mono font-black text-center text-xs sm:text-sm uppercase focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>

          {/* 2. اسم ووصف القطعة بالعربية والإنجليزية + أزرار الترجمة */}
          <div className="bg-[#221712] border border-[#4A342B] rounded-xl p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-amber-300 font-bold text-[11px]">
                3. اسم ووصف القطعة (عربي / إنجليزي)
              </span>
              <span className="text-[10px] text-amber-400/90 flex items-center gap-1 font-semibold">
                <Sparkles className="w-3 h-3" /> تعريب وتصنيف تلقائي
              </span>
            </div>

            {/* Description AR */}
            <div>
              <label className="block text-neutral-300 font-semibold mb-1 text-[11px]">
                الاسم والوصف بالعربية
              </label>
              <input
                type="text"
                value={descAr}
                onChange={(e) => setDescAr(e.target.value)}
                placeholder="جازكيت حلزوني مدعم 3 بوصة..."
                className="w-full px-3 py-1.5 rounded-xl bg-[#160F0C] border border-[#4A342B] text-neutral-100 font-bold focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Description EN */}
            <div>
              <label className="block text-neutral-300 font-semibold mb-1 text-[11px]">
                الوصف بالإنجليزية (Material Description)
              </label>
              <input
                type="text"
                value={descEn}
                onChange={(e) => handleDescEnChange(e.target.value)}
                placeholder="e.g. GASKET SPIRAL WOUND 3 INCH 150#"
                dir="ltr"
                className="w-full px-3 py-1.5 rounded-xl bg-[#160F0C] border border-[#4A342B] text-neutral-100 font-sans focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Translation Action Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => setDescAr(suggestTechnicalTranslation(descEn).arabic)}
                className="px-2.5 py-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-amber-200 font-bold border border-[#52382D] cursor-pointer text-[11px] text-center truncate"
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
                className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-black flex items-center justify-center gap-1 cursor-pointer text-[11px] truncate"
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">مساعد جمني والمقاس ✨</span>
              </button>
            </div>
          </div>

          {liveAnalysis && (
            <div className="p-2.5 rounded-xl bg-[#1A110D] border border-amber-600/50 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="font-black text-amber-300 flex items-center gap-1">
                  <Ruler className="w-3.5 h-3.5" />
                  <span>المقاس: {liveAnalysis.dimensions_calculation_ar}</span>
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
                    الرف المقترح: <strong className="font-mono">{liveAnalysis.recommended_bin}</strong>
                  </span>
                </span>
                {locationCode.trim().toUpperCase() !== liveAnalysis.recommended_bin && (
                  <button
                    type="button"
                    onClick={() => setLocationCode(liveAnalysis.recommended_bin)}
                    className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-black cursor-pointer"
                  >
                    اعتماد {liveAnalysis.recommended_bin} 🟢
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 3. التصنيف وحالة الجرد في صف واحد منظم */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Category */}
            <div>
              <label className="block text-neutral-300 font-bold mb-1 text-[11px] whitespace-nowrap truncate">
                4. التصنيف (Category)
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-2.5 py-2 rounded-xl bg-[#1F1511] border border-[#4A342B] text-neutral-100 font-bold text-xs focus:outline-none focus:border-amber-500"
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
              <label className="block text-neutral-300 font-bold mb-1 text-[11px] whitespace-nowrap truncate">
                5. حالة الجرد (Status)
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as InventoryItem['status'])}
                className="w-full px-2.5 py-2 rounded-xl bg-[#1F1511] border border-[#4A342B] text-neutral-100 font-bold text-xs focus:outline-none focus:border-amber-500"
              >
                <option value="مضاف">✓ موجودة / مضاف</option>
                <option value="غير موجودة">× غير موجودة (×)</option>
                <option value="مدقق">مدقق ✓</option>
                <option value="غير مدقق">غير مدقق</option>
                <option value="تم النقل">تم النقل 🟢</option>
              </select>
            </div>
          </div>

          {/* 4. الكميات على خط أفقي واحد متساوٍ تماماً */}
          <div className="grid grid-cols-3 gap-2 bg-[#1F1511] p-2.5 rounded-xl border border-[#4A342B] items-end">
            <div className="flex flex-col">
              <label className="block text-neutral-300 font-bold mb-1 text-[11px] text-center whitespace-nowrap truncate">
                المخزون (Total)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={qtyTotal}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setQtyTotal(Number.isFinite(v) && v >= 0 ? v : 0);
                }}
                className="w-full h-9 px-2 rounded-lg bg-[#271B15] border border-[#432d24] text-amber-300 font-black font-mono text-center text-sm focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex flex-col">
              <label className="block text-neutral-300 font-bold mb-1 text-[11px] text-center whitespace-nowrap truncate">
                الخارج (Out)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={qtyOut}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setQtyOut(Number.isFinite(v) && v >= 0 ? v : 0);
                }}
                className="w-full h-9 px-2 rounded-lg bg-[#271B15] border border-[#432d24] text-orange-400 font-black font-mono text-center text-sm focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex flex-col">
              <label className="block text-neutral-300 font-bold mb-1 text-[11px] text-center whitespace-nowrap truncate">
                المتبقي (Net)
              </label>
              <div className="w-full h-9 px-2 rounded-lg bg-[#271B15] border border-emerald-700/50 text-emerald-400 font-black font-mono text-center text-sm flex items-center justify-center">
                {status === 'غير موجودة' ? 0 : Math.round(Math.max(0, qtyTotal - qtyOut) * 1000) / 1000}
              </div>
            </div>
          </div>

          {/* 5. علامات الفحص والتصنيف السريع في صف واحد منظم */}
          <div className="p-2.5 rounded-xl bg-[#1A120E] border border-[#4A342B] space-y-2">
            <label className="block text-amber-300 font-bold text-[11px]">
              6. علامات الفحص والتصنيف السريع للقطعة:
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const next = isManualAudit === 1 ? 0 : 1;
                  setIsManualAudit(next);
                  if (next === 1) setStatus('مدقق');
                }}
                className={`py-2 px-1.5 rounded-xl font-black text-[11px] border flex items-center justify-center gap-1 cursor-pointer transition-all ${
                  isManualAudit === 1
                    ? 'bg-teal-600 text-white border-teal-300 shadow-md'
                    : 'bg-[#261A14] hover:bg-teal-950/60 text-teal-200 border-teal-700/50'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{isManualAudit === 1 ? 'مدقق يدوي ✓' : 'مدقق يدوي'}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsQain(isQain === 1 ? 0 : 1)}
                className={`py-2 px-1.5 rounded-xl font-black text-[11px] border flex items-center justify-center gap-1 cursor-pointer transition-all ${
                  isQain === 1
                    ? 'bg-emerald-600 text-white border-emerald-300 shadow-md'
                    : 'bg-[#261A14] hover:bg-emerald-950/60 text-emerald-200 border-emerald-700/50'
                }`}
              >
                <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{isQain === 1 ? 'قين 💬 ✓' : 'علامة قين 💬'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const next = isConsumable === 1 ? 0 : 1;
                  setIsConsumable(next);
                  if (next === 1 && !locationCode.trim()) {
                    setLocationCode('N11A1');
                  }
                }}
                className={`py-2 px-1.5 rounded-xl font-black text-[11px] border flex items-center justify-center gap-1 cursor-pointer transition-all ${
                  isConsumable === 1
                    ? 'bg-cyan-600 text-white border-cyan-300 shadow-md'
                    : 'bg-[#261A14] hover:bg-cyan-950/60 text-cyan-200 border-cyan-700/50'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{isConsumable === 1 ? 'استهلاكية ✓' : 'استهلاكية A/FL'}</span>
              </button>
            </div>

            {isConsumable === 1 && (
              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#32211A] text-[11px] flex-wrap">
                <span className="text-cyan-300 font-bold">
                  🔄 موقع الصرف المقترح:{' '}
                  <strong className="font-mono">
                    {resolveTargetConsumableLocation(locationCode || 'N11A1')}
                  </strong>
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setLocationCode(resolveTargetConsumableLocation(locationCode || 'N11A1', false))}
                    className="px-2 py-0.5 rounded bg-cyan-800 hover:bg-cyan-700 text-white font-bold cursor-pointer"
                  >
                    رف A ({resolveTargetConsumableLocation(locationCode || 'N11A1', false)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocationCode(resolveTargetConsumableLocation(locationCode || 'N11A1', true))}
                    className="px-2 py-0.5 rounded bg-cyan-800 hover:bg-cyan-700 text-white font-bold cursor-pointer"
                  >
                    رف FL ({resolveTargetConsumableLocation(locationCode || 'N11A1', true)})
                  </button>
                </div>
              </div>
            )}

            {isQain === 1 && (
              <div className="pt-1.5 border-t border-[#32211A]">
                <input
                  type="text"
                  value={qainNote}
                  onChange={(e) => setQainNote(e.target.value)}
                  placeholder="ملاحظة اختيارية لقطعة قين (تظهر في قائمة قين)..."
                  className="w-full px-3 py-1.5 rounded-lg bg-[#150E0B] border border-emerald-600/50 text-white text-xs"
                />
              </div>
            )}
          </div>

          {/* Footer Buttons - Sticky at bottom of form */}
          <div className="pt-2.5 border-t border-[#3D271F] flex items-center justify-between gap-2 sticky bottom-0 bg-[#2C1E18] pb-0.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-neutral-200 font-bold transition-colors cursor-pointer border border-[#52382D]"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 sm:flex-initial px-6 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-700 hover:from-amber-500 hover:to-orange-600 text-white font-black flex items-center justify-center gap-1.5 shadow-md shadow-amber-900/40 disabled:opacity-50 cursor-pointer border border-amber-400/40"
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
