import React, { useState } from 'react';
import { InventoryItem } from '../types';
import { exportCategoryToPdfFile } from '../utils/pdfExportUtil';
import { 
  ArrowRight, 
  Printer, 
  RotateCcw, 
  MapPin, 
  Edit3, 
  Trash2, 
  Package, 
  Layers, 
  CheckCircle2,
  ChevronLeft,
  ArrowRightLeft,
  FileDown,
  Loader2
} from 'lucide-react';

interface CategoryGroupScreenProps {
  items: InventoryItem[];
  onBack: () => void;
  onOpenLocation: (locationCode: string) => void;
  onEditItem: (item: InventoryItem) => void;
  onDeleteItem: (partNumber: string) => void;
  onOpenRelocate?: (item: InventoryItem) => void;
  initialCategory?: string;
}

export const CategoryGroupScreen: React.FC<CategoryGroupScreenProps> = ({
  items,
  onBack,
  onOpenLocation,
  onEditItem,
  onDeleteItem,
  onOpenRelocate,
  initialCategory,
}) => {
  // State: null means we are at "كتالوج الأصناف المتشابهة"
  // string (e.g. "مسامير") means we are viewing items of that category
  const [activeCategory, setActiveCategory] = useState<string | null>(initialCategory || null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // حساب الأصناف الفريدة مع عدد القطع لكل صنف
  const uniqueCategories = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const cat = item.category || 'عام';
      map.set(cat, (map.get(cat) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  // القطع التابعة للصنف المحدد
  const categoryItems = React.useMemo(() => {
    if (!activeCategory) return [];
    const cat = activeCategory.trim().toLowerCase();
    return items.filter((i) => {
      const itemCat = (i.category || '').toLowerCase();
      return itemCat === cat || itemCat.includes(cat) || cat.includes(itemCat);
    });
  }, [items, activeCategory]);

  // دالة تصدير وطباعة تقرير النقل (PDF)
  const [isExporting, setIsExporting] = useState(false);

  const generateCategoryPdf = async (categoryName: string) => {
    setIsExporting(true);
    try {
      await exportCategoryToPdfFile({
        categoryName,
        items: categoryItems,
      });
      setExportNotice(`تم تصدير ملف PDF لتصنيف (${categoryName}) بنجاح! 📥`);
      setTimeout(() => setExportNotice(null), 4000);
    } catch (err) {
      console.error('PDF export error:', err);
      window.print();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-[#2C1E18] rounded-2xl border border-[#432d24] shadow-xl overflow-hidden flex flex-col min-h-[550px]">
      {/* الشريط العلوي مطابق للكود: ⬅ عودة | كتالوج الأصناف المتشابهة */}
      <div className="p-4 bg-[#231713] border-b border-[#3D271F] flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-3.5 py-1.5 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-amber-300 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer border border-[#543A2F]"
        >
          <ArrowRight className="w-4 h-4" />
          <span>⬅ عودة</span>
        </button>

        <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
          <Package className="w-5 h-5 text-[#E67E22]" />
          <span>كتالوج الأصناف المتشابهة</span>
        </h2>
      </div>

      {/* إشعار تصدير التقرير */}
      {exportNotice && (
        <div className="bg-[#27AE60]/20 border-b border-[#27AE60]/40 p-2.5 px-4 text-xs font-bold text-emerald-300 flex items-center justify-between">
          <span>{exportNotice}</span>
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        </div>
      )}

      {/* منطقة المحتوى القابلة للتمرير (scroll_frame) */}
      <div className="p-4 overflow-y-auto flex-1 space-y-3">
        {/* الحالة الأولى: عرض بطاقات الأصناف الفريدة (load_unique_categories) */}
        {!activeCategory ? (
          <div className="space-y-3">
            <div className="text-xs text-neutral-400 font-semibold mb-2">
              اختر صنفاً لتتبع حركته والقطع التابعة له ومواقعها:
            </div>

            {uniqueCategories.map(([catName, count]) => (
              <div
                key={catName}
                className="bg-[#231713] rounded-xl p-4 border border-[#432d24] hover:border-amber-500/40 transition-all flex items-center justify-between gap-3 shadow-md"
              >
                {/* lbl: صنف: {cat_name} ({count} قطعة) */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#D35400]/20 border border-[#D35400]/40 flex items-center justify-center text-[#E67E22] font-black">
                    ⚙️
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-white">
                      صنف: {catName}
                    </h3>
                    <span className="text-xs text-neutral-400">
                      ({count} قطعة مسجلة)
                    </span>
                  </div>
                </div>

                {/* btn_open: عرض وتتبع القطع (fg_color="#D35400") */}
                <button
                  onClick={() => setActiveCategory(catName)}
                  className="px-4 py-2 rounded-xl bg-[#D35400] hover:bg-[#b84500] text-white text-xs font-black flex items-center gap-1.5 shadow-lg shadow-orange-950/40 transition-all cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>عرض وتتبع القطع</span>
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* الحالة الثانية: تجميع القطع المتشابهة وتطبيق التلوين الجديد (open_category_items) */
          <div className="space-y-3">
            {/* top_bar: ⤴ عودة لكتالوج الأصناف | 🖨️ طباعة تقرير النقل (PDF) */}
            <div className="p-2.5 rounded-xl bg-[#1F1511] border border-[#3A271F] flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={() => setActiveCategory(null)}
                className="px-3 py-1.5 rounded-xl bg-[#7F8C8D] hover:bg-[#6c7a7b] text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-md"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>⤴ عودة لكتالوج الأصناف</span>
              </button>

              <div className="text-xs font-bold text-amber-300">
                الصنف الحالي: <span className="text-white underline">{activeCategory}</span> ({categoryItems.length} قطعة)
              </div>

              <button
                onClick={() => generateCategoryPdf(activeCategory)}
                className="px-3.5 py-1.5 rounded-xl bg-[#27AE60] hover:bg-[#219653] text-white text-xs font-black flex items-center gap-1.5 shadow-md shadow-emerald-950/40 transition-all cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>🖨️ طباعة تقرير النقل (PDF)</span>
              </button>
            </div>

            {/* قائمة القطع التابعة للصنف مع التلوين (أخضر للنقل | برتقالي لعدم النقل) */}
            {categoryItems.map((item) => {
              const isMoved = item.is_moved === 1 || item.status === 'تم النقل' || item.status === 'منقول';
              const movedMark = isMoved ? 'تم النقل 🟢' : 'لم تنتقل 🟠';
              const textColorClass = isMoved ? 'text-[#2ECC71]' : 'text-[#E67E22]';
              const borderClass = isMoved ? 'border-emerald-800/40 hover:border-[#2ECC71]/70' : 'border-orange-800/40 hover:border-[#E67E22]/70';

              return (
                <div
                  key={item.part_number}
                  className={`bg-[#231713] rounded-xl p-3.5 border ${borderClass} transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs`}
                >
                  {/* lbl_detail:
                      الوصف: {desc_ar}
                      رقم القطعة: {part_num} | الموقع: {loc_code} | المتبقي: {qty_rem} | {moved_mark}
                  */}
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-neutral-400 font-medium">الوصف:</span>
                      <h4 className="font-bold text-neutral-100 text-sm">
                        {item.description_ar}
                      </h4>
                    </div>

                    <div className={`flex flex-wrap items-center gap-2 pt-0.5 font-bold ${textColorClass}`}>
                      <span className="font-mono text-amber-300 bg-[#19110D] px-2 py-0.5 rounded border border-[#3D271F]">
                        رقم القطعة: {item.part_number}
                      </span>
                      <span className="text-neutral-600">|</span>
                      <span className="flex items-center gap-1 font-mono text-neutral-200">
                        <MapPin className="w-3.5 h-3.5 text-amber-500" />
                        الموقع: {item.location_code}
                      </span>
                      <span className="text-neutral-600">|</span>
                      <span>المتبقي: <strong className="font-mono">{item.qty_remaining}</strong></span>
                      <span className="text-neutral-600">|</span>
                      <span className={`px-2.5 py-0.5 rounded text-[11px] font-bold border ${
                        isMoved
                          ? 'bg-emerald-950/70 text-[#2ECC71] border-emerald-700/60'
                          : 'bg-orange-950/70 text-[#E67E22] border-orange-700/60'
                      }`}>
                        {movedMark}
                      </span>
                    </div>

                    <p className="text-[11px] text-neutral-400 font-sans" dir="ltr">
                      {item.description_en}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 justify-end shrink-0">
                    {onOpenRelocate && (
                      <button
                        onClick={() => onOpenRelocate(item)}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-900/70 hover:bg-emerald-800 text-emerald-200 border border-emerald-500/50 font-bold text-xs flex items-center gap-1 cursor-pointer transition-all shadow-sm active:scale-95"
                        title="نقل موقع القطعة 🟢"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
                        <span>نقل موقع القطعة 🟢</span>
                      </button>
                    )}
                    <button
                      onClick={() => onOpenLocation(item.location_code)}
                      className="px-3 py-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-amber-300 font-bold"
                    >
                      فتح الموقع
                    </button>

                    <button
                      onClick={() => onEditItem(item)}
                      className="p-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-neutral-300"
                      title="تعديل"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => onDeleteItem(item.part_number)}
                      className="p-1.5 rounded-lg bg-red-950/50 hover:bg-red-900 text-red-400 border border-red-900/50"
                      title="حذف"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
