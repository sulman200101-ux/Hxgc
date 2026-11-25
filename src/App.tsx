import { TransferSuggestionsPanel } from './components/TransferSuggestionsPanel';
import { SimilarItemsPlannerView } from './components/SimilarItemsPlannerView';
import { PdfExportProgress } from './components/PdfExportProgress';
import { DatabaseProgressBar } from './components/DatabaseProgressBar';
import { ReportsPanel } from './components/ReportsPanel';
import { StockDocumentsPanel } from './components/StockDocumentsPanel';
import { DataSafetyPanel } from './components/DataSafetyPanel';
import { RepositoryBuildPanel } from './components/RepositoryBuildPanel';
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
import { QainListModal } from './components/QainListModal';
import { ExtractedSparePart } from './services/localOcr';
import { isConsumablePart, isConsumableTargetLocation } from './services/transferSuggestions';
import { Camera, Plus, CheckCircle, RefreshCw, MapPin, Edit3, XCircle, CheckCircle2, Layers, MessageCircle, ArrowRightLeft } from 'lucide-react';

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
  const [isQainModalOpen, setIsQainModalOpen] = useState(false);
  const [reportMovedOverride, setReportMovedOverride] = useState<InventoryItem[] | undefined>(undefined);
  const [selectedLocationCode, setSelectedLocationCode] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [renameLocationCode, setRenameLocationCode] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  useEffect(() => {
    const initDb = async () => {
      try {
        await dbService.init();
        await dbService.seedFromExternalStoreIfNeeded();
        refreshData();
        setIsDbReady(true);
        const syncRes = await dbService.syncWithRemoteStore();
        if (syncRes.applied > 0 || syncRes.removed > 0) {
          refreshData();
        }
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
    const items = [...dbService.getAllItems()];
    const locs = dbService.getLocationsSummary();
    setAllItems(items);
    setLocationsSummary(locs);
  };

  const movedItems = useMemo(() => {
    return dbService.getMovedItems();
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
      showNotification(`تم اعتماد ونقل القطعة (${partNumber}) بنجاح إلى الموقع الجديد (${newLocation}) 🟢`, 'success');
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
    let qainCount = 0;
    let consumableCount = 0;
    let manualAuditCount = 0;

    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      totalQty += item.qty_total;
      totalOut += item.qty_out;
      totalRemaining += item.qty_remaining;
      if (item.is_missing === 1 || item.status === 'غير موجودة' || item.status === 'مفقود') {
        totalMissing += 1;
      }
      if (item.is_qain === 1) {
        qainCount += 1;
      }
      if (item.is_consumable === 1 || isConsumablePart(item)) {
        consumableCount += 1;
      }
      if (item.is_manual_audit === 1) {
        manualAuditCount += 1;
      }
    }

    return { totalItems, totalQty, totalOut, totalRemaining, totalMissing, qainCount, consumableCount, manualAuditCount };
  }, [allItems]);

  const showMainLocations = () => {
    setActiveTab('locations');
    setSelectedLocationCode(null);
  };

  const showLocationDetails = (locCode: string) => {
    setSelectedLocationCode(locCode);
  };

  // CRUD & Mark Handlers
  const handleSaveItem = async (data: {
    part_number: string;
    location_code: string;
    description_en: string;
    description_ar: string;
    category: string;
    qty_total: number;
    qty_out: number;
    status: InventoryItem['status'];
    is_consumable?: number;
    is_qain?: number;
    qain_note?: string;
    is_manual_audit?: number;
  }) => {
    const existing = dbService.getItemByPartNumber(data.part_number);
    const targetLocation = data.location_code.trim().toUpperCase();
    const initialLocation = existing ? existing.location_code : targetLocation;

    await dbService.insertOrUpdateItem(
      data.part_number,
      initialLocation,
      data.description_en,
      data.qty_total,
      data.qty_out,
      data.status,
      data.description_ar,
      data.status === 'غير موجودة' || data.status === 'مفقود' ? 1 : 0,
      undefined,
      {
        is_consumable: data.is_consumable,
        is_qain: data.is_qain,
        qain_note: data.qain_note,
        is_manual_audit: data.is_manual_audit,
      }
    );

    if (existing && existing.location_code !== targetLocation) {
      await dbService.relocateItem(data.part_number, targetLocation);
      refreshData();
      showNotification(`تم نقل القطعة ${data.part_number} إلى موقعها الجديد ${targetLocation} بنجاح 🟢`, 'success');
      return;
    }

    refreshData();
    showNotification(`تم حفظ القطعة ${data.part_number} في موقع ${targetLocation} بنجاح`, 'success');
  };

  const handleToggleManualAudit = async (partNumber: string) => {
    const updated = await dbService.toggleManualAudit(partNumber);
    if (updated) {
      refreshData();
      if (updated.is_manual_audit === 1) {
        showNotification(`✋✓ تم وضع علامة (مدقق يدوي) على القطعة ${partNumber}`, 'success');
      } else {
        showNotification(`تم إلغاء علامة التدقيق اليدوي عن القطعة ${partNumber}`, 'info');
      }
    }
  };

  const handleToggleQain = async (partNumber: string, forceValue?: boolean, note?: string) => {
    const updated = await dbService.toggleQainMark(partNumber, forceValue, note);
    if (updated) {
      refreshData();
      if (updated.is_qain === 1) {
        showNotification(`💬 تم وضع علامة (قين) على القطعة ${partNumber} وإضافتها لقائمة قين`, 'success');
      } else {
        showNotification(`تم إزالة علامة (قين) عن القطعة ${partNumber}`, 'info');
      }
    }
  };

  const handleUpdateQainNote = async (partNumber: string, note: string) => {
    await dbService.updateQainNote(partNumber, note);
    refreshData();
    showNotification(`💬 تم حفظ ملاحظة قين للقطعة ${partNumber}`, 'success');
  };

  const handleToggleConsumable = async (partNumber: string) => {
    const updated = await dbService.toggleConsumableMark(partNumber);
    if (updated) {
      refreshData();
      if (updated.is_consumable === 1) {
        showNotification(`🔄 تم تحديد القطعة ${partNumber} كقطعة استهلاكية (A / FL)`, 'success');
      } else {
        showNotification(`تم إلغاء تصنيف الاستهلاكية عن القطعة ${partNumber}`, 'info');
      }
    }
  };

  const handleRelocateConsumablesToAOrFL = async () => {
    const moved = await dbService.relocateAllConsumableItemsToAOrFL();
    refreshData();
    if (moved.length > 0) {
      showNotification(`🔄 تم نقل وتوجيه (${moved.length}) قطعة استهلاكية إلى أرفف (A / FL) بنجاح!`, 'success');
      handleOpenRelocationReportWithItems(moved);
    } else {
      showNotification('جميع القطع الاستهلاكية موجودة بالفعل في أرفف A / FL أو لا توجد قطع تحتاج نقل.', 'info');
    }
  };

  const handleOpenAddConsumableItem = () => {
    const random7 = Math.floor(1000000 + Math.random() * 8999999);
    setEditingItem({
      part_number: `100${random7}`,
      location_code: 'N01A1',
      description_en: '',
      description_ar: '',
      category: 'فلاتر ومصافي',
      qty_total: 10,
      qty_out: 0,
      qty_remaining: 10,
      is_moved: 0,
      is_missing: 0,
      status: 'مدقق',
      is_consumable: 1,
      is_manual_audit: 1,
    });
    setIsItemModalOpen(true);
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
      } else {
        showNotification(`تم تحديث حالة القطعة ${partNumber} إلى (${newStatus})`, 'success');
      }
    } catch (error) { showNotification((error as Error).message, 'info'); }
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
      <nav aria-label="شاشات التطبيق" className="sticky top-0 z-40 bg-[#19110D] border-b border-amber-900 px-3 py-3 flex gap-2" dir="rtl">
        <button type="button" aria-pressed={screen === 'inventory'} onClick={() => changeScreen('inventory')} className={`flex-1 rounded-2xl py-3.5 px-2 font-black text-sm sm:text-base cursor-pointer transition-all ${screen === 'inventory' ? 'bg-[#E67E00] text-white shadow-lg shadow-amber-950/60' : 'bg-[#262322] text-neutral-200 hover:bg-stone-800'}`}>المخزون</button>
        <button type="button" aria-pressed={screen === 'similar'} onClick={() => changeScreen('similar')} className={`flex-1 rounded-2xl py-3 px-2 font-black text-xs sm:text-sm cursor-pointer flex items-center justify-center gap-1.5 text-center leading-snug transition-all ${screen === 'similar' ? 'bg-[#E67E00] text-white shadow-lg shadow-amber-950/60' : 'bg-[#262322] text-amber-300 hover:bg-stone-800'}`}>
          <Layers className="w-4 h-4 shrink-0" />
          <span>قائمة النقل اليومية والقطع الاستهلاكية (A / FL) ✨</span>
        </button>
        <button type="button" aria-pressed={screen === 'operations'} onClick={() => changeScreen('operations')} className={`flex-1 rounded-2xl py-3.5 px-2 font-black text-sm sm:text-base cursor-pointer transition-all ${screen === 'operations' ? 'bg-[#E67E00] text-white shadow-lg shadow-amber-950/60' : 'bg-[#262322] text-neutral-200 hover:bg-stone-800'}`}>العمليات والتقارير</button>
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
      <section hidden={screen !== 'similar'} aria-label="شاشة المتشابهات وخطة النقل" className="max-w-7xl mx-auto w-full min-h-[75vh] p-4 space-y-4">
        {/* شريط إدارة القطع الاستهلاكية (A / FL) السريع */}
        <div className="bg-gradient-to-r from-[#122628] via-[#173235] to-[#1A2520] rounded-2xl border border-teal-600/60 p-4 shadow-xl" dir="rtl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-1 rounded-full bg-teal-900/90 text-teal-200 border border-teal-400/70 text-xs font-black inline-flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-teal-300" />
                  <span>القطع الاستهلاكية ← A / FL</span>
                </span>
                <span className="text-xs font-bold text-teal-300">
                  إجمالي الاستهلاكية: ({overallTotals.consumableCount}) قطعة
                </span>
              </div>
              <p className="text-xs text-neutral-300 mt-1">
                توجيه الفلاتر، السيور، الفيوزات، اللمبات، الصوف، الجوانات، والرمانات تلقائياً إلى الأرفف القريبة <span className="text-teal-300 font-mono font-bold">A</span> أو <span className="text-teal-300 font-mono font-bold">FL</span> لسهولة الصرف اليومي.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleOpenAddConsumableItem}
                className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <Plus className="w-4 h-4" />
                <span>+ إضافة قطعة استهلاكية (A / FL)</span>
              </button>
              <button
                type="button"
                onClick={handleRelocateConsumablesToAOrFL}
                className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-400 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <ArrowRightLeft className="w-4 h-4" />
                <span>توجيه كافة الاستهلاكية إلى (A / FL) تلقائياً</span>
              </button>
              <button
                type="button"
                onClick={() => setIsQainModalOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-[#0F2F23] hover:bg-[#164232] text-emerald-200 border border-emerald-500/80 text-xs font-black flex items-center gap-1.5 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4 text-emerald-300" />
                <span>قائمة قين ({overallTotals.qainCount})</span>
              </button>
            </div>
          </div>
        </div>

        {isDbReady && (
          <SimilarItemsPlannerView
            items={allItems}
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
          <button className="p-3 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-white font-bold cursor-pointer" onClick={() => changeScreen('similar')}>فتح واجهة المتشابهات وخطة الإحلال الكاملة</button>
          <button className="p-3 rounded-xl bg-teal-800 hover:bg-teal-700 text-white font-bold cursor-pointer" onClick={() => setIsQainModalOpen(true)}>فتح قائمة قطع قين 💬 ({overallTotals.qainCount})</button>
        </div>
        <RepositoryBuildPanel defaultOpen={true} />
        <DataSafetyPanel onRefresh={refreshData} />
        {isDbReady && <ReportsPanel />}
        {isDbReady && <StockDocumentsPanel onRefresh={refreshData} onCapture={kind => { setCaptureKind(kind); setIsOcrOpen(true); }} />}
      </section>
      <section hidden={screen !== 'inventory'} aria-label="شاشة المخزون" className="min-h-[75vh]">
      <DatabaseProgressBar />

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
      <label className="block px-4 py-2 font-bold text-neutral-200" dir="rtl"><input type="checkbox" className="accent-blue-500 w-4 h-4 ml-2 align-middle" checked={!availableOnly} onChange={e => setAvailableOnly(!e.target.checked)} /> عرض التاريخ والرصيد الصفري وغير المتاح</label>
      {/* Main Header */}
      <Header
        locationCount={locationsSummary.length}
        totalItemsCount={overallTotals.totalItems}
        remainingTotal={overallTotals.totalRemaining}
        movedCount={movedItems.length}
        missingCount={overallTotals.totalMissing}
        qainCount={overallTotals.qainCount}
        consumableCount={overallTotals.consumableCount}
        manualAuditCount={overallTotals.manualAuditCount}
        onOpenRelocationReport={() => handleOpenRelocationReportWithItems()}
        onOpenQainList={() => setIsQainModalOpen(true)}
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
            {/* View Mode 1: المواقع والبحث الفوري */}
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
                        : selectedStatus === 'مدقق يدوي'
                        ? `القطع المدققة يدوياً ✋✓ (${filteredItems.length.toLocaleString()} قطعة)`
                        : selectedStatus === 'قين'
                        ? `قائمة قطع قين 💬 (${filteredItems.length.toLocaleString()} قطعة)`
                        : selectedStatus === 'استهلاكية'
                        ? `القطع الاستهلاكية A / FL 🔄 (${filteredItems.length.toLocaleString()} قطعة)`
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

                {/* نتائج البحث الفوري بالقطعة أو الرقم أو الموقع أو الفلاتر الخاصة */}
                {(searchQuery.trim() !== '' ||
                  selectedStatus === 'غير موجودة' ||
                  selectedStatus === 'مفقود' ||
                  selectedStatus === 'مدقق يدوي' ||
                  selectedStatus === 'قين' ||
                  selectedStatus === 'استهلاكية') && (
                  <div className="space-y-2 mb-6">
                    <div className="text-xs font-bold text-neutral-400 mb-1 flex items-center justify-between flex-wrap gap-2">
                      <span>
                        القطع المطابقة ({filteredItems.length.toLocaleString()} قطعة — عرض أول 25 نتيجة فورية):
                      </span>
                      <div className="flex items-center gap-3">
                        {selectedStatus === 'استهلاكية' && (
                          <button
                            onClick={handleRelocateConsumablesToAOrFL}
                            className="px-3 py-1 rounded-lg bg-teal-700 hover:bg-teal-600 text-white font-bold cursor-pointer"
                          >
                            🔄 توجيه كافة الاستهلاكية إلى أرفف (A / FL)
                          </button>
                        )}
                        {filteredItems.length > 25 && (
                          <button
                            onClick={() => setActiveTab('items')}
                            className="text-amber-400 hover:underline font-bold cursor-pointer"
                          >
                            عرض كافة النتائج في جدول القطع ⬅
                          </button>
                        )}
                      </div>
                    </div>

                    {filteredItems.slice(0, 25).map((item, idx) => {
                      const isMissing =
                        item.is_missing === 1 ||
                        item.status === 'غير موجودة' ||
                        item.status === 'مفقود';
                      const isVerified =
                        !isMissing && (item.status === 'مدقق' || item.status === 'موجود');
                      const isManualAudit = item.is_manual_audit === 1;
                      const isQain = item.is_qain === 1;
                      const isConsumable = item.is_consumable === 1 || isConsumablePart(item);
                      const inConsumableShelf = isConsumableTargetLocation(item.location_code);

                      return (
                        <div
                          key={`${item.part_number}-${idx}`}
                          className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                            isMissing
                              ? 'bg-red-950/25 border-red-700/60 hover:border-red-500'
                              : isManualAudit
                              ? 'bg-emerald-950/35 border-emerald-400/80 hover:border-emerald-300'
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
                              <span className="font-bold text-neutral-100 text-sm">
                                {item.description_ar}
                              </span>
                              {isManualAudit && (
                                <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white border border-emerald-300 font-black text-[11px] inline-flex items-center gap-1">
                                  ✋✓ مدقق يدوي
                                </span>
                              )}
                              {isQain && (
                                <span className="px-2 py-0.5 rounded-md bg-emerald-800 text-emerald-100 border border-emerald-400 font-black text-[11px] inline-flex items-center gap-1">
                                  💬 قين
                                </span>
                              )}
                              {isConsumable && (
                                <span className={`px-2 py-0.5 rounded-md font-black text-[11px] inline-flex items-center gap-1 border ${
                                  inConsumableShelf
                                    ? 'bg-teal-900/90 text-teal-200 border-teal-400'
                                    : 'bg-amber-950/90 text-amber-200 border-amber-500'
                                }`}>
                                  🔄 استهلاكية {inConsumableShelf ? '(في A/FL ✓)' : '(تحتاج نقل لـ A/FL)'}
                                </span>
                              )}
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

                          <div className="flex items-center gap-1.5 justify-end shrink-0 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleToggleManualAudit(item.part_number)}
                              className={`px-2.5 py-1.5 rounded-lg font-black border flex items-center gap-1 cursor-pointer transition-all ${
                                isManualAudit
                                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-300 shadow-sm'
                                  : 'bg-[#1D2D24] hover:bg-emerald-800 text-emerald-200 border-emerald-600/60'
                              }`}
                            >
                              <span>{isManualAudit ? '✋✓ مدقق يدوي' : '✋ تدقيق يدوي'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleToggleQain(item.part_number)}
                              className={`px-2.5 py-1.5 rounded-lg font-black border flex items-center gap-1 cursor-pointer transition-all ${
                                isQain
                                  ? 'bg-emerald-700 hover:bg-emerald-600 text-white border-emerald-400 shadow-sm'
                                  : 'bg-[#1E2E26] hover:bg-emerald-900/70 text-emerald-300 border-emerald-700/60'
                              }`}
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span>{isQain ? 'قين ✓' : 'علامة قين'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleToggleConsumable(item.part_number)}
                              className={`px-2.5 py-1.5 rounded-lg font-bold border flex items-center gap-1 cursor-pointer transition-all ${
                                isConsumable
                                  ? 'bg-teal-700 hover:bg-teal-600 text-white border-teal-400'
                                  : 'bg-[#1A2829] hover:bg-teal-950 text-teal-300 border-teal-700/60'
                              }`}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>{isConsumable ? 'استهلاكية ✓' : 'استهلاكية'}</span>
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
                              <span>{isVerified ? 'مدقق ✓' : 'غير مدقق'}</span>
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
                              {isMissing ? 'اعتماد المشرف: تحويل لموجودة ✓' : 'علامة × غير موجودة'}
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

                {/* بطاقات المواقع */}
                {filteredLocations.length === 0 ? (
                  <div className="bg-[#2C1E18] rounded-2xl border border-[#432d24] p-10 text-center space-y-4">
                    <div>
                      <p className="text-neutral-200 text-base font-bold mb-1">لا توجد قطع أو مواقع محفوظة حالياً</p>
                      <p className="text-neutral-400 text-xs">
                        يمكنك قراءة أوراق الجرد بالكاميرا أو الألبوم (حتى 55+ ورقة دفعة واحدة)، أو إضافة قطعة جديدة يدوياً.
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
                          onToggleManualAudit={handleToggleManualAudit}
                          onToggleQain={handleToggleQain}
                          onToggleConsumable={handleToggleConsumable}
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

            {/* View Mode 2: دليل الأصناف */}
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

            {/* View Mode 3: جدول القطع المفهرس (يدعم 100,000 قطعة) */}
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
                onToggleManualAudit={handleToggleManualAudit}
                onToggleQain={handleToggleQain}
                onToggleConsumable={handleToggleConsumable}
              />
            )}

            {/* View Mode 4: واجهة المتشابهات وخطة الإحلال والتخزين المتقارب */}
            {activeTab === 'similar' && (
              <SimilarItemsPlannerView
                items={allItems}
                onRefresh={refreshData}
                onOpenRelocationReport={handleOpenRelocationReportWithItems}
                onOpenLocation={showLocationDetails}
              />
            )}
          </>
        )}
      </main>

      {/* الزر البرتقالي المزخرف العائم أسفل الشاشة لفتح نافذة الكاميرا والألبوم (Gemini Vision) */}
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

      {/* Location Details Modal */}
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
          const random7 = Math.floor(1000000 + Math.random() * 8999999);
          setEditingItem({
            part_number: `100${random7}`,
            location_code: code,
            description_en: '',
            description_ar: '',
            category: '',
            qty_total: 10,
            qty_out: 0,
            qty_remaining: 10,
            is_moved: 0,
            is_missing: 0,
            status: 'موجود',
          });
          setIsItemModalOpen(true);
        }}
        onMarkItemStatus={handleMarkItemStatus}
        onOpenRelocate={handleOpenRelocate}
        onToggleManualAudit={handleToggleManualAudit}
        onToggleQain={handleToggleQain}
        onToggleConsumable={handleToggleConsumable}
      />

      {/* Qain List Modal (قائمة قطع قين 💬) */}
      <QainListModal
        isOpen={isQainModalOpen}
        onClose={() => setIsQainModalOpen(false)}
        allItems={allItems}
        onToggleQain={handleToggleQain}
        onUpdateQainNote={handleUpdateQainNote}
        onToggleManualAudit={handleToggleManualAudit}
        onToggleConsumable={handleToggleConsumable}
        onOpenLocation={(locCode) => {
          setIsQainModalOpen(false);
          changeScreen('inventory');
          showLocationDetails(locCode);
        }}
        onOpenRelocate={(item) => {
          setIsQainModalOpen(false);
          handleOpenRelocate(item);
        }}
        onOpenAddNewWithQain={() => {
          setIsQainModalOpen(false);
          const random7 = Math.floor(1000000 + Math.random() * 8999999);
          setEditingItem({
            part_number: `100${random7}`,
            location_code: 'N01A1',
            description_en: '',
            description_ar: '',
            category: '',
            qty_total: 10,
            qty_out: 0,
            qty_remaining: 10,
            is_moved: 0,
            is_missing: 0,
            status: 'مدقق',
            is_qain: 1,
            is_manual_audit: 1,
          });
          setIsItemModalOpen(true);
        }}
      />

      {/* OCR Modal (Gemini Vision Camera & Album) */}
      <OcrModal
        kind={captureKind}
        isOpen={isOcrOpen}
        onClose={() => setIsOcrOpen(false)}
        onRefresh={refreshData}
      />

      {/* Item Modal */}
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

      {/* Rename Location Modal */}
      <RenameLocationModal
        isOpen={!!renameLocationCode}
        currentLocationCode={renameLocationCode || ''}
        onClose={() => setRenameLocationCode(null)}
        onConfirmRename={handleRenameLocation}
      />

      {/* Relocate Modal */}
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

      {/* Relocation Report Modal */}
      <RelocationReportModal
        isOpen={isRelocationReportOpen}
        onClose={() => {
          setIsRelocationReportOpen(false);
          setReportMovedOverride(undefined);
        }}
        movedItems={reportMovedOverride && reportMovedOverride.length > 0 ? reportMovedOverride : movedItems}
      />

      {/* Wipe Database Modal */}
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
