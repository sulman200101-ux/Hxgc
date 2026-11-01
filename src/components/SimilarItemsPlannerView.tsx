import React, { useEffect, useMemo, useState } from 'react';
import type { InventoryItem } from '../types';
import type { StockDocument, DocumentLine } from '../services/documents';
import { dbService } from '../services/db';
import {
  buildSimilaritySwapPlans,
  getAdjacentStorageBins,
  parseShelfElevation,
  estimatePartSizeProfile,
  SHELF_ELEVATION_GUIDE,
  type SimilaritySwapPlan,
} from '../services/transferSuggestions';
import { sanitizeLocationCode, isValidSpecificLocation } from '../utils/regexSanitizer';
import { GeminiEngineeringAssistantPanel } from './GeminiEngineeringAssistantPanel';
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
} from 'lucide-react';

interface SimilarItemsPlannerViewProps {
  items: InventoryItem[];
  onRefresh: () => void;
  onOpenRelocationReport: (movedItems?: InventoryItem[]) => void;
  onOpenLocation?: (locationCode: string) => void;
}

export const SimilarItemsPlannerView: React.FC<SimilarItemsPlannerViewProps> = ({
  items,
  onRefresh,
  onOpenRelocationReport,
  onOpenLocation,
}) => {
  const [documents, setDocuments] = useState<StockDocument[]>([]);
  const [customTargetBins, setCustomTargetBins] = useState<Record<string, string>>({});
  const [customEvictBins, setCustomEvictBins] = useState<Record<string, string>>({});
  const [includeEvictionsMap, setIncludeEvictionsMap] = useState<Record<string, boolean>>({});
  const [sizeSortOrder, setSizeSortOrder] = useState<'desc' | 'asc'>('desc');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'success' | 'info' | 'error';
  } | null>(null);
  const [lastApprovedPlanItems, setLastApprovedPlanItems] = useState<InventoryItem[]>([]);

  // حالة النقل المباشر السريع لأي قطعة
  const [quickPartNumber, setQuickPartNumber] = useState('');
  const [quickNewLocation, setQuickNewLocation] = useState('');

  const refreshDocs = async () => {
    const docs = await dbService.getDocuments();
    setDocuments(docs);
  };

  useEffect(() => {
    refreshDocs().catch((err) =>
      setStatusMessage({ text: String(err), type: 'error' })
    );
  }, [items.length]);

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

  const selectedQuickItem = useMemo(
    () => items.find((i) => i.part_number === quickPartNumber.trim()) || null,
    [items, quickPartNumber]
  );

  const selectedQuickItemSize = useMemo(
    () => (selectedQuickItem ? estimatePartSizeProfile(selectedQuickItem) : null),
    [selectedQuickItem]
  );

  const selectedQuickItemElev = useMemo(
    () => (selectedQuickItem ? parseShelfElevation(selectedQuickItem.location_code) : null),
    [selectedQuickItem]
  );

  const quickNearbyBins = useMemo(() => {
    if (!selectedQuickItem) return allBins.slice(0, 6);
    return getAdjacentStorageBins(selectedQuickItem.location_code, allBins, 8);
  }, [selectedQuickItem, allBins]);

  const swapPlans = useMemo(
    () => buildSimilaritySwapPlans(items, pendingPartNumbers, 'warehouse'),
    [items, pendingPartNumbers]
  );

  // نقل قطعة واحدة فوراً إلى موقعها الجديد مع طلب اعتماد المشرف
  const handleDirectMoveSingleItem = async (partNumber: string, targetLocation: string) => {
    const cleanTarget = sanitizeLocationCode(targetLocation) || targetLocation.trim().toUpperCase();
    if (!cleanTarget || !isValidSpecificLocation(cleanTarget)) {
      setStatusMessage({ text: 'يرجى إدخال رمز الموقع الجديد بشكل صحيح (مثل N11FL1 أو N11C2)', type: 'error' });
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
      const targetElev = parseShelfElevation(updated.location_code);
      setStatusMessage({
        text: `✅ تم اعتماد ونقل القطعة (${partNumber}) من (${updated.old_location || 'السابق'}) إلى موقعها الجديد (${updated.location_code} — ${targetElev.shortLabelAr}) بنجاح!`,
        type: 'success',
      });
      onOpenRelocationReport([updated]);
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const buildDocumentLinesForPlan = (plan: SimilaritySwapPlan): DocumentLine[] => {
    const targetBin = (customTargetBins[plan.id] || plan.targetBin).trim().toUpperCase();
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
            check: '',
            remark: 'إخراج لإحلال المتشابهات',
            reviewed: true,
          });
        }
      }
    }

    for (const entry of plan.allGroupItemsSortedBySize) {
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
          remark: `تجميع وترتيب عائلة ${plan.family} (${entry.sizeProfile.sizeCategory})`,
          reviewed: true,
        });
      }
    }

    return lines;
  };

  // اعتماد وتنفيذ خطة النقل والتبديل فوراً ثم فتح تقرير PDF والواتساب
  const handleApproveAndExecutePlanNow = async (plan: SimilaritySwapPlan) => {
    setBusy(true);
    setStatusMessage(null);
    try {
      const lines = buildDocumentLinesForPlan(plan);
      if (!lines.length) {
        throw new Error('جميع قطع هذه المجموعة موجودة بالفعل في الموقع المحدد — اختر رفاً آخر إذا أردت نقل المجموعة بالكامل');
      }
      const docId = `SWAP-${plan.family}-${Date.now().toString().slice(-5)}`;
      await dbService.submitDocument({
        id: docId,
        kind: 'transfer',
        requester: 'مخطط المتشابهات وترتيب الأحجام الذكي',
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
        text: `✅ تم اعتماد ونقل جميع قطع مجموعة (${plan.familyAr}) مع ترتيبها حسب الحجم والارتفاع (${movedParts.length} قطعة)!`,
        type: 'success',
      });
      onOpenRelocationReport(movedParts);
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // اعتماد مستند نقل معلق وفتح تقرير PDF والواتساب مباشرة
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

  return (
    <div className="space-y-4" dir="rtl">
      {/* ترويسة التخطيط لنقل القطع المتشابهة وترتيب الأحجام والارتفاعات */}
      <div className="bg-[#251914] rounded-2xl border border-amber-700/40 p-4 shadow-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-white">
              التخطيط الذكي لنقل القطع المتشابهة وترتيبها حسب الحجم وارتفاع الرف
            </h2>
            <p className="text-xs text-neutral-300">
              ترتيب القطع المتشابهة من حيث الحجم والوزن وتوجيهها للرف المناسب (FL على الأرض، A=1م، B=2م، BB=3م، C=4م، D=5م)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setSizeSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            className="px-3 py-2 rounded-xl bg-[#19110D] hover:bg-[#32211A] text-amber-300 border border-amber-600/50 text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span>
              {sizeSortOrder === 'desc'
                ? 'الترتيب الحالي: من الأكبر للأصغر حجماً ⬇'
                : 'الترتيب الحالي: من الأصغر للأكبر حجماً ⬆'}
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
            <span>تقرير PDF وواتساب للمنقولة 📲</span>
          </button>
        </div>
      </div>

      {/* دليل ارتفاعات الرفوف في المستودع (FL, A, B, BB, C, D) */}
      <div className="bg-[#1E1410] rounded-2xl border border-amber-600/40 p-3.5 shadow-md space-y-2.5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Ruler className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs sm:text-sm font-black text-amber-300">
              دليل ارتفاعات الرفوف المعتمد لترتيب القطع حسب الحجم والوزن:
            </h3>
          </div>
          <span className="text-[11px] text-neutral-300 font-bold">
            القطع الثقيلة والكبيرة توضع في الأسفل (FL / A) والخفيفة والصغيرة في الأعلى (C / D)
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {SHELF_ELEVATION_GUIDE.map((level) => {
            const elevInfo = parseShelfElevation(`N11${level.code}1`);
            return (
              <div
                key={level.code}
                className={`p-2.5 rounded-xl border ${elevInfo.badgeColorClass} flex flex-col justify-between gap-1`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono font-black text-sm px-2 py-0.5 rounded bg-black/40 border border-current/30">
                    {level.code}
                  </span>
                  <span className="text-[11px] font-black">
                    {level.meters === 0 ? 'على الأرض (0م)' : `ارتفاع ${level.meters} متر`}
                  </span>
                </div>
                <p className="text-[10px] opacity-90 leading-snug font-bold mt-0.5">
                  {level.suitableForAr}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* مساعد جمني الذكي للترجمة وحسبة المقاسات والأماكن المناسبة للحجم والوزن */}
      <GeminiEngineeringAssistantPanel
        items={items}
        onRefresh={onRefresh}
        onMoveItemToShelf={handleDirectMoveSingleItem}
      />

      {/* تنبيه الحالة */}
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
              <span>فتح تقرير PDF وواتساب 📲</span>
            </button>
          )}
        </div>
      )}

      {/* القسم الأول: نقل مباشر وسريع لأي قطعة إلى موقع جديد */}
      {items.length > 0 && (
        <div className="bg-[#221612] border-2 border-emerald-700/50 rounded-2xl p-4 space-y-3 shadow-md">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-black text-emerald-300">
                1. نقل سريع لأي قطعة إلى موقع وارتفاع جديد (تنتقل فوراً بعد الاعتماد)
              </h3>
            </div>
            {selectedQuickItem && selectedQuickItemSize && selectedQuickItemElev && (
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <span className={`px-2.5 py-0.5 rounded-lg border font-bold ${selectedQuickItemElev.badgeColorClass}`}>
                  الارتفاع الحالي: {selectedQuickItemElev.shortLabelAr}
                </span>
                <span className="px-2.5 py-0.5 rounded-lg bg-amber-950/90 text-amber-200 border border-amber-500/60 font-bold">
                  الحجم: {selectedQuickItemSize.sizeCategory} ({selectedQuickItemSize.dimensionsLabel}) — ينصح بـ: {selectedQuickItemSize.recommendedShelfTextAr}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            {/* اختيار القطعة */}
            <div>
              <label className="block text-xs font-bold text-neutral-300 mb-1">
                اختر القطعة المراد نقلها:
              </label>
              <select
                value={quickPartNumber}
                onChange={(e) => {
                  setQuickPartNumber(e.target.value);
                  setQuickNewLocation('');
                }}
                className="w-full px-3 py-2.5 rounded-xl bg-[#160E0B] border border-[#4A3227] text-amber-200 text-xs font-bold focus:outline-none focus:border-amber-500"
              >
                <option value="">-- اختر رقم القطعة من المخزون ({items.length}) --</option>
                {items.map((item, idx) => {
                  const elev = parseShelfElevation(item.location_code);
                  const sz = estimatePartSizeProfile(item);
                  return (
                    <option key={`${item.part_number}-${idx}`} value={item.part_number}>
                      {item.part_number} — {item.location_code} ({elev.shortLabelAr}) — [{sz.sizeCategory}] {item.description_ar}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* إدخال الموقع الجديد */}
            <div>
              <label className="block text-xs font-bold text-emerald-300 mb-1">
                الموقع الجديد {quickNewLocation ? `(${parseShelfElevation(quickNewLocation).shortLabelAr})` : ''}:
              </label>
              <input
                type="text"
                dir="ltr"
                value={quickNewLocation}
                onChange={(e) => setQuickNewLocation(e.target.value.toUpperCase())}
                placeholder="مثال: N11FL1 (أرضي) أو N11A1 (1م) أو N11B1 (2م)"
                className="w-full px-3 py-2.5 rounded-xl bg-[#160E0B] border border-emerald-600/60 text-white font-mono font-bold text-xs text-center focus:outline-none focus:border-emerald-400"
              />
            </div>

            {/* زر الاعتماد والنقل */}
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

          {/* أزرار المواقع المتقاربة السريعة مع توضيح الارتفاع */}
          {selectedQuickItem && quickNearbyBins.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
              <span className="text-neutral-400">رفوف مقترحة في نفس الممر (حسب الارتفاع):</span>
              {quickNearbyBins
                .filter((b) => b !== selectedQuickItem.location_code)
                .map((bin) => {
                  const binElev = parseShelfElevation(bin);
                  return (
                    <button
                      key={bin}
                      type="button"
                      onClick={() => setQuickNewLocation(bin)}
                      className={`px-2.5 py-1 rounded-lg font-mono font-bold border cursor-pointer flex items-center gap-1 ${
                        quickNewLocation === bin
                          ? 'bg-emerald-600 text-white border-emerald-400'
                          : 'bg-[#19110D] text-amber-200 border-[#3D271F] hover:border-amber-500'
                      }`}
                    >
                      <span>{bin}</span>
                      <span className="text-[10px] font-sans text-neutral-300">
                        ({binElev.meters === 0 ? 'أرضي 0م' : `${binElev.meters}م`})
                      </span>
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* طلبات النقل المعلقة بانتظار اعتماد المشرف */}
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
                    {doc.lines.map((line, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-[#261A15] border border-[#3D271F] font-mono text-[11px] text-neutral-200"
                      >
                        {line.part_number}: {line.old_location || '—'} ⬅ {line.location}
                      </span>
                    ))}
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

      {/* القسم الثاني: بطاقات المتشابهات مرتبة حسب الحجم وارتفاع الرف */}
      {swapPlans.length === 0 ? (
        <div className="bg-[#2C1E18] rounded-2xl border border-[#432d24] p-8 text-center space-y-2">
          <Sparkles className="w-8 h-8 text-amber-400 mx-auto" />
          <h3 className="text-sm sm:text-base font-bold text-white">
            {items.length === 0
              ? 'المخزون فارغ حالياً — اقرأ ورقة جرد بالماسح الذكي (Gemini Vision) لتظهر خطط تجميع المتشابهات وترتيب الأحجام'
              : 'لا توجد مجموعات متناثرة حالياً — يمكنك استخدام النقل السريع أعلاه'}
          </h3>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-sm font-black text-amber-300 px-1">
            2. خطط تجميع القطع المتشابهة وترتيبها حسب الحجم وارتفاع الرف ({swapPlans.length} مجموعة):
          </h3>

          {swapPlans.map((plan) => {
            const activeTargetBin = customTargetBins[plan.id] || plan.targetBin;
            const activeTargetElev = parseShelfElevation(activeTargetBin);
            const includeEvictions = includeEvictionsMap[plan.id] ?? true;
            const adjacentCandidates = getAdjacentStorageBins(activeTargetBin, allBins, 8);

            const sortedGroupEntries = [...plan.allGroupItemsSortedBySize].sort((a, b) =>
              sizeSortOrder === 'desc'
                ? b.sizeProfile.sizeScore - a.sizeProfile.sizeScore
                : a.sizeProfile.sizeScore - b.sizeProfile.sizeScore
            );

            return (
              <div
                key={plan.id}
                className="bg-[#251914] rounded-2xl border border-[#4A3227] shadow-lg overflow-hidden"
              >
                {/* رأس المجموعة مع معلومات الحجم والارتفاع */}
                <div className="p-3.5 bg-[#1E1410] border-b border-[#3D271F] flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-black text-xs">
                        {plan.family}
                      </span>
                      <h4 className="text-sm sm:text-base font-black text-white">
                        {plan.familyAr}
                      </h4>
                      <span className="px-2.5 py-0.5 rounded-lg bg-stone-900 border border-amber-600/40 text-amber-200 text-xs font-bold">
                        تصنيف حجم المجموعة: {plan.groupSizeCategory}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-lg border text-xs font-bold ${activeTargetElev.badgeColorClass}`}>
                        {activeTargetBin}: {activeTargetElev.shortLabelAr}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-300">
                      إجمالي قطع العائلة: <strong>{plan.allGroupItemsSortedBySize.length}</strong> قطعة (مرتبة {sizeSortOrder === 'desc' ? 'من الأكبر/الأثقل إلى الأصغر/الأخف' : 'من الأصغر/الأخف إلى الأكبر/الأثقل'}) — الرف الموصى به حسب الوزن والحجم:{' '}
                      <strong className="text-emerald-300 font-mono">
                        {plan.recommendedHeightBin} ({plan.recommendedHeightElevation.shortLabelAr})
                      </strong>
                    </p>
                  </div>

                  {/* اختيار الموقع الموحد وارتفاع الرف */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {plan.recommendedHeightBin !== activeTargetBin && (
                      <button
                        type="button"
                        onClick={() =>
                          setCustomTargetBins((prev) => ({
                            ...prev,
                            [plan.id]: plan.recommendedHeightBin,
                          }))
                        }
                        className="px-2.5 py-1.5 rounded-xl bg-emerald-950/90 hover:bg-emerald-900 text-emerald-200 border border-emerald-500/60 text-[11px] font-black cursor-pointer"
                      >
                        اختيار الرف الأنسب للحجم: {plan.recommendedHeightBin} ({plan.recommendedHeightElevation.meters}م)
                      </button>
                    )}

                    <div className="flex items-center gap-2 text-xs bg-[#160E0B] px-3 py-1.5 rounded-xl border border-[#38241C]">
                      <MapPin className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-neutral-300 font-bold">الموقع الموحد:</span>
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
                          {plan.targetBin} — {parseShelfElevation(plan.targetBin).shortLabelAr} (المقترح)
                        </option>
                        {adjacentCandidates.map((adj) => {
                          const elev = parseShelfElevation(adj);
                          return (
                            <option key={adj} value={adj}>
                              {adj} — {elev.shortLabelAr} ({elev.suitabilityAr})
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>
                </div>

                {/* قائمة جميع قطع المجموعة مرتبة حسب الحجم مع بيان موقعها وارتفاعها */}
                <div className="p-3.5 space-y-2.5 text-xs">
                  <div className="font-bold text-amber-300 flex items-center justify-between flex-wrap gap-2">
                    <span>
                      ترتيب القطع المتشابهة حسب الحجم والمقاس ({sortedGroupEntries.length} قطع):
                    </span>
                    <span className="text-[11px] text-neutral-400">
                      مرتبة بالتدرج الحجمي لسهولة صفّها في الرف ({activeTargetBin} — {activeTargetElev.shortLabelAr})
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {sortedGroupEntries.map((entry, idx) => {
                      const { item, sizeProfile, currentElevation } = entry;
                      const currentBin = item.location_code.trim().toUpperCase();
                      const isAlreadyInTarget = currentBin === activeTargetBin;

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
                                #{idx + 1} بالحجم
                              </span>
                              <span className="font-mono font-black text-amber-300 text-xs">
                                {item.part_number}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded font-bold text-[11px] border ${
                                  sizeProfile.sizeCategory === 'كبير / ثقيل'
                                    ? 'bg-red-950/80 text-red-200 border-red-600/60'
                                    : sizeProfile.sizeCategory === 'متوسط الحجم'
                                    ? 'bg-amber-950/80 text-amber-200 border-amber-600/60'
                                    : 'bg-sky-950/80 text-sky-200 border-sky-600/60'
                                }`}
                              >
                                الحجم: {sizeProfile.sizeCategory} ({sizeProfile.dimensionsLabel})
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${currentElevation.badgeColorClass}`}>
                                {currentBin}: {currentElevation.shortLabelAr}
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
                                ✓ مستقرة في الموقع الموحد ({activeTargetBin})
                              </span>
                            ) : (
                              <>
                                <span className="px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-700 font-mono font-bold text-neutral-200">
                                  من: <strong className="text-amber-300">{currentBin}</strong> ({currentElevation.meters}م) ⬅ إلى:{' '}
                                  <strong className="text-emerald-400">{activeTargetBin}</strong> ({activeTargetElev.meters}م)
                                </span>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    handleDirectMoveSingleItem(item.part_number, activeTargetBin)
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

                  {/* ب. القطع غير المتشابهة المقترح إخراجها من الموقع */}
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
                          إخراج القطع غير المتشابهة من ({plan.targetBin}) إلى موقع مجاور يناسب حجمها ({plan.evictions.length}):
                        </span>
                      </label>

                      {plan.evictions.map((ev, idx) => {
                        const evKey = `${plan.id}:${ev.partNumber}`;
                        const selectedEvictBin = customEvictBins[evKey] || ev.evictToBin;
                        const evictDestElev = parseShelfElevation(selectedEvictBin);
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
                                  {ev.sizeProfile.sizeCategory} ({ev.sizeProfile.dimensionsLabel})
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
                              <span className="text-[10px] text-neutral-400">
                                ({evictDestElev.shortLabelAr})
                              </span>
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

                {/* زر اعتماد ونقل المجموعة بالكامل */}
                <div className="p-3 bg-[#19110D] border-t border-[#3D271F] flex flex-wrap items-center justify-between gap-2">
                  {onOpenLocation ? (
                    <button
                      type="button"
                      onClick={() => onOpenLocation(activeTargetBin)}
                      className="px-3 py-1.5 rounded-xl bg-[#2C1E18] hover:bg-[#3A271F] text-neutral-200 border border-[#4D3429] text-xs font-bold cursor-pointer"
                    >
                      عرض الموقع {activeTargetBin} ({activeTargetElev.shortLabelAr})
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
                      اعتماد ونقل المجموعة بالكامل ({activeTargetBin} — {activeTargetElev.shortLabelAr}) + تقرير PDF وواتساب 📲
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
