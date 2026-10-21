import React, { useState } from 'react';
import { LocationSummary, InventoryItem } from '../types';
import {
  MapPin,
  ChevronDown,
  ChevronUp,
  Trash2,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRightLeft,
  XCircle,
} from 'lucide-react';

interface LocationCardProps {
  summary: LocationSummary;
  items: InventoryItem[];
  onOpenLocation: (locationCode: string) => void;
  onEditItem: (item: InventoryItem) => void;
  onDeleteItem: (partNumber: string) => void;
  onDeleteLocation: (locationCode: string) => void;
  onRenameLocation: (oldCode: string) => void;
  onMarkItemStatus: (partNumber: string, status: InventoryItem['status']) => void;
  onOpenRelocate?: (item: InventoryItem) => void;
}

export const LocationCard: React.FC<LocationCardProps> = ({
  summary,
  items,
  onOpenLocation,
  onEditItem,
  onDeleteItem,
  onDeleteLocation,
  onRenameLocation,
  onMarkItemStatus,
  onOpenRelocate,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const previewItems = items.slice(0, 25);

  return (
    <div className="bg-[#2C1E18] rounded-2xl border border-[#432d24] shadow-lg hover:border-amber-700/50 transition-all overflow-hidden mb-4">
      {/* Location Header */}
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          {/* Location Code & Title */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-black text-white tracking-wide font-mono">
                  موقع: {summary.location_code}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-md bg-[#3B2820] text-amber-200/80 border border-[#4F362B] font-bold">
                  {summary.item_count} أصناف
                </span>
              </div>
            </div>
          </div>

          {/* Status Badges & Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {summary.missing_count > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-red-950 text-red-200 border border-red-500 text-xs font-black flex items-center gap-1 shadow-sm">
                <XCircle className="w-3.5 h-3.5 text-red-400" />
                <span>× غير موجودة ({summary.missing_count})</span>
              </span>
            )}

            {summary.added_count > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 text-xs font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>✓ موجودة ({summary.added_count})</span>
              </span>
            )}

            {summary.unverified_count > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-orange-950/60 text-orange-300 border border-orange-800/60 text-xs font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
                <span>غير مدقق ({summary.unverified_count})</span>
              </span>
            )}

            {summary.moved_count > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-emerald-950/70 text-emerald-300 border border-emerald-700/60 text-xs font-bold flex items-center gap-1 shadow-sm">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>🟢 نقلت ({summary.moved_count})</span>
              </span>
            )}

            <button
              onClick={() => onRenameLocation(summary.location_code)}
              title="تعديل رمز الموقع"
              className="p-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-neutral-300 hover:text-white border border-[#4F362B] transition-colors cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => onDeleteLocation(summary.location_code)}
              title="حذف الموقع وجميع قطعه"
              className="p-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 hover:text-red-200 border border-red-900/50 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 4-Column Statistics Breakdown */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-[#1F1511] p-3 rounded-xl border border-[#3C271E]">
          <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-[#271B15] border border-[#3A271F]">
            <span className="text-[11px] text-neutral-400 font-medium mb-1">
              المخزون (Total)
            </span>
            <span className="text-lg font-black text-amber-300 font-mono">
              {summary.total_qty.toLocaleString()}
            </span>
          </div>

          <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-[#271B15] border border-[#3A271F]">
            <span className="text-[11px] text-neutral-400 font-medium mb-1">
              المتبقي (Remaining)
            </span>
            <span className="text-lg font-black text-emerald-400 font-mono">
              {summary.remaining_qty.toLocaleString()}
            </span>
          </div>

          <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-[#271B15] border border-[#3A271F]">
            <span className="text-[11px] text-neutral-400 font-medium mb-1">
              × غير موجودة
            </span>
            <span className="text-lg font-black text-red-400 font-mono">
              {(summary.missing_count || 0).toLocaleString()}
            </span>
          </div>

          <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-[#271B15] border border-[#3A271F]">
            <span className="text-[11px] text-neutral-400 font-medium mb-1">
              إجمالي الأصناف
            </span>
            <span className="text-lg font-black text-purple-400 font-mono">
              {summary.item_count.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Card Actions Footer */}
        <div className="mt-3.5 flex items-center justify-between pt-2 border-t border-[#3B2820]">
          <button
            onClick={() => onOpenLocation(summary.location_code)}
            className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-amber-950/40 transition-all cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>عرض القطع ({summary.item_count})</span>
          </button>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 text-xs font-bold text-neutral-300 hover:text-amber-300 transition-colors py-1 px-2.5 rounded-lg bg-[#3A271F] hover:bg-[#4A3228] cursor-pointer"
          >
            <span>{isExpanded ? 'إخفاء المعاينة السريعة' : 'معاينة سريعة'}</span>
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded Items List inside this location */}
      {isExpanded && (
        <div className="border-t border-[#432d24] bg-[#221712] p-3 sm:p-4 space-y-2.5">
          {previewItems.length === 0 ? (
            <p className="text-center text-xs text-neutral-500 py-4">لا توجد قطع مطابقة للبحث داخل هذا الموقع</p>
          ) : (
            <>
              {previewItems.map((item) => {
                const isMissing = item.is_missing === 1 || item.status === 'غير موجودة';
                const isMoved = item.is_moved === 1 || item.status === 'منقول' || item.status === 'تم النقل';

                return (
                  <div
                    key={item.part_number}
                    className={`rounded-xl p-3 border transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                      isMissing
                        ? 'bg-red-950/20 border-red-800/60 hover:border-red-500'
                        : 'bg-[#2C1E18] border-[#432d24] hover:border-amber-500/40'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md bg-[#1F1511] text-amber-300 font-mono font-bold text-xs border border-[#4A342B]">
                          رقم: {item.part_number}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-[#3A271F] text-neutral-300 text-xs font-medium">
                          {item.category}
                        </span>

                        {isMissing ? (
                          <span className="text-[11px] px-2.5 py-0.5 rounded-md font-black bg-red-950 text-red-200 border border-red-500 inline-flex items-center gap-1 shadow-sm">
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                            <span>× غير موجودة</span>
                          </span>
                        ) : isMoved ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-md font-bold bg-emerald-950/70 text-emerald-300 border border-emerald-600/60">
                            تم النقل 🟢
                          </span>
                        ) : (
                          <span className="text-[11px] px-2 py-0.5 rounded-md font-bold bg-emerald-950/50 text-emerald-300 border border-emerald-700/50">
                            ✓ موجودة ({item.status})
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-bold text-neutral-100 leading-snug">
                        {item.description_ar}
                      </h4>
                      <p className="text-xs text-neutral-400 font-sans mt-0.5" dir="ltr">
                        {item.description_en}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 bg-[#1A110D] px-3 py-1.5 rounded-lg border border-[#3E291F] text-xs font-mono justify-between md:justify-start">
                      <div className="text-center px-1.5">
                        <span className="block text-[10px] text-neutral-400">إجمالي</span>
                        <span className="font-bold text-amber-300">{item.qty_total}</span>
                      </div>
                      <span className="text-neutral-600">|</span>
                      <div className="text-center px-1.5">
                        <span className="block text-[10px] text-neutral-400">متبقي</span>
                        <span className={`font-bold ${isMissing ? 'text-red-400' : 'text-emerald-400'}`}>
                          {item.qty_remaining}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 justify-end flex-wrap">
                      <button
                        onClick={() =>
                          onMarkItemStatus(
                            item.part_number,
                            isMissing ? 'مضاف' : 'غير موجودة'
                          )
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                          isMissing
                            ? 'bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border-emerald-600/60'
                            : 'bg-red-950/60 hover:bg-red-900/80 text-red-200 border-red-700/60'
                        }`}
                        title="تغيير حالة التوفر (موجودة ✓ / غير موجودة ×)"
                      >
                        {isMissing ? 'تحويل لموجودة ✓' : 'علامة × غير موجودة'}
                      </button>

                      {onOpenRelocate && (
                        <button
                          onClick={() => onOpenRelocate(item)}
                          title="نقل موقع القطعة 🟢"
                          className="px-2.5 py-1 rounded-lg bg-emerald-900/70 hover:bg-emerald-800 text-emerald-200 border border-emerald-500/50 text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm active:scale-95"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
                          <span>نقل 🟢</span>
                        </button>
                      )}

                      <button
                        onClick={() => onEditItem(item)}
                        title="تعديل تفاصيل القطعة"
                        className="p-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-amber-300 border border-[#52382D] cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => onDeleteItem(item.part_number)}
                        title="حذف القطعة"
                        className="p-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-900/50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {items.length > 25 && (
                <div className="pt-2 text-center">
                  <button
                    onClick={() => onOpenLocation(summary.location_code)}
                    className="px-4 py-2 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-bold cursor-pointer"
                  >
                    عرض كافة القطع في هذا الموقع ({items.length.toLocaleString()} قطعة)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
