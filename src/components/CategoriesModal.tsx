import React from 'react';
import { InventoryItem } from '../types';
import { X, Package, ChevronLeft, Layers, ArrowRight } from 'lucide-react';

interface CategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  onSelectCategory: (category: string) => void;
  onOpenItem: (item: InventoryItem) => void;
}

export const CategoriesModal: React.FC<CategoriesModalProps> = ({
  isOpen,
  onClose,
  items,
  onSelectCategory,
  onOpenItem,
}) => {
  const [selectedCat, setSelectedCat] = React.useState<string | null>(null);

  if (!isOpen) return null;

  // Aggregate category stats
  const categoryStats = React.useMemo(() => {
    const map = new Map<
      string,
      { count: number; totalQty: number; remainingQty: number; outQty: number }
    >();

    for (const item of items) {
      const cat = item.category || 'عام';
      const existing = map.get(cat) || { count: 0, totalQty: 0, remainingQty: 0, outQty: 0 };
      existing.count += 1;
      existing.totalQty += item.qty_total;
      existing.remainingQty += item.qty_remaining;
      existing.outQty += item.qty_out;
      map.set(cat, existing);
    }

    return Array.from(map.entries()).map(([name, stats]) => ({
      name,
      ...stats,
    })).sort((a, b) => b.count - a.count);
  }, [items]);

  const categoryItems = React.useMemo(() => {
    if (!selectedCat) return [];
    return items.filter((i) => i.category === selectedCat);
  }, [items, selectedCat]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm overflow-y-auto">
      <div className="bg-[#2C1E18] border border-[#52382D] w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 bg-[#231713] border-b border-[#3D271F] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {selectedCat ? (
              <button
                onClick={() => setSelectedCat(null)}
                className="p-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-amber-400"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <div className="w-9 h-9 rounded-xl bg-[#E67E22]/20 border border-[#E67E22]/40 flex items-center justify-center text-[#E67E22]">
                <Package className="w-5 h-5" />
              </div>
            )}
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                {selectedCat ? `تصنيف: ${selectedCat}` : '📦 تصنيفات قطع الغيار'}
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#E67E22]/20 text-[#E67E22] border border-[#E67E22]/30">
                  {selectedCat ? `${categoryItems.length} قطعة` : `${categoryStats.length} تصنيف`}
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                {selectedCat
                  ? 'عرض وإدارة جميع القطع المندرجة تحت هذا التصنيف'
                  : 'توزيع المخزون حسب الأقسام الصناعية (مسامير، لمبات، جازكيت...)'}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setSelectedCat(null);
              onClose();
            }}
            className="p-2 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-neutral-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {!selectedCat ? (
            /* Categories Grid */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {categoryStats.map((cat) => (
                <div
                  key={cat.name}
                  onClick={() => setSelectedCat(cat.name)}
                  className="p-3.5 rounded-xl bg-[#231713] border border-[#432d24] hover:border-[#E67E22] transition-all cursor-pointer group flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-sm text-neutral-100 group-hover:text-amber-300 transition-colors">
                      {cat.name}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-[#19110D] text-amber-300 font-mono font-bold">
                      {cat.count} صنف
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1 bg-[#19110D] p-2 rounded-lg text-center text-xs font-mono">
                    <div>
                      <span className="text-[10px] text-neutral-400 block">المخزون</span>
                      <span className="font-bold text-amber-300">{cat.totalQty}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-neutral-400 block">الخارج</span>
                      <span className="font-bold text-orange-400">{cat.outQty}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-neutral-400 block">المتبقي</span>
                      <span className="font-bold text-emerald-400">{cat.remainingQty}</span>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-xs text-[#E67E22] font-semibold pt-1">
                    <span>استعراض القطع</span>
                    <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Items inside Selected Category */
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => {
                    onSelectCategory(selectedCat);
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#E67E22] hover:bg-[#d4701a] text-white text-xs font-bold"
                >
                  تطبيق كفلتر في الشاشة الرئيسية
                </button>
              </div>

              {categoryItems.map((item) => (
                <div
                  key={item.part_number}
                  onClick={() => onOpenItem(item)}
                  className="p-3 rounded-xl bg-[#231713] border border-[#432d24] hover:border-amber-500/50 transition-all cursor-pointer flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono font-bold text-amber-300 bg-[#19110D] px-2 py-0.5 rounded">
                        {item.part_number}
                      </span>
                      <span className="font-mono text-neutral-300 bg-[#35241D] px-2 py-0.5 rounded">
                        {item.location_code}
                      </span>
                    </div>
                    <p className="font-bold text-neutral-100">{item.description_ar}</p>
                    <p className="text-[11px] text-neutral-400 font-sans" dir="ltr">
                      {item.description_en}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 bg-[#19110D] px-2.5 py-1 rounded-lg border border-[#3E291F] font-mono text-center">
                    <div>
                      <span className="text-[9px] text-neutral-400 block">المتبقي</span>
                      <span className="font-bold text-emerald-400">{item.qty_remaining}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
