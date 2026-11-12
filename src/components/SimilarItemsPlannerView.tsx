import React, { useEffect, useMemo, useState } from 'react';
import type { InventoryItem } from '../types';
import type { StockDocument, DocumentLine } from '../services/documents';
import { dbService } from '../services/db';
import {
  buildSimilaritySwapPlans,
  buildHighValueConsolidationPlans,
  getAdjacentStorageBins,
  estimatePartSizeProfile,
  suggestHeavyItemsToLocationD,
  suggestConsumableItemsToAOrFL,
  isDLocation,
  isCLocation,
  isALocation,
  isFLLocation,
  isConsumableAOrFLLocation,
  isHeavyDutyDOrCLocation,
  isConsumablePart,
  MAX_ITEMS_PER_SHELF,
  type SimilaritySwapPlan,
  type HighValueShelfPlan,
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
  Ruler,
  Search,
  Filter,
  RefreshCw,
} from 'lucide-react';

interface SimilarItemsPlannerViewProps {
  items: InventoryItem[];
  isActive?: boolean;
  onRefresh: () => void;
  onOpenRelocationReport: (movedItems?: InventoryItem[]) => void;
  onOpenLocation?: (locationCode: string) => void;
}

export const SimilarItemsPlannerView: React.FC<SimilarItemsPlannerViewProps> = ({
  items,
  isActive = true,
  onRefresh,
  onOpenRelocationReport,
  onOpenLocation,
}) => {
  const [documents, setDocuments] = useState<StockDocument[]>([]);
  const [customTargetBins, setCustomTargetBins] = useState<Record<string, string>>({});
  const [customEvictBins, setCustomEvictBins] = useState<Record<string, string>>({});
  const [includeEvictionsMap, setIncludeEvictionsMap] = useState<Record<string, boolean>>({});
  const [expandedPlans, setExpandedPlans] = useState<Record<string, boolean>>({});
  const [visiblePlansLimit, setVisiblePlansLimit] = useState(12);
  const [visibleHeavyLimit, setVisibleHeavyLimit] = useState(15);
  const [visibleConsumableLimit, setVisibleConsumableLimit] = useState(15);
  const [sizeSortOrder, setSizeSortOrder] = useState<'price_desc' | 'desc' | 'asc'>('price_desc');
  const [selectedFamilyFilter, setSelectedFamilyFilter] = useState<string>('ALL');
  const [selectedSizeFilter, setSelectedSizeFilter] = useState<string>('ALL');
  const [mmFilterRange, setMmFilterRange] = useState<string>('ALL');
  const [mmSearchText, setMmSearchText] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'success' | 'info' | 'error';
  } | null>(null);
  const [lastApprovedPlanItems, setLastApprovedPlanItems] = useState<InventoryItem[]>([]);

  const [quickSearchFilter, setQuickSearchFilter] = useState('');
  const [quickPartNumber, setQuickPartNumber] = useState('');
  const [quickNewLocation, setQuickNewLocation] = useState('');
  const [heavyTargetOverride, setHeavyTargetOverride] = useState('');
  const [consumableTargetOverride, setConsumableTargetOverride] = useState('');
  const [consumableTargetLetter, setConsumableTargetLetter] = useState<'AUTO' | 'A' | 'FL'>('AUTO');
  const [expensiveShelfOverride, setExpensiveShelfOverride] = useState('');

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

  const approvedTransferReports = useMemo(
    () => (isActive ? dbService.getTransferReports() : []),
    [documents, items.length, isActive]
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
    if (!isActive) return map;
    for (let i = 0; i < items.length; i++) {
      map.set(items[i].part_number, items[i]);
    }
    return map;
  }, [items, isActive]);

  const allBins = useMemo(
    () =>
      isActive
        ? Array.from(
            new Set(
              items
                .map((i) => i.location_code.trim().toUpperCase())
                .filter(Boolean)
            )
          ).sort()
        : [],
    [items, isActive]
  );

  const quickSelectableItems = useMemo(() => {
    if (!isActive) return [];
    const q = quickSearchFilter.trim().toLowerCase();
    if (!q) return items.slice(0, 120);
    const matches: InventoryItem[] = [];
    for (let i = 0; i < items.length && matches.length < 120; i++) {
      const it = items[i];
      const sz = estimatePartSizeProfile(it);
      if (
        it.part_number.toLowerCase().includes(q) ||
        it.location_code.toLowerCase().includes(q) ||
        it.description_ar.toLowerCase().includes(q) ||
        it.description_en.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q) ||
        sz.mmLabel.toLowerCase().includes(q)
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

  const selectedQuickItemSize = useMemo(
    () => (selectedQuickItem ? estimatePartSizeProfile(selectedQuickItem) : null),
    [selectedQuickItem]
  );

  const quickNearbyBins = useMemo(() => {
    if (!selectedQuickItem) return allBins.slice(0, 6);
    const adj = getAdjacentStorageBins(selectedQuickItem.location_code, allBins, 8);
    if (selectedQuickItemSize?.isConsumable) {
      const zonePrefix = selectedQuickItem.location_code.trim().toUpperCase().match(/^([A-Z]\d{2})/)?.[1] || 'N11';
      return Array.from(
        new Set([
          selectedQuickItemSize.targetConsumableLocation,
          `${zonePrefix}A1`,
          `${zonePrefix}FL1`,
          'A1',
          'FL1',
          ...adj,
        ])
      ).slice(0, 8);
    }
    if (selectedQuickItemSize?.sizeCategory === 'كبير / ثقيل') {
      return Array.from(
        new Set([selectedQuickItemSize.targetHeavyLocation, 'D1', 'C1', 'D2', 'C2', ...adj])
      ).slice(0, 8);
    }
    return adj;
  }, [selectedQuickItem, selectedQuickItemSize, allBins]);

  const consumableToAFLSuggestions = useMemo(() => {
    if (!isActive) return [];
    return suggestConsumableItemsToAOrFL(items, pendingPartNumbers, consumableTargetLetter);
  }, [items, pendingPartNumbers, consumableTargetLetter, isActive]);

  const heavyToDSuggestions = useMemo(() => {
    if (!isActive) return [];
    return suggestHeavyItemsToLocationD(items, pendingPartNumbers);
  }, [items, pendingPartNumbers, isActive]);

  const highValueShelfPlans = useMemo(() => {
    if (!isActive) return [];
    return buildHighValueConsolidationPlans(
      items,
      pendingPartNumbers,
      expensiveShelfOverride.trim() || undefined
    );
  }, [items, pendingPartNumbers, expensiveShelfOverride, isActive]);

  const swapPlans = useMemo(() => {
    if (!isActive) return [];
    return buildSimilaritySwapPlans(items, pendingPartNumbers, 'warehouse');
  }, [items, pendingPartNumbers, isActive]);

  const filteredSwapPlans = useMemo(() => {
    return swapPlans.filter((plan) => {
      if (selectedFamilyFilter !== 'ALL' && plan.family !== selectedFamilyFilter) {
        return false;
      }
      if (selectedSizeFilter !== 'ALL') {
        if (selectedSizeFilter === 'CONSUMABLE') {
          if (!plan.isConsumableFamily && !plan.allGroupItemsSortedBySize.some((e) => e.sizeProfile.isConsumable)) {
            return false;
          }
        } else if (selectedSizeFilter === 'EXPENSIVE') {
          const hasExpensive = plan.allGroupItemsSortedBySize.some(
            (e) => e.sizeProfile.priceCategory === 'أغلى سعراً / قيمة عالية'
          );
          if (!hasExpensive) return false;
        } else {
          const hasSize =
            plan.groupSizeCategory === selectedSizeFilter ||
            plan.allGroupItemsSortedBySize.some((e) => e.sizeProfile.sizeCategory === selectedSizeFilter);
          if (!hasSize) return false;
        }
      }
      if (mmFilterRange !== 'ALL') {
        const matchesRange = plan.allGroupItemsSortedBySize.some((e) => {
          const mm = e.sizeProfile.primaryMm;
          if (mmFilterRange === 'LT20') return mm > 0 && mm < 20;
          if (mmFilterRange === '20_60') return mm >= 20 && mm <= 60;
          if (mmFilterRange === '61_150') return mm > 60 && mm <= 150;
          if (mmFilterRange === 'GT150') return mm > 150;
          return true;
        });
        if (!matchesRange) return false;
      }
      if (mmSearchText.trim()) {
        const q = mmSearchText.trim().toLowerCase();
        const matchesMmText = plan.allGroupItemsSortedBySize.some(
          (e) =>
            e.sizeProfile.mmLabel.toLowerCase().includes(q) ||
            String(e.sizeProfile.primaryMm).includes(q) ||
            e.item.part_number.includes(q) ||
            e.item.description_ar.toLowerCase().includes(q) ||
            e.item.description_en.toLowerCase().includes(q)
        );
        if (!matchesMmText) return false;
      }
      return true;
    });
  }, [swapPlans, selectedFamilyFilter, selectedSizeFilter, mmFilterRange, mmSearchText]);

  const handleDirectMoveSingleItem = async (partNumber: string, targetLocation: string) => {
    const cleanTarget = sanitizeLocationCode(targetLocation) || targetLocation.trim().toUpperCase();
    if (!cleanTarget || !isValidSpecificLocation(cleanTarget)) {
      setStatusMessage({ text: 'يرجى إدخال رمز الموقع الجديد بشكل صحيح (مثل A1 أو FL1 أو N11A1 أو N11FL1 أو D1)', type: 'error' });
      return;
    }

    setBusy(true);
    setStatusMessage(null);
    try {
      const updated = await dbService.relocateItem(partNumber, cleanTarget);
      if (!updated) {
        throw new Error('لم يتم العثور على القطعة المطلوبة للنقل');
      }
      await refreshDocs();
      onRefresh();
      setLastApprovedPlanItems([updated]);
      setQuickNewLocation('');
      const sz = estimatePartSizeProfile(updated);
      setStatusMessage({
        text: `✅ تم اعتماد ونقل القطعة (${partNumber}${sz.isConsumable ? ' — 🔄 قطعة استهلاكية' : ''} — الصنف: ${updated.category} — المقاس: ${sz.mmLabel}) من (${updated.old_location || 'السابق'}) إلى موقعها الجديد (${updated.location_code}) وحفظها في قائمة النقل اليومية!`,
        type: 'success',
      });
      onOpenRelocationReport([updated]);
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleMoveAllConsumablesToAFL = async (targetLetter: 'AUTO' | 'A' | 'FL') => {
    setBusy(true);
    setStatusMessage(null);
    try {
      const movedCons = await dbService.relocateAllConsumableItemsToAOrFL(
        targetLetter,
        consumableTargetOverride.trim() || undefined
      );
      if (!movedCons.length) {
        throw new Error('جميع القطع الاستهلاكية مستقرة بالفعل في مواقع الحرف (A و FL) المعتمدة!');
      }
      await refreshDocs();
      onRefresh();
      setLastApprovedPlanItems(movedCons);
      const label = targetLetter === 'A' ? 'حرف A' : targetLetter === 'FL' ? 'حرف FL' : 'حرفي A و FL';
      setStatusMessage({
        text: `✅ تم اعتماد ونقل كافة القطع الاستهلاكية (${movedCons.length} قطعة) إلى (${label}) وحفظ العملية في قائمة النقل اليومية!`,
        type: 'success',
      });
      onOpenRelocationReport(movedCons);
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleMoveAllHeavyToDC = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      const movedHeavy = await dbService.relocateAllHeavyItemsToLocationD(
        heavyTargetOverride.trim() || undefined
      );
      if (!movedHeavy.length) {
        throw new Error('جميع القطع الثقيلة مستقرة بالفعل في مواقع الثقيلة المعتمدة (D و C)!');
      }
      await refreshDocs();
      onRefresh();
      setLastApprovedPlanItems(movedHeavy);
      setStatusMessage({
        text: `✅ تم اعتماد ونقل كافة القطع الثقيلة جداً (${movedHeavy.length} قطعة) إلى مواقع القطع الثقيلة المعتمدة (D و C) بحد أقصى ${MAX_ITEMS_PER_SHELF} صنفاً لكل رف!`,
        type: 'success',
      });
      onOpenRelocationReport(movedHeavy);
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleExecuteHighValueShelfPlan = async (hvPlan: HighValueShelfPlan) => {
    setBusy(true);
    setStatusMessage(null);
    try {
      const targetBin = (expensiveShelfOverride.trim() || hvPlan.targetBin).toUpperCase();
      const lines: DocumentLine[] = [
        ...hvPlan.evictions
          .filter((ev) => ev.fromBin !== ev.evictToBin)
          .map((ev) => ({
            part_number: ev.partNumber,
            old_location: ev.fromBin,
            location: ev.evictToBin,
            quantity: ev.quantity,
            description_en: ev.descriptionEn,
            description_ar: ev.descriptionAr,
            is_consumable: ev.sizeProfile.isConsumable ? 1 : 0,
            check: '',
            remark: ev.reason,
            reviewed: true,
          })),
        ...hvPlan.items
          .slice(0, MAX_ITEMS_PER_SHELF)
          .filter((entry) => entry.fromBin !== targetBin)
          .map((entry) => ({
            part_number: entry.item.part_number,
            old_location: entry.fromBin,
            location: targetBin,
            quantity: entry.item.qty_remaining,
            description_en: entry.item.description_en,
            description_ar: entry.item.description_ar,
            is_consumable: entry.sizeProfile.isConsumable ? 1 : 0,
            check: '',
            remark: `تجميع القطع الأغلى سعراً (${entry.sizeProfile.estimatedPriceSar.toLocaleString()} ر.س) في الرف (${targetBin}) — بحد أقصى ${MAX_ITEMS_PER_SHELF} صنف فقط`,
            reviewed: true,
          })),
      ];

      if (!lines.length) {
        throw new Error(`جميع القطع الأغلى سعراً (${hvPlan.itemsCount}/${MAX_ITEMS_PER_SHELF} صنف) مستقرة بالفعل في الرف الموحد (${targetBin})!`);
      }

      const docId = `EXPENSIVE-15-${hvPlan.shelfIndex}-${Date.now().toString().slice(-5)}`;
      await dbService.submitDocument({
        id: docId,
        kind: 'transfer',
        requester: 'فرز وتجميع القطع الأغلى سعراً (15 صنف للرف)',
        reason: hvPlan.summaryReason,
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
        text: `✅ تم اعتماد وتجميع القطع الأغلى سعراً (${hvPlan.itemsCount}/${MAX_ITEMS_PER_SHELF} صنف فقط) في الرف الموحد (${targetBin}) بنجاح!`,
        type: 'success',
      });
      onOpenRelocationReport(movedParts);
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const buildDocumentLinesForPlan = (plan: SimilaritySwapPlan): DocumentLine[] => {
    const customTarget = customTargetBins[plan.id]?.trim().toUpperCase();
    const includeEvictions = includeEvictionsMap[plan.id] ?? true;
    const lines: DocumentLine[] = [];

    if (includeEvictions) {
      for (const evict of plan.evictions) {
        const destBin = (
          customEvictBins[`${plan.id}:${evict.partNumber}`] || evict.evictToBin
        )
          .trim()
          .toUpperCase();
        if (destBin && destBin !== evict.fromBin) {
          lines.push({
            part_number: evict.partNumber,
            old_location: evict.fromBin,
            location: destBin,
            quantity: evict.quantity,
            description_en: evict.descriptionEn,
            description_ar: evict.descriptionAr,
            is_consumable: evict.sizeProfile.isConsumable ? 1 : 0,
            check: '',
            remark: 'إخراج لإحلال المتشابهات (التزام بسقف 15 صنف للرف)',
            reviewed: true,
          });
        }
      }
    }

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
            is_consumable: entry.sizeProfile.isConsumable ? 1 : 0,
            check: '',
            remark: `تجميع متشابهات ${plan.family} في ${targetBin} (دفعة #${batch.batchIndex}: ${batch.itemsCount}/${MAX_ITEMS_PER_SHELF} صنف — ${entry.sizeProfile.mmLabel})`,
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
        throw new Error('جميع قطع هذا الصنف موجودة بالفعل في الموقع المحدد — اختر موقعاً آخر إذا أردت نقل المجموعة بالكامل');
      }
      const docId = `SWAP-${plan.family}-${Date.now().toString().slice(-5)}`;
      await dbService.submitDocument({
        id: docId,
        kind: 'transfer',
        requester: 'مخطط المتشابهات (15 صنف لكل رف)',
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
        text: `✅ تم اعتماد ونقل جميع متشابهات الصنف (${plan.familyAr}) مع التزام سقف (${MAX_ITEMS_PER_SHELF} صنف فقط لكل رف) — (${movedParts.length} قطعة)!`,
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
        text: `✅ تم اعتماد النقل للمستند (${doc.id}) وانتقلت القطع لمواقعها الجديدة بنجاح!`,
        type: 'success',
      });
      onOpenRelocationReport(movedParts);
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (!isActive) return null;

  const displayedPlans = filteredSwapPlans.slice(0, visiblePlansLimit);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="bg-[#251914] rounded-2xl border border-amber-700/40 p-4 shadow-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-black text-white">
                نقل القطع الاستهلاكية إلى (A و FL) + قوائم النقل اليومية + تجميع المتشابهات
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500 text-stone-950 text-xs font-black">
                🔄 القطع الاستهلاكية ⬅ حرف A أو FL
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-stone-950 text-xs font-black">
                حد صارم: {MAX_ITEMS_PER_SHELF} صنف فقط لكل رف
              </span>
            </div>
            <p className="text-xs text-neutral-300 mt-0.5">
              يتم الإشارة إلى القطع الاستهلاكية وتوجيه نقلها إلى حرف (A) أو (FL)، وتُحفظ قائمة النقل تلقائياً لكل يوم يتم فيه النقل مع إرسال الـ PDF عبر واتساب
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() =>
              setSizeSortOrder((prev) =>
                prev === 'price_desc' ? 'desc' : prev === 'desc' ? 'asc' : 'price_desc'
              )
            }
            className="px-3 py-2 rounded-xl bg-[#19110D] hover:bg-[#32211A] text-amber-300 border border-amber-600/50 text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span>
              {sizeSortOrder === 'price_desc'
                ? 'الفرز الحالي: الأغلى سعراً أولاً 💰'
                : sizeSortOrder === 'desc'
                ? 'الفرز الحالي: الأكبر حجماً وملم أولاً ⬇'
                : 'الفرز الحالي: الأصغر حجماً وملم أولاً ⬆'}
            </span>
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
            <span>قائمة النقل اليومية PDF وواتساب 📲</span>
          </button>
        </div>
      </div>

      {/* 🌟 قسم خاص: قائمة ونقل القطع الاستهلاكية إلى حرف A أو FL 🌟 */}
      {items.length > 0 && (
        <div className="bg-[#122229] border-2 border-cyan-500/80 rounded-2xl p-4 space-y-3 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-700/40 pb-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-1 rounded-lg bg-cyan-400 text-stone-950 font-black text-xs flex items-center gap-1">
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>🔄 القطع الاستهلاكية ⬅ حرف (A) أو (FL)</span>
                </span>
                <h3 className="text-sm sm:text-base font-black text-white">
                  قائمة القطع الاستهلاكية الجاهزة للنقل إلى حرف (A) أو (FL) ({consumableToAFLSuggestions.length} قطعة)
                </h3>
              </div>
              <p className="text-xs text-cyan-100/90">
                يتم الإشارة إلى جميع القطع الاستهلاكية (المسامير، الصواميل، الجازكيت، الأورينج، الحشوات، الفلاتر، الفيوزات، اللمبات، القفازات) وتوجيه نقلها إلى حرف <strong>A</strong> أو <strong>FL</strong> مع حفظها تلقائياً في قائمة النقل اليومية.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-black/40 p-1 rounded-xl border border-cyan-600/50 text-xs">
                {(
                  [
                    { id: 'AUTO', label: 'A أو FL تلقائي' },
                    { id: 'A', label: 'إلى حرف A فقط' },
                    { id: 'FL', label: 'إلى حرف FL فقط' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setConsumableTargetLetter(mode.id)}
                    className={`px-2.5 py-1 rounded-lg font-black cursor-pointer transition-all ${
                      consumableTargetLetter === mode.id
                        ? 'bg-cyan-500 text-stone-950 shadow'
                        : 'text-cyan-200 hover:text-white'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              <input
                type="text"
                dir="ltr"
                value={consumableTargetOverride}
                onChange={(e) => setConsumableTargetOverride(e.target.value.toUpperCase())}
                placeholder="مثال: N11A1 أو N11FL1"
                className="w-40 px-3 py-2 rounded-xl bg-black/50 border border-cyan-400/70 text-cyan-200 font-mono font-bold text-xs text-center"
                title="اتركه فارغاً للتوزيع التلقائي على A و FL (بحد 15 صنفاً لكل رف)"
              />

              {consumableToAFLSuggestions.length > 0 && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleMoveAllConsumablesToAFL('A')}
                    className="px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-lg cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>نقل الاستهلاكية إلى حرف (A) 🟢</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleMoveAllConsumablesToAFL('FL')}
                    className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-lg cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>نقل الاستهلاكية إلى حرف (FL) 🟢</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {consumableToAFLSuggestions.length === 0 ? (
            <div className="p-3 rounded-xl bg-black/30 border border-cyan-700/40 text-xs text-cyan-200 font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>جميع القطع الاستهلاكية في المخزون مستقرة حالياً في مواقع الحرف (A و FL) المعتمدة!</span>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {consumableToAFLSuggestions.slice(0, visibleConsumableLimit).map((sug, idx) => {
                const item = itemByPartMap.get(sug.partNumber);
                if (!item) return null;
                const sz = estimatePartSizeProfile(item);
                const destBin = consumableTargetOverride.trim() || sug.to;
                const zonePrefix = item.location_code.trim().toUpperCase().match(/^([A-Z]\d{2})/)?.[1] || 'N11';
                const binA = `${zonePrefix}A1`;
                const binFL = `${zonePrefix}FL1`;
                return (
                  <div
                    key={`cons-${sug.partNumber}-${idx}`}
                    className="p-2.5 rounded-xl bg-[#0D181D] border border-cyan-700/50 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-black text-amber-300 bg-black/50 px-2 py-0.5 rounded border border-amber-600/40">
                          {sug.partNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-cyan-500 text-stone-950 font-black text-[11px]">
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

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-2.5 py-1 rounded-lg bg-black/50 border border-cyan-700/50 font-mono font-bold text-neutral-200">
                        من: <strong className="text-amber-300">{sug.from}</strong> ⬅ إلى:{' '}
                        <strong className="text-cyan-300">{destBin}</strong> (الكمية: {sug.quantity})
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDirectMoveSingleItem(sug.partNumber, binA)}
                        className="px-2.5 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white font-black cursor-pointer"
                        title={`نقل القطعة الاستهلاكية إلى حرف A (${binA})`}
                      >
                        نقل إلى A ({binA})
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDirectMoveSingleItem(sug.partNumber, binFL)}
                        className="px-2.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-600 text-white font-black cursor-pointer"
                        title={`نقل القطعة الاستهلاكية إلى حرف FL (${binFL})`}
                      >
                        نقل إلى FL ({binFL})
                      </button>
                    </div>
                  </div>
                );
              })}

              {consumableToAFLSuggestions.length > visibleConsumableLimit && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => setVisibleConsumableLimit((prev) => prev + 25)}
                    className="px-4 py-1.5 rounded-xl bg-cyan-950 hover:bg-cyan-900 text-cyan-200 border border-cyan-600/50 text-xs font-bold cursor-pointer"
                  >
                    عرض المزيد من القطع الاستهلاكية ({consumableToAFLSuggestions.length - visibleConsumableLimit} متبقية)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* سجل قوائم النقل اليومية المحفوظة (تحفظ كل يوم يتم فيه النقل مع الإشارة للقطع الاستهلاكية) */}
      <div className="bg-[#201511] border-2 border-emerald-600/60 rounded-2xl p-4 space-y-3 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black text-emerald-300 flex items-center gap-2">
            <Printer className="w-4 h-4 text-emerald-400" />
            <span>
              📅 قوائم النقل اليومية المحفوظة ({approvedTransferReports.length} يوم نقل محفوظ)
            </span>
          </h3>
          <span className="text-[11px] text-neutral-300 font-bold">
            تُحفظ قائمة النقل تلقائياً لكل يوم يتم فيه النقل مع الإشارة للقطع الاستهلاكية الموجهة إلى حرف (A) أو (FL)
          </span>
        </div>

        {approvedTransferReports.length === 0 ? (
          <div className="p-3 rounded-xl bg-[#160E0B] border border-[#38241C] text-xs text-neutral-400">
            لم تقم بأي عملية نقل حتى الآن — عند نقل أي قطعة استهلاكية إلى (A أو FL) أو أي قطعة أخرى ستُحفظ تلقائياً في قائمة نقل اليوم وتبقى محفوظة للرجوع إليها وإرسالها كملف PDF عبر واتساب.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {approvedTransferReports.map((rep, idx) => {
              const title = rep.reportTitle || `قائمة نقل #${idx + 1}`;
              const movedSnapshotItems: InventoryItem[] =
                rep.transferredItemsSnapshot && rep.transferredItemsSnapshot.length > 0
                  ? rep.transferredItemsSnapshot.map((s) => ({
                      part_number: s.part_number,
                      location_code: s.location_code,
                      old_location: s.old_location,
                      description_en: s.description_en,
                      description_ar: s.description_ar,
                      category: s.category,
                      qty_total: s.qty_total,
                      qty_out: s.qty_out,
                      qty_remaining: s.qty_remaining,
                      is_moved: 1,
                      user_moved: 1,
                      is_missing: s.is_missing,
                      is_consumable: s.is_consumable,
                      status: 'منقول',
                      moved_at: s.moved_at || rep.executedAt || rep.createdAt,
                      remark: s.remark || rep.reason,
                    }))
                  : rep.lines
                      .map((l) => dbService.getItemByPartNumber(l.part_number))
                      .filter((i): i is InventoryItem => Boolean(i));

              const consMovedCount = movedSnapshotItems.filter((i) => isConsumablePart(i)).length;

              return (
                <div
                  key={rep.id}
                  className="bg-[#160E0B] border border-emerald-700/40 rounded-xl p-3 flex flex-col justify-between gap-2.5"
                >
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 font-black">
                        📄 {title}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold text-[11px]">
                          {movedSnapshotItems.length || rep.lines.length} قطعة منقولة
                        </span>
                        {consMovedCount > 0 && (
                          <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-500/40 font-bold text-[11px]">
                            🔄 {consMovedCount} استهلاكية (A/FL)
                          </span>
                        )}
                      </div>
                    </div>
                    {rep.reason && (
                      <p className="text-neutral-300 text-[11px] font-bold">{rep.reason}</p>
                    )}
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {rep.lines.slice(0, 6).map((line, lIdx) => {
                        const isCons = line.is_consumable === 1;
                        return (
                          <span
                            key={lIdx}
                            className={`px-2 py-0.5 rounded border font-mono text-[10px] ${
                              isCons
                                ? 'bg-cyan-950/70 border-cyan-600/50 text-cyan-200'
                                : 'bg-[#231712] border-[#3D271F] text-amber-200'
                            }`}
                          >
                            {isCons ? '🔄 ' : ''}{line.part_number}: {line.old_location || '—'} ⬅ {line.location}
                          </span>
                        );
                      })}
                      {rep.lines.length > 6 && (
                        <span className="text-[10px] text-emerald-300 font-bold">
                          +{rep.lines.length - 6} قطع أخرى
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenRelocationReport(movedSnapshotItems)}
                    className="w-full px-3 py-2 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>فتح {title} وإرسال PDF عبر واتساب 📲</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-[#1E1410] rounded-2xl border border-amber-600/40 p-3.5 shadow-md space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Ruler className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs sm:text-sm font-black text-amber-300">
              فلترة المتشابهات حسب (الصنف — القطع الاستهلاكية A/FL — الحجم / السعر — المليمتر ملم):
            </h3>
          </div>
          <span className="text-[11px] text-cyan-300 font-bold">
            إجمالي مجموعات الأصناف المتشابهة: {filteredSwapPlans.length} من {swapPlans.length} مجموعة
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold text-neutral-300 mb-1">
              1. تصفية حسب الصنف (Category):
            </label>
            <select
              value={selectedFamilyFilter}
              onChange={(e) => {
                setSelectedFamilyFilter(e.target.value);
                setVisiblePlansLimit(12);
              }}
              className="w-full px-3 py-2 rounded-xl bg-[#140D0A] border border-amber-700/50 text-amber-200 text-xs font-bold focus:outline-none focus:border-amber-400"
            >
              <option value="ALL">كل الأصناف المتشابهة ({swapPlans.length} صنف)</option>
              {swapPlans.map((p) => (
                <option key={p.id} value={p.family}>
                  {p.family} — {p.familyAr} ({p.allGroupItemsSortedBySize.length} قطع)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-neutral-300 mb-1">
              2. تصفية حسب الاستهلاكية أو الحجم أو الأغلى سعراً:
            </label>
            <select
              value={selectedSizeFilter}
              onChange={(e) => {
                setSelectedSizeFilter(e.target.value);
                setVisiblePlansLimit(12);
              }}
              className="w-full px-3 py-2 rounded-xl bg-[#140D0A] border border-amber-700/50 text-amber-200 text-xs font-bold focus:outline-none focus:border-amber-400"
            >
              <option value="ALL">جميع الأحجام والأسعار</option>
              <option value="CONSUMABLE">🔄 القطع الاستهلاكية (تنقل إلى حرف A أو FL)</option>
              <option value="EXPENSIVE">الأغلى سعراً / قيمة عالية جداً 💰</option>
              <option value="كبير / ثقيل">ثقيلة جداً (تنقل إلى الموقعين D و C)</option>
              <option value="متوسط الحجم">متوسط الحجم</option>
              <option value="صغير / خفيف">صغير / خفيف</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-cyan-300 mb-1">
              3. تصفية حسب نطاق المقاس بالملم (MM):
            </label>
            <select
              value={mmFilterRange}
              onChange={(e) => {
                setMmFilterRange(e.target.value);
                setVisiblePlansLimit(12);
              }}
              className="w-full px-3 py-2 rounded-xl bg-[#140D0A] border border-cyan-700/50 text-cyan-200 text-xs font-bold focus:outline-none focus:border-cyan-400"
            >
              <option value="ALL">كل المقاسات بالملم (MM)</option>
              <option value="LT20">دقيق وصغير: أقل من 20 ملم</option>
              <option value="20_60">متوسط: من 20 ملم إلى 60 ملم</option>
              <option value="61_150">كبير: من 61 ملم إلى 150 ملم</option>
              <option value="GT150">ثقيل جداً: أكبر من 150 ملم</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-cyan-300 mb-1">
              4. بحث دقيق بالملم أو الصنف (مثال: 100 ملم أو M10):
            </label>
            <div className="relative">
              <Filter className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-cyan-400" />
              <input
                type="text"
                value={mmSearchText}
                onChange={(e) => setMmSearchText(e.target.value)}
                placeholder="اكتب المقاس بالملم (مثلاً 80.5 أو 215)..."
                className="w-full pr-8 pl-2.5 py-2 rounded-xl bg-[#140D0A] border border-cyan-700/50 text-white text-xs focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>
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
              : 'bg-amber-950/90 text-amber-200 border-amber-600'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{statusMessage.text}</span>
          </div>
          {statusMessage.type === 'success' && (
            <button
              type="button"
              onClick={() => onOpenRelocationReport(lastApprovedPlanItems)}
              className="px-3 py-1.5 rounded-xl bg-[#25D366] hover:bg-[#1da851] text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>فتح قائمة النقل اليومية PDF وواتساب 📲</span>
            </button>
          )}
        </div>
      )}

      {items.length > 0 && highValueShelfPlans.length > 0 && (
        <div className="bg-[#271C11] border-2 border-amber-400/80 rounded-2xl p-4 space-y-3 shadow-xl">
          {(() => {
            const topPlan = highValueShelfPlans[0];
            const activeExpensiveBin = (expensiveShelfOverride.trim() || topPlan.targetBin).toUpperCase();
            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-700/40 pb-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-1 rounded-lg bg-amber-400 text-stone-950 font-black text-xs">
                        رف القطع الأغلى سعراً 💰 ({topPlan.itemsCount}/{MAX_ITEMS_PER_SHELF} صنف فقط)
                      </span>
                      <h3 className="text-sm sm:text-base font-black text-white">
                        فرز القطع الأغلى سعراً لتجميعها في رف واحد ({activeExpensiveBin}) — حد الرف {MAX_ITEMS_PER_SHELF} صنفاً فقط
                      </h3>
                    </div>
                    <p className="text-xs text-amber-200/90">
                      تم فرز المخزون تنازلياً من الأغلى سعراً ({topPlan.maxUnitPriceSar.toLocaleString()} ر.س) إلى ({topPlan.minUnitPriceSar.toLocaleString()} ر.س) بإجمالي قيمة ~{topPlan.totalShelfValueSar.toLocaleString()} ر.س.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      dir="ltr"
                      value={expensiveShelfOverride}
                      onChange={(e) => setExpensiveShelfOverride(e.target.value.toUpperCase())}
                      placeholder={`الرف الموحد (${topPlan.targetBin})`}
                      className="w-40 px-3 py-2 rounded-xl bg-black/50 border border-amber-400/70 text-amber-200 font-mono font-bold text-xs text-center"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleExecuteHighValueShelfPlan(topPlan)}
                      className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 text-xs font-black flex items-center gap-1.5 shadow-lg cursor-pointer"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>
                        اعتماد وتجميع الأغلى سعراً ({topPlan.itemsCount}/{MAX_ITEMS_PER_SHELF} صنف) في ({activeExpensiveBin}) 💰
                      </span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-80 overflow-y-auto pr-1">
                  {topPlan.items.slice(0, MAX_ITEMS_PER_SHELF).map((entry, idx) => {
                    const { item, sizeProfile, fromBin } = entry;
                    const isAlreadyThere = fromBin === activeExpensiveBin;
                    return (
                      <div
                        key={`exp-${item.part_number}-${idx}`}
                        className="p-2.5 rounded-xl bg-[#18110A] border border-amber-600/40 flex flex-col justify-between gap-2 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-1.5 flex-wrap">
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-black text-[11px] border border-amber-500/40">
                              #{idx + 1} / {MAX_ITEMS_PER_SHELF}
                            </span>
                            <span className="font-mono font-black text-white bg-black/50 px-2 py-0.5 rounded border border-stone-700">
                              {item.part_number}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-amber-400 text-stone-950 font-black text-[11px]">
                              {sizeProfile.estimatedPriceSar.toLocaleString()} ر.س
                            </span>
                          </div>
                          <div className="font-bold text-amber-100 truncate" title={item.description_ar}>
                            {item.description_ar}
                          </div>
                          <div className="text-[11px] text-neutral-400 font-mono truncate" dir="ltr" title={item.description_en}>
                            {item.description_en}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-900/40">
                          <span className="font-mono text-[11px] text-neutral-300">
                            من: <strong className="text-amber-300">{fromBin}</strong> ⬅ إلى:{' '}
                            <strong className="text-emerald-400">{activeExpensiveBin}</strong>
                          </span>
                          {isAlreadyThere ? (
                            <span className="text-[11px] text-emerald-400 font-bold">✓ في الرف</span>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleDirectMoveSingleItem(item.part_number, activeExpensiveBin)}
                              className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-[11px] cursor-pointer"
                            >
                              نقل للرف
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {items.length > 0 && (
        <div className="bg-[#1A261E] border-2 border-emerald-500/70 rounded-2xl p-4 space-y-3 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500 text-stone-950 font-black text-xs">
                  مواقع الثقيلة جداً: D و C (بحد {MAX_ITEMS_PER_SHELF} صنف للرف)
                </span>
                <h3 className="text-sm sm:text-base font-black text-white">
                  توجيه ونقل القطع الثقيلة جداً إلى الموقعين D و C ({heavyToDSuggestions.length} قطعة ثقيلة للتوزيع)
                </h3>
              </div>
              <p className="text-xs text-emerald-200/90">
                يتم توجيه القطع الثقيلة جداً أولاً إلى الرف (D) حتى يكتمل بـ {MAX_ITEMS_PER_SHELF} صنفاً، ثم ينتقل الفائض تلقائياً إلى الرف (C).
              </p>
            </div>

            {heavyToDSuggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  dir="ltr"
                  value={heavyTargetOverride}
                  onChange={(e) => setHeavyTargetOverride(e.target.value.toUpperCase())}
                  placeholder="تلقائي (D و C — 15/رف)"
                  className="w-44 px-3 py-2 rounded-xl bg-black/50 border border-emerald-500/60 text-white font-mono font-bold text-xs text-center"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleMoveAllHeavyToDC}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-lg cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    اعتماد ونقل كافة القطع الثقيلة إلى D و C ({heavyToDSuggestions.length} قطعة) 🟢
                  </span>
                </button>
              </div>
            )}
          </div>

          {heavyToDSuggestions.length === 0 ? (
            <div className="p-3 rounded-xl bg-black/30 border border-emerald-700/40 text-xs text-emerald-300 font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>جميع القطع الثقيلة في المخزون مستقرة حالياً في مواقع الثقيلة المعتمدة (D و C) ضمن حد 15 صنفاً لكل رف!</span>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {heavyToDSuggestions.slice(0, visibleHeavyLimit).map((sug, idx) => {
                const item = itemByPartMap.get(sug.partNumber);
                if (!item) return null;
                const sz = estimatePartSizeProfile(item);
                const destBin = heavyTargetOverride.trim() || sug.to;
                const isTargetC = isCLocation(destBin);
                return (
                  <div
                    key={`${sug.partNumber}-${idx}`}
                    className="p-2.5 rounded-xl bg-[#111914] border border-emerald-700/50 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-black text-amber-300 bg-black/50 px-2 py-0.5 rounded border border-amber-600/40">
                          {sug.partNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-amber-950/90 text-amber-200 border border-amber-600/50 font-bold text-[11px]">
                          الصنف: {item.category}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-red-950/90 text-red-200 border border-red-600/60 font-bold text-[11px]">
                          الحجم: {sz.sizeCategory}
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
                        من: <strong className="text-amber-300">{sug.from}</strong> ⬅ إلى موقع الثقيلة ({isTargetC ? 'C' : 'D'}):{' '}
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

              {heavyToDSuggestions.length > visibleHeavyLimit && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => setVisibleHeavyLimit((prev) => prev + 25)}
                    className="px-4 py-1.5 rounded-xl bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-600/50 text-xs font-bold cursor-pointer"
                  >
                    عرض المزيد من القطع الثقيلة ({heavyToDSuggestions.length - visibleHeavyLimit} متبقية)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="bg-[#221612] border-2 border-emerald-700/50 rounded-2xl p-4 space-y-3 shadow-md">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-black text-emerald-300">
                1. نقل سريع لأي قطعة إلى موقع جديد (مع الإشارة للقطع الاستهلاكية ونقلها إلى حرف A أو FL)
              </h3>
            </div>
            {selectedQuickItem && selectedQuickItemSize && (
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <span className="px-2.5 py-0.5 rounded-lg bg-stone-900 text-amber-200 border border-amber-600/50 font-bold">
                  الموقع الحالي: {selectedQuickItem.location_code} | الصنف: {selectedQuickItem.category}
                </span>
                {selectedQuickItemSize.isConsumable && (
                  <span className="px-2.5 py-0.5 rounded-lg bg-cyan-950 text-cyan-200 border border-cyan-500/70 font-black">
                    🔄 قطعة استهلاكية (تنقل إلى حرف {selectedQuickItemSize.consumableTargetType})
                  </span>
                )}
                <span className="px-2.5 py-0.5 rounded-lg bg-amber-950/90 text-amber-200 border border-amber-500/60 font-bold">
                  الحجم: {selectedQuickItemSize.sizeCategory}
                </span>
                <span className="px-2.5 py-0.5 rounded-lg bg-cyan-950/90 text-cyan-200 border border-cyan-500/60 font-mono font-bold">
                  المقاس بالملم: {selectedQuickItemSize.mmLabel}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs font-bold text-neutral-300 mb-1">
                بحث سريع بالرقم أو الصنف أو الملم:
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
                  placeholder="ابحث بالرقم أو الصنف أو الملم..."
                  className="w-full pr-8 pl-2.5 py-2.5 rounded-xl bg-[#160E0B] border border-[#4A3227] text-white text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-300 mb-1">
                اختر القطعة المراد نقلها:
              </label>
              <select
                value={quickPartNumber}
                onChange={(e) => {
                  const p = e.target.value;
                  setQuickPartNumber(p);
                  const found = itemByPartMap.get(p);
                  if (found) {
                    const sz = estimatePartSizeProfile(found);
                    if (sz.isConsumable && !isConsumableAOrFLLocation(found.location_code)) {
                      setQuickNewLocation(sz.targetConsumableLocation);
                    } else if (sz.sizeCategory === 'كبير / ثقيل' && !isHeavyDutyDOrCLocation(found.location_code)) {
                      setQuickNewLocation(sz.targetHeavyLocation);
                    } else {
                      setQuickNewLocation('');
                    }
                  }
                }}
                className="w-full px-3 py-2.5 rounded-xl bg-[#160E0B] border border-[#4A3227] text-amber-200 text-xs font-bold focus:outline-none focus:border-amber-500"
              >
                <option value="">
                  -- اختر رقم القطعة (عرض {quickSelectableItems.length} من {items.length.toLocaleString()}) --
                </option>
                {quickSelectableItems.map((item, idx) => {
                  const sz = estimatePartSizeProfile(item);
                  return (
                    <option key={`${item.part_number}-${idx}`} value={item.part_number}>
                      {item.part_number} — {item.location_code} — [{sz.isConsumable ? '🔄 استهلاكية (A/FL) | ' : ''}{item.category} | {sz.mmLabel}] {item.description_ar}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-emerald-300 mb-1">
                الموقع الجديد (مثال: A1 أو FL1 أو N11A1 أو N11FL1):
              </label>
              <input
                type="text"
                dir="ltr"
                value={quickNewLocation}
                onChange={(e) => setQuickNewLocation(e.target.value.toUpperCase())}
                placeholder="مثال: N11A1 أو N11FL1 أو A1 أو FL1"
                className="w-full px-3 py-2.5 rounded-xl bg-[#160E0B] border border-emerald-600/60 text-white font-mono font-bold text-xs text-center focus:outline-none focus:border-emerald-400"
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
              <span className="text-neutral-400">مواقع مقترحة (حرف A و FL للاستهلاكية، و D و C للثقيلة):</span>
              {quickNearbyBins
                .filter((b) => b !== selectedQuickItem.location_code)
                .map((bin) => {
                  const isDC = isHeavyDutyDOrCLocation(bin);
                  const isAFL = isConsumableAOrFLLocation(bin);
                  return (
                    <button
                      key={bin}
                      type="button"
                      onClick={() => setQuickNewLocation(bin)}
                      className={`px-2.5 py-1 rounded-lg font-mono font-bold border cursor-pointer flex items-center gap-1 ${
                        quickNewLocation === bin
                          ? 'bg-emerald-600 text-white border-emerald-400'
                          : isAFL
                          ? 'bg-cyan-950/90 text-cyan-200 border-cyan-500/60 hover:bg-cyan-900'
                          : isDC
                          ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/60 hover:bg-emerald-900'
                          : 'bg-[#19110D] text-amber-200 border-[#3D271F] hover:border-amber-500'
                      }`}
                    >
                      <span>{bin}</span>
                      {isAFL && (
                        <span className="text-[10px] font-sans text-cyan-300">
                          (🔄 استهلاكية {isFLLocation(bin) ? 'FL' : 'A'})
                        </span>
                      )}
                      {isDC && (
                        <span className="text-[10px] font-sans text-emerald-300">
                          (ثقيلة {isCLocation(bin) ? 'C' : 'D'})
                        </span>
                      )}
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

      {filteredSwapPlans.length === 0 ? (
        <div className="bg-[#2C1E18] rounded-2xl border border-[#432d24] p-8 text-center space-y-2">
          <Sparkles className="w-8 h-8 text-amber-400 mx-auto" />
          <h3 className="text-sm sm:text-base font-bold text-white">
            {items.length === 0
              ? 'المخزون فارغ حالياً — اقرأ ورقة جرد بالماسح الذكي لتظهر خطط تجميع المتشابهات والقطع الاستهلاكية'
              : 'لا توجد مجموعات مطابقة للفلتر الحالي — جرب اختيار كل الأصناف أو مسح نص البحث بالملم'}
          </h3>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-sm font-black text-amber-300 px-1">
            2. خطط تجميع المتشابهات من كل صنف (مع توجيه الاستهلاكية إلى A و FL بحد أقصى {MAX_ITEMS_PER_SHELF} صنفاً لكل رف) ({filteredSwapPlans.length} مجموعة):
          </h3>

          {displayedPlans.map((plan) => {
            const activeTargetBin = customTargetBins[plan.id] || plan.targetBin;
            const isTargetHeavyDC = isHeavyDutyDOrCLocation(activeTargetBin);
            const isTargetAFL = isConsumableAOrFLLocation(activeTargetBin);
            const includeEvictions = includeEvictionsMap[plan.id] ?? true;
            const isPlanExpanded = expandedPlans[plan.id] ?? false;
            const adjacentCandidates = getAdjacentStorageBins(activeTargetBin, allBins, 8);

            const sortedGroupEntries = [...plan.allGroupItemsSortedBySize].sort((a, b) => {
              if (sizeSortOrder === 'price_desc') {
                return (
                  b.sizeProfile.estimatedPriceSar - a.sizeProfile.estimatedPriceSar ||
                  b.sizeProfile.primaryMm - a.sizeProfile.primaryMm
                );
              }
              if (sizeSortOrder === 'desc') {
                return (
                  b.sizeProfile.primaryMm - a.sizeProfile.primaryMm ||
                  b.sizeProfile.sizeScore - a.sizeProfile.sizeScore
                );
              }
              return (
                a.sizeProfile.primaryMm - b.sizeProfile.primaryMm ||
                a.sizeProfile.sizeScore - b.sizeProfile.sizeScore
              );
            });
            const visibleEntries = isPlanExpanded
              ? sortedGroupEntries.slice(0, 100)
              : sortedGroupEntries.slice(0, MAX_ITEMS_PER_SHELF);

            return (
              <div
                key={plan.id}
                className="bg-[#251914] rounded-2xl border border-[#4A3227] shadow-lg overflow-hidden"
              >
                <div className="p-3.5 bg-[#1E1410] border-b border-[#3D271F] flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-black text-xs">
                        الصنف: {plan.family}
                      </span>
                      <h4 className="text-sm sm:text-base font-black text-white">
                        {plan.familyAr}
                      </h4>
                      {plan.isConsumableFamily && (
                        <span className="px-2.5 py-0.5 rounded-lg bg-cyan-500 text-stone-950 font-black text-xs">
                          🔄 قطع استهلاكية ⬅ حرف {isFLLocation(activeTargetBin) ? 'FL' : 'A'}
                        </span>
                      )}
                      <span className="px-2.5 py-0.5 rounded-lg bg-amber-500 text-stone-950 font-black text-xs">
                        سعة الرف: {Math.min(MAX_ITEMS_PER_SHELF, plan.allGroupItemsSortedBySize.length)} / {MAX_ITEMS_PER_SHELF} صنف كحد أقصى
                      </span>
                      <span className="px-2.5 py-0.5 rounded-lg bg-cyan-950/90 text-cyan-200 border border-cyan-500/60 font-mono text-xs font-bold">
                        نطاق المقاس بالملم: {plan.groupMmSummary}
                      </span>
                      {isTargetAFL && (
                        <span className="px-2.5 py-0.5 rounded-lg bg-cyan-950/90 text-cyan-200 border border-cyan-400/70 text-xs font-bold">
                          موقع استهلاكية ({isFLLocation(activeTargetBin) ? 'FL' : 'A'}): {activeTargetBin}
                        </span>
                      )}
                      {isTargetHeavyDC && (
                        <span className="px-2.5 py-0.5 rounded-lg bg-emerald-950/90 text-emerald-300 border border-emerald-500/70 text-xs font-bold">
                          موقع الثقيلة ({isCLocation(activeTargetBin) ? 'C' : 'D'}): {activeTargetBin}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-xs bg-[#160E0B] px-3 py-1.5 rounded-xl border border-[#38241C]">
                      <MapPin className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-neutral-300 font-bold">الرف الموحد (بحد {MAX_ITEMS_PER_SHELF} صنف):</span>
                      <select
                        value={activeTargetBin}
                        onChange={(e) =>
                          setCustomTargetBins((prev) => ({
                            ...prev,
                            [plan.id]: e.target.value,
                          }))
                        }
                        className="bg-[#2A1B15] text-amber-300 font-mono font-black px-2 py-1 rounded border border-amber-600/50 text-xs"
                      >
                        <option value={plan.targetBin}>
                          {plan.targetBin} {isConsumableAOrFLLocation(plan.targetBin) ? '— موقع استهلاكية A/FL' : isHeavyDutyDOrCLocation(plan.targetBin) ? '— موقع الثقيلة D/C' : '— الموقع المقترح'}
                        </option>
                        {adjacentCandidates.map((adj) => (
                          <option key={adj} value={adj}>
                            {adj} {isConsumableAOrFLLocation(adj) ? '— موقع استهلاكية A/FL' : isHeavyDutyDOrCLocation(adj) ? '— موقع الثقيلة D/C' : '— موقع مجاور'}
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
                              : 'bg-[#1B120E] border-amber-700/40'
                          }`}
                        >
                          <div className="space-y-1 flex-1 min-w-[240px]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-black text-[11px] border border-amber-500/40">
                                #{(idx % MAX_ITEMS_PER_SHELF) + 1}/{MAX_ITEMS_PER_SHELF} (رف {assignedShelfBin})
                              </span>
                              <span className="font-mono font-black text-amber-300 text-xs">
                                {item.part_number}
                              </span>
                              {sizeProfile.isConsumable && (
                                <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-200 border border-cyan-500/70 font-black text-[11px]">
                                  🔄 قطعة استهلاكية (⬅ {sizeProfile.consumableTargetType})
                                </span>
                              )}
                              <span className="px-2 py-0.5 rounded bg-cyan-950/90 text-cyan-200 border border-cyan-500/60 font-mono font-bold text-[11px]">
                                المقاس بالملم: {sizeProfile.mmLabel}
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
                        className="px-3 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 text-amber-300 border border-amber-700/40 text-xs font-bold cursor-pointer"
                      >
                        {isPlanExpanded
                          ? 'طي القائمة ▲'
                          : `عرض الدفعة التالية في الرف الرديف (${sortedGroupEntries.length - MAX_ITEMS_PER_SHELF} قطعة إضافية) ▼`}
                      </button>
                    </div>
                  )}

                  {plan.evictions.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-[#38241C]">
                      <label className="flex items-center gap-2 font-bold text-orange-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeEvictions}
                          onChange={(e) =>
                            setIncludeEvictionsMap((prev) => ({
                              ...prev,
                              [plan.id]: e.target.checked,
                            }))
                          }
                          className="accent-orange-500"
                        />
                        <span>
                          إخراج الأصناف غير المتشابهة من ({plan.targetBin}) إلى موقع مجاور للحفاظ على سقف {MAX_ITEMS_PER_SHELF} صنفاً ({plan.evictions.length}):
                        </span>
                      </label>

                      {plan.evictions.slice(0, 15).map((ev, idx) => {
                        const evKey = `${plan.id}:${ev.partNumber}`;
                        const selectedEvictBin = customEvictBins[evKey] || ev.evictToBin;
                        return (
                          <div
                            key={`${ev.partNumber}-${ev.fromBin}-${idx}`}
                            className={`p-2.5 rounded-xl bg-[#1B120E] border border-orange-800/40 flex flex-wrap items-center justify-between gap-2 ${
                              !includeEvictions ? 'opacity-50' : ''
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono font-bold text-orange-300">
                                  {ev.partNumber}
                                </span>
                                <span className="font-bold text-neutral-200">
                                  {ev.descriptionAr}
                                </span>
                                <span className="px-2 py-0.5 rounded bg-stone-900 text-amber-200 border border-stone-700 text-[10px] font-bold">
                                  الصنف: {ev.categoryAr} | المقاس: {ev.sizeProfile.mmLabel}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-neutral-300">
                                من: <strong className="text-red-300">{ev.fromBin}</strong> ⬅ إلى:
                              </span>
                              <input
                                type="text"
                                dir="ltr"
                                value={selectedEvictBin}
                                onChange={(e) =>
                                  setCustomEvictBins((prev) => ({
                                    ...prev,
                                    [evKey]: e.target.value.toUpperCase(),
                                  }))
                                }
                                className="w-24 bg-[#120B09] text-amber-300 font-mono font-bold px-2 py-1 rounded border border-amber-700/50 text-center"
                              />
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  handleDirectMoveSingleItem(ev.partNumber, selectedEvictBin)
                                }
                                className="px-2.5 py-1 rounded-lg bg-orange-800 hover:bg-orange-700 text-white font-bold cursor-pointer"
                              >
                                إخراج ونقل
                              </button>
                            </div>
                          </div>
                        );
                      })}
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
                      اعتماد وتجميع متشابهات ({plan.familyAr}) + حفظ في قائمة النقل اليومية (PDF / واتساب 📲)
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
                className="px-6 py-2.5 rounded-xl bg-[#2C1E18] hover:bg-[#3A271F] text-amber-300 border border-amber-500/40 font-bold text-xs shadow-lg cursor-pointer"
              >
                عرض المزيد من خطط تجميع الأصناف ({filteredSwapPlans.length - visiblePlansLimit} خطة متبقية)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
