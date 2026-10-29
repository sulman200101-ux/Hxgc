import React, { useEffect, useMemo, useState } from 'react';
import type { InventoryItem } from '../types';
import type { StockDocument } from '../services/documents';
import { dbService } from '../services/db';
import { suggestTransfers, buildSimilaritySwapPlans } from '../services/transferSuggestions';
import { MessageCircle, FileText, ArrowRightLeft } from 'lucide-react';

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

  const pending = documents.filter((doc) => doc.kind === 'transfer' && doc.status === 'pending');
  const pendingSet = useMemo(
    () =>
      new Set(
        documents
          .filter((doc) => doc.kind === 'transfer' && doc.status === 'pending')
          .flatMap((doc) => doc.lines.map((line) => line.part_number))
      ),
    [documents]
  );

  const suggestions = useMemo(() => suggestTransfers(items, pendingSet), [items, pendingSet]);
  const swapPlans = useMemo(
    () => buildSimilaritySwapPlans(items, pendingSet, 'warehouse'),
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
            <h2 className="text-lg font-bold">اقتراح تجميع القطع المتشابهة وخطة الإحلال</h2>
            <p className="text-xs text-neutral-400">
              اقتراحات حسب العائلة الفنية وترميز المنطقة مع خطة إخراج غير المتشابهات واستبدالها بالمتشابهات
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
          اقتراحات حسب العائلة الفنية وترميز المنطقة. تحقق من القرب الفعلي وسعة الموقع قبل طلب النقل. لا تُدمج أرقام القطع ولا يتغير الموقع قبل اعتماد المشرف.
        </p>

        <p role="status" className="text-amber-300 font-bold text-sm">
          {message}
        </p>

        {ready && !suggestions.length && !swapPlans.length && (
          <p className="text-sm text-neutral-400">
            لا توجد اقتراحات مناسبة حاليًا داخل المنطقة نفسها، أو توجد طلبات نقل معلقة لهذه القطع.
          </p>
        )}

        {/* اقتراحات التجميع المباشر داخل نفس المنطقة */}
        {ready &&
          suggestions.map((suggestion, idx) => {
            const item = items.find((candidate) => candidate.part_number === suggestion.partNumber)!;
            return (
              <article
                key={`${suggestion.partNumber}-${idx}`}
                className="border border-amber-900 bg-stone-950/60 p-3.5 rounded-xl space-y-2"
              >
                <strong>
                  {suggestion.partNumber} — {suggestion.family}
                </strong>
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

        {/* خطط إخراج غير المتشابهات واستبدالها بالمتشابهات عبر المواقع المتقاربة */}
        {ready && swapPlans.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-stone-800">
            <h3 className="font-bold text-amber-300 text-sm flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              <span>خطط إخراج غير المتشابهات من الموقع الفعلي واستبدالها بالمتشابهات ({swapPlans.length})</span>
            </h3>
            {swapPlans.map((plan) => (
              <article
                key={plan.id}
                className="border border-amber-700/40 bg-stone-950/70 p-3.5 rounded-xl space-y-2 text-xs"
              >
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <strong className="text-amber-300 text-sm">
                    {plan.familyAr} — الموقع الفعلي المستهدف: {plan.targetBin}
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
                      .map((e) => `${e.partNumber} (${e.currentFamily}) ← ${e.evictToBin}`)
                      .join(' | ')}
                  </p>
                )}
                <p className="text-emerald-300 font-mono">
                  إدخال متشابهات إلى {plan.targetBin}:{' '}
                  {plan.consolidations
                    .map((c) => `${c.partNumber} من ${c.fromBin}`)
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
                          remark: 'إخراج لإحلال المتشابهات',
                          reviewed: true,
                        })),
                        ...plan.consolidations.map((c) => ({
                          part_number: c.partNumber,
                          quantity: c.quantity,
                          location: plan.targetBin,
                          description_en: c.descriptionEn,
                          description_ar: c.descriptionAr,
                          check: '',
                          remark: `تجميع عائلة ${plan.family}`,
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
                  طلب اعتماد خطة الإحلال والتجميع
                </button>
              </article>
            ))}
          </div>
        )}

        {!!pending.length && <h3 className="font-bold pt-2">طلبات نقل بانتظار الاعتماد</h3>}
        {pending.map((doc) => (
          <article key={doc.id} className="border border-stone-600 p-3 rounded-xl space-y-2">
            <p className="font-mono text-xs">
              {doc.lines
                .map((line) => `${line.part_number}: ${line.old_location || '—'} ← ${line.location} (${line.quantity})`)
                .join('، ')}
            </p>
            <p className="text-xs text-neutral-300">{doc.reason}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={busy}
                className="p-2 bg-emerald-900 hover:bg-emerald-800 rounded-lg text-xs font-bold cursor-pointer"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await dbService.approveDocument(doc.id);
                    await refresh();
                    onRefresh();
                    const moved = Array.from(
                      new Map(
                        doc.lines
                          .map((l) => dbService.getItemByPartNumber(l.part_number))
                          .filter((i): i is InventoryItem => Boolean(i))
                          .map((i) => [i.part_number, i])
                      ).values()
                    );
                    setLastMoved(moved);
                    setMessage('تم اعتماد النقل وتحديث الموقع وتسجيل العملية');
                  } catch (error) {
                    setMessage((error as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                اعتماد المشرف وتنفيذ النقل
              </button>

              {onOpenRelocationReport && (
                <button
                  type="button"
                  disabled={busy}
                  className="p-2 bg-[#25D366] hover:bg-[#1da851] text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await dbService.approveDocument(doc.id);
                      await refresh();
                      onRefresh();
                      const moved = Array.from(
                        new Map(
                          doc.lines
                            .map((l) => dbService.getItemByPartNumber(l.part_number))
                            .filter((i): i is InventoryItem => Boolean(i))
                            .map((i) => [i.part_number, i])
                        ).values()
                      );
                      setLastMoved(moved);
                      setMessage('تم اعتماد النقل وتحديث الموقع وتسجيل العملية');
                      onClose();
                      onOpenRelocationReport(moved);
                    } catch (error) {
                      setMessage((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>اعتماد واستخراج PDF + واتساب 📲</span>
                </button>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
