import React, { useEffect, useMemo, useState } from 'react';
import type { InventoryItem } from '../types';
import type { StockDocument } from '../services/documents';
import { dbService } from '../services/db';
import {
  suggestConsumableItemsToAOrFL,
  buildSimilaritySwapPlans,
  isConsumablePart,
  isConsumableTargetLocation,
  MAX_ITEMS_PER_SHELF,
} from '../services/transferSuggestions';
import { MessageCircle, ArrowRightLeft, ShieldCheck, RefreshCw, Search, CheckCircle2 } from 'lucide-react';

export function TransferSuggestionsPanel({
  items,
  onClose,
  onRefresh,
  onOpenRelocationReport,
}: {
  items: InventoryItem[];
  onClose: () => void;
  onRefresh: () => void;
  onOpenRelocationReport?: (movedItems?: InventoryItem[]) => void;
}) {
  const [documents, setDocuments] = useState<StockDocument[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [lastMoved, setLastMoved] = useState<InventoryItem[]>([]);

  const refresh = async () => {
    setDocuments(await dbService.getDocuments());
    setReady(true);
  };

  useEffect(() => {
    refresh().catch((error) => setMessage(String(error)));
  }, []);

  const itemMap = useMemo(() => {
    const m = new Map<string, InventoryItem>();
    for (let i = 0; i < items.length; i++) m.set(items[i].part_number, items[i]);
    return m;
  }, [items]);

  const pendingSet = useMemo(
    () =>
      new Set(
        documents
          .filter((doc) => doc.kind === 'transfer' && doc.status === 'pending')
          .flatMap((doc) => doc.lines.map((line) => line.part_number))
      ),
    [documents]
  );

  const consumableSuggestions = useMemo(
    () => suggestConsumableItemsToAOrFL(items, pendingSet),
    [items, pendingSet]
  );

  const swapPlans = useMemo(
    () => buildSimilaritySwapPlans(items, pendingSet, 'warehouse').slice(0, 30),
    [items, pendingSet]
  );

  const searchedItemsForMarking = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const pool = q
      ? items.filter(
          (i) =>
            i.part_number.toLowerCase().includes(q) ||
            i.description_ar.toLowerCase().includes(q) ||
            i.description_en.toLowerCase().includes(q) ||
            i.category.toLowerCase().includes(q) ||
            i.location_code.toLowerCase().includes(q)
        )
      : items.filter((i) => isConsumablePart(i));
    return pool.slice(0, 40);
  }, [items, searchQuery]);

  const handleAutoDetectAndMarkAllConsumables = async () => {
    setBusy(true);
    try {
      const res = await dbService.markAllDetectedConsumableItems();
      onRefresh();
      setMessage(
        `✅ تم البحث في المخزون ووضع علامة (استهلاكية 🔄) على (${res.totalConsumables}) قطعة استهلاكية (منها ${res.newlyMarked} قطعة جديدة)!`
      );
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleSingleConsumable = async (partNumber: string) => {
    await dbService.toggleConsumableMark(partNumber);
    onRefresh();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="خطة نقل القطع الاستهلاكية والبحث عنها"
      className="fixed inset-0 z-50 bg-black/90 overflow-y-auto p-4"
      dir="rtl"
    >
      <section className="max-w-4xl mx-auto bg-stone-900 text-white rounded-2xl p-5 space-y-4 border border-teal-700/60 shadow-2xl">
        <header className="flex flex-wrap justify-between items-center gap-2 border-b border-stone-800 pb-3">
          <div>
            <h2 className="text-lg font-bold text-teal-200 flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-teal-400" />
              <span>خطة النقل المخصصة للقطع الاستهلاكية فقط (A / FL) — مع البحث ووضع علامة استهلاكية</span>
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              تم استبعاد خطة النقل للقطع الثقيلة نهائياً، وتخصيص خطة النقل للقطع الاستهلاكية فقط لتوجيهها إلى أرفف (A / FL).
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onOpenRelocationReport && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenRelocationReport(lastMoved.length ? lastMoved : undefined);
                }}
                className="px-3 py-2 bg-[#25D366] hover:bg-[#1da851] text-white rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4" />
                <span>تقرير PDF وواتساب 📲</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 bg-stone-800 hover:bg-stone-700 rounded-xl text-xs font-bold cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </header>

        {/* قسم البحث عن القطع الاستهلاكية ووضع علامة عليها */}
        <div className="p-4 rounded-xl bg-[#112426] border border-teal-500/60 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <strong className="text-teal-200 block text-sm">
                🔍 البحث عن القطع الاستهلاكية ووضع علامة (استهلاكية 🔄) عليها
              </strong>
              <p className="text-xs text-neutral-300">
                ابحث عن أي قطعة برقمها (10 أرقام) أو اسمها (فلتر، سير، أورنق، صوفة، فيوز، لمبة...) وضع عليها علامة استهلاكية لتدخل في خطة النقل.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleAutoDetectAndMarkAllConsumables}
              className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>البحث التلقائي ووضع علامة على كل الاستهلاكية</span>
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-teal-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث عن قطعة لوضع علامة استهلاكية عليها (رقم القطعة، فلتر، سير، فيوز، لمبة، أورنق)..."
              className="w-full pr-9 pl-3 py-2.5 rounded-xl bg-black/50 border border-teal-600/60 text-white text-xs focus:outline-none focus:border-teal-400"
            />
          </div>

          <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
            {searchedItemsForMarking.map((item) => {
              const isMarked = item.is_consumable === 1 || isConsumablePart(item);
              const inTarget = isConsumableTargetLocation(item.location_code);
              return (
                <div
                  key={item.part_number}
                  className={`p-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${
                    isMarked
                      ? 'bg-teal-950/60 border-teal-500/70'
                      : 'bg-stone-950/70 border-stone-800'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-amber-300 bg-black/60 px-2 py-0.5 rounded">
                      {item.part_number}
                    </span>
                    <span className="font-mono text-teal-200 font-bold">
                      الموقع: {item.location_code} {inTarget ? '(في A/FL ✓)' : ''}
                    </span>
                    <span className="font-bold text-white">{item.description_ar}</span>
                    <span className="text-neutral-400 font-mono text-[11px]" dir="ltr">
                      {item.description_en}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSingleConsumable(item.part_number)}
                    className={`px-3 py-1.5 rounded-lg font-black text-xs border flex items-center gap-1 cursor-pointer ${
                      isMarked
                        ? 'bg-teal-600 hover:bg-teal-500 text-white border-teal-300'
                        : 'bg-stone-800 hover:bg-teal-900 text-teal-200 border-teal-700'
                    }`}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{isMarked ? 'استهلاكية ✓ (معلّمة)' : 'وضع علامة استهلاكية'}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* بطاقة اعتماد خطة النقل للقطع الاستهلاكية إلى (A / FL) */}
        {ready && consumableSuggestions.length > 0 && (
          <div className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-500/60 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs space-y-1">
              <strong className="text-emerald-300 block text-sm">
                🔄 خطة نقل القطع الاستهلاكية إلى أرفف (A / FL) ({consumableSuggestions.length} قطعة استهلاكية جاهزة للنقل)
              </strong>
              <p className="text-neutral-300">
                توجيه كافة القطع الاستهلاكية المعلمة إلى أرفف الصرف السريع (A و FL) دون أي نقل للقطع الثقيلة.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const moved = await dbService.relocateAllConsumableItemsToAOrFL();
                  await refresh();
                  onRefresh();
                  setLastMoved(moved);
                  setMessage(
                    `✅ تم اعتماد ونقل (${moved.length}) قطعة استهلاكية إلى أرفف (A / FL) بنجاح!`
                  );
                } catch (err) {
                  setMessage((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>اعتماد ونقل جميع القطع الاستهلاكية إلى A / FL ({consumableSuggestions.length})</span>
            </button>
          </div>
        )}

        {message && (
          <p role="status" className="text-amber-300 font-bold text-sm">
            {message}
          </p>
        )}

        {ready && !consumableSuggestions.length && !swapPlans.length && (
          <p className="text-sm text-neutral-400">
            جميع القطع الاستهلاكية موجودة حالياً في مواقع (A / FL) المعتمدة، أو يمكنك البحث أعلاه ووضع علامة استهلاكية على قطع إضافية.
          </p>
        )}

        {ready &&
          consumableSuggestions.map((suggestion, idx) => {
            const item = itemMap.get(suggestion.partNumber);
            if (!item) return null;
            return (
              <article
                key={`${suggestion.partNumber}-${idx}`}
                className="border border-teal-700/60 bg-teal-950/20 p-3.5 rounded-xl space-y-2"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <strong>
                    {suggestion.partNumber} — الصنف: {suggestion.category} | الكمية: {suggestion.quantity}
                  </strong>
                  <span className="px-2.5 py-0.5 rounded bg-teal-600 text-white text-[11px] font-black">
                    🔄 قطعة استهلاكية ⬅ موقع {suggestion.to}
                  </span>
                </div>
                <p className="font-bold text-sm">{item.description_ar}</p>
                <p dir="ltr" className="text-xs text-neutral-400 font-mono">
                  {item.description_en}
                </p>
                <p className="font-mono text-xs text-amber-200">
                  الموقع الحالي: {suggestion.from} ← الموقع الاستهلاكي المقترح: {suggestion.to}
                </p>
                <p className="text-xs text-neutral-300">{suggestion.reason}</p>
                <div className="flex items-center gap-2">
                  <button
                    disabled={busy}
                    className="bg-teal-700 hover:bg-teal-600 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const moved = await dbService.relocateItem(item.part_number, suggestion.to);
                        await refresh();
                        onRefresh();
                        if (moved) setLastMoved([moved]);
                        setMessage(`✅ تم نقل القطعة الاستهلاكية (${item.part_number}) إلى (${suggestion.to})`);
                      } catch (error) {
                        setMessage((error as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    نقل فوري إلى {suggestion.to} 🟢
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleSingleConsumable(item.part_number)}
                    className="bg-stone-800 hover:bg-stone-700 px-3 py-1.5 rounded-lg text-xs text-neutral-300 cursor-pointer"
                  >
                    إلغاء علامة الاستهلاكية
                  </button>
                </div>
              </article>
            );
          })}

        {ready && swapPlans.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-stone-800">
            <h3 className="font-bold text-teal-300 text-sm flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              <span>خطط تجميع القطع الاستهلاكية المتشابهة في أرفف (A / FL) (بحد {MAX_ITEMS_PER_SHELF} صنف لكل رف) ({swapPlans.length})</span>
            </h3>
            {swapPlans.map((plan) => (
              <article
                key={plan.id}
                className="border border-teal-700/40 bg-stone-950/70 p-3.5 rounded-xl space-y-2 text-xs"
              >
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <strong className="text-teal-300 text-sm">
                    {plan.familyAr} (المقاس بالملم: {plan.groupMmSummary}) — رف الاستهلاكية الموحد: {plan.targetBin}
                  </strong>
                  <span className="text-neutral-400 font-mono">
                    أرفف استهلاكية قريبة: {plan.adjacentBins.join('، ')}
                  </span>
                </div>
                <p className="text-neutral-300">{plan.summaryReason}</p>
                <p className="text-emerald-300 font-mono">
                  تجميع القطع الاستهلاكية إلى {plan.targetBin}:{' '}
                  {plan.consolidations
                    .slice(0, 10)
                    .map((c) => `${c.partNumber} من ${c.fromBin} ← ${c.toBin}`)
                    .join(' | ')}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
