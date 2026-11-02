import React from 'react';
import { Search, Plus, X, Trash2, FileText, XCircle, Database } from 'lucide-react';

interface HeaderProps {
  locationCount: number;
  totalItemsCount: number;
  remainingTotal: number;
  movedCount?: number;
  missingCount?: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchField?: 'all' | 'part' | 'name' | 'location';
  onSearchFieldChange?: (field: 'all' | 'part' | 'name' | 'location') => void;
  selectedStatus: string;
  onStatusChange: (status: string) => void;
  activeTab: 'locations' | 'categories' | 'items' | 'similar';
  onTabChange: (tab: 'locations' | 'categories' | 'items' | 'similar') => void;
  onOpenAddItem: () => void;
  onOpenWipeModal: () => void;
  onOpenRelocationReport?: () => void;
  onGenerateBulk100k?: () => void;
  isBulkLoading?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  locationCount,
  totalItemsCount,
  remainingTotal,
  movedCount = 0,
  missingCount = 0,
  searchQuery,
  onSearchChange,
  searchField = 'all',
  onSearchFieldChange,
  selectedStatus,
  onStatusChange,
  activeTab,
  onTabChange,
  onOpenAddItem,
  onOpenWipeModal,
  onOpenRelocationReport,
  onGenerateBulk100k,
  isBulkLoading = false,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-[#2C1E18] border-b border-[#432d24] shadow-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-1.5 pb-2.5">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5">
          {/* الشعار والعنوان */}
          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center gap-2.5">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FF7A00] via-[#E65100] to-[#9E2A00] flex items-center justify-center shadow-lg shadow-orange-950/80 border-2 border-[#FFB74D] relative overflow-hidden">
                <svg className="absolute inset-0 w-full h-full opacity-35 pointer-events-none" viewBox="0 0 44 44" fill="none">
                  <rect x="3" y="3" width="38" height="38" rx="9" stroke="#FFE082" strokeWidth="1.2" strokeDasharray="3 2" />
                  <circle cx="22" cy="22" r="16" stroke="#FFD54F" strokeWidth="1" />
                  <path d="M22 3L25 8L22 13L19 8L22 3Z" fill="#FFD54F" />
                  <path d="M22 31L25 36L22 41L19 36L22 31Z" fill="#FFD54F" />
                  <path d="M3 22L8 19L13 22L8 25L3 22Z" fill="#FFD54F" />
                  <path d="M31 22L36 19L41 22L36 25L31 22Z" fill="#FFD54F" />
                </svg>
                <span className="relative z-10 text-white font-black text-lg tracking-wider drop-shadow">A</span>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight leading-tight">
                    قطع الغيار - أسمو
                  </h1>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/25 text-emerald-300 font-black border border-emerald-400/50 font-mono">
                    v2.7.0
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/25 text-amber-200 font-bold border border-amber-400/40">
                    سقف 15 صنف للرف
                  </span>
                </div>
                <p className="text-[11px] text-amber-200/60 font-medium">
                  نظام الجرد الذكي للمواقع والأرقام الـ 10 (SAP Controller)
                </p>
              </div>
            </div>

            {/* شارة للموبايل */}
            <div className="flex sm:hidden items-center gap-1.5">
              <span className="px-2 py-1 rounded-lg bg-[#3F2B22] text-amber-300 text-[11px] font-bold border border-[#5A3F33]">
                {locationCount.toLocaleString()} موقع
              </span>
              <button
                type="button"
                onClick={onOpenWipeModal}
                className="px-2 py-1 rounded-lg bg-[#3F2B22] hover:bg-red-950/70 text-emerald-400 hover:text-red-300 text-[11px] font-bold border border-[#5A3F33] flex items-center gap-1 cursor-pointer transition-colors"
                title="مسح كل ما في البرنامج"
              >
                <span>{totalItemsCount.toLocaleString()} قطعة</span>
                <Trash2 className="w-3 h-3 text-red-400" />
              </button>
            </div>
          </div>

          {/* إحصائيات سريعة */}
          <div className="hidden sm:flex items-center gap-2 flex-wrap">
            <div className="px-3 py-1 rounded-xl bg-[#3A271F] border border-[#52382D] flex items-center gap-1.5 text-xs">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              <span className="text-neutral-300 font-medium">المواقع:</span>
              <span className="font-bold text-amber-300 font-mono">{locationCount.toLocaleString()}</span>
            </div>

            <button
              type="button"
              onClick={onOpenWipeModal}
              title="مسح وتصفير كافة بيانات البرنامج (محمي بـ 4 أرقام سرية)"
              className="px-3 py-1 rounded-xl bg-[#3A271F] hover:bg-[#4E271F] border border-[#52382D] hover:border-red-500/60 flex items-center gap-1.5 text-xs transition-all cursor-pointer group shadow-sm"
            >
              <span className="text-neutral-300 font-medium">القطع:</span>
              <span className="font-bold text-emerald-400 font-mono">{totalItemsCount.toLocaleString()}</span>
              <span className="p-0.5 rounded bg-red-950/50 text-red-400 group-hover:bg-red-600 group-hover:text-white transition-colors">
                <Trash2 className="w-3 h-3" />
              </span>
            </button>

            <div className="px-3 py-1 rounded-xl bg-[#3A271F] border border-[#52382D] flex items-center gap-1.5 text-xs">
              <span className="text-neutral-300 font-medium">المتبقي:</span>
              <span className="font-bold text-blue-400 font-mono">{remainingTotal.toLocaleString()}</span>
            </div>

            {/* شارة القطع المعلمة بـ × غير موجودة */}
            <button
              type="button"
              onClick={() => onStatusChange(selectedStatus === 'غير موجودة' ? 'الكل' : 'غير موجودة')}
              title="عرض القطع المعلمة بـ (× غير موجودة) في أوراق الجرد"
              className={`px-3 py-1 rounded-xl border flex items-center gap-1.5 text-xs font-bold cursor-pointer transition-all ${
                selectedStatus === 'غير موجودة'
                  ? 'bg-red-700 text-white border-red-400 shadow-md'
                  : 'bg-red-950/70 hover:bg-red-900/70 text-red-300 border-red-700/60'
              }`}
            >
              <XCircle className="w-3.5 h-3.5 text-red-400" />
              <span>× غير موجودة:</span>
              <span className="font-mono font-black">{missingCount.toLocaleString()}</span>
            </button>
          </div>

          {/* أزرار الإجراءات العلوية */}
          <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end flex-wrap">
            <button
              type="button"
              onClick={onOpenWipeModal}
              title="مسح شامل للبرنامج وتصفير كافة البيانات مع طلب الاعتماد"
              className="px-3 py-1.5 rounded-xl bg-red-950/80 hover:bg-red-800 text-red-200 hover:text-white text-xs font-bold flex items-center gap-1.5 border border-red-600/50 transition-all cursor-pointer shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <span>مسح شامل</span>
            </button>

            {onOpenRelocationReport && (
              <button
                type="button"
                onClick={onOpenRelocationReport}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-800 to-emerald-950 hover:from-emerald-700 hover:to-emerald-900 text-emerald-200 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-950/50 transition-all cursor-pointer border border-emerald-500/50"
              >
                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                <span>تقرير المنقولة</span>
                {movedCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-neutral-950 text-[10px] font-black">
                    {movedCount}
                  </span>
                )}
              </button>
            )}

            <button
              onClick={onOpenAddItem}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white text-xs font-bold flex items-center gap-1 shadow-md shadow-amber-900/50 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة قطعة</span>
            </button>
          </div>
        </div>

        {/* شريط البحث السريع بـ: اسم القطعة | رقم القطعة (10 أرقام) | الموقع */}
        <div className="mt-2.5 pt-2 border-t border-[#3F2B22] flex flex-col gap-2">
          <div className="flex flex-col md:flex-row items-center gap-2">
            {/* حقل البحث الفوري */}
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-amber-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={
                  searchField === 'part'
                    ? '🔍 اكتب رقم القطعة (10 أرقام مثل 1001023714)...'
                    : searchField === 'location'
                    ? '🔍 اكتب اسم الموقع (مثل N11C2 أو N06C1 أو N11FL2)...'
                    : searchField === 'name'
                    ? '🔍 اكتب اسم القطعة بالعربي أو الإنجليزي (مسمار، محبس، GASKET, VALVE)...'
                    : '🔍 بحث فوري بـ: اسم القطعة أو رقم القطعة (10 أرقام) أو اسم الموقع (مثل N11C2)...'
                }
                className="w-full pl-9 pr-10 py-2 rounded-xl bg-[#1F1511] text-neutral-100 placeholder-neutral-400 border border-[#4D3429] focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-xs sm:text-sm transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => onSearchChange('')}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* أزرار تخصيص نطاق البحث السريع */}
            {onSearchFieldChange && (
              <div className="flex items-center gap-1 bg-[#1F1511] p-1 rounded-xl border border-[#4D3429] w-full md:w-auto overflow-x-auto scrollbar-none">
                {(
                  [
                    { id: 'all', label: 'الكل' },
                    { id: 'part', label: 'رقم القطعة' },
                    { id: 'name', label: 'اسم القطعة' },
                    { id: 'location', label: 'الموقع' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onSearchFieldChange(f.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                      searchField === f.id
                        ? 'bg-amber-600 text-white shadow'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}

            {/* فلتر الحالة وتبويبات العرض */}
            <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-start">
              <div className="flex items-center gap-1 bg-[#1F1511] px-2.5 py-1.5 rounded-xl border border-[#4D3429] text-xs">
                <select
                  value={selectedStatus || ''}
                  onChange={(e) => onStatusChange(e.target.value)}
                  className="bg-transparent text-neutral-200 text-xs font-bold focus:outline-none cursor-pointer"
                >
                  <option value="" className="bg-[#2C1E18]">كل الحالات</option>
                  <option value="موجود" className="bg-[#2C1E18]">✓ موجود</option>
                  <option value="مفقود" className="bg-[#2C1E18]">× مفقود ({missingCount})</option>
                  <option value="غير موجودة" className="bg-[#2C1E18]">× غير موجودة ({missingCount})</option>
                  <option value="مضاف" className="bg-[#2C1E18]">✓ موجودة / مضاف</option>
                  <option value="تم النقل" className="bg-[#2C1E18]">تم النقل 🟢</option>
                  <option value="لم تنتقل" className="bg-[#2C1E18]">لم تنتقل 🟠</option>
                  <option value="مدقق" className="bg-[#2C1E18]">مدقق</option>
                  <option value="غير مدقق" className="bg-[#2C1E18]">غير مدقق</option>
                </select>
              </div>

              <div className="flex rounded-xl bg-[#1F1511] p-1 border border-[#4D3429] flex-wrap">
                <button
                  onClick={() => onTabChange('locations')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeTab === 'locations'
                      ? 'bg-[#3A271F] text-amber-300 shadow-sm'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  مواقعي
                </button>
                <button
                  onClick={() => onTabChange('similar')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeTab === 'similar'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-amber-300 hover:text-white'
                  }`}
                >
                  المتشابهات والنقل
                </button>
                <button
                  onClick={() => onTabChange('categories')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeTab === 'categories'
                      ? 'bg-[#3A271F] text-amber-300 shadow-sm'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  دليل الأصناف
                </button>
                <button
                  onClick={() => onTabChange('items')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeTab === 'items'
                      ? 'bg-[#3A271F] text-amber-300 shadow-sm'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  جدول القطع
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
