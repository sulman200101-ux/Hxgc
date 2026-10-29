import React, { useState } from 'react';
import { InventoryItem, LocationSummary } from '../types';
import { exportLocationToPdfFile } from '../utils/pdfExportUtil';
import {
  ArrowRight,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  Search,
  FileDown,
  ArrowRightLeft,
  Loader2,
  XCircle,
} from 'lucide-react';

interface LocationDetailModalProps {
  locationCode: string | null;
  summary: LocationSummary | undefined;
  items: InventoryItem[];
  isOpen: boolean;
  onClose: () => void;
  onEditItem: (item: InventoryItem) => void;
  onDeleteItem: (partNumber: string) => void;
  onAddNewItemForLocation: (locationCode: string) => void;
  onMarkItemStatus: (partNumber: string, status: InventoryItem['status']) => void;
  onOpenRelocate: (item: InventoryItem) => void;
  onExportPdf?: (locationCode: string) => void;
}

export const LocationDetailModal: React.FC<LocationDetailModalProps> = ({
  locationCode,
  summary,
  items,
  isOpen,
  onClose,
  onEditItem,
  onDeleteItem,
  onAddNewItemForLocation,
  onMarkItemStatus,
  onOpenRelocate,
  onExportPdf,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(50);
  const [showExportSuccess, setShowExportSuccess] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  if (!isOpen || !locationCode) return null;

  const filtered = items.filter((i) => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      i.part_number.toLowerCase().includes(q) ||
      i.description_ar.toLowerCase().includes(q) ||
      i.description_en.toLowerCase().includes(q) ||
      i.category.toLowerCase().includes(q)
    );
  });

  const visibleItems = filtered.slice(0, visibleLimit);

  const handleExportPdf = async () => {
    if (onExportPdf) {
      onExportPdf(locationCode);
    }

    setIsExportingPdf(true);
    try {
      await exportLocationToPdfFile({
        locationCode,
        items,
        summary,
      });
      setShowExportSuccess(true);
      setTimeout(() => setShowExportSuccess(false), 4000);
    } catch (err) {
      console.error('PDF export error:', err);
      window.print();
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm overflow-y-auto">
      <div className="bg-[#2C1E18] border border-[#52382D] w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* الشريط العلوي */}
        <div className="p-4 bg-[#231713] border-b border-[#3D271F] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-amber-300 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer border border-[#543A2F]"
            >
              <ArrowRight className="w-4 h-4" />
              <span>⬅ عودة</span>
            </button>

            <h2 className="text-base sm:text-lg font-black text-white font-mono flex items-center gap-2">
              تفاصيل الموقع: {locationCode}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPdf}
              disabled={isExportingPdf}
              className="px-4 py-1.5 rounded-xl bg-[#27AE60] hover:bg-[#219653] disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 transition-all cursor-pointer active:scale-95"
            >
              {isExportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              <span>تصدير ملف PDF</span>
            </button>

            <button
              onClick={() => onAddNewItemForLocation(locationCode)}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1 shadow-md transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة صنف</span>
            </button>
          </div>
        </div>

        {showExportSuccess && (
          <div className="bg-[#27AE60]/20 border-b border-[#27AE60]/40 p-2.5 px-4 text-xs font-bold text-emerald-300 flex items-center justify-between">
            <span>تم إنشاء وتجهيز تقرير PDF للموقع {locationCode} بنجاح!</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
        )}

        {/* 4 Stats Grid */}
        {summary && (
          <div className="p-3.5 bg-[#1F1511] border-b border-[#3A271F]">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-2 rounded-xl bg-[#271B15] border border-[#3C271E] text-center">
                <span className="text-[10px] text-neutral-400 block mb-0.5">المخزون (Total)</span>
                <span className="text-base font-black text-amber-300 font-mono">
                  {summary.total_qty.toLocaleString()}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-[#271B15] border border-[#3C271E] text-center">
                <span className="text-[10px] text-neutral-400 block mb-0.5">المتبقي (Remaining)</span>
                <span className="text-base font-black text-emerald-400 font-mono">
                  {summary.remaining_qty.toLocaleString()}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-[#271B15] border border-[#3C271E] text-center">
                <span className="text-[10px] text-neutral-400 block mb-0.5">× غير موجودة</span>
                <span className="text-base font-black text-red-400 font-mono">
                  {(summary.missing_count || 0).toLocaleString()}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-[#271B15] border border-[#3C271E] text-center">
                <span className="text-[10px] text-neutral-400 block mb-0.5">إجمالي الأصناف</span>
                <span className="text-base font-black text-purple-400 font-mono">
                  {summary.item_count.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Search inside location */}
        <div className="p-3 bg-[#231713] border-b border-[#3D271F]">
          <div className="relative">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => {
                setFilterQuery(e.target.value);
                setVisibleLimit(50);
              }}
              placeholder="🔍 بحث برقم القطعة أو اسمها داخل هذا الموقع..."
              className="w-full pl-3 pr-9 py-2 rounded-xl bg-[#19110D] text-xs text-neutral-100 placeholder-neutral-500 border border-[#432d24] focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* منطقة القائمة */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {visibleItems.length === 0 ? (
            <div className="text-center py-8 text-neutral-400 text-xs">
              لا توجد قطع مطابقة للبحث داخل هذا الموقع
            </div>
          ) : (
            <>
              {visibleItems.map((item) => {
                const isMissing = item.is_missing === 1 || item.status === 'غير موجودة';
                const isMoved = item.is_moved === 1 || item.status === 'منقول' || item.status === 'تم النقل';

                return (
                  <div
                    key={item.part_number}
                    className={`rounded-xl p-3.5 border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                      isMissing
                        ? 'bg-red-950/25 border-red-700/60 hover:border-red-500'
                        : 'bg-[#231713] border-[#432d24] hover:border-amber-500/40'
                    }`}
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-neutral-400 font-medium">الوصف:</span>
                        <h4 className="font-bold text-neutral-100 text-sm">
                          {item.description_ar}
                        </h4>
                        {isMissing && (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-red-950 text-red-200 border border-red-500 inline-flex items-center gap-1">
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                            × غير موجودة
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-neutral-300 pt-0.5">
                        <span className="font-mono text-amber-300 font-bold bg-[#19110D] px-2 py-0.5 rounded border border-[#3D271F]">
                          رقم القطعة: {item.part_number}
                        </span>
                        <span className="text-neutral-500">|</span>
                        <span>
                          المخزون: <strong className="text-amber-300 font-mono">{item.qty_total}</strong>
                        </span>
                        <span className="text-neutral-500">|</span>
                        <span>
                          المتبقي: <strong className={`font-mono ${isMissing ? 'text-red-400' : 'text-emerald-400'}`}>{item.qty_remaining}</strong>
                        </span>
                        <span className="text-neutral-500">|</span>
                        {isMissing ? (
                          <span className="text-red-300 font-bold">معلمة بـ (×) في ورقة الجرد</span>
                        ) : isMoved ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/60 inline-flex items-center gap-1 shadow-sm">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            تم النقل 🟢
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-600/50 inline-flex items-center gap-1">
                            ✓ موجودة بالموقع
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-neutral-400 font-sans" dir="ltr">
                        {item.description_en}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 justify-end shrink-0 flex-wrap">
                      <button onClick={() => onMarkItemStatus(item.part_number, item.status === 'مدقق' ? 'غير مدقق' : 'مدقق')} title="تغيير حالة تدقيق القطعة" className="px-2 py-1 rounded border border-amber-700 text-amber-200 text-xs">{item.status === 'مدقق' ? 'مدققة ✓' : 'غير مدققة'}</button>
                      <button
                        onClick={() =>
                          onMarkItemStatus(
                            item.part_number,
                            isMissing ? 'مضاف' : 'غير موجودة'
                          )
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                          isMissing
                            ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60'
                            : 'bg-red-950/60 text-red-200 border-red-700/60'
                        }`}
                      >
                        {isMissing ? 'تحويل لموجودة ✓' : '× غير موجودة'}
                      </button>

                      <button
                        onClick={() => onOpenRelocate(item)}
                        title="نقل موقع القطعة 🟢"
                        className="px-2.5 py-1 rounded-lg bg-emerald-900/70 hover:bg-emerald-800 text-emerald-200 border border-emerald-500/50 text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm active:scale-95"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
                        <span>نقل 🟢</span>
                      </button>

                      <button
                        onClick={() => onEditItem(item)}
                        className="p-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-amber-300 border border-[#52382D] cursor-pointer"
                        title="تعديل"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => onDeleteItem(item.part_number)}
                        className="p-1.5 rounded-lg bg-red-950/50 hover:bg-red-900 text-red-400 border border-red-900/50 cursor-pointer"
                        title="حذف"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {filtered.length > visibleLimit && (
                <div className="pt-2 text-center">
                  <button
                    onClick={() => setVisibleLimit((prev) => prev + 50)}
                    className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold cursor-pointer"
                  >
                    عرض المزيد ({filtered.length - visibleLimit} متبقية)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
