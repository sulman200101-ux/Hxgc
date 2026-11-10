import React, { useState } from 'react';
import { LocationSummary, InventoryItem } from '../types';
import {
  estimatePartSizeProfile,
  isDLocation,
  isCLocation,
  isALocation,
  isFLLocation,
  isConsumablePart,
  MAX_ITEMS_PER_SHELF,
} from '../services/transferSuggestions';
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
  RefreshCw,
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
  onToggleGin?: (partNumber: string, currentGin?: string) => void;
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
  onToggleGin,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const previewItems = items.slice(0, 25);
  const isHeavyD = isDLocation(summary.location_code);
  const isHeavyC = isCLocation(summary.location_code);
  const isConsumableA = isALocation(summary.location_code);
  const isConsumableFL = isFLLocation(summary.location_code);
  const ginCountInLocation = items.filter((i) => Boolean(i.gin_code && i.gin_code.trim())).length;
  const consumableCountInLocation =
    summary.consumable_count ?? items.filter((i) => isConsumablePart(i)).length;

  return (
    <div className="bg-[#2C1E18] rounded-2xl border border-[#432d24] shadow-lg hover:border-amber-700/50 transition-all overflow-hidden mb-4">
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-black text-white tracking-wide font-mono">
                  موقع: {summary.location_code}
                </span>
                {(isHeavyD || isHeavyC) && (
                  <span className="text-xs px-2.5 py-0.5 rounded-md border font-bold bg-emerald-950/90 text-emerald-300 border-emerald-500/60">
                    موقع القطع الثقيلة ({isHeavyC ? 'C' : 'D'})
                  </span>
                )}
                {(isConsumableA || isConsumableFL) && (
                  <span className="text-xs px-2.5 py-0.5 rounded-md border font-bold bg-cyan-950/90 text-cyan-300 border-cyan-500/60">
                    🔄 موقع القطع الاستهلاكية ({isConsumableFL ? 'FL' : 'A'})
                  </span>
                )}
                <span className="text-xs px-2 py-0.5 rounded-md bg-[#3B2820] text-amber-200/80 border border-[#4F362B] font-bold">
                  {summary.item_count} / {MAX_ITEMS_PER_SHELF} أصناف
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                {isHeavyD || isHeavyC
                  ? `رف مخصص للقطع الثقيلة جداً (${isHeavyC ? 'C' : 'D'}) — السعة القصوى ${MAX_ITEMS_PER_SHELF} صنفاً للرف`
                  : isConsumableA || isConsumableFL
                  ? `رف مخصص لنقل وتجميع القطع الاستهلاكية (حرف ${isConsumableFL ? 'FL' : 'A'}) — السعة القصوى ${MAX_ITEMS_PER_SHELF} صنفاً للرف`
                  : `تجميع المتشابهات في الصنف والحجم والملم (MM) — السعة القصوى ${MAX_ITEMS_PER_SHELF} صنفاً للرف`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {consumableCountInLocation > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-cyan-950/90 text-cyan-200 border border-cyan-500/60 text-xs font-black flex items-center gap-1 shadow-sm">
                <RefreshCw className="w-3 h-3 text-cyan-400" />
                <span>🔄 استهلاكية ({consumableCountInLocation})</span>
              </span>
            )}

            {summary.missing_count > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-red-950 text-red-200 border border-red-500 text-xs font-black flex items-center gap-1 shadow-sm">
                <XCircle className="w-3.5 h-3.5 text-red-400" />
                <span>× غير موجودة ({summary.missing_count})</span>
              </span>
            )}

            {summary.added_count > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-600 text-xs font-black flex items-center gap-1 shadow-sm">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>✓ مدقق ({summary.added_count})</span>
              </span>
            )}

            {summary.unverified_count > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-amber-950/80 text-amber-300 border border-amber-600/80 text-xs font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>غير مدقق ({summary.unverified_count})</span>
              </span>
            )}

            {ginCountInLocation > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-purple-950/90 text-purple-200 border border-purple-400 text-xs font-black flex items-center gap-1 shadow-sm">
                <span>🔖 قين ({ginCountInLocation})</span>
              </span>
            )}

            {summary.moved_count > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-emerald-950/70 text-emerald-300 border border-emerald-700/60 text-xs font-bold flex items-center gap-1 shadow-sm">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>🟢 منقول ({summary.moved_count})</span>
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

      {isExpanded && (
        <div className="border-t border-[#432d24] bg-[#221712] p-3 sm:p-4 space-y-2.5">
          {previewItems.length === 0 ? (
            <p className="text-center text-xs text-neutral-500 py-4">لا توجد قطع مطابقة للبحث داخل هذا الموقع</p>
          ) : (
            <>
              {previewItems.map((item, idx) => {
                const isMissing = item.is_missing === 1 || item.status === 'غير موجودة';
                // لا تظهر "مدقق" إلا إذا دققها المستخدم بنفسه (user_verified === 1)
                const isVerified = !isMissing && item.user_verified === 1 && item.status === 'مدقق';
                // لا تظهر "منقول" إلا إذا نقلها المستخدم بنفسه (is_moved === 1)
                const isMoved =
                  !isMissing &&
                  item.is_moved === 1 &&
                  (item.status === 'منقول' || item.status === 'تم النقل');
                const isGin = Boolean(item.gin_code && item.gin_code.trim());
                const sizeProf = estimatePartSizeProfile(item);
                const isConsumable = sizeProf.isConsumable;

                return (
                  <div
                    key={`${item.part_number}-${idx}`}
                    className={`rounded-xl p-3 border transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                      isMissing
                        ? 'bg-red-950/20 border-red-800/60 hover:border-red-500'
                        : isGin
                        ? 'bg-purple-950/25 border-purple-500/70 hover:border-purple-400'
                        : isVerified
                        ? 'bg-emerald-950/20 border-emerald-600/60 hover:border-emerald-400'
                        : 'bg-[#2C1E18] border-[#432d24] hover:border-amber-500/40'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md bg-[#1F1511] text-amber-300 font-mono font-bold text-xs border border-[#4A342B]">
                          رقم: {item.part_number}
                        </span>
                        {isConsumable && (
                          <span className="px-2.5 py-0.5 rounded-md bg-cyan-950 text-cyan-200 border border-cyan-500/70 text-[11px] font-black shadow-sm inline-flex items-center gap-1">
                            <span>🔄 قطعة استهلاكية (تنقل إلى {sizeProf.consumableTargetType})</span>
                          </span>
                        )}
                        {isGin && (
                          <span className="px-2.5 py-0.5 rounded-md bg-gradient-to-r from-purple-700 to-fuchsia-700 text-white border border-purple-300 text-xs font-black shadow-sm inline-flex items-center gap-1">
                            <span>🔖 قين{item.gin_code !== 'قين' ? `: ${item.gin_code}` : ''}</span>
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-md bg-[#3A271F] text-neutral-300 text-xs font-medium">
                          {item.category}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-[#1B120E] text-amber-200 border border-amber-700/40 text-[11px] font-bold">
                          المقاس: {sizeProf.dimensionsLabel}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-emerald-950/70 text-emerald-200 border border-emerald-600/40 text-[11px] font-bold">
                          💰 ~{sizeProf.estimatedPriceSar.toLocaleString('en-US')} ر.س
                        </span>

                        {isMissing ? (
                          <span className="text-[11px] px-2.5 py-0.5 rounded-md font-black bg-red-950 text-red-200 border border-red-500 inline-flex items-center gap-1 shadow-sm">
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                            <span>× غير موجودة (بانتظار المشرف)</span>
                          </span>
                        ) : isVerified ? (
                          <span className="text-[11px] px-2.5 py-0.5 rounded-md font-black bg-emerald-950 text-emerald-300 border border-emerald-500 inline-flex items-center gap-1 shadow-sm">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>✓ مدقق</span>
                          </span>
                        ) : (
                          <span className="text-[11px] px-2.5 py-0.5 rounded-md font-bold bg-amber-950/80 text-amber-300 border border-amber-600/70 inline-flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                            <span>غير مدقق</span>
                          </span>
                        )}
                        {isMoved && (
                          <span className="text-[11px] px-2 py-0.5 rounded-md font-bold bg-emerald-950/70 text-emerald-300 border border-emerald-600/60">
                            منقول 🟢{item.old_location ? ` (من ${item.old_location})` : ''}
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
                        <span className="block text-[10px] text-neutral-400">العدد الأصلي</span>
                        <span className="font-bold text-amber-300">{item.qty_total}</span>
                      </div>
                      {item.qty_out > 0 && !isMissing && (
                        <>
                          <span className="text-neutral-600">-</span>
                          <div className="text-center px-1.5">
                            <span className="block text-[10px] text-amber-400">ناقص</span>
                            <span className="font-bold text-amber-400">-{item.qty_out}</span>
                          </div>
                          <span className="text-neutral-600">=</span>
                        </>
                      )}
                      {(!item.qty_out || isMissing) && <span className="text-neutral-600">|</span>}
                      <div className="text-center px-1.5">
                        <span className="block text-[10px] text-neutral-400">يبقى بالمخزون</span>
                        <span className={`font-bold ${isMissing ? 'text-red-400' : 'text-emerald-400'}`}>
                          {item.qty_remaining}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 justify-end flex-wrap">
                      {!isMissing && (
                        <button
                          onClick={() =>
                            onMarkItemStatus(
                              item.part_number,
                              isVerified ? 'غير مدقق' : 'مدقق'
                            )
                          }
                          title="اضغط لتدقيق القطعة بنفسك وتحويلها إلى مدقق ✓"
                          className={`px-3 py-1 rounded-lg text-xs font-black border flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 ${
                            isVerified
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-md shadow-emerald-950/60'
                              : 'bg-amber-950/80 hover:bg-emerald-800 text-amber-200 hover:text-white border-amber-600/80'
                          }`}
                        >
                          <CheckCircle2 className={`w-3.5 h-3.5 ${isVerified ? 'text-white' : 'text-amber-400'}`} />
                          <span>{isVerified ? 'مدقق ✓' : 'غير مدقق (اضغط للتدقيق)'}</span>
                        </button>
                      )}
                      <button
                        onClick={() =>
                          onMarkItemStatus(
                            item.part_number,
                            // عند إلغاء علامة غير موجودة تعود إلى غير مدقق حتى يدققها المستخدم بنفسه
                            isMissing ? 'غير مدقق' : 'غير موجودة'
                          )
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                          isMissing
                            ? 'bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border-emerald-600/60'
                            : 'bg-red-950/60 hover:bg-red-900/80 text-red-200 border-red-700/60'
                        }`}
                        title="تغيير حالة التوفر (إلغاء علامة × أو وضع علامة × غير موجودة)"
                      >
                        {isMissing ? 'إلغاء علامة × (إرجاع للمخزون)' : 'علامة × غير موجودة'}
                      </button>

                      {onToggleGin && (
                        <button
                          type="button"
                          onClick={() => onToggleGin(item.part_number, item.gin_code)}
                          title="وضع أو إزالة إشارة (قين) على بطاقة القطعة"
                          className={`px-2.5 py-1 rounded-lg text-xs font-black border transition-all cursor-pointer ${
                            isGin
                              ? 'bg-purple-700 hover:bg-purple-600 text-white border-purple-300 shadow-sm'
                              : 'bg-purple-950/60 hover:bg-purple-800 text-purple-200 border-purple-700/60'
                          }`}
                        >
                          {isGin ? '🔖 قين ✓' : '+ إشارة قين'}
                        </button>
                      )}

                      {onOpenRelocate && (
                        <button
                          onClick={() => onOpenRelocate(item)}
                          title="نقل موقع القطعة 🟢"
                          className="px-2.5 py-1 rounded-lg bg-emerald-900/70 hover:bg-emerald-800 text-emerald-200 border border-emerald-500/50 text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm active:scale-95"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{isConsumable ? `نقل إلى ${sizeProf.consumableTargetType} 🟢` : 'نقل 🟢'}</span>
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
