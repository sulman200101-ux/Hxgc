import { TransferSuggestionsPanel } from './components/TransferSuggestionsPanel';
import { SimilarItemsPlannerView } from './components/SimilarItemsPlannerView';
import { PdfExportProgress } from './components/PdfExportProgress';
import { ReportsPanel } from './components/ReportsPanel';
import { StockDocumentsPanel } from './components/StockDocumentsPanel';
import { DataSafetyPanel } from './components/DataSafetyPanel';
import { AuthorizationDialog } from './components/AuthorizationDialog';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { dbService } from './services/db';
import { InventoryItem, LocationSummary } from './types';
import { Header } from './components/Header';
import { LocationCard } from './components/LocationCard';
import { LocationDetailModal } from './components/LocationDetailModal';
import { CategoriesCatalogView } from './components/CategoriesCatalogView';
import { ItemsTableView } from './components/ItemsTableView';
import { OcrModal } from './components/OcrModal';
import { ItemModal } from './components/ItemModal';
import { RenameLocationModal } from './components/RenameLocationModal';
import { WipeDatabaseModal } from './components/WipeDatabaseModal';
import { RelocateModal } from './components/RelocateModal';
import { RelocationReportModal } from './components/RelocationReportModal';
import { GinListModal } from './components/GinListModal';
import { ExtractedSparePart } from './services/localOcr';
import { estimatePartSizeProfile } from './services/transferSuggestions';
import { Camera, Plus, CheckCircle, RefreshCw, MapPin, Edit3, XCircle, CheckCircle2, Layers } from 'lucide-react';

export default function App() {
  const [screen, setScreen] = useState<'inventory' | 'similar' | 'operations'>('inventory');
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const changeScreen = (next: 'inventory' | 'similar' | 'operations') => { setScreen(next); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const [availableOnly, setAvailableOnly] = useState(false);
  const [isDbReady, setIsDbReady] = useState(false);
  const [allItems, setAllItems] = useState<InventoryItem[]>([]);
  const [locationsSummary, setLocationsSummary] = useState<LocationSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<'all' | 'part' | 'name' | 'location'>('all');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [activeTab, setActiveTab] = useState<'locations' | 'categories' | 'items' | 'similar'>('locations');
  const [visibleLocationsLimit, setVisibleLocationsLimit] = useState(25);

  // Modals state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [captureKind, setCaptureKind] = useState<'inventory' | 'issue' | 'receipt'>('inventory');
  const [isOcrOpen, setIsOcrOpen] = useState(false);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isWipeModalOpen, setIsWipeModalOpen] = useState(false);
  const [isRelocateOpen, setIsRelocateOpen] = useState(false);
  const [relocatingItem, setRelocatingItem] = useState<InventoryItem | null>(null);
  const [isRelocationReportOpen, setIsRelocationReportOpen] = useState(false);
  const [isGinListOpen, setIsGinListOpen] = useState(false);
  const [reportMovedOverride, setReportMovedOverride] = useState<InventoryItem[] | undefined>(undefined);
  const [selectedLocationCode, setSelectedLocationCode] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [renameLocationCode, setRenameLocationCode] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  useEffect(() => {
    const initDb = async () => {
      try {
        await dbService.init();
        refreshData();
        setIsDbReady(true);
      } catch (err) {
        console.error('Failed to init DB:', err);
      }
    };
    initDb();
  }, []);

  const showNotification = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const refreshData = () => {
    const items = dbService.getAllItems();
    const locs = dbService.getLocationsSummary();
    setAllItems(items);
    setLocationsSummary(locs);
  };

  const movedItems = useMemo(() => {
    return dbService.getMovedItems();
  }, [allItems]);

  const ginItems = useMemo(() => {
    return dbService.getGinItems();
  }, [allItems]);

  const handleOpenRelocationReportWithItems = (customItems?: InventoryItem[]) => {
    refreshData();
    setReportMovedOverride(customItems);
    setIsRelocationReportOpen(true);
  };

  const handleOpenRelocate = (item: InventoryItem) => {
    setRelocatingItem(item);
    setIsRelocateOpen(true);
  };

  const handleConfirmRelocate = async (partNumber: string, newLocation: string) => {
    const updated = await dbService.relocateItem(partNumber, newLocation);
    if (updated) {
      refreshData();
      showNotification(`تم اعتماد ونقل القطعة (${partNumber}) بنجاح إلى الموقع الجديد (${newLocation}) وحفظها في قائمة النقل اليومية 🟢`, 'success');
      handleOpenRelocationReportWithItems([updated]);
    }
  };

  // فهرسة وبحث فوري يدعم 100,000 قطعة بدون أي تأخير
  const filteredItems = useMemo(() => {
    return dbService.searchItems(searchQuery, selectedCategory, selectedStatus, searchField).filter(item => !availableOnly || (item.qty_remaining > 0 && item.is_missing !== 1));
  }, [allItems, searchQuery, selectedCategory, selectedStatus, searchField, availableOnly]);

  // تجميع القطع المفلترة حسب الموقع في تمريرة واحدة O(N) لمنع التهنيج عند 100,000 قطعة
  const itemsByLocationMap = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    for (let i = 0; i < filteredItems.length; i++) {
      const item = filteredItems[i];
      const loc = item.location_code;
      let list = map.get(loc);
      if (!list) {
        list = [];
        map.set(loc, list);
      }
      list.push(item);
    }
    return map;
  }, [filteredItems]);

  // المواقع المفلترة
  const filteredLocations = useMemo(() => {
    if (
      !availableOnly &&
      !searchQuery &&
      (!selectedCategory || selectedCategory === 'الكل') &&
      (!selectedStatus || selectedStatus === 'الكل')
    ) {
      return locationsSummary;
    }
    return locationsSummary.filter((loc) => itemsByLocationMap.has(loc.location_code));
  }, [locationsSummary, itemsByLocationMap, searchQuery, selectedCategory, selectedStatus, availableOnly]);

  const displayedLocations = useMemo(() => {
    return filteredLocations.slice(0, visibleLocationsLimit);
  }, [filteredLocations, visibleLocationsLimit]);

  const selectedLocationSummary = useMemo(() => {
    if (!selectedLocationCode) return undefined;
    return locationsSummary.find((l) => l.location_code === selectedLocationCode);
  }, [locationsSummary, selectedLocationCode]);

  const selectedLocationItems = useMemo(() => {
    if (!selectedLocationCode) return [];
    return dbService.getItemsByLocation(selectedLocationCode).filter(item => !availableOnly || (item.qty_remaining > 0 && item.is_missing !== 1));
  }, [allItems, selectedLocationCode, availableOnly]);

  // الإحصائيات الشاملة
  const overallTotals = useMemo(() => {
    let totalItems = allItems.length;
    let totalQty = 0;
    let totalOut = 0;
    let totalRemaining = 0;
    let totalMissing = 0;

    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      totalQty += item.qty_total;
      totalOut += item.qty_out;
      totalRemaining += item.qty_remaining;
      if (item.is_missing === 1 || item.status === 'غير موجودة' || item.status === 'مفقود') {
        totalMissing += 1;
      }
    }

    return { totalItems, totalQty, totalOut, totalRemaining, totalMissing };
  }, [allItems]);

  const showMainLocations = () => {
    setActiveTab('locations');
    setSelectedLocationCode(null);
  };

  const showLocationDetails = (locCode: string) => {
    setSelectedLocationCode(locCode);
  };

  const handleSaveItem = async (data: {
    part_number: string;
    location_code: string;
    description_en: string;
    description_ar: string;
    category: string;
    qty_total: number;
    qty_out: number;
    status: InventoryItem['status'];
    gin_code?: string;
  }) => {
    const targetLocation = data.location_code.trim().toUpperCase();

    await dbService.insertOrUpdateItem(
      data.part_number,
      targetLocation,
      data.description_en,
      data.qty_total,
      data.qty_out,
      data.status,
      data.description_ar,
      data.status === 'غير موجودة' || data.status === 'مفقود' ? 1 : 0,
      undefined,
      data.gin_code
    );

    refreshData();
    if (data.gin_code && data.gin_code.trim()) {
      showNotification(`تم حفظ القطعة ${data.part_number} مع القطع في الموقع ${targetLocation} مع وضع إشارة (🔖 قين) في بطاقتها`, 'success');
    } else {
      showNotification(`تم حفظ القطعة ${data.part_number} مع القطع في موقع ${targetLocation} بنجاح`, 'success');
    }
  };

  const handleToggleGin = async (partNumber: string, currentGin?: string) => {
    const isCurrentlyGin = Boolean(currentGin && currentGin.trim());
    const nextGin = isCurrentlyGin ? null : 'قين';
    await dbService.setItemGinCode(partNumber, nextGin);
    refreshData();
    if (nextGin) {
      showNotification(`تم وضع إشارة (🔖 قين) في بطاقة القطعة (${partNumber}) مع بقائها في موقعها`, 'success');
    } else {
      showNotification(`تمت إزالة إشارة (قين) عن بطاقة القطعة (${partNumber})`, 'info');
    }
  };

  const handleDeleteItem = async (partNumber: string) => {
    try {
      await dbService.deleteItem(partNumber);
      refreshData();
      showNotification(`تم حذف القطعة ${partNumber} بعد تأكيد الرقم السري`, 'info');
    } catch (error) {
      showNotification((error as Error).message || 'تم إلغاء المسح لحماية البيانات', 'error');
    }
  };

  const handleDeleteLocation = async (locationCode: string) => {
    try {
      const count = await dbService.deleteLocation(locationCode);
      refreshData();
      showNotification(`تم حذف الموقع ${locationCode} (${count} قطعة) بعد تأكيد الرقم السري`, 'info');
    } catch (error) {
      showNotification((error as Error).message || 'تم إلغاء المسح لحماية البيانات', 'error');
    }
  };

  const handleRenameLocation = async (oldCode: string, newCode: string) => {
    await dbService.updateLocationCode(oldCode, newCode);
    refreshData();
    showNotification(`تم نقل وتحديث الموقع إلى ${newCode}`);
  };

  const handleMarkItemStatus = async (
    partNumber: string,
    newStatus: InventoryItem['status']
  ) => {
    try {
      await dbService.markStatus(partNumber, newStatus);
      refreshData();
      if (newStatus === 'غير موجودة') {
        showNotification(`تم وضع علامة (× غير موجودة) على القطعة ${partNumber}`, 'info');
      } else if (newStatus === 'مدقق') {
        showNotification(`تم تدقيق القطعة ${partNumber} من قِبلك بنجاح (✓ مدقق)`, 'success');
      } else {
        showNotification(`تم تحديث حالة القطعة ${partNumber} إلى (غير مدقق)`, 'info');
      }
    } catch (error) {
      showNotification((error as Error).message, 'info');
    }
  };

  const handleWipeDatabase = async () => {
    await dbService.fullProgramWipe();
    setSearchQuery('');
    setSelectedStatus('');
    setSelectedCategory('');
    setSelectedLocationCode(null);
    setReportMovedOverride(undefined);
    refreshData();
    showNotification('تم المسح الشامل للبرنامج وتصفير كافة القطع والمواقع والمستندات بنجاح!', 'success');
  };

  return (
    <div className="min-h-screen bg-[#19110D] text-neutral-100 flex flex-col font-sans pb-28 selection:bg-amber-700 selection:text-white">
      <AuthorizationDialog />
      {showSuggestions && (
        <TransferSuggestionsPanel
          items={allItems}
          onClose={() => setShowSuggestions(false)}
          onRefresh={refreshData}
          onOpenRelocationReport={handleOpenRelocationReportWithItems}
        />
      )}
      <PdfExportProgress />
      <nav aria-label="شاشات التطبيق" className="sticky top-0 z-40 bg-[#19110D] border-b border-amber-900 px-4 py-3 flex gap-2" dir="rtl">
        <button type="button" aria-pressed={screen === 'inventory'} onClick={() => changeScreen('inventory')} className={`flex-1 rounded-xl py-3 font-bold cursor-pointer ${screen === 'inventory' ? 'bg-amber-600 text-white' : 'bg-stone-800 text-neutral-300'}`}>المخزون</button>
        <button type="button" aria-pressed={screen === 'similar'} onClick={() => changeScreen('similar')} className={`flex-1 rounded-xl py-3 font-bold cursor-pointer flex items-center justify-center gap-1.5 ${screen === 'similar' ? 'bg-amber-600 text-white' : 'bg-stone-800 text-amber-200'}`}>
          <Layers className="w-4 h-4" />
          <span>قائمة النقل اليومية والقطع الاستهلاكية (A / FL) ✨</span>
        </button>
        <button type="button" aria-pressed={screen === 'operations'} onClick={() => changeScreen('operations')} className={`flex-1 rounded-xl py-3 font-bold cursor-pointer ${screen === 'operations' ? 'bg-amber-600 text-white' : 'bg-stone-800 text-neutral-300'}`}>العمليات والتقارير</button>
      </nav>
      <div onTouchStart={event => {
        const target = event.target as HTMLElement;
        if (event.touches.length !== 1 || target.closest('input,textarea,select,button,a,summary,table,[data-no-swipe]')) { swipeStart.current = null; return; }
        swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }} onTouchCancel={() => { swipeStart.current = null; }} onTouchEnd={event => {
        const start = swipeStart.current; swipeStart.current = null;
        if (!start || !event.changedTouches.length) return;
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 1.5) changeScreen(dx > 0 ? 'operations' : 'inventory');
      }}>
      <section hidden={screen !== 'similar'} aria-label="شاشة المتشابهات وخطة النقل" className="max-w-7xl mx-auto w-full min-h-[75vh] p-4">
        {isDbReady && (
          <SimilarItemsPlannerView
            items={allItems}
            isActive={screen === 'similar'}
            onRefresh={refreshData}
            onOpenRelocationReport={handleOpenRelocationReportWithItems}
            onOpenLocation={(locCode) => {
              changeScreen('inventory');
              showLocationDetails(locCode);
            }}
          />
        )}
      </section>
      <section hidden={screen !== 'operations'} aria-label="شاشة العمليات والتقارير" className="max-w-7xl mx-auto w-full min-h-[75vh]">
        <header className="p-4" dir="rtl"><h1 className="text-xl font-bold">العمليات والتقارير</h1><p className="text-sm text-neutral-400">اسحب لليسار للعودة إلى المخزون</p></header>
        <div className="flex flex-wrap gap-2 px-4">
          <button className="p-3 rounded-xl bg-amber-800 hover:bg-amber-700 text-white font-bold cursor-pointer" onClick={() => setShowSuggestions(true)}>اقتراح تجميع القطع في مواقع متجاورة</button>
          <button className="p-3 rounded-xl bg-cyan-800 hover:bg-cyan-700 text-white font-black cursor-pointer" onClick={() => changeScreen('similar')}>فتح قائمة النقل اليومية ونقل القطع الاستهلاكية إلى (A و FL) 🔄</button>
          <button className="p-3 rounded-xl bg-green-700 hover:bg-green-600 text-white font-black cursor-pointer" onClick={() => setIsGinListOpen(true)}>فتح قائمة (قين) للإرسال عبر الواتساب 💬 ({ginItems.length})</button>
        </div>
        <DataSafetyPanel onRefresh={refreshData} />
        {isDbReady && <ReportsPanel />}
        {isDbReady && <StockDocumentsPanel onRefresh={refreshData} onCapture={kind => { setCaptureKind(kind); setIsOcrOpen(true); }} />}
      </section>
      <section hidden={screen !== 'inventory'} aria-label="شاشة المخزون" className="min-h-[75vh]">

      {/* Notification Toast */}
      {notification && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all animate-bounce">
          <div
            className={`px-4 py-2.5 rounded-xl shadow-2xl border text-xs font-bold flex items-center gap-2 ${
              notification.type === 'success'
                ? 'bg-emerald-950 text-emerald-200 border-emerald-700'
                : notification.type === 'error'
                ? 'bg-red-950 text-red-200 border-red-700'
                : 'bg-amber-950 text-amber-200 border-amber-700'
            }`}
          >
            <CheckCircle className="w-4 h-4 text-amber-400" />
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      <p className="px-4 pt-2 text-sm text-neutral-400" dir="rtl">اسحب لليمين لفتح العمليات والتقارير</p>
      <label className="block px-4 py-2" dir="rtl"><input type="checkbox" checked={!availableOnly} onChange={e => setAvailableOnly(!e.target.checked)} /> عرض التاريخ والرصيد الصفري وغير المتاح</label>
      {/* Main Header */}
      <Header
        locationCount={locationsSummary.length}
        totalItemsCount={overallTotals.totalItems}
        remainingTotal={overallTotals.totalRemaining}
        movedCount={movedItems.length}
        missingCount={overallTotals.totalMissing}
        ginCount={ginItems.length}
        onOpenRelocationReport={() => handleOpenRelocationReportWithItems()}
        onOpenGinList={() => setIsGinListOpen(true)}
        onOpenBackup={() => changeScreen('operations')}
        searchQuery={searchQuery}
        onSearchChange={(q) => {
          setSearchQuery(q);
          setVisibleLocationsLimit(25);
        }}
        searchField={searchField}
        onSearchFieldChange={setSearchField}
        selectedStatus={selectedStatus}
        onStatusChange={(st) => {
          setSelectedStatus(st);
          setVisibleLocationsLimit(25);
        }}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenAddItem={() => {
          setEditingItem(null);
          setIsItemModalOpen(true);
        }}
        onOpenWipeModal={() => setIsWipeModalOpen(true)}
      />

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-2 w-full flex-1">
        {!isDbReady ? (
          <div className="flex flex-col items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mb-3" />
            <p className="text-neutral-400 text-sm">جاري تهيئة قاعدة بيانات الجرد والفهارس السريعة...</p>
          </div>
        ) : (
          <>
            {activeTab === 'locations' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
                      {searchQuery
                        ? `نتائج البحث الفوري (${filteredItems.length.toLocaleString()} قطعة)`
                        : selectedStatus === 'غير موجودة'
                        ? `القطع غير الموجودة المعلمة بـ × (${filteredItems.length.toLocaleString()} قطعة)`
                        : 'مواقع الجرد المعتمدة (Storage Bins)'}
                    </h2>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#35241D] text-amber-300 font-bold border border-[#4F362B]">
                      {filteredLocations.length.toLocaleString()} موقع
                    </span>
                  </div>

                  {(searchQuery || (selectedStatus && selectedStatus !== 'الكل')) && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedStatus('');
                      }}
                      className="text-xs text-amber-400 hover:text-amber-300 font-bold cursor-pointer"
                    >
                      إعادة ضبط الفلاتر والعودة لكافة المواقع
                    </button>
                  )}
                </div>

                {(searchQuery.trim() !== '' || selectedStatus === 'غير موجودة' || selectedStatus === 'مفقود') && (
                  <div className="space-y-2 mb-6">
                    <div className="text-xs font-bold text-neutral-400 mb-1 flex items-center justify-between">
                      <span>
                        القطع المطابقة ({filteredItems.length.toLocaleString()} قطعة — عرض أول 20 نتيجة فورية):
                      </span>
                      {filteredItems.length > 20 && (
                        <button
                          onClick={() => setActiveTab('items')}
                          className="text-amber-400 hover:underline font-bold cursor-pointer"
                        >
                          عرض كافة النتائج في جدول القطع ⬅
                        </button>
                      )}
                    </div>

                    {filteredItems.slice(0, 20).map((item, idx) => {
                      const isMissing =
                        item.is_missing === 1 ||
                        item.status === 'غير موجودة' ||
                        item.status === 'مفقود';
                      // لا يظهر مدقق إلا إذا دققه المستخدم بنفسه
                      const isVerified =
                        !isMissing && item.user_verified === 1 && item.status === 'مدقق';
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
                          className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                            isMissing
                              ? 'bg-red-950/25 border-red-700/60 hover:border-red-500'
                              : isGin
                              ? 'bg-purple-950/25 border-purple-500/70 hover:border-purple-400'
                              : isVerified
                              ? 'bg-emerald-950/20 border-emerald-700/60 hover:border-emerald-500'
                              : 'bg-[#231713] border-[#432d24] hover:border-amber-500/50'
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-mono font-bold text-amber-300 bg-[#19110D] px-2 py-0.5 rounded border border-[#3D271F]">
                                رقم: {item.part_number}
                              </span>
                              {isConsumable && (
                                <span className="px-2 py-0.5 rounded-md bg-cyan-950 text-cyan-200 border border-cyan-500/70 font-black text-[11px]">
                                  🔄 قطعة استهلاكية (⬅ {sizeProf.consumableTargetType})
                                </span>
                              )}
                              {isGin && (
                                <span className="px-2.5 py-0.5 rounded-md bg-gradient-to-r from-purple-700 to-fuchsia-700 text-white border border-purple-300 font-black text-[11px] shadow-sm inline-flex items-center gap-1">
                                  <span>🔖 قين{item.gin_code !== 'قين' ? `: ${item.gin_code}` : ''}</span>
                                </span>
                              )}
                              <span className="font-bold text-neutral-100 text-sm">
                                {item.description_ar}
                              </span>
                              {isMissing ? (
                                <span className="px-2 py-0.5 rounded-md bg-red-950 text-red-200 border border-red-500 font-black text-[11px] inline-flex items-center gap-1">
                                  <XCircle className="w-3.5 h-3.5 text-red-400" />
                                  × غير موجودة (بانتظار المشرف)
                                </span>
                              ) : isVerified ? (
                                <span className="px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-300 border border-emerald-500 font-black text-[11px] inline-flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                  ✓ مدقق
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-md bg-orange-950/80 text-orange-300 border border-orange-600/70 font-bold text-[11px] inline-flex items-center gap-1">
                                  غير مدقق
                                </span>
                              )}
                              {isMoved && (
                                <span className="px-2 py-0.5 rounded-md bg-emerald-950/80 text-emerald-300 border border-emerald-500/60 font-bold text-[11px]">
                                  منقول 🟢
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 text-neutral-400 flex-wrap">
                              <span className="flex items-center gap-1 font-mono text-amber-200 font-bold">
                                <MapPin className="w-3 h-3 text-amber-500" /> الموقع: {item.location_code}
                              </span>
                              <span>•</span>
                              <span className={`font-bold font-mono ${isMissing ? 'text-red-400' : 'text-emerald-400'}`}>
                                {item.qty_out > 0 && !isMissing
                                  ? `العدد: ${item.qty_total} - ${item.qty_out} = يبقى في المخزون: ${item.qty_remaining}`
                                  : `المتبقي في المخزون: ${item.qty_remaining} (إجمالي: ${item.qty_total})`}
                              </span>
                              <span>•</span>
                              <span className="text-neutral-400 font-sans" dir="ltr">
                                {item.description_en}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 justify-end shrink-0 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleToggleGin(item.part_number, item.gin_code)}
                              className={`px-2.5 py-1.5 rounded-lg font-black border cursor-pointer transition-all ${
                                isGin
                                  ? 'bg-purple-700 hover:bg-purple-600 text-white border-purple-300'
                                  : 'bg-purple-950/60 hover:bg-purple-800 text-purple-200 border-purple-700/60'
                              }`}
                            >
                              {isGin ? '🔖 قين ✓' : '+ إشارة قين'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleMarkItemStatus(
                                  item.part_number,
                                  isVerified ? 'غير مدقق' : 'مدقق'
                                )
                              }
                              className={`px-3 py-1.5 rounded-lg font-black border flex items-center gap-1.5 cursor-pointer transition-all ${
                                isVerified
                                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-sm'
                                  : 'bg-orange-950/70 hover:bg-emerald-700 text-orange-200 hover:text-white border-orange-500/70'
                              }`}
                            >
                              <CheckCircle2 className={`w-4 h-4 ${isVerified ? 'text-white' : 'text-orange-400'}`} />
                              <span>{isVerified ? 'مدقق ✓' : 'غير مدقق (اضغط للتدقيق)'}</span>
                            </button>
                            <button
                              onClick={() =>
                                handleMarkItemStatus(
                                  item.part_number,
                                  isMissing ? 'غير مدقق' : 'غير موجودة'
                                )
                              }
                              className={`px-2.5 py-1.5 rounded-lg font-bold border cursor-pointer ${
                                isMissing
                                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60'
                                  : 'bg-red-950/60 text-red-200 border-red-700/60'
                              }`}
                            >
                              {isMissing ? 'إلغاء علامة ×' : 'علامة × غير موجودة'}
                            </button>
                            <button
                              onClick={() => showLocationDetails(item.location_code)}
                              className="px-3 py-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-amber-300 font-bold cursor-pointer"
                            >
                              عرض الموقع
                            </button>
                            <button
                              onClick={() => {
                                setEditingItem(item);
                                setIsItemModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-neutral-300 cursor-pointer"
                              title="تعديل"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {filteredLocations.length === 0 ? (
                  <div className="bg-[#2C1E18] rounded-2xl border border-[#432d24] p-10 text-center space-y-4">
                    <div>
                      <p className="text-neutral-200 text-base font-bold mb-1">لا توجد قطع أو مواقع محفوظة حالياً</p>
                      <p className="text-neutral-400 text-xs">
                        يمكنك قراءة أوراق الجرد بالكاميرا أو الألبوم، أو إضافة قطعة جديدة يدوياً.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2.5">
                      <button
                        onClick={() => {
                          setEditingItem(null);
                          setIsItemModalOpen(true);
                        }}
                        className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-md"
                      >
                        <Plus className="w-4 h-4" />
                        <span>إضافة قطعة جديدة</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {displayedLocations.map((loc) => {
                      const locItems = itemsByLocationMap.get(loc.location_code) || [];
                      return (
                        <LocationCard
                          key={loc.location_code}
                          summary={loc}
                          items={locItems}
                          onOpenLocation={showLocationDetails}
                          onEditItem={(item) => {
                            setEditingItem(item);
                            setIsItemModalOpen(true);
                          }}
                          onDeleteItem={handleDeleteItem}
                          onDeleteLocation={handleDeleteLocation}
                          onRenameLocation={(code) => setRenameLocationCode(code)}
                          onMarkItemStatus={handleMarkItemStatus}
                          onOpenRelocate={handleOpenRelocate}
                          onToggleGin={handleToggleGin}
                        />
                      );
                    })}

                    {filteredLocations.length > visibleLocationsLimit && (
                      <div className="py-4 text-center">
                        <button
                          onClick={() => setVisibleLocationsLimit((prev) => prev + 25)}
                          className="px-6 py-2.5 rounded-xl bg-[#2C1E18] hover:bg-[#3A271F] text-amber-300 border border-amber-500/40 font-bold text-xs shadow-lg cursor-pointer"
                        >
                          عرض المزيد من المواقع ({filteredLocations.length - visibleLocationsLimit} موقع متبقي)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'categories' && (
              <CategoriesCatalogView
                onBack={showMainLocations}
                onOpenLocation={showLocationDetails}
                onEditItem={(item) => {
                  setEditingItem(item);
                  setIsItemModalOpen(true);
                }}
                onDeleteItem={handleDeleteItem}
                onOpenRelocate={handleOpenRelocate}
              />
            )}

            {activeTab === 'items' && (
              <ItemsTableView
                items={filteredItems}
                onEditItem={(item) => {
                  setEditingItem(item);
                  setIsItemModalOpen(true);
                }}
                onDeleteItem={handleDeleteItem}
                onMarkItemStatus={handleMarkItemStatus}
                onOpenRelocate={handleOpenRelocate}
                onToggleGin={handleToggleGin}
              />
            )}

            {activeTab === 'similar' && (
              <SimilarItemsPlannerView
                items={allItems}
                isActive={screen === 'inventory' && activeTab === 'similar'}
                onRefresh={refreshData}
                onOpenRelocationReport={handleOpenRelocationReportWithItems}
                onOpenLocation={showLocationDetails}
              />
            )}
          </>
        )}
      </main>

      <div className="fixed bottom-6 inset-x-0 flex justify-center z-40 pointer-events-none">
        <button
          onClick={() => { setCaptureKind('inventory'); setIsOcrOpen(true); }}
          className="pointer-events-auto px-6 py-3.5 rounded-full bg-gradient-to-r from-[#FF6D00] via-[#FF8F00] to-[#E65100] hover:from-[#FF8500] hover:to-[#FF6D00] text-white font-black text-sm sm:text-base flex items-center gap-3 shadow-2xl shadow-orange-950/90 border-2 border-[#FFD54F] active:scale-95 transition-all cursor-pointer group relative overflow-hidden"
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3E1C0A] to-[#1F0D05] border border-[#FFB74D] text-[#FFB74D] flex items-center justify-center group-hover:scale-110 transition-transform relative">
            <Camera className="w-4 h-4 text-[#FFD54F]" />
          </div>
          <span className="tracking-wide text-white drop-shadow">
            قراءة ورقة أو عدة أوراق
          </span>
        </button>
      </div>

      </section>
      </div>

      <LocationDetailModal
        locationCode={selectedLocationCode}
        summary={selectedLocationSummary}
        items={selectedLocationItems}
        isOpen={!!selectedLocationCode}
        onClose={() => setSelectedLocationCode(null)}
        onEditItem={(item) => {
          setEditingItem(item);
          setIsItemModalOpen(true);
        }}
        onDeleteItem={handleDeleteItem}
        onAddNewItemForLocation={(code) => {
          setEditingItem({
            part_number: '',
            location_code: code,
            description_en: '',
            description_ar: '',
            category: 'قطع ميكانيكية متنوعة',
            qty_total: 1,
            qty_out: 0,
            qty_remaining: 1,
            is_moved: 0,
            is_missing: 0,
            status: 'غير مدقق',
          });
          setIsItemModalOpen(true);
        }}
        onMarkItemStatus={handleMarkItemStatus}
        onOpenRelocate={handleOpenRelocate}
        onToggleGin={handleToggleGin}
      />

      <OcrModal
        kind={captureKind}
        isOpen={isOcrOpen}
        onClose={() => setIsOcrOpen(false)}
        onRefresh={refreshData}
      />

      <ItemModal
        isOpen={isItemModalOpen}
        item={editingItem}
        onClose={() => {
          setIsItemModalOpen(false);
          setEditingItem(null);
        }}
        onSave={handleSaveItem}
        onOpenRelocate={handleOpenRelocate}
      />

      <GinListModal
        isOpen={isGinListOpen}
        onClose={() => setIsGinListOpen(false)}
        items={allItems}
        onRefresh={refreshData}
        onOpenAddModal={() => {
          setEditingItem(null);
          setIsItemModalOpen(true);
        }}
      />

      <RenameLocationModal
        isOpen={!!renameLocationCode}
        currentLocationCode={renameLocationCode || ''}
        onClose={() => setRenameLocationCode(null)}
        onConfirmRename={handleRenameLocation}
      />

      <RelocateModal
        isOpen={isRelocateOpen}
        item={relocatingItem}
        onClose={() => {
          setIsRelocateOpen(false);
          setRelocatingItem(null);
        }}
        onConfirm={handleConfirmRelocate}
        popularLocations={locationsSummary.map((l) => l.location_code)}
      />

      <RelocationReportModal
        isOpen={isRelocationReportOpen}
        onClose={() => {
          setIsRelocationReportOpen(false);
          setReportMovedOverride(undefined);
        }}
        movedItems={reportMovedOverride && reportMovedOverride.length > 0 ? reportMovedOverride : movedItems}
      />

      <WipeDatabaseModal
        isOpen={isWipeModalOpen}
        onClose={() => setIsWipeModalOpen(false)}
        onConfirmWipe={handleWipeDatabase}
        totalItemsCount={overallTotals.totalItems}
        totalLocationsCount={locationsSummary.length}
      />
    </div>
  );
}
