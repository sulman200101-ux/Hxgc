import React, { useState, useMemo, useEffect } from 'react';
import { InventoryItem } from '../types';
import { dbService } from '../services/db';
import { exportInventoryListToPdfFile } from '../utils/pdfExportUtil';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import {
  X,
  MessageCircle,
  Copy,
  Trash2,
  Plus,
  Search,
  MapPin,
  Package,
  CheckCircle2,
  CheckSquare,
  Square,
  FileDown,
  Loader2,
} from 'lucide-react';

interface GinListModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  onRefresh: () => void;
  onOpenAddModal?: () => void;
}

export const GinListModal: React.FC<GinListModalProps> = ({
  isOpen,
  onClose,
  items,
  onRefresh,
  onOpenAddModal,
}) => {
  const [searchAddQuery, setSearchAddQuery] = useState('');
  const [customGinNote, setCustomGinNote] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedParts, setSelectedParts] = useState<Set<string>>(new Set());
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const ginItems = useMemo(() => {
    return items.filter((item) => Boolean(item.gin_code && item.gin_code.trim()));
  }, [items]);

  useEffect(() => {
    setSelectedParts((prev) => {
      const validSet = new Set(ginItems.map((i) => i.part_number));
      const next = new Set<string>();
      prev.forEach((p) => {
        if (validSet.has(p)) next.add(p);
      });
      return next;
    });
  }, [ginItems]);

  const selectedGinItems = useMemo(() => {
    return ginItems.filter((item) => selectedParts.has(item.part_number));
  }, [ginItems, selectedParts]);

  const candidateItems = useMemo(() => {
    const q = searchAddQuery.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter(
        (item) =>
          (!item.gin_code || !item.gin_code.trim()) &&
          (item.part_number.toLowerCase().includes(q) ||
            item.description_ar.toLowerCase().includes(q) ||
            item.description_en.toLowerCase().includes(q) ||
            item.location_code.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [items, searchAddQuery]);

  if (!isOpen) return null;

  const showTempStatus = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const toggleSelectPart = (partNumber: string) => {
    setSelectedParts((prev) => {
      const next = new Set(prev);
      if (next.has(partNumber)) {
        next.delete(partNumber);
      } else {
        next.add(partNumber);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedParts.size === ginItems.length) {
      setSelectedParts(new Set());
    } else {
      setSelectedParts(new Set(ginItems.map((i) => i.part_number)));
    }
  };

  const buildWhatsAppMessage = (targetItems: InventoryItem[], modeLabel: string): string => {
    const today = new Date().toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const lines: string[] = [
      `📋 *تقرير قائمة (قين) — ${modeLabel}*`,
      `🏭 مستودع قطع الغيار ASMO`,
      `📅 التاريخ: ${today}`,
      `📦 عدد مواد (قين) في التقرير: *${targetItems.length}* مادة`,
      `━━━━━━━━━━━━━━━━━━━━`,
    ];

    targetItems.forEach((item, idx) => {
      const ginTag =
        item.gin_code && item.gin_code !== 'قين' ? ` | قين: ${item.gin_code}` : ' | 🔖 قين';
      lines.push(
        `*${idx + 1}.* رقم المادة: *${item.part_number}*${ginTag}`,
        `   🔹 الاسم: ${item.description_ar || item.description_en || '—'}`,
        item.description_en ? `   🔸 EN: ${item.description_en}` : '',
        `   📍 الموقع: *${item.location_code || '—'}* | المتبقي: *${item.qty_remaining}* (إجمالي: ${item.qty_total})`,
        `────────────────────`
      );
    });

    return lines.filter(Boolean).join('\n');
  };

  const sendReportViaWhatsApp = async (onlySelected: boolean) => {
    const targetList = onlySelected ? selectedGinItems : ginItems;
    if (targetList.length === 0) {
      showTempStatus(
        onlySelected
          ? '⚠️ يرجى تحديد مادة واحدة على الأقل من القائمة لإرسال المختار'
          : '⚠️ قائمة قين فارغة حالياً — أضف أو حدد مادة بإشارة (قين) أولاً'
      );
      return;
    }

    const modeLabel = onlySelected
      ? `المواد المختارة (${targetList.length} من ${ginItems.length})`
      : `كامل قائمة قين (${targetList.length} مادة)`;
    const text = buildWhatsAppMessage(targetList, modeLabel);
    const encoded = encodeURIComponent(text);
    const whatsappUrl = `https://wa.me/?text=${encoded}`;

    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({
          title: `تقرير قائمة (قين) — ${modeLabel}`,
          text,
          dialogTitle: 'إرسال تقرير (قين) عبر الواتساب...',
        });
        showTempStatus(`✅ تم فتح المشاركة لإرسال تقرير (${modeLabel})`);
        return;
      } catch {
        // fallback to wa.me link
      }
    }

    const link = document.createElement('a');
    link.href = whatsappUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showTempStatus(`✅ جاري فتح الواتساب لإرسال تقرير (${modeLabel})...`);
  };

  const handleExportPdf = async (onlySelected: boolean, sendViaWhatsApp = true) => {
    const targetList = onlySelected ? selectedGinItems : ginItems;
    if (targetList.length === 0) {
      showTempStatus(
        onlySelected
          ? '⚠️ يرجى تحديد مادة واحدة على الأقل لتصدير تقرير المختار'
          : '⚠️ قائمة قين فارغة حالياً'
      );
      return;
    }

    setIsExportingPdf(true);
    try {
      const title = onlySelected
        ? `تقرير قائمة (قين) — المواد المختارة (${targetList.length} مادة)`
        : `تقرير شامل لقائمة (قين) — (${targetList.length} مادة)`;
      await exportInventoryListToPdfFile({
        items: targetList,
        title,
        sendViaWhatsApp,
      });
      showTempStatus(
        `✅ تم تصدير تقرير PDF لـ (${targetList.length}) مادة من قين وتجهيز الإرسال عبر واتساب 📲`
      );
    } catch {
      showTempStatus('⚠️ تعذر تصدير ملف PDF');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleCopyText = async (onlySelected: boolean) => {
    const targetList = onlySelected ? selectedGinItems : ginItems;
    if (targetList.length === 0) {
      showTempStatus('⚠️ لا توجد مواد لنسخها');
      return;
    }
    const modeLabel = onlySelected
      ? `المواد المختارة (${targetList.length})`
      : `كامل قائمة قين (${targetList.length})`;
    try {
      await navigator.clipboard.writeText(buildWhatsAppMessage(targetList, modeLabel));
      showTempStatus(`✅ تم نسخ تقرير (${modeLabel}) للحافظة — يمكنك لصقه في الواتساب مباشرة`);
    } catch {
      showTempStatus('⚠️ تعذر النسخ التلقائي');
    }
  };

  const handleAddExistingToGin = async (partNumber: string) => {
    const val = customGinNote.trim() || 'قين';
    await dbService.setItemGinCode(partNumber, val);
    onRefresh();
    showTempStatus(`✅ تم وضع إشارة (قين) على المادة (${partNumber}) مع بقائها في نفس موقعها`);
  };

  const handleRemoveFromGin = async (partNumber: string) => {
    await dbService.setItemGinCode(partNumber, null);
    onRefresh();
    showTempStatus(`تمت إزالة إشارة (قين) عن المادة (${partNumber}) مع بقائها في موقعها`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
      dir="rtl"
    >
      <div className="bg-[#2C1E18] border-2 border-purple-500/70 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="p-4 bg-gradient-to-l from-purple-950 via-[#231713] to-[#231713] border-b border-purple-700/50 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-purple-600/25 border border-purple-400/60 flex items-center justify-center text-purple-200">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-black text-base sm:text-lg text-white">
                  قائمة وتقارير (قين 🔖) — إرسال الكل أو المختار عبر الواتساب (نص + PDF)
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-purple-600 text-white text-xs font-black">
                  إجمالي القين: {ginItems.length}
                </span>
                {selectedParts.size > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-600 text-white text-xs font-black">
                    المحدد: {selectedParts.size}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-purple-200/80">
                تُحفظ كل مادة مع القطع في نفس موقعها الفعلي مع وضع إشارة (🔖 قين) في بطاقة القطعة، ويمكنك إرسال PDF وتقرير واتساب بكل القين أو بالمختار منها
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-neutral-300 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3.5 bg-[#1F1511] border-b border-[#3D271F] space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => sendReportViaWhatsApp(false)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-black text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-950/80 border border-emerald-400/60 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4" />
                <span>إرسال تقرير بكل القين واتساب 💬 ({ginItems.length})</span>
              </button>

              <button
                type="button"
                onClick={() => sendReportViaWhatsApp(true)}
                disabled={selectedParts.size === 0}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 disabled:opacity-45 text-white font-black text-xs flex items-center gap-1.5 shadow-lg shadow-purple-950/80 border border-purple-300/60 cursor-pointer"
              >
                <CheckSquare className="w-4 h-4" />
                <span>إرسال المختار فقط واتساب ✅ ({selectedParts.size})</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={isExportingPdf || ginItems.length === 0}
                onClick={() => handleExportPdf(selectedParts.size > 0, true)}
                className="px-3.5 py-2 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] disabled:opacity-45 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                {isExportingPdf ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileDown className="w-3.5 h-3.5" />
                )}
                <span>
                  {selectedParts.size > 0
                    ? `PDF للمختار وإرسال واتساب 📲 (${selectedParts.size})`
                    : `PDF لكل القين وإرسال واتساب 📲 (${ginItems.length})`}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleCopyText(selectedParts.size > 0)}
                className="px-3 py-2 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-amber-200 font-bold text-xs flex items-center gap-1 border border-[#52382D] cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>
                  {selectedParts.size > 0
                    ? `نسخ المختار (${selectedParts.size})`
                    : 'نسخ الكل'}
                </span>
              </button>

              {onOpenAddModal && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAddModal();
                  }}
                  className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة مادة يدوياً</span>
                </button>
              )}
            </div>
          </div>

          {ginItems.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-[#32211A] text-xs">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="px-3 py-1 rounded-lg bg-[#2C1E18] hover:bg-[#3A271F] text-purple-200 border border-purple-600/50 font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  {selectedParts.size === ginItems.length ? (
                    <>
                      <CheckSquare className="w-3.5 h-3.5 text-purple-400" />
                      <span>إلغاء تحديد الكل</span>
                    </>
                  ) : (
                    <>
                      <Square className="w-3.5 h-3.5 text-purple-400" />
                      <span>تحديد كل القين ({ginItems.length})</span>
                    </>
                  )}
                </button>
                <span className="text-neutral-400 text-[11px]">
                  اضغط على أي مادة في القائمة بالأسفل لاختيارها ضمن التقرير المخصص
                </span>
              </div>
              {selectedParts.size > 0 && (
                <span className="text-emerald-300 font-bold">
                  تم اختيار {selectedParts.size} من أصل {ginItems.length} مادة
                </span>
              )}
            </div>
          )}
        </div>

        {statusMessage && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-emerald-950/90 border border-emerald-500/70 text-emerald-200 text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        <div className="p-3.5 border-b border-[#3D271F] bg-[#251914] space-y-2 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2 relative">
              <Search className="w-3.5 h-3.5 text-amber-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchAddQuery}
                onChange={(e) => setSearchAddQuery(e.target.value)}
                placeholder="ابحث برقم القطعة أو الاسم أو الموقع لوضع إشارة (🔖 قين) على قطعة موجودة..."
                className="w-full pr-9 pl-3 py-2 rounded-xl bg-[#19110D] border border-[#4A342B] text-neutral-100 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <input
                type="text"
                value={customGinNote}
                onChange={(e) => setCustomGinNote(e.target.value)}
                placeholder="بيان / ملاحظة قين (اختياري)"
                className="w-full px-3 py-2 rounded-xl bg-[#19110D] border border-[#4A342B] text-purple-200 font-bold focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {candidateItems.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 max-h-36 overflow-y-auto">
              {candidateItems.map((cand) => (
                <div
                  key={cand.part_number}
                  className="p-2 rounded-lg bg-[#19110D] border border-[#3D271F] flex items-center justify-between gap-2"
                >
                  <div className="truncate">
                    <span className="font-mono font-bold text-amber-300 ml-2">
                      {cand.part_number}
                    </span>
                    <span className="text-neutral-400 font-mono text-[11px] ml-2">
                      [{cand.location_code}]
                    </span>
                    <span className="text-neutral-200">{cand.description_ar}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddExistingToGin(cand.part_number)}
                    className="px-2.5 py-1 rounded-lg bg-purple-700 hover:bg-purple-600 text-white font-bold text-[11px] shrink-0 cursor-pointer"
                  >
                    + وضع إشارة قين 🔖
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
          {ginItems.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <Package className="w-10 h-10 text-purple-400/50 mx-auto" />
              <p className="text-neutral-200 font-bold text-sm">
                لا توجد مواد عليها إشارة (🔖 قين) حالياً
              </p>
              <p className="text-neutral-400 text-xs max-w-md mx-auto">
                عند إضافة أي مادة يدوياً تُحفظ مع القطع في نفس الموقع، وعند اختيار (وضع قين) أو الضغط على زر (+ إشارة قين) في بطاقة القطعة تظهر هنا لتتمكن من إرسال تقرير بكل القين أو المختار منها عبر الواتساب.
              </p>
            </div>
          ) : (
            ginItems.map((item, idx) => {
              const isSelected = selectedParts.has(item.part_number);
              return (
                <div
                  key={item.part_number}
                  onClick={() => toggleSelectPart(item.part_number)}
                  className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs cursor-pointer ${
                    isSelected
                      ? 'bg-purple-950/40 border-purple-400 shadow-md'
                      : 'bg-[#1F1511] border-purple-800/50 hover:border-purple-500/70'
                  }`}
                >
                  <div className="flex items-start sm:items-center gap-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectPart(item.part_number);
                      }}
                      className="mt-1 sm:mt-0 text-purple-300 hover:text-white cursor-pointer"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <Square className="w-5 h-5 text-purple-400" />
                      )}
                    </button>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-200 border border-purple-600/60 font-black">
                          #{idx + 1}
                        </span>
                        <span className="font-mono font-black text-amber-300 text-sm bg-[#140D0A] px-2.5 py-0.5 rounded border border-[#3D271F]">
                          {item.part_number}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-md bg-gradient-to-r from-purple-700 to-fuchsia-700 text-white border border-purple-300 font-black">
                          🔖 قين{item.gin_code !== 'قين' ? `: ${item.gin_code}` : ''}
                        </span>
                        <span className="font-bold text-white text-sm">{item.description_ar}</span>
                      </div>
                      <div className="flex items-center gap-3 text-neutral-400 flex-wrap">
                        <span className="text-amber-200 font-mono font-bold flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-amber-500" />
                          محفوظة في الموقع: {item.location_code}
                        </span>
                        <span>•</span>
                        <span className="text-emerald-400 font-mono font-bold">
                          المتبقي: {item.qty_remaining} (الإجمالي: {item.qty_total})
                        </span>
                        {item.description_en && (
                          <>
                            <span>•</span>
                            <span dir="ltr" className="text-neutral-300 font-sans">
                              {item.description_en}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-2 self-end sm:self-center shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => handleRemoveFromGin(item.part_number)}
                      className="px-3 py-1.5 rounded-lg bg-red-950/70 hover:bg-red-800 text-red-200 border border-red-700/60 font-bold flex items-center gap-1 cursor-pointer"
                      title="إزالة إشارة قين فقط (تبقى المادة محفوظة مع القطع في موقعها)"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>إزالة إشارة قين</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-3.5 bg-[#231713] border-t border-[#3D271F] flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">
            جميع مواد (قين) محفوظة مع القطع في نفس مواقعها الفعلية وتظهر عليها شارة (🔖 قين).
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-white font-bold text-xs cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
