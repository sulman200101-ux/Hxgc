import React, { useState, useMemo } from 'react';
import { InventoryItem } from '../types';
import { dbService } from '../services/db';
import { exportCategoryToPdfFile, exportInventoryListToPdfFile } from '../utils/pdfExportUtil';
import {
  Package,
  ArrowRight,
  MapPin,
  ChevronLeft,
  X,
  Search,
  Edit3,
  Trash2,
  Printer,
  CheckCircle2,
  ExternalLink,
  ArrowRightLeft,
  XCircle,
} from 'lucide-react';

interface CategoriesCatalogViewProps {
  onBack: () => void;
  onOpenLocation: (locationCode: string) => void;
  onEditItem: (item: InventoryItem) => void;
  onDeleteItem: (partNumber: string) => void;
  onOpenRelocate: (item: InventoryItem) => void;
}

export const CategoriesCatalogView: React.FC<CategoriesCatalogViewProps> = ({
  onBack,
  onOpenLocation,
  onEditItem,
  onDeleteItem,
  onOpenRelocate,
}) => {
  const categoryGroups = useMemo(() => {
    return dbService.getCategoryGroups();
  }, [dbService.getTotalCount()]);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(50);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const selectedCategoryItems = useMemo(() => {
    if (!selectedCategory) return [];
    return dbService.getItemsByCategory(selectedCategory);
  }, [selectedCategory]);

  const filteredGroups = useMemo(() => {
    if (!searchFilter.trim()) return categoryGroups;
    const q = searchFilter.toLowerCase();
    return categoryGroups.filter((g) => g.category.toLowerCase().includes(q));
  }, [categoryGroups, searchFilter]);

  const getCategoryIcon = (category: string) => {
    const c = category.toLowerCase();
    if (c.includes('مسمار') || c.includes('مسامير')) return '🔩';
    if (c.includes('جازكيت')) return '⚙️';
    if (c.includes('لمب') || c.includes('إضاءة') || c.includes('كهرباء')) return '💡';
    if (c.includes('فلنج') || c.includes('أنبوب') || c.includes('أنابيب')) return '⭕';
    if (c.includes('صمام') || c.includes('محبس')) return '🚰';
    if (c.includes('فلتر') || c.includes('مصفا')) return '🌪️';
    if (c.includes('رولمان') || c.includes('محمل')) return '🔘';
    if (c.includes('قياس') || c.includes('ضغط')) return '🧭';
    return '📦';
  };

  const handleExportPdf = async (targetCategory?: string) => {
    setIsExportingPdf(true);
    try {
      if (targetCategory) {
        const itemsToExport = dbService.getItemsByCategory(targetCategory);
        await exportCategoryToPdfFile({
          categoryName: targetCategory,
          items: itemsToExport,
        });
        setExportNotice(`تم تصدير ملف PDF لصنف (${targetCategory}) بنجاح! 📥`);
      } else {
        const itemsToExport = dbService.getAllItems();
        await exportInventoryListToPdfFile({
          items: itemsToExport,
          title: 'تقرير شامل لحركة ونقل أصناف أسمو (ASMO)',
        });
        setExportNotice('تم تصدير ملف PDF الشامل بنجاح! 📥');
      }
      setTimeout(() => setExportNotice(null), 4000);
    } catch (err) {
      console.error('PDF export error:', err);
      window.alert('تعذر تصدير PDF. حاول مرة أخرى؛ لم تتغير بيانات المخزون.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const visibleCategoryItems = selectedCategoryItems.slice(0, visibleLimit);

  return (
    <div className="bg-[#2C1E18] rounded-2xl border border-[#432d24] shadow-2xl overflow-hidden flex flex-col min-h-[650px] relative">
      {exportNotice && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <div className="px-4 py-2.5 rounded-xl bg-emerald-950 text-emerald-200 border border-emerald-700 shadow-2xl text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{exportNotice}</span>
          </div>
        </div>
      )}

      {/* الشريط العلوي */}
      <div className="p-4 bg-[#231713] border-b border-[#3D271F] flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="px-3.5 py-1.5 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-amber-300 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer border border-[#543A2F]"
          >
            <ArrowRight className="w-4 h-4" />
            <span>⬅ عودة للمواقع</span>
          </button>

          <div className="flex items-center gap-2">
            <Package className="w-6 h-6 text-[#E67E22]" />
            <div>
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                دليل الأصناف المنظم
              </h2>
              <p className="text-xs text-neutral-400">
                تجميع ذكي لكافة القطع حسب نوعها ومواقعها الفعلية
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
          <button
            onClick={() => handleExportPdf()}
            disabled={isExportingPdf}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-950/50 border border-emerald-600/50 transition-all cursor-pointer shrink-0"
          >
            <Printer className="w-4 h-4 text-emerald-300" />
            <span>تصدير تقرير PDF</span>
          </button>

          <div className="relative flex-1 md:w-56">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="بحث في أسماء الأصناف..."
              className="w-full pl-3 pr-9 py-2 rounded-xl bg-[#19110D] text-neutral-200 placeholder-neutral-500 border border-[#443027] focus:outline-none focus:border-amber-500 text-xs"
            />
          </div>
        </div>
      </div>

      {/* شبكة بطاقات الأصناف */}
      <div className="p-5 flex-1 overflow-y-auto">
        <div className="text-xs text-neutral-400 font-semibold mb-3 flex items-center justify-between">
          <span>الأصناف المسجلة ({filteredGroups.length} صنف):</span>
          <span className="text-amber-400 text-[11px]">اضغط على أي بطاقة لعرض كافة مقاساتها ومواقعها</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredGroups.map((group) => {
            const icon = getCategoryIcon(group.category);
            return (
              <div
                key={group.category}
                onClick={() => {
                  setSelectedCategory(group.category);
                  setVisibleLimit(50);
                }}
                className="bg-[#231713] rounded-2xl p-4 border border-[#432d24] hover:border-amber-500/60 hover:bg-[#281b16] transition-all cursor-pointer group shadow-md flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="w-10 h-10 rounded-xl bg-[#2F1F19] border border-[#4C3328] flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                        {icon}
                      </span>
                      <div>
                        <h3 className="text-base font-black text-white group-hover:text-amber-300 transition-colors">
                          {group.category}
                        </h3>
                        <span className="text-[11px] text-neutral-400">
                          {group.missing_count > 0
                            ? `منها ${group.missing_count} معلمة بـ (× غير موجودة)`
                            : 'كافة القطع متوفرة ✓'}
                        </span>
                      </div>
                    </div>

                    <span className="px-2.5 py-1 rounded-xl bg-[#3A271F] text-amber-300 text-xs font-mono font-bold border border-[#543A2F]">
                      {group.count.toLocaleString()} قطعة
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-[#19110D] p-2.5 rounded-xl border border-[#3E2A21] mb-3">
                    <div>
                      <span className="text-neutral-500 block text-[10px]">المواقع المتواجدة بها</span>
                      <span className="font-bold text-amber-200 flex items-center gap-1 font-mono">
                        <MapPin className="w-3 h-3 text-amber-500" />
                        {group.locations_count.toLocaleString()} موقع
                      </span>
                    </div>

                    <div>
                      <span className="text-neutral-500 block text-[10px]">إجمالي المتبقي بالمخزن</span>
                      <span className="font-bold text-emerald-400 font-mono">
                        {group.remaining_qty.toLocaleString()} قطعة
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#34241D] flex items-center justify-between text-xs font-bold text-amber-400 group-hover:text-amber-300">
                  <span>استعراض المقاسات والمواقع</span>
                  <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* نافذة تفاصيل الصنف */}
      {selectedCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-sm">
          <div className="bg-[#2C1E18] border border-[#52382D] w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 bg-[#231713] border-b border-[#3D271F] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl">
                  {getCategoryIcon(selectedCategory)}
                </span>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                    قطع صنف: <span className="text-amber-300 underline">{selectedCategory}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700 font-mono font-bold">
                      {selectedCategoryItems.length.toLocaleString()} قطعة
                    </span>
                  </h3>
                  <p className="text-xs text-neutral-400">
                    كافة مقاسات الصنف ومواقع التخزين وحالة التوفر (✓ / ×)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExportPdf(selectedCategory)}
                  className="px-3 py-1.5 rounded-xl bg-[#27AE60] hover:bg-[#219150] text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>تصدير PDF للصنف</span>
                </button>

                <button
                  onClick={() => setSelectedCategory(null)}
                  className="p-2 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-neutral-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-3">
              {visibleCategoryItems.map((item) => {
                const isMissing = item.is_missing === 1 || item.status === 'غير موجودة';
                const isMoved = item.is_moved === 1 || item.status === 'تم النقل' || item.status === 'منقول';

                return (
                  <div
                    key={item.part_number}
                    className={`rounded-xl p-3.5 border transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs ${
                      isMissing
                        ? 'bg-red-950/25 border-red-700/60 hover:border-red-500'
                        : 'bg-[#231713] border-[#432d24] hover:border-amber-500/50'
                    }`}
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-neutral-400 font-medium">الوصف العربي:</span>
                        <h4 className="font-bold text-white text-sm">
                          {item.description_ar}
                        </h4>
                        {isMissing && (
                          <span className="px-2 py-0.5 rounded-md bg-red-950 text-red-200 border border-red-500 font-black text-[11px] inline-flex items-center gap-1">
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                            × غير موجودة
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-neutral-300 pt-0.5">
                        <span className="font-mono text-amber-300 font-bold bg-[#19110D] px-2 py-0.5 rounded border border-[#3D271F]">
                          رقم القطعة: {item.part_number}
                        </span>
                        <span className="text-neutral-600">|</span>
                        <span className="flex items-center gap-1 font-mono text-neutral-200">
                          <MapPin className="w-3.5 h-3.5 text-amber-500" />
                          الموقع: <strong>{item.location_code}</strong>
                        </span>
                        <span className="text-neutral-600">|</span>
                        {isMissing ? (
                          <span className="text-red-300 font-bold">× غير موجودة بالرف</span>
                        ) : isMoved ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/60">
                            تم النقل 🟢
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-950/50 text-emerald-300 border border-emerald-700/50">
                            ✓ موجودة
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-neutral-400 font-sans" dir="ltr">
                        {item.description_en}
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 justify-end shrink-0">
                      <div className="bg-[#19110D] px-3 py-1.5 rounded-lg border border-[#3E2A21] font-mono text-center">
                        <span className="text-[10px] text-neutral-500 block">المتبقي</span>
                        <span className={`font-bold text-sm ${isMissing ? 'text-red-400' : 'text-emerald-400'}`}>
                          {item.qty_remaining}
                        </span>
                      </div>

                      <button
                        onClick={() => {
                          setSelectedCategory(null);
                          onOpenRelocate(item);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-900/70 hover:bg-emerald-800 text-emerald-200 border border-emerald-500/50 font-bold text-xs flex items-center gap-1 cursor-pointer transition-all shadow-sm active:scale-95"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
                        <span>نقل 🟢</span>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedCategory(null);
                          onOpenLocation(item.location_code);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-amber-300 font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <span>فتح الموقع</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>

                      <button
                        onClick={() => {
                          setSelectedCategory(null);
                          onEditItem(item);
                        }}
                        className="p-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-neutral-300 cursor-pointer"
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

              {selectedCategoryItems.length > visibleLimit && (
                <div className="pt-2 text-center">
                  <button
                    onClick={() => setVisibleLimit((prev) => prev + 50)}
                    className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold cursor-pointer"
                  >
                    عرض المزيد ({selectedCategoryItems.length - visibleLimit} متبقية)
                  </button>
                </div>
              )}
            </div>

            <div className="p-3 bg-[#231713] border-t border-[#3D271F] flex items-center justify-between text-xs">
              <span className="text-neutral-400">
                إجمالي قطع هذا الصنف: <strong className="text-white font-mono">{selectedCategoryItems.length.toLocaleString()}</strong>
              </span>

              <button
                onClick={() => setSelectedCategory(null)}
                className="px-4 py-1.5 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-neutral-200 font-bold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
