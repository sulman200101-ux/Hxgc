import React, { useState, useEffect } from 'react';
import { InventoryItem } from '../types';
import { exportInventoryListToPdfFile } from '../utils/pdfExportUtil';
import { exportAndShareForEditing } from '../utils/csvExportUtil';
import {
  Edit3,
  Trash2,
  MapPin,
  ArrowRightLeft,
  CheckCircle2,
  FileDown,
  Loader2,
  Check,
  Share2,
  XCircle,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';

interface ItemsTableViewProps {
  items: InventoryItem[];
  onEditItem: (item: InventoryItem) => void;
  onDeleteItem: (partNumber: string) => void;
  onMarkItemStatus: (partNumber: string, status: InventoryItem['status']) => void;
  onOpenRelocate: (item: InventoryItem) => void;
  onToggleGin?: (partNumber: string, currentGin?: string) => void;
}

const PAGE_SIZE = 50;

export const ItemsTableView: React.FC<ItemsTableViewProps> = ({
  items,
  onEditItem,
  onDeleteItem,
  onMarkItemStatus,
  onOpenRelocate,
  onToggleGin,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [items.length]);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageItems = items.slice(startIndex, startIndex + PAGE_SIZE);

  const handleExportTablePdf = async () => {
    setIsExporting(true);
    try {
      await exportInventoryListToPdfFile({
        items: items,
        title: `تقرير جرد الأصناف المعروضة (${items.length.toLocaleString()} صنف)`,
      });
      setExportNotice('تم تصدير وحفظ ملف PDF بنجاح! 📥');
      setTimeout(() => setExportNotice(null), 4000);
    } catch (err) {
      console.error('PDF export error:', err);
      setExportNotice('تعذر تصدير PDF. حاول مرة أخرى؛ لم تتغير بيانات المخزون.');
      setTimeout(() => setExportNotice(null), 5000);
    } finally {
      setIsExporting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="bg-[#2C1E18] rounded-2xl border border-[#432d24] p-12 text-center">
        <p className="text-neutral-400 text-sm">لا توجد قطع مطابقة لمعايير البحث الحالية.</p>
      </div>
    );
  }

  return (
    <div className="bg-[#2C1E18] rounded-2xl border border-[#432d24] shadow-xl overflow-hidden flex flex-col">
      {/* شريط الإجراءات العلوي للجدول */}
      <div className="p-3 bg-[#241712] border-b border-[#3D271F] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-neutral-300">
            إجمالي القطع المطابقة:
          </span>
          <span className="px-2.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-mono text-xs font-bold border border-amber-500/30">
            {items.length.toLocaleString()} قطعة
          </span>
          <span className="text-[11px] text-neutral-400">
            (عرض {startIndex + 1} - {Math.min(startIndex + PAGE_SIZE, items.length)} من {items.length.toLocaleString()})
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {exportNotice && (
            <span className="text-xs text-emerald-400 font-bold flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              {exportNotice}
            </span>
          )}

          <button
            type="button"
            onClick={handleExportTablePdf}
            disabled={isExporting}
            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-all cursor-pointer border border-emerald-500/40 active:scale-95"
          >
            {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
            <span>تصدير PDF 📥</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              setIsExporting(true);
              const success = await exportAndShareForEditing(items.slice(0, 5000));
              if (success) {
                setExportNotice('تم إعداد ومشاركة ملف Excel (CSV)! 📊');
                setTimeout(() => setExportNotice(null), 4000);
              }
              setIsExporting(false);
            }}
            disabled={isExporting}
            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-700 to-indigo-800 hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-all cursor-pointer border border-blue-500/40 active:scale-95"
          >
            <Share2 className="w-3.5 h-3.5 text-blue-200" />
            <span>مشاركة Excel 📊</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead className="bg-[#211612] text-neutral-400 border-b border-[#3D271F] font-bold">
            <tr>
              <th className="py-3.5 px-4">رقم القطعة (10 أرقام)</th>
              <th className="py-3.5 px-4">الموقع (Storage Bin)</th>
              <th className="py-3.5 px-4">اسم ووصف القطعة</th>
              <th className="py-3.5 px-4">التصنيف</th>
              <th className="py-3.5 px-4 text-center">المخزون</th>
              <th className="py-3.5 px-4 text-center">المتبقي</th>
              <th className="py-3.5 px-4 text-center">حالة الجرد</th>
              <th className="py-3.5 px-4 text-center">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3A271F]">
            {pageItems.map((item, idx) => {
              const isMissing = item.is_missing === 1 || item.status === 'غير موجودة';
              const isVerified = !isMissing && item.status === 'مدقق';
              const isMoved = item.is_moved === 1 || item.status === 'تم النقل' || item.status === 'منقول';
              const isGin = Boolean(item.gin_code && item.gin_code.trim());

              return (
                <tr
                  key={`${item.part_number}-${idx}`}
                  className={`transition-colors ${
                    isMissing
                      ? 'bg-red-950/25 hover:bg-red-950/40'
                      : isGin
                      ? 'bg-purple-950/25 hover:bg-purple-950/40'
                      : isVerified
                      ? 'bg-emerald-950/20 hover:bg-emerald-950/35'
                      : 'hover:bg-[#34241D]'
                  }`}
                >
                  <td className="py-3 px-4 font-mono font-bold text-amber-300">
                    <div>{item.part_number}</div>
                    {isGin && (
                      <span className="mt-1 px-2 py-0.5 rounded-md text-[10px] font-black bg-gradient-to-r from-purple-700 to-fuchsia-700 text-white border border-purple-300 inline-block">
                        🔖 قين{item.gin_code !== 'قين' ? `: ${item.gin_code}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-neutral-200">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-amber-500" />
                      {item.location_code}
                    </span>
                    {item.old_location && (
                      <span className="text-[10px] text-neutral-500 block font-normal">
                        السابق: {item.old_location}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-bold text-neutral-100">{item.description_ar}</p>
                    <p className="text-[11px] text-neutral-400 font-sans" dir="ltr">
                      {item.description_en}
                    </p>
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-[#1F1511] text-neutral-300 border border-[#422D22]">
                      {item.category}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center font-mono font-bold text-amber-300">
                    <div>{item.qty_total}</div>
                    {item.qty_out > 0 && !isMissing && (
                      <span className="text-[10px] text-amber-400 block">
                        ناقص: -{item.qty_out}
                      </span>
                    )}
                  </td>
                  <td className={`py-3 px-4 text-center font-mono font-bold ${isMissing ? 'text-red-400' : 'text-emerald-400'}`}>
                    <div>{item.qty_remaining}</div>
                    {item.qty_out > 0 && !isMissing && (
                      <span className="text-[10px] text-emerald-300/80 block">
                        ({item.qty_total} - {item.qty_out})
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {isMissing ? (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-black bg-red-950 text-red-200 border border-red-500 inline-flex items-center gap-1 shadow-sm">
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                        × غير موجودة (بانتظار المشرف)
                      </span>
                    ) : isVerified ? (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-black bg-emerald-950 text-emerald-300 border border-emerald-500 inline-flex items-center gap-1 shadow-sm">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ✓ مدقق
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-950/80 text-amber-300 border border-amber-600/70 inline-flex items-center gap-1">
                        غير مدقق
                      </span>
                    )}
                    {isMoved && !isMissing && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/70 text-emerald-300 border border-emerald-500/60 inline-flex items-center gap-1 mt-1">
                        تم النقل 🟢
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {!isMissing && (
                        <button
                          onClick={() =>
                            onMarkItemStatus(
                              item.part_number,
                              isVerified ? 'غير مدقق' : 'مدقق'
                            )
                          }
                          title="اضغط لتحويل القطعة إلى اللون الأخضر مدقق ✓"
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-black border flex items-center gap-1 transition-all cursor-pointer active:scale-95 ${
                            isVerified
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-md shadow-emerald-950/60'
                              : 'bg-amber-950/80 hover:bg-emerald-800 text-amber-200 hover:text-white border-amber-600/80'
                          }`}
                        >
                          <CheckCircle2 className={`w-3.5 h-3.5 ${isVerified ? 'text-white' : 'text-amber-400'}`} />
                          <span>{isVerified ? 'مدقق ✓' : 'غير مدقق'}</span>
                        </button>
                      )}
                      <button
                        onClick={() =>
                          onMarkItemStatus(
                            item.part_number,
                            isMissing ? 'مدقق' : 'غير موجودة'
                          )
                        }
                        className={`px-2 py-1 rounded text-[11px] font-bold border cursor-pointer transition-all ${
                          isMissing
                            ? 'bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 border-emerald-600/50'
                            : 'bg-red-950/60 hover:bg-red-900 text-red-200 border-red-700/50'
                        }`}
                        title="تبديل علامة × غير موجودة"
                      >
                        {isMissing ? 'تغيير المشرف ✓' : '× غير موجودة'}
                      </button>
                      {onToggleGin && (
                        <button
                          type="button"
                          onClick={() => onToggleGin(item.part_number, item.gin_code)}
                          className={`px-2 py-1 rounded text-[11px] font-black border cursor-pointer transition-all ${
                            isGin
                              ? 'bg-purple-700 hover:bg-purple-600 text-white border-purple-300'
                              : 'bg-purple-950/60 hover:bg-purple-800 text-purple-200 border-purple-700/60'
                          }`}
                          title="وضع أو إزالة إشارة (قين)"
                        >
                          {isGin ? '🔖 قين ✓' : '+ قين'}
                        </button>
                      )}
                      <button
                        onClick={() => onOpenRelocate(item)}
                        className="px-2 py-1 rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                        title="نقل موقع القطعة 🟢"
                      >
                        <ArrowRightLeft className="w-3 h-3 text-emerald-400" />
                        <span>نقل 🟢</span>
                      </button>
                      <button
                        onClick={() => onEditItem(item)}
                        className="p-1 rounded bg-[#2A1B14] text-neutral-300 hover:text-amber-400 border border-[#4D3429] cursor-pointer"
                        title="تعديل القطعة"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDeleteItem(item.part_number)}
                        className="p-1 rounded bg-[#2A1B14] text-neutral-300 hover:text-red-400 border border-[#4D3429] cursor-pointer"
                        title="حذف القطعة"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* شريط التصفح السريع (Pagination) لدعم 100,000 قطعة بدون أي بطء */}
      {totalPages > 1 && (
        <div className="p-3 bg-[#211612] border-t border-[#3D271F] flex items-center justify-between text-xs">
          <span className="text-neutral-400 font-bold">
            صفحة <strong className="text-amber-300 font-mono">{safePage}</strong> من{' '}
            <strong className="text-amber-300 font-mono">{totalPages.toLocaleString()}</strong>
          </span>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={safePage === 1}
              className="px-2.5 py-1 rounded-lg bg-[#2C1E18] hover:bg-[#3A271F] disabled:opacity-40 text-neutral-200 border border-[#4D3429] cursor-pointer font-bold"
            >
              الأولى
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="px-2.5 py-1 rounded-lg bg-[#2C1E18] hover:bg-[#3A271F] disabled:opacity-40 text-neutral-200 border border-[#4D3429] flex items-center gap-1 cursor-pointer font-bold"
            >
              <ChevronRight className="w-3.5 h-3.5" />
              <span>السابقة</span>
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="px-2.5 py-1 rounded-lg bg-[#2C1E18] hover:bg-[#3A271F] disabled:opacity-40 text-neutral-200 border border-[#4D3429] flex items-center gap-1 cursor-pointer font-bold"
            >
              <span>التالية</span>
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={safePage === totalPages}
              className="px-2.5 py-1 rounded-lg bg-[#2C1E18] hover:bg-[#3A271F] disabled:opacity-40 text-neutral-200 border border-[#4D3429] cursor-pointer font-bold"
            >
              الأخيرة
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
