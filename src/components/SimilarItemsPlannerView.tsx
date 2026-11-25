import React, { useEffect, useMemo, useState } from 'react';
import type { InventoryItem } from '../types';
import type { StockDocument, DocumentLine } from '../services/documents';
import { dbService } from '../services/db';
import {
  buildSimilaritySwapPlans,
  getAdjacentStorageBins,
  estimatePartSizeProfile,
  suggestConsumableItemsToAOrFL,
  isConsumablePart,
  isConsumableTargetLocation,
  resolveTargetConsumableLocation,
  MAX_ITEMS_PER_SHELF,
  type SimilaritySwapPlan,
} from '../services/transferSuggestions';
import { sanitizeLocationCode, isValidSpecificLocation } from '../utils/regexSanitizer';
import {
  Layers,
  ArrowRightLeft,
  MapPin,
  CheckCircle2,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Printer,
  ArrowUpDown,
  Search,
  RefreshCw,
} from 'lucide-react';

interface SimilarItemsPlannerViewProps {
  items: InventoryItem[];
  isActive?: boolean;
  onRefresh: () => void;
  onOpenRelocationReport: (movedItems?: InventoryItem[]) => void;
  onOpenLocation?: (locationCode: string) => void;
}

const CONSUMABLE_QUICK_FILTERS = [
  { id: 'ALL_CONSUMABLES', label: 'كل الاستهلاكية 🔄', query: '' },
  { id: 'FILTER', label: 'فلاتر ومصافي', query: 'فلتر|FILTER|STRAINER|CARTRIDGE' },
  { id: 'BELT', label: 'سيور نقل حركة', query: 'سير|BELT' },
  { id: 'ORING_SEAL', label: 'أورنق وصوف مانعة للتسرب', query: 'أورنق|اورنق|O-RING|ORING|SEAL|صوف|PACKING' },
  { id: 'GASKET', label: 'وجيه وجازكيت', query: 'جازكيت|وجيه|جوان|GASKET' },
  { id: 'FUSE_LAMP', label: 'فيوزات ولمبات', query: 'فيوز|لمبة|كشاف|FUSE|LAMP|BULB' },
  { id: 'FASTENERS', label: 'مسامير وصواميل ووردات', query: 'مسمار|صامولة|وردة|برغي|BOLT|NUT|WASHER|SCREW|STUD' },
  { id: 'BEARING', label: 'رمانات وبلي', query: 'رولمان|بلي|محمل|BEARING' },
  { id: 'ALL_INVENTORY', label: 'البحث في كامل المخزون 🌐', query: '__ALL__' },
];

export const SimilarItemsPlannerView: React.FC<SimilarItemsPlannerViewProps> = ({
  items,
  isActive = true,
  onRefresh,
  onOpenRelocationReport,
  onOpenLocation,
}) => {
  const [documents, setDocuments] = useState<StockDocument[]>([]);
  const [customTargetBins, setCustomTargetBins] = useState<Record<string, string>>({});
  const [expandedPlans, setExpandedPlans] = useState<Record<string, boolean>>({});
  const [visiblePlansLimit, setVisiblePlansLimit] = useState(12);
  const [visibleConsumableLimit, setVisibleConsumableLimit] = useState(25);
  const [visibleSearchLimit, setVisibleSearchLimit] = useState(30);
  const [sizeSortOrder, setSizeSortOrder] = useState<'price_desc' | 'desc' | 'asc'>('price_desc');
  const [selectedFamilyFilter, setSelectedFamilyFilter] = useState<string>('ALL');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'success' | 'info' | 'error';
  } | null>(null);
  const [lastApprovedPlanItems, setLastApprovedPlanItems] = useState<InventoryItem[]>([]);

  // حالات البحث عن القطع الاستهلاكية ووضع علامة عليها
  const [consumableSearchQuery, setConsumableSearchQuery] = useState('');
  const [activeQuickCategory, setActiveQuickCategory] = useState('ALL_CONSUMABLES');
  const [consumableTargetOverride, setConsumableTargetOverride] = useState('');

  // النقل السريع لقطعة محددة
  const [quickSearchFilter, setQuickSearchFilter] = useState('');
  const [quickPartNumber, setQuickPartNumber] = useState('');
  const [quickNewLocation, setQuickNewLocation] = useState('');

  const refreshDocs = async () => {
    const docs = await dbService.getDocuments();
    setDocuments(docs);
  };

  useEffect(() => {
    if (!isActive) return;
    refreshDocs().catch((err) =>
      setStatusMessage({ text: String(err), type: 'error' })
    );
  }, [items.length, isActive]);

  const pendingTransferDocs = useMemo(
    () => documents.filter((doc) => doc.kind === 'transfer' && doc.status === 'pending'),
    [documents]
  );

  const pendingPartNumbers = useMemo(
    () =>
      new Set(
        pendingTransferDocs.flatMap((doc) =>
          doc.lines.map((line) => line.part_number)
        )
      ),
    [pendingTransferDocs]
  );

  const itemByPartMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (let i = 0; i < items.length; i++) {
      map.set(items[i].part_number, items[i]);
    }
    return map;
  }, [items]);

  const allBins = useMemo(
    () =>
      Array.from(
        new Set(
          items
            .map((i) => i.location_code.trim().toUpperCase())
            .filter(Boolean)
        )
      ).sort(),
    [items]
  );

  // إحصائيات القطع الاستهلاكية في المخزون
  const consumableStats = useMemo(() => {
    let totalConsumable = 0;
    let explicitlyMarked = 0;
    let inAOrFL = 0;
    for (const item of items) {
      const isCons = item.is_consumable === 1 || isConsumablePart(item);
      if (isCons) {
        totalConsumable++;
        if (item.is_consumable === 1) explicitlyMarked++;
        if (isConsumableTargetLocation(item.location_code)) inAOrFL++;
      }
    }
    return { totalConsumable, explicitlyMarked, inAOrFL };
  }, [items]);

  // قائمة نتائج البحث عن القطع الاستهلاكية لوضع علامة عليها
  const searchedConsumableCandidates = useMemo(() => {
    if (!isActive) return [];
    const q = consumableSearchQuery.trim().toLowerCase();
    const filterDef = CONSUMABLE_QUICK_FILTERS.find((f) => f.id === activeQuickCategory);
    const regex =
      filterDef && filterDef.query && filterDef.query !== '__ALL__'
        ? new RegExp(filterDef.query, 'i')
        : null;

    return items.filter((item) => {
      if (activeQuickCategory === 'ALL_CONSUMABLES' && !q) {
        return item.is_consumable === 1 || isConsumablePart(item);
      }
      if (regex) {
        const text = `${item.description_en} ${item.description_ar} ${item.category}`;
        if (!regex.test(text)) return false;
      }
      if (q) {
        return (
          item.part_number.toLowerCase().includes(q) ||
          item.description_ar.toLowerCase().includes(q) ||
          item.description_en.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.location_code.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, consumableSearchQuery, activeQuickCategory, isActive]);

  // خطة النقل المخصصة للقطع الاستهلاكية فقط (إلى A / FL)
  const consumableTransferSuggestions = useMemo(() => {
    if (!isActive) return [];
    return suggestConsumableItemsToAOrFL(items, pendingPartNumbers);
  }, [items, pendingPartNumbers, isActive]);

  // خطط تجميع القطع الاستهلاكية المتشابهة فقط
  const swapPlans = useMemo(() => {
    if (!isActive) return [];
    return buildSimilaritySwapPlans(items, pendingPartNumbers, 'warehouse');
  }, [items, pendingPartNumbers, isActive]);

  const filteredSwapPlans = useMemo(() => {
    return swapPlans.filter((plan) => {
      if (selectedFamilyFilter !== 'ALL' && plan.family !== selectedFamilyFilter) {
        return false;
      }
      return true;
    });
  }, [swapPlans, selectedFamilyFilter]);

  const quickSelectableItems = useMemo(() => {
    if (!isActive) return [];
    const q = quickSearchFilter.trim().toLowerCase();
    const pool = items.filter((it) => it.is_consumable === 1 || isConsumablePart(it));
    const sourceList = pool.length > 0 && !q ? pool : items;
    if (!q) return sourceList.slice(0, 120);
    const matches: InventoryItem[] = [];
    for (let i = 0; i < items.length && matches.length < 120; i++) {
      const it = items[i];
      if (
        it.part_number.toLowerCase().includes(q) ||
        it.location_code.toLowerCase().includes(q) ||
        it.description_ar.toLowerCase().includes(q) ||
        it.description_en.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q)
      ) {
        matches.push(it);
      }
    }
    return matches;
  }, [items, quickSearchFilter, isActive]);

  const selectedQuickItem = useMemo(
    () => itemByPartMap.get(quickPartNumber.trim()) || null,
    [itemByPartMap, quickPartNumber]
  );

  const quickNearbyBins = useMemo(() => {
    if (!selectedQuickItem) return ['N11A1', 'N11FL1', 'N11A2', 'N11FL2', ...allBins.slice(0, 4)];
    const targetA = resolveTargetConsumableLocation(selectedQuickItem.location_code, false);
    const targetFL = resolveTargetConsumableLocation(selectedQuickItem.location_code, true);
    const adj = getAdjacentStorageBins(selectedQuickItem.location_code, allBins, 6);
    return Array.from(new Set([targetA, targetFL, 'N11A1', 'N11FL1', ...adj])).slice(0, 8);
  }, [selectedQuickItem, allBins]);

  // 1. البحث التلقائي الشامل ووضع علامة (استهلاكية ✓) على كافة القطع الاستهلاكية في المخزون
  const handleAutoMarkAllConsumables = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      const res = await dbService.markAllDetectedConsumableItems();
      onRefresh();
      setStatusMessage({
        text: `✅ تم البحث في كامل المخزون ووضع علامة (استهلاكية 🔄) على (${res.totalConsumables}) قطعة استهلاكية بنجاح!`,
        type: 'success',
      });
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // 2. وضع علامة استهلاكية على جميع نتائج البحث الحالية دفعة واحدة
  const handleMarkCurrentSearchResultsAsConsumable = async () => {
    if (searchedConsumableCandidates.length === 0) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      const partNumbers = searchedConsumableCandidates.map((i) => i.part_number);
      const count = await dbService.markMultipleAsConsumable(partNumbers, true);
      onRefresh();
      setStatusMessage({
        text: `✅ تم وضع علامة (استهلاكية 🔄) على (${searchedConsumableCandidates.length}) قطعة مطابقة للبحث (${count} قطعة جديدة)!`,
        type: 'success',
      });
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // 3. تبديل علامة استهلاكية لقطعة واحدة
  const handleToggleSingleConsumable = async (partNumber: string) => {
    const updated = await dbService.toggleConsumableMark(partNumber);
    onRefresh();
    if (updated) {
      setStatusMessage({
        text:
          updated.is_consumable === 1
            ? `🔄 تم وضع علامة (قطعة استهلاكية ✓) على القطعة (${partNumber}) وإدراجها في خطة النقل إلى (A / FL)`
            : `تم إزالة علامة الاستهلاكية عن القطعة (${partNumber})`,
        type: 'info',
      });
    }
  };

  const handleDirectMoveSingleItem = async (partNumber: string, targetLocation: string) => {
    const cleanTarget = sanitizeLocationCode(targetLocation) || targetLocation.trim().toUpperCase();
    if (!cleanTarget || !isValidSpecificLocation(cleanTarget)) {
      setStatusMessage({
        text: 'يرجى إدخال رمز الموقع الاستهلاكي الجديد بشكل صحيح (مثل N11A1 أو N11FL1 أو A1 أو FL1)',
        type: 'error',
      });
      return;
    }

    setBusy(true);
    setStatusMessage(null);
    try {
      await dbService.toggleConsumableMark(partNumber, true);
      const updated = await dbService.relocateItem(partNumber, cleanTarget);
      if (!updated) {
        throw new Error('لم يتم العثور على القطعة المطلوبة للنقل');
      }
      await refreshDocs();
      onRefresh();
      setLastApprovedPlanItems([updated]);
      setQuickNewLocation('');
      setStatusMessage({
        text: `✅ تم اعتماد ونقل القطعة الاستهلاكية (${partNumber} — ${updated.description_ar}) من (${updated.old_location || 'السابق'}) إلى موقعها الجديد (${updated.location_code}) بنجاح!`,
        type: 'success',
      });
      onOpenRelocationReport([updated]);
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // 4. اعتماد ونقل كافة القطع الاستهلاكية إلى (A / FL)
  const handleMoveAllConsumablesToAFL = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      await dbService.markAllDetectedConsumableItems();
      const movedConsumables = await dbService.relocateAllConsumableItemsToAOrFL(
        consumableTargetOverride.trim() || undefined
      );
      if (!movedConsumables.length) {
        throw new Error('جميع القطع الاستهلاكية مستقرة بالفعل في مواقع الاستهلاكية المعتمدة (A و FL)!');
      }
      await refreshDocs();
      onRefresh();
      setLastApprovedPlanItems(movedConsumables);
      setStatusMessage({
        text: `✅ تم اعتماد ونقل كافة القطع الاستهلاكية (${movedConsumables.length} قطعة) إلى أرفف الاستهلاكية المعتمدة (A و FL) بنجاح!`,
        type: 'success',
      });
      onOpenRelocationReport(movedConsumables);
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const buildDocumentLinesForPlan = (plan: SimilaritySwapPlan): DocumentLine[] => {
    const customTarget = customTargetBins[plan.id]?.trim().toUpperCase();
    const lines: DocumentLine[] = [];

    const batches =
      plan.shelfBatches && plan.shelfBatches.length > 0
        ? plan.shelfBatches
        : [
            {
              shelfBin: customTarget || plan.targetBin,
              batchIndex: 1,
              itemsCount: Math.min(MAX_ITEMS_PER_SHELF, plan.allGroupItemsSortedBySize.length),
              maxCapacity: MAX_ITEMS_PER_SHELF,
              items: plan.allGroupItemsSortedBySize.slice(0, MAX_ITEMS_PER_SHELF),
            },
          ];

    for (const batch of batches) {
      const targetBin =
        batch.batchIndex === 1 && customTarget ? customTarget : batch.shelfBin.trim().toUpperCase();
      for (const entry of batch.items.slice(0, MAX_ITEMS_PER_SHELF)) {
        const fromBin = entry.item.location_code.trim().toUpperCase();
        if (fromBin !== targetBin) {
          lines.push({
            part_number: entry.item.part_number,
            old_location: fromBin,
            location: targetBin,
            quantity: entry.item.qty_remaining,
            description_en: entry.item.description_en,
            description_ar: entry.item.description_ar,
            check: '',
            remark: `نقل وتجميع القطع الاستهلاكية (${plan.family}) في ${targetBin}`,
            reviewed: true,
          });
        }
      }
    }

    return lines;
  };

  const handleApproveAndExecutePlanNow = async (plan: SimilaritySwapPlan) => {
    setBusy(true);
    setStatusMessage(null);
    try {
      const lines = buildDocumentLinesForPlan(plan);
      if (!lines.length) {
        throw new Error('جميع قطع هذه المجموعة الاستهلاكية موجودة بالفعل في الموقع المحدد');
      }
      const docId = `CONS-${plan.family}-${Date.now().toString().slice(-5)}`;
      await dbService.submitDocument({
        id: docId,
        kind: 'transfer',
        requester: 'خطة نقل القطع الاستهلاكية (A / FL)',
        reason: plan.summaryReason,
        status: 'pending',
        createdAt: '',
        lines,
      });
      await dbService.approveDocument(docId);
      await refreshDocs();
      onRefresh();

      const movedParts = Array.from(
        new Map(
          lines
            .map((l) => dbService.getItemByPartNumber(l.part_number))
            .filter((i): i is InventoryItem => Boolean(i))
            .map((i) => [i.part_number, i])
        ).values()
      );

      setLastApprovedPlanItems(movedParts);
      setStatusMessage({
        text: `✅ تم اعتماد ونقل مجموعة القطع الاستهلاكية (${plan.familyAr}) إلى (${plan.targetBin}) — (${movedParts.length} قطعة)!`,
        type: 'success',
      });
      onOpenRelocationReport(movedParts);
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleApprovePendingDoc = async (doc: StockDocument) => {
    setBusy(true);
    setStatusMessage(null);
    try {
      await dbService.approveDocument(doc.id);
      await refreshDocs();
      onRefresh();

      const movedParts = Array.from(
        new Map(
          doc.lines
            .map((l) => dbService.getItemByPartNumber(l.part_number))
            .filter((i): i is InventoryItem => Boolean(i))
            .map((i) => [i.part_number, i])
        ).values()
      );

      setLastApprovedPlanItems(movedParts);
      setStatusMessage({
        text: `✅ تم اعتماد النقل للمستند (${doc.id}) وانتقلت القطع الاستهلاكية لمواقعها الجديدة بنجاح!`,
        type: 'success',
      });
      onOpenRelocationReport(movedParts);
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const displayedPlans = filteredSwapPlans.slice(0, visiblePlansLimit);

  return (
    <div className="space-y-4" dir="rtl">
      {/* رأس الصفحة: خطة النقل مخصصة للقطع الاستهلاكية فقط (مع استبعاد الثقيلة) */}
      <div className="bg-[#132628] rounded-2xl border border-teal-500/60 p-4 shadow-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/50 flex items-center justify-center text-teal-300">
            <RefreshCw className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-black text-white">
                البحث عن القطع الاستهلاكية ووضع علامة عليها + خطة نقل الاستهلاكية فقط إلى (A / FL)
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-teal-400 text-stone-950 text-xs font-black">
                خطة النقل للقطع الاستهلاكية فقط 🔄
              </span>
            </div>
            <p className="text-xs text-teal-200/90 mt-0.5">
              تم استبعاد خطة النقل للقطع الثقيلة نهائياً — هذه الواجهة مخصصة للبحث عن القطع الاستهلاكية ووضع علامة (استهلاكية ✓) عليها وتوجيهها إلى أرفف (A و FL).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={busy}
            onClick={handleAutoMarkAllConsumables}
            className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-black flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>البحث التلقائي ووضع علامة على كل الاستهلاكية ({consumableStats.totalConsumable})</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onOpenRelocationReport(
                lastApprovedPlanItems.length ? lastApprovedPlanItems : undefined
              )
            }
            className="px-4 py-2 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-white text-xs font-black flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <MessageCircle className="w-4 h-4" />
            <span>تقرير PDF وواتساب للمنقولة 📲</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          role="status"
          className={`p-3.5 rounded-2xl border text-xs sm:text-sm font-bold flex flex-wrap items-center justify-between gap-3 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-600'
              : statusMessage.type === 'error'
              ? 'bg-red-950/90 text-red-200 border-red-600'
              : 'bg-teal-950/90 text-teal-200 border-teal-500'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{statusMessage.text}</span>
          </div>
          {statusMessage.type === 'success' && lastApprovedPlanItems.length > 0 && (
            <button
              type="button"
              onClick={() => onOpenRelocationReport(lastApprovedPlanItems)}
              className="px-3 py-1.5 rounded-xl bg-[#25D366] hover:bg-[#1da851] text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>فتح تقرير PDF وواتساب 📲</span>
            </button>
          )}
        </div>
      )}

      {/* القسم الأول: البحث عن القطع الاستهلاكية ووضع علامة (استهلاكية 🔄) عليها */}
      <div className="bg-[#112224] border-2 border-teal-500/70 rounded-2xl p-4 space-y-3 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-1 rounded-lg bg-teal-400 text-stone-950 font-black text-xs">
                1. البحث عن القطع الاستهلاكية ووضع علامة عليها 🔄
              </span>
              <h3 className="text-sm sm:text-base font-black text-white">
                إجمالي القطع الاستهلاكية المكتشفة والمعلمة: ({consumableStats.totalConsumable}) قطعة | المعلمة بعلامة صريحة: ({consumableStats.explicitlyMarked}) | في أرفف A/FL حالياً: ({consumableStats.inAOrFL})
              </h3>
            </div>
            <p className="text-xs text-teal-200/90">
              ابحث عن أي قطعة في المخزون بالاسم أو الرقم أو الصنف، واضغط على زر (وضع علامة استهلاكية 🔄) لتحديدها وإدراجها فوراً في خطة النقل إلى (A / FL).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {searchedConsumableCandidates.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={handleMarkCurrentSearchResultsAsConsumable}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>وضع علامة (استهلاكية ✓) على نتائج البحث ({searchedConsumableCandidates.length})</span>
              </button>
            )}
          </div>
        </div>

        {/* فلاتر سريعة لأصناف القطع الاستهلاكية */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {CONSUMABLE_QUICK_FILTERS.map((flt) => (
            <button
              key={flt.id}
              type="button"
              onClick={() => {
                setActiveQuickCategory(flt.id);
                setVisibleSearchLimit(30);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                activeQuickCategory === flt.id
                  ? 'bg-teal-500 text-stone-950 border-teal-300 font-black shadow-md'
                  : 'bg-[#0B1719] text-teal-200 border-teal-800 hover:border-teal-500'
              }`}
            >
              {flt.label}
            </button>
          ))}
        </div>

        {/* حقل البحث عن القطع الاستهلاكية */}
        <div className="relative">
          <Search className="w-4 h-4 text-teal-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={consumableSearchQuery}
            onChange={(e) => {
              setConsumableSearchQuery(e.target.value);
              setVisibleSearchLimit(30);
            }}
            placeholder="ابحث عن القطع الاستهلاكية بـ: رقم القطعة (10 أرقام) أو الاسم (فلتر، سير، أورنق، صوفة، فيوز، لمبة، جازكيت)..."
            className="w-full pr-10 pl-4 py-2.5 rounded-xl bg-[#091315] border border-teal-600/70 text-white text-xs sm:text-sm focus:outline-none focus:border-teal-400"
          />
        </div>

        {/* نتائج البحث مع زر وضع العلامة على كل قطعة */}
        {searchedConsumableCandidates.length === 0 ? (
          <div className="p-4 rounded-xl bg-black/30 border border-teal-800/50 text-xs text-teal-200 text-center">
            لا توجد قطع مطابقة لنص البحث الحالي — جرب اختيار (البحث في كامل المخزون 🌐) للبحث في جميع القطع ووضع علامة استهلاكية عليها.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {searchedConsumableCandidates.slice(0, visibleSearchLimit).map((item, idx) => {
              const isMarked = item.is_consumable === 1 || isConsumablePart(item);
              const inAFL = isConsumableTargetLocation(item.location_code);
              const preferFL = /FILTER|HOSE|BELT|GASKET|فلتر|خرطوم|سير|جازكيت/i.test(
                `${item.description_en} ${item.description_ar}`
              );
              const suggestedBin = resolveTargetConsumableLocation(item.location_code, preferFL);

              return (
                <div
                  key={`cons-search-${item.part_number}-${idx}`}
                  className={`p-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs transition-all ${
                    isMarked
                      ? 'bg-[#0E292B] border-teal-400/80 shadow-sm'
                      : 'bg-[#141A1C] border-stone-700/70'
                  }`}
                >
                  <div className="space-y-0.5 flex-1 min-w-[230px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-black text-amber-300 bg-black/60 px-2 py-0.5 rounded border border-amber-600/40">
                        {item.part_number}
                      </span>
                      {isMarked && (
                        <span className="px-2 py-0.5 rounded-md bg-teal-500 text-stone-950 font-black text-[11px] inline-flex items-center gap-1">
                          <RefreshCw className="w-3 h-3" />
                          <span>علامة استهلاكية ✓</span>
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded bg-stone-900 text-teal-200 border border-teal-700/50 font-mono font-bold text-[11px]">
                        الموقع: {item.location_code} {inAFL ? '(في A/FL ✓)' : ''}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-stone-900 text-amber-200 border border-amber-700/40 text-[11px] font-bold">
                        الصنف: {item.category} | الكمية: {item.qty_remaining}
                      </span>
                      <span className="font-bold text-white">{item.description_ar}</span>
                    </div>
                    <p className="text-[11px] text-neutral-400 font-mono" dir="ltr">
                      {item.description_en}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleToggleSingleConsumable(item.part_number)}
                      className={`px-3 py-1.5 rounded-lg font-black text-xs border flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 ${
                        isMarked
                          ? 'bg-teal-600 hover:bg-teal-500 text-white border-teal-300 shadow-md'
                          : 'bg-stone-800 hover:bg-teal-900 text-teal-200 border-teal-600/60'
                      }`}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{isMarked ? 'معلّمة استهلاكية ✓' : 'وضع علامة استهلاكية'}</span>
                    </button>

                    {!inAFL && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDirectMoveSingleItem(item.part_number, suggestedBin)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs cursor-pointer"
                      >
                        نقل إلى {suggestedBin} 🟢
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {searchedConsumableCandidates.length > visibleSearchLimit && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleSearchLimit((prev) => prev + 40)}
                  className="px-4 py-1.5 rounded-xl bg-teal-950 hover:bg-teal-900 text-teal-200 border border-teal-600/50 text-xs font-bold cursor-pointer"
                >
                  عرض المزيد من النتائج ({searchedConsumableCandidates.length - visibleSearchLimit} قطعة متبقية)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* القسم الثاني: خطة النقل المباشرة للقطع الاستهلاكية فقط إلى (A / FL) */}
      {items.length > 0 && (
        <div className="bg-[#14261D] border-2 border-emerald-500/70 rounded-2xl p-4 space-y-3 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500 text-stone-950 font-black text-xs">
                  2. خطة نقل القطع الاستهلاكية فقط ← A / FL
                </span>
                <h3 className="text-sm sm:text-base font-black text-white">
                  توجيه ونقل القطع الاستهلاكية المعلمة إلى أرفف الصرف السريع A و FL ({consumableTransferSuggestions.length} قطعة استهلاكية جاهزة للنقل)
                </h3>
              </div>
              <p className="text-xs text-emerald-200/90">
                تشمل الخطة القطع الاستهلاكية فقط (الفلاتر، السيور، الأورنق، الصوف، الوجيه، الفيوزات، اللمبات، وأي قطعة وضعت عليها علامة استهلاكية) لتوجيهها إلى الأرفف القريبة (A و FL).
              </p>
            </div>

            {consumableTransferSuggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  dir="ltr"
                  value={consumableTargetOverride}
                  onChange={(e) => setConsumableTargetOverride(e.target.value.toUpperCase())}
                  placeholder="تلقائي (A و FL)"
                  className="w-40 px-3 py-2 rounded-xl bg-black/50 border border-emerald-500/60 text-white font-mono font-bold text-xs text-center"
                  title="اتركه فارغاً لتوزيع القطع الاستهلاكية تلقائياً على A و FL في نفس الممر"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleMoveAllConsumablesToAFL}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-lg cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    اعتماد ونقل كافة القطع الاستهلاكية إلى A / FL ({consumableTransferSuggestions.length} قطعة) 🟢
                  </span>
                </button>
              </div>
            )}
          </div>

          {consumableTransferSuggestions.length === 0 ? (
            <div className="p-3 rounded-xl bg-black/30 border border-emerald-700/40 text-xs text-emerald-300 font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>جميع القطع الاستهلاكية المعلمة مستقرة حالياً في أرفف الاستهلاكية المعتمدة (A و FL)!</span>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {consumableTransferSuggestions.slice(0, visibleConsumableLimit).map((sug, idx) => {
                const item = itemByPartMap.get(sug.partNumber);
                if (!item) return null;
                const sz = estimatePartSizeProfile(item);
                const destBin = consumableTargetOverride.trim() || sug.to;
                return (
                  <div
                    key={`${sug.partNumber}-${idx}`}
                    className="p-2.5 rounded-xl bg-[#0F1D16] border border-emerald-700/50 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-black text-amber-300 bg-black/50 px-2 py-0.5 rounded border border-amber-600/40">
                          {sug.partNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-teal-900/90 text-teal-200 border border-teal-500/60 font-black text-[11px]">
                          🔄 قطعة استهلاكية
                        </span>
                        <span className="px-2 py-0.5 rounded bg-amber-950/90 text-amber-200 border border-amber-600/50 font-bold text-[11px]">
                          الصنف: {item.category}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-cyan-950/90 text-cyan-200 border border-cyan-600/60 font-mono font-bold text-[11px]">
                          المقاس: {sz.mmLabel}
                        </span>
                        <span className="font-bold text-white">{item.description_ar}</span>
                      </div>
                      <p className="text-[11px] text-neutral-400 font-mono" dir="ltr">
                        {item.description_en}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-1 rounded-lg bg-black/50 border border-emerald-700/50 font-mono font-bold text-neutral-200">
                        من: <strong className="text-amber-300">{sug.from}</strong> ⬅ إلى رف الاستهلاكية:{' '}
                        <strong className="text-emerald-400">{destBin}</strong> (الكمية: {sug.quantity})
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDirectMoveSingleItem(sug.partNumber, destBin)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black cursor-pointer"
                      >
                        نقل إلى {destBin} 🟢
                      </button>
                    </div>
                  </div>
                );
              })}

              {consumableTransferSuggestions.length > visibleConsumableLimit && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => setVisibleConsumableLimit((prev) => prev + 25)}
                    className="px-4 py-1.5 rounded-xl bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-600/50 text-xs font-bold cursor-pointer"
                  >
                    عرض المزيد من القطع الاستهلاكية ({consumableTransferSuggestions.length - visibleConsumableLimit} متبقية)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* القسم الثالث: نقل سريع لأي قطعة استهلاكية إلى موقع جديد */}
      {items.length > 0 && (
        <div className="bg-[#221612] border-2 border-teal-700/50 rounded-2xl p-4 space-y-3 shadow-md">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-teal-400" />
              <h3 className="text-sm font-black text-teal-300">
                3. نقل مباشر لأي قطعة استهلاكية إلى رف (A / FL) أو موقع جديد
              </h3>
            </div>
            {selectedQuickItem && (
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <span className="px-2.5 py-0.5 rounded-lg bg-stone-900 text-amber-200 border border-amber-600/50 font-bold">
                  الموقع الحالي: {selectedQuickItem.location_code} | الصنف: {selectedQuickItem.category}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs font-bold text-neutral-300 mb-1">
                بحث سريع بالرقم أو الاسم:
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-amber-400" />
                <input
                  type="text"
                  value={quickSearchFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    setQuickSearchFilter(val);
                    if (/^\d{10}$/.test(val.trim()) && itemByPartMap.has(val.trim())) {
                      setQuickPartNumber(val.trim());
                    }
                  }}
                  placeholder="ابحث بالرقم أو الاسم..."
                  className="w-full pr-8 pl-2.5 py-2.5 rounded-xl bg-[#160E0B] border border-[#4A3227] text-white text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-300 mb-1">
                اختر القطعة الاستهلاكية المراد نقلها:
              </label>
              <select
                value={quickPartNumber}
                onChange={(e) => {
                  const p = e.target.value;
                  setQuickPartNumber(p);
                  const found = itemByPartMap.get(p);
                  if (found) {
                    const preferFL = /FILTER|HOSE|BELT|GASKET|فلتر|خرطوم|سير|جازكيت/i.test(
                      `${found.description_en} ${found.description_ar}`
                    );
                    setQuickNewLocation(resolveTargetConsumableLocation(found.location_code, preferFL));
                  }
                }}
                className="w-full px-3 py-2.5 rounded-xl bg-[#160E0B] border border-[#4A3227] text-amber-200 text-xs font-bold focus:outline-none focus:border-amber-500"
              >
                <option value="">
                  -- اختر رقم القطعة (عرض {quickSelectableItems.length}) --
                </option>
                {quickSelectableItems.map((item, idx) => (
                  <option key={`${item.part_number}-${idx}`} value={item.part_number}>
                    {item.part_number} — {item.location_code} — [{item.category}] {item.description_ar}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-teal-300 mb-1">
                رف الاستهلاكية الجديد (A / FL):
              </label>
              <input
                type="text"
                dir="ltr"
                value={quickNewLocation}
                onChange={(e) => setQuickNewLocation(e.target.value.toUpperCase())}
                placeholder="مثال: N11A1 أو N11FL1 أو A1 أو FL1"
                className="w-full px-3 py-2.5 rounded-xl bg-[#160E0B] border border-teal-600/60 text-white font-mono font-bold text-xs text-center focus:outline-none focus:border-teal-400"
              />
            </div>

            <button
              type="button"
              disabled={busy || !selectedQuickItem || !quickNewLocation.trim()}
              onClick={() =>
                selectedQuickItem &&
                handleDirectMoveSingleItem(selectedQuickItem.part_number, quickNewLocation)
              }
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>اعتماد ونقل القطعة للموقع الجديد 🟢</span>
            </button>
          </div>

          {selectedQuickItem && quickNearbyBins.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
              <span className="text-neutral-400">أرفف استهلاكية مقترحة (A و FL):</span>
              {quickNearbyBins
                .filter((b) => b !== selectedQuickItem.location_code)
                .map((bin) => {
                  const isAFL = isConsumableTargetLocation(bin);
                  return (
                    <button
                      key={bin}
                      type="button"
                      onClick={() => setQuickNewLocation(bin)}
                      className={`px-2.5 py-1 rounded-lg font-mono font-bold border cursor-pointer flex items-center gap-1 ${
                        quickNewLocation === bin
                          ? 'bg-teal-600 text-white border-teal-400'
                          : isAFL
                          ? 'bg-teal-950/90 text-teal-200 border-teal-500/60 hover:bg-teal-900'
                          : 'bg-[#19110D] text-amber-200 border-[#3D271F] hover:border-amber-500'
                      }`}
                    >
                      <span>{bin}</span>
                      {isAFL && <span className="text-[10px] font-sans text-teal-300">(رف استهلاكية)</span>}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {pendingTransferDocs.length > 0 && (
        <div className="bg-[#231713] border-2 border-amber-600/60 rounded-2xl p-4 space-y-3">
          <h3 className="text-sm font-black text-amber-300 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <span>طلبات نقل محفوظة بانتظار اعتماد المشرف ({pendingTransferDocs.length})</span>
          </h3>
          <div className="space-y-2">
            {pendingTransferDocs.map((doc) => (
              <div
                key={doc.id}
                className="bg-[#19110D] border border-[#3E2A21] rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="text-xs space-y-1">
                  <span className="font-mono font-bold text-amber-300">{doc.id}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {doc.lines.slice(0, 12).map((line, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-[#261A15] border border-[#3D271F] font-mono text-[11px] text-neutral-200"
                      >
                        {line.part_number}: {line.old_location || '—'} ⬅ {line.location}
                      </span>
                    ))}
                    {doc.lines.length > 12 && (
                      <span className="text-[11px] text-amber-300 font-bold">
                        +{doc.lines.length - 12} قطعة أخرى
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleApprovePendingDoc(doc)}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-black flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>اعتماد وتنفيذ النقل الآن + PDF وواتساب</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* القسم الرابع: خطط تجميع مجموعات القطع الاستهلاكية المتشابهة في أرفف (A / FL) */}
      {filteredSwapPlans.length === 0 ? (
        <div className="bg-[#2C1E18] rounded-2xl border border-[#432d24] p-8 text-center space-y-2">
          <Sparkles className="w-8 h-8 text-teal-400 mx-auto" />
          <h3 className="text-sm sm:text-base font-bold text-white">
            {items.length === 0
              ? 'المخزون فارغ حالياً — اقرأ ورقة جرد بالماسح الذكي للبحث عن القطع الاستهلاكية وتوجيهها إلى (A / FL)'
              : 'جميع مجموعات القطع الاستهلاكية منظمة حالياً أو يمكنك وضع علامة استهلاكية على قطع إضافية أعلاه'}
          </h3>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h3 className="text-sm font-black text-teal-300">
              4. خطط تجميع أصناف القطع الاستهلاكية في أرفف (A / FL) (بحد أقصى {MAX_ITEMS_PER_SHELF} صنفاً لكل رف) ({filteredSwapPlans.length} مجموعة استهلاكية):
            </h3>

            <div className="flex items-center gap-2">
              <select
                value={selectedFamilyFilter}
                onChange={(e) => {
                  setSelectedFamilyFilter(e.target.value);
                  setVisiblePlansLimit(12);
                }}
                className="px-3 py-1.5 rounded-xl bg-[#140D0A] border border-teal-700/60 text-teal-200 text-xs font-bold"
              >
                <option value="ALL">كل أصناف الاستهلاكية ({swapPlans.length})</option>
                {swapPlans.map((p) => (
                  <option key={p.id} value={p.family}>
                    {p.family} — {p.familyAr} ({p.allGroupItemsSortedBySize.length} قطع)
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() =>
                  setSizeSortOrder((prev) =>
                    prev === 'price_desc' ? 'desc' : prev === 'desc' ? 'asc' : 'price_desc'
                  )
                }
                className="px-3 py-1.5 rounded-xl bg-[#19110D] hover:bg-[#32211A] text-amber-300 border border-amber-600/50 text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span>ترتيب العرض</span>
              </button>
            </div>
          </div>

          {displayedPlans.map((plan) => {
            const activeTargetBin = customTargetBins[plan.id] || plan.targetBin;
            const isPlanExpanded = expandedPlans[plan.id] ?? false;
            const adjacentCandidates = plan.adjacentBins;

            const sortedGroupEntries = [...plan.allGroupItemsSortedBySize].sort((a, b) => {
              if (sizeSortOrder === 'price_desc') {
                return (
                  b.sizeProfile.estimatedPriceSar - a.sizeProfile.estimatedPriceSar ||
                  b.sizeProfile.primaryMm - a.sizeProfile.primaryMm
                );
              }
              if (sizeSortOrder === 'desc') {
                return b.sizeProfile.primaryMm - a.sizeProfile.primaryMm;
              }
              return a.sizeProfile.primaryMm - b.sizeProfile.primaryMm;
            });
            const visibleEntries = isPlanExpanded
              ? sortedGroupEntries.slice(0, 100)
              : sortedGroupEntries.slice(0, MAX_ITEMS_PER_SHELF);

            return (
              <div
                key={plan.id}
                className="bg-[#251914] rounded-2xl border border-teal-700/50 shadow-lg overflow-hidden"
              >
                <div className="p-3.5 bg-[#162324] border-b border-teal-800/60 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-1 rounded-lg bg-teal-500/20 text-teal-200 border border-teal-400/50 font-mono font-black text-xs">
                        🔄 صنف استهلاكي: {plan.family}
                      </span>
                      <h4 className="text-sm sm:text-base font-black text-white">
                        {plan.familyAr}
                      </h4>
                      <span className="px-2.5 py-0.5 rounded-lg bg-teal-400 text-stone-950 font-black text-xs">
                        سعة الرف: {Math.min(MAX_ITEMS_PER_SHELF, plan.allGroupItemsSortedBySize.length)} / {MAX_ITEMS_PER_SHELF} صنف
                      </span>
                      <span className="px-2.5 py-0.5 rounded-lg bg-cyan-950/90 text-cyan-200 border border-cyan-500/60 font-mono text-xs font-bold">
                        نطاق المقاس بالملم: {plan.groupMmSummary}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-xs bg-[#0E1819] px-3 py-1.5 rounded-xl border border-teal-700/50">
                      <MapPin className="w-3.5 h-3.5 text-teal-400" />
                      <span className="text-neutral-300 font-bold">رف الاستهلاكية الموحد (A / FL):</span>
                      <select
                        value={activeTargetBin}
                        onChange={(e) =>
                          setCustomTargetBins((prev) => ({
                            ...prev,
                            [plan.id]: e.target.value,
                          }))
                        }
                        className="bg-[#16282A] text-teal-200 font-mono font-black px-2 py-1 rounded border border-teal-500/50 text-xs"
                      >
                        <option value={plan.targetBin}>
                          {plan.targetBin} — رف الاستهلاكية المقترح
                        </option>
                        {adjacentCandidates.map((adj) => (
                          <option key={adj} value={adj}>
                            {adj} — رف بديل
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 space-y-2.5 text-xs">
                  <div className="space-y-1.5">
                    {visibleEntries.map((entry, idx) => {
                      const { item, sizeProfile } = entry;
                      const currentBin = item.location_code.trim().toUpperCase();
                      const batchIdx = Math.floor(idx / MAX_ITEMS_PER_SHELF);
                      const assignedShelfBin =
                        batchIdx === 0
                          ? activeTargetBin
                          : plan.shelfBatches?.[batchIdx]?.shelfBin || activeTargetBin;
                      const isAlreadyInTarget = currentBin === assignedShelfBin;

                      return (
                        <div
                          key={`${item.part_number}-${currentBin}-${idx}`}
                          className={`p-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${
                            isAlreadyInTarget
                              ? 'bg-emerald-950/20 border-emerald-700/40'
                              : 'bg-[#1B120E] border-teal-700/40'
                          }`}
                        >
                          <div className="space-y-1 flex-1 min-w-[240px]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 font-mono font-black text-[11px] border border-teal-500/40">
                                #{(idx % MAX_ITEMS_PER_SHELF) + 1}/{MAX_ITEMS_PER_SHELF} (رف {assignedShelfBin})
                              </span>
                              <span className="font-mono font-black text-amber-300 text-xs">
                                {item.part_number}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-teal-900/90 text-teal-200 border border-teal-500/50 text-[11px] font-bold">
                                🔄 استهلاكية
                              </span>
                              <span className="px-2 py-0.5 rounded bg-cyan-950/90 text-cyan-200 border border-cyan-500/60 font-mono font-bold text-[11px]">
                                المقاس: {sizeProfile.mmLabel}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-stone-900 text-neutral-200 border border-stone-700">
                                الموقع الحالي: {currentBin}
                              </span>
                              <span className="text-neutral-300 font-mono font-bold">
                                (الكمية: {item.qty_remaining})
                              </span>
                            </div>

                            <div className="font-bold text-white text-xs sm:text-sm">
                              {item.description_ar}
                            </div>
                            <div className="text-[11px] text-neutral-400 font-mono" dir="ltr">
                              {item.description_en}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            {isAlreadyInTarget ? (
                              <span className="px-3 py-1 rounded-lg bg-emerald-950/80 border border-emerald-600/60 text-emerald-300 font-bold text-[11px]">
                                ✓ مستقرة في الرف ({assignedShelfBin})
                              </span>
                            ) : (
                              <>
                                <span className="px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-700 font-mono font-bold text-neutral-200">
                                  من: <strong className="text-amber-300">{currentBin}</strong> ⬅ إلى:{' '}
                                  <strong className="text-emerald-400">{assignedShelfBin}</strong>
                                </span>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    handleDirectMoveSingleItem(item.part_number, assignedShelfBin)
                                  }
                                  className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold cursor-pointer"
                                >
                                  نقل هذه القطعة 🟢
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {sortedGroupEntries.length > MAX_ITEMS_PER_SHELF && (
                    <div className="pt-1 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPlans((prev) => ({
                            ...prev,
                            [plan.id]: !isPlanExpanded,
                          }))
                        }
                        className="px-3 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 text-teal-300 border border-teal-700/40 text-xs font-bold cursor-pointer"
                      >
                        {isPlanExpanded
                          ? 'طي القائمة ▲'
                          : `عرض الدفعة التالية (${sortedGroupEntries.length - MAX_ITEMS_PER_SHELF} قطعة استهلاكية إضافية) ▼`}
                      </button>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-[#19110D] border-t border-[#3D271F] flex flex-wrap items-center justify-between gap-2">
                  {onOpenLocation ? (
                    <button
                      type="button"
                      onClick={() => onOpenLocation(activeTargetBin)}
                      className="px-3 py-1.5 rounded-xl bg-[#2C1E18] hover:bg-[#3A271F] text-neutral-200 border border-[#4D3429] text-xs font-bold cursor-pointer"
                    >
                      عرض الموقع {activeTargetBin}
                    </button>
                  ) : (
                    <span />
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleApproveAndExecutePlanNow(plan)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-lg cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>
                      اعتماد ونقل مجموعة الاستهلاكية ({plan.familyAr}) إلى ({activeTargetBin}) + تقرير PDF وواتساب 📲
                    </span>
                  </button>
                </div>
              </div>
            );
          })}

          {filteredSwapPlans.length > visiblePlansLimit && (
            <div className="py-3 text-center">
              <button
                type="button"
                onClick={() => setVisiblePlansLimit((prev) => prev + 12)}
                className="px-6 py-2.5 rounded-xl bg-[#2C1E18] hover:bg-[#3A271F] text-teal-300 border border-teal-500/40 font-bold text-xs shadow-lg cursor-pointer"
              >
                عرض المزيد من خطط القطع الاستهلاكية ({filteredSwapPlans.length - visiblePlansLimit} خطة متبقية)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
