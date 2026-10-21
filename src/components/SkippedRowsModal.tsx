import React, { useState } from 'react';
import {
  AlertTriangle,
  Volume2,
  Check,
  X,
  CheckCircle2,
  Trash2,
  XCircle,
} from 'lucide-react';
import { playHighPitchWarningAlert } from '../utils/audioAlert';
import { ExtractedSparePart } from '../services/localOcr';
import { categorizeAndTranslate } from '../utils/translator';
import { sanitizeLocationCode, isValidSpecificLocation, strict10DigitRegexFilter } from '../utils/regexSanitizer';

export interface SkippedRow {
  id: string;
  row_number?: number;
  raw_text: string;
  part_number?: string;
  location?: string;
  quantity?: number;
  description_en?: string;
  is_missing?: number;
  reason: string;
}

interface SkippedRowsModalProps {
  isOpen: boolean;
  onClose: () => void;
  skippedRows: SkippedRow[];
  validCount: number;
  onAcceptCorrectedItem: (item: ExtractedSparePart, skippedRowId: string) => void;
  onRemoveSkippedRow?: (skippedRowId: string) => void;
  onDismissAllSkipped?: () => void;
}

export const SkippedRowsModal: React.FC<SkippedRowsModalProps> = ({
  isOpen,
  onClose,
  skippedRows,
  validCount,
  onAcceptCorrectedItem,
  onRemoveSkippedRow,
  onDismissAllSkipped,
}) => {
  const [editingRows, setEditingRows] = useState<
    Record<
      string,
      {
        partNumber: string;
        location: string;
        quantity: number;
        description: string;
        isMissing: boolean;
      }
    >
  >({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || skippedRows.length === 0) return null;

  const getRowState = (row: SkippedRow) => {
    const existing = editingRows[row.id];
    if (existing) return existing;

    const initialPart = (row.part_number || '').trim().replace(/[^0-9]/g, '');
    const initialLoc = sanitizeLocationCode(row.location || '');
    return {
      partNumber: initialPart.length === 10 ? initialPart : initialPart.startsWith('100') ? initialPart : `100${initialPart}`.slice(0, 10),
      location: isValidSpecificLocation(initialLoc) ? initialLoc : 'N11C2',
      quantity: row.quantity || 1,
      description: row.description_en || 'SPARE PART ASMO',
      isMissing: row.is_missing === 1,
    };
  };

  const handleFieldChange = (
    rowId: string,
    field: 'partNumber' | 'location' | 'quantity' | 'description' | 'isMissing',
    value: any
  ) => {
    const currentRow = skippedRows.find((r) => r.id === rowId);
    if (!currentRow) return;

    const current = getRowState(currentRow);
    setEditingRows((prev) => ({
      ...prev,
      [rowId]: {
        ...current,
        [field]: value,
      },
    }));
    setErrorMsg(null);
  };

  const handleApplyRow = (row: SkippedRow) => {
    const state = getRowState(row);
    const cleanPart = strict10DigitRegexFilter(state.partNumber);
    const cleanLoc = sanitizeLocationCode(state.location);

    if (!cleanPart) {
      setErrorMsg('يجب أن يتكون رقم القطعة من 10 أرقام كاملة (مثال: 1001023714) — يمنع حفظ أرقام ناقصة');
      return;
    }

    if (!isValidSpecificLocation(cleanLoc)) {
      setErrorMsg('يجب إدخال رمز الموقع الفعلي من عمود Storage Bin (مثل N11C2 أو N06C1) — يمنع إدخال موقع "عام"');
      return;
    }

    const { category, descAr } = categorizeAndTranslate(state.description);
    const total = Math.max(0, state.quantity);
    const out = 0;

    const correctedItem: ExtractedSparePart = {
      part_number: cleanPart,
      location_code: cleanLoc,
      description_en: state.description.trim() || 'SPARE PART ASMO',
      description_ar: descAr,
      category,
      qty_total: total,
      qty_out: out,
      qty_remaining: state.isMissing ? 0 : total,
      is_missing: state.isMissing ? 1 : 0,
      status: state.isMissing ? 'غير موجودة' : 'مضاف',
      confidence: 'مكتمل ومصحح يدوياً 100%',
    };

    onAcceptCorrectedItem(correctedItem, row.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="bg-[#261712] border-2 border-orange-500/80 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-right">
        {/* رأس النافذة */}
        <div className="p-4 bg-[#1B100C] border-b border-[#3D251D] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-orange-500/20 border border-orange-500/50 flex items-center justify-center text-orange-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-orange-900/60 text-orange-300 font-bold text-xs border border-orange-700/60">
                  إكمال قراءة الورقة
                </span>
                <span className="text-xs text-neutral-400 font-medium">
                  ({skippedRows.length} أسطر تحتاج تأكيد)
                </span>
              </div>
              <h3 className="text-base font-black text-white mt-0.5">
                تصحيح وإكمال الأسطر الناقصة قبل رفع الورقة
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => playHighPitchWarningAlert()}
              title="تشغيل صوت التنبيه"
              className="p-2 rounded-xl bg-[#362118] hover:bg-[#4D2F23] text-orange-300 border border-[#543326] transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
            >
              <Volume2 className="w-4 h-4 text-orange-400" />
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-[#362118] text-neutral-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* تنبيه القاعدة الصارمة */}
        <div className="bg-gradient-to-r from-orange-950/70 via-red-950/50 to-orange-950/70 p-3.5 border-b border-orange-900/50 text-xs">
          <p className="text-orange-200 font-bold leading-relaxed">
            ⛔ <strong>قاعدة اكتمال الورقة:</strong> لا يتم رفع الورقة إلا بعد اكتمال القراءة 100% (رقم قطعة من 10 أرقام كاملة + موقع فعلي مثل N11C2 وليس "عام").
          </p>
          {errorMsg && (
            <div className="mt-2 p-2 rounded-lg bg-red-950 border border-red-500 text-red-200 font-bold">
              {errorMsg}
            </div>
          )}
        </div>

        {/* قائمة الأسطر */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3.5 text-xs">
          {skippedRows.map((row, index) => {
            const state = getRowState(row);
            const cleanPart = strict10DigitRegexFilter(state.partNumber);
            const cleanLoc = sanitizeLocationCode(state.location);
            const isPartValid = !!cleanPart;
            const isLocValid = isValidSpecificLocation(cleanLoc);
            const isRowReady = isPartValid && isLocValid;

            return (
              <div
                key={row.id}
                className="bg-[#1C120E] border border-orange-800/40 rounded-xl p-3.5 space-y-3 hover:border-orange-600/60 transition-all shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2E1D16] pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-orange-900/60 text-orange-200 font-bold flex items-center justify-center text-[11px] border border-orange-700/60">
                      {row.row_number || index + 1}
                    </span>
                    <span className="font-bold text-white text-xs">
                      السطر رقم {row.row_number || index + 1}
                    </span>
                  </div>

                  <span className="text-[11px] text-red-300 bg-red-950/60 px-2 py-0.5 rounded border border-red-800/40 font-medium">
                    {row.reason}
                  </span>
                </div>

                <div className="bg-[#130B09] p-2 rounded-lg border border-[#2B1B15] text-[11px]">
                  <span className="text-neutral-400 block mb-0.5 font-bold">بيانات السطر المقروءة:</span>
                  <code className="text-amber-200/90 font-mono block break-words" dir="ltr">
                    {row.raw_text}
                  </code>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  {/* رقم القطعة (10 أرقام) */}
                  <div>
                    <label className="block text-neutral-300 font-bold mb-1 text-[11px] flex items-center justify-between">
                      <span>رقم القطعة (10 أرقام):</span>
                      {isPartValid ? (
                        <span className="text-emerald-400 text-[10px] flex items-center gap-0.5">
                          <CheckCircle2 className="w-3 h-3" /> 10/10 مكتمل
                        </span>
                      ) : (
                        <span className="text-red-400 text-[10px]">
                          {state.partNumber.replace(/[^0-9]/g, '').length}/10 أرقام
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      maxLength={10}
                      value={state.partNumber}
                      onChange={(e) => handleFieldChange(row.id, 'partNumber', e.target.value)}
                      placeholder="1001023714"
                      className={`w-full px-2.5 py-1.5 rounded-lg bg-[#140B08] border font-mono font-bold text-xs focus:outline-none ${
                        isPartValid
                          ? 'border-emerald-600/70 text-emerald-300'
                          : 'border-red-600/70 text-amber-200'
                      }`}
                    />
                  </div>

                  {/* الموقع الفعلي */}
                  <div>
                    <label className="block text-neutral-300 font-bold mb-1 text-[11px] flex items-center justify-between">
                      <span>الموقع (Storage Bin):</span>
                      {isLocValid ? (
                        <span className="text-emerald-400 text-[10px]">موقع صحيح</span>
                      ) : (
                        <span className="text-red-400 text-[10px]">أدخل رمز الموقع</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={state.location}
                      onChange={(e) => handleFieldChange(row.id, 'location', e.target.value)}
                      placeholder="N11C2 أو N06C1"
                      className={`w-full px-2.5 py-1.5 rounded-lg bg-[#140B08] border font-mono font-bold text-xs focus:outline-none ${
                        isLocValid
                          ? 'border-emerald-600/70 text-neutral-100'
                          : 'border-red-600/70 text-red-300'
                      }`}
                    />
                  </div>

                  {/* الكمية */}
                  <div>
                    <label className="block text-neutral-300 font-bold mb-1 text-[11px]">
                      الكمية (QTY):
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={state.quantity}
                      onChange={(e) => handleFieldChange(row.id, 'quantity', parseInt(e.target.value, 10) || 0)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#140B08] border border-[#3E251D] text-amber-300 font-mono text-xs focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                {/* الوصف وحالة × غير موجودة */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
                  <div className="sm:col-span-2">
                    <label className="block text-neutral-300 font-bold mb-1 text-[11px]">
                      وصف القطعة (Material Description):
                    </label>
                    <input
                      type="text"
                      value={state.description}
                      onChange={(e) => handleFieldChange(row.id, 'description', e.target.value)}
                      placeholder="BALL VALVE, SIZE 1/2 INCH"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#140B08] border border-[#3E251D] text-neutral-200 text-xs focus:outline-none focus:border-amber-500"
                      dir="ltr"
                    />
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => handleFieldChange(row.id, 'isMissing', !state.isMissing)}
                      className={`w-full px-3 py-1.5 rounded-lg font-bold text-xs border flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                        state.isMissing
                          ? 'bg-red-950/90 text-red-200 border-red-500'
                          : 'bg-emerald-950/70 text-emerald-300 border-emerald-600/50'
                      }`}
                    >
                      {state.isMissing ? (
                        <>
                          <XCircle className="w-3.5 h-3.5 text-red-400" />
                          <span>× غير موجودة</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>✓ موجودة بالرف</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* أزرار اعتماد السطر أو استبعاده إذا كان ضوضاء */}
                <div className="flex items-center justify-between pt-2 border-t border-[#2E1D16]">
                  {onRemoveSkippedRow ? (
                    <button
                      type="button"
                      onClick={() => onRemoveSkippedRow(row.id)}
                      className="px-2.5 py-1.5 rounded-lg bg-red-950/50 hover:bg-red-900/70 text-red-300 border border-red-800/50 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف هذا السطر التالف</span>
                    </button>
                  ) : <div />}

                  <button
                    type="button"
                    onClick={() => handleApplyRow(row)}
                    disabled={!isRowReady}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                      isRowReady
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/40'
                        : 'bg-[#2E1E18] text-neutral-500 cursor-not-allowed border border-[#452D24]'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>اعتماد وإضافة للورقة المكتملة</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* التذييل */}
        <div className="p-4 bg-[#1B100C] border-t border-[#3D251D] flex flex-wrap items-center justify-between gap-2 text-xs">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#362118] hover:bg-[#4D2F23] text-neutral-200 font-bold transition-colors cursor-pointer"
          >
            العودة لمعاينة الورقة ({validCount} قطعة مكتملة)
          </button>

          {onDismissAllSkipped && (
            <button
              onClick={() => {
                onDismissAllSkipped();
                onClose();
              }}
              className="px-3.5 py-2 rounded-xl bg-red-950/60 hover:bg-red-900/80 text-red-200 border border-red-800/50 transition-colors cursor-pointer text-[11px] font-bold"
            >
              حذف كافة الأسطر التالفة المتبقية ({skippedRows.length})
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
