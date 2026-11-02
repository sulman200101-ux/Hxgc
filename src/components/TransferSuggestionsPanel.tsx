import React, { useEffect, useMemo, useState } from 'react';
import type { InventoryItem } from '../types';
import type { StockDocument } from '../services/documents';
import { dbService } from '../services/db';
import {
  suggestTransfers,
  buildSimilaritySwapPlans,
  buildHighValueConsolidationPlans,
  suggestHeavyItemsToLocationD,
  MAX_ITEMS_PER_SHELF,
} from '../services/transferSuggestions';
import { MessageCircle, ArrowRightLeft, ShieldCheck } from 'lucide-react';

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

  const heavySuggestions = useMemo(
    () => suggestHeavyItemsToLocationD(items, pendingSet),
    [items, pendingSet]
  );
  const highValuePlans = useMemo(
    () => buildHighValueConsolidationPlans(items, pendingSet),
    [items, pendingSet]
  );
  const suggestions = useMemo(() => suggestTransfers(items, pendingSet, 80), [items, pendingSet]);
  const swapPlans = useMemo(
    () => buildSimilaritySwapPlans(items, pendingSet, 'warehouse').slice(0, 30),
    [items, pendingSet]
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="اقتراحات تجميع القطع"
      className="fixed inset-0 z-50 bg-black/90 overflow-y-auto p-4"
      dir="rtl"
    >
      <section className="max-w-4xl mx-auto bg-stone-900 text-white rounded-2xl p-5 space-y-4 border border-amber-800/50 shadow-2xl">
        <header className="flex flex-wrap justify-between items-center gap-2 border-b border-stone-800 pb-3">
          <div>
            <h2 className="text-lg font-bold">
              تجميع المتشابهات + فرز الأغلى سعراً + توجيه الثقيلة جداً إلى (D و C) — حد {MAX_ITEMS_PER_SHELF} صنف لكل رف
            </h2>
            <p className="text-xs text-neutral-400">
              تجميع المتشابهات حسب (الصنف + الحجم + الملم)، وتجميع القطع الأغلى سعراً في رف واحد، وتوجيه القطع الثقيلة جداً إلى الموقعين D و C بحد أقصى {MAX_ITEMS_PER_SHELF} صنفاً لكل رف
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
            <button onClick={onClose} className="p-2 bg-stone-800 hover:bg-stone-700 rounded-xl text-xs font-bold cursor-pointer">
              إغلاق الاقتراحات
            </button>
          </div>
        </header>

        <p className="text-xs text-neutral-300">
          اقتراحات حسب السعر والوزن والحجم (القطع الثقيلة جداً تنقل إلى الموقعين D و C، والأغلى سعراً تجمع في رف واحد بحد {MAX_ITEMS_PER_SHELF} صنف فقط لكل رف). لا تُدمج أرقام القطع ولا يتغير الموقع قبل اعتماد المشرف.
        </p>

        {/* 1. بطاقة تجميع القطع الأغلى سعراً في رف واحد (بحد 15 صنفاً) */}
        {ready && highValuePlans.length > 0 && (
          <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-500/70 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs space-y-1">
              <strong className="text-amber-300 block text-sm">
                💰 فرز وتجميع القطع الأغلى سعراً في رف واحد ({highValuePlans[0].itemsCount}/{MAX_ITEMS_PER_SHELF} صنف فقط في الرف {highValuePlans[0].targetBin})
              </strong>
              <p className="text-neutral-200">
                نطاق الأسعار: من {highValuePlans[0].minUnitPriceSar.toLocaleString()} ر.س إلى {highValuePlans[0].maxUnitPriceSar.toLocaleString()} ر.س (إجمالي قيمة الرف ~{highValuePlans[0].totalShelfValueSar.toLocaleString()} ر.س).
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const moved = await dbService.relocateTopExpensiveItemsToShelf();
                  await refresh();
                  onRefresh();
                  setLastMoved(moved);
                  setMessage(`تم اعتماد وتجميع ${moved.length} من القطع الأغلى سعراً في الرف (${highValuePlans[0].targetBin}) بحد أقصى ${MAX_ITEMS_PER_SHELF} صنفاً!`);
                } catch (err) {
                  setMessage((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-black flex items-center gap-1.5 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>اعتماد وتجميع الـ {highValuePlans[0].itemsCount} قطعة الأغلى سعراً في ({highValuePlans[0].targetBin}) 💰</span>
            </button>
          </div>
        )}

        {/* 2. بطاقة توجيه القطع الثقيلة جداً إلى الموقعين D و C (بحد 15 صنفاً لكل رف) */}
        {ready && heavySuggestions.length > 0 && (
          <div className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-500/60 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs space-y-1">
              <strong className="text-emerald-300 block text-sm">
                توجيه القطع الثقيلة جداً إلى الموقعين D و C ({heavySuggestions.length} قطعة ثقيلة — بحد أقصى {MAX_ITEMS_PER_SHELF} صنف لكل رف)
              </strong>
              <p className="text-neutral-300">
                يمكنك نقل وتوزيع جميع القطع الثقيلة جداً مباشرة على الموقعين (D و C) بحيث يستوعب كل رف {MAX_ITEMS_PER_SHELF} صنفاً كحد أقصى.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const moved = await dbService.relocateAllHeavyItemsToLocationD();
                  await refresh();
                  onRefresh();
                  setLastMoved(moved);
                  setMessage(`تم اعتماد ونقل ${moved.length} قطعة ثقيلة جداً إلى الموقعين D و C (بحد ${MAX_ITEMS_PER_SHELF} صنف لكل رف) بنجاح`);
                } catch (err) {
                  setMessage((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>اعتماد ونقل جميع القطع الثقيلة إلى D و C ({heavySuggestions.length})</span>
            </button>
          </div>
        )}

        <p role="status" className="text-amber-300 font-bold text-sm">
          {message}
        </p>

        {ready && !suggestions.length && !swapPlans.length && (
          <p className="text-sm text-neutral-400">
            لا توجد اقتراحات مناسبة حاليًا داخل المنطقة نفسها، أو توجد طلبات نقل معلقة لهذه القطع.
          </p>
        )}

        {ready &&
          suggestions.map((suggestion, idx) => {
            const item = itemMap.get(suggestion.partNumber);
            if (!item) return null;
            return (
              <article
                key={`${suggestion.partNumber}-${idx}`}
                className={`border p-3.5 rounded-xl space-y-2 ${
                  suggestion.isHeavyToD || suggestion.isHeavyToC
                    ? 'border-emerald-600/70 bg-emerald-950/30'
                    : 'border-amber-900 bg-stone-950/60'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <strong>
                    {suggestion.partNumber} — الصنف: {suggestion.categoryAr} | الحجم: {suggestion.sizeCategory} | المقاس: {suggestion.mmLabel} | السعر: {suggestion.estimatedPriceSar.toLocaleString()} ر.س
                  </strong>
                  {(suggestion.isHeavyToD || suggestion.isHeavyToC) && (
                    <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[11px] font-black">
                      قطعة ثقيلة جداً ⬅ موقع {suggestion.isHeavyToC ? 'C' : 'D'}
                    </span>
                  )}
                </div>
                <p>{item.description_ar}</p>
                <p dir="ltr" className="text-xs text-neutral-400 font-mono">
                  {item.description_en}
                </p>
                <p className="font-mono text-xs text-amber-200">
                  الحالي: {suggestion.from} ← المقترح: {suggestion.to} — الكمية: {suggestion.quantity}
                </p>
                <p className="text-sm text-neutral-300">{suggestion.reason}</p>
                <button
                  disabled={busy}
                  className="bg-amber-800 hover:bg-amber-700 p-2 rounded-lg text-xs font-bold cursor-pointer"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await dbService.submitDocument({
                        id: 'SUGGEST-' + crypto.randomUUID(),
                        kind: 'transfer',
                        requester: 'المستخدم المحلي',
                        reason: suggestion.reason,
                        status: 'pending',
                        createdAt: '',
                        lines: [
                          {
                            part_number: item.part_number,
                            quantity: suggestion.quantity,
                            location: suggestion.to,
                            description_en: item.description_en,
                            description_ar: item.description_ar,
                            check: '',
                            remark: '',
                            reviewed: true,
                          },
                        ],
                      });
                      await refresh();
                      setMessage('حُفظ طلب النقل للمراجعة؛ الموقع الحالي لم يتغير');
                    } catch (error) {
                      setMessage((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  طلب اعتماد الاقتراح
                </button>
              </article>
            );
          })}

        {ready && swapPlans.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-stone-800">
            <h3 className="font-bold text-amber-300 text-sm flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              <span>خطط إخراج غير المتشابهات وتجميع المتشابهات (بحد {MAX_ITEMS_PER_SHELF} صنف لكل رف) ({swapPlans.length})</span>
            </h3>
            {swapPlans.map((plan) => (
              <article
                key={plan.id}
                className="border border-amber-700/40 bg-stone-950/70 p-3.5 rounded-xl space-y-2 text-xs"
              >
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <strong className="text-amber-300 text-sm">
                    {plan.familyAr} (الحجم: {plan.groupSizeCategory} | المقاس بالملم: {plan.groupMmSummary}) — الموقع الموحد: {plan.targetBin} (سعة {MAX_ITEMS_PER_SHELF} صنف/رف)
                  </strong>
                  <span className="text-neutral-400 font-mono">
                    مواقع متقاربة: {plan.adjacentBins.join('، ')}
                  </span>
                </div>
                <p className="text-neutral-300">{plan.summaryReason}</p>
                {plan.evictions.length > 0 && (
                  <p className="text-orange-300 font-mono">
                    إخراج من {plan.targetBin}:{' '}
                    {plan.evictions
                      .slice(0, 10)
                      .map((e) => `${e.partNumber} (${e.currentFamily}) ← ${e.evictToBin}`)
                      .join(' | ')}
                  </p>
                )}
                <p className="text-emerald-300 font-mono">
                  إدخال متشابهات إلى {plan.targetBin}:{' '}
                  {plan.consolidations
                    .slice(0, 10)
                    .map((c) => `${c.partNumber} من ${c.fromBin} ← ${c.toBin}`)
                    .join(' | ')}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  className="bg-amber-800 hover:bg-amber-700 p-2 rounded-lg text-xs font-bold cursor-pointer"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const lines = [
                        ...plan.evictions.map((ev) => ({
                          part_number: ev.partNumber,
                          quantity: ev.quantity,
                          location: ev.evictToBin,
                          description_en: ev.descriptionEn,
                          description_ar: ev.descriptionAr,
                          check: '',
                          remark: 'إخراج لإحلال المتشابهات (سقف 15 صنف للرف)',
                          reviewed: true,
                        })),
                        ...plan.consolidations.map((c) => ({
                          part_number: c.partNumber,
                          quantity: c.quantity,
                          location: c.toBin,
                          description_en: c.descriptionEn,
                          description_ar: c.descriptionAr,
                          check: '',
                          remark: `تجميع عائلة ${plan.family} (سقف 15 صنف للرف)`,
                          reviewed: true,
                        })),
                      ];
                      await dbService.submitDocument({
                        id: 'SWAP-' + crypto.randomUUID(),
                        kind: 'transfer',
                        requester: 'المستخدم المحلي',
                        reason: plan.summaryReason,
                        status: 'pending',
                        createdAt: '',
                        lines,
                      });
                      await refresh();
                      setMessage('حُفظ طلب النقل للمراجعة؛ الموقع الحالي لم يتغير');
                    } catch (error) {
                      setMessage((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  طلب اعتماد خطة التجميع والتبديل
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
