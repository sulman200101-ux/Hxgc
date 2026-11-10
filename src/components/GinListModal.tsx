import React, { useState, useMemo } from 'react';
import { InventoryItem } from '../types';
import { dbService } from '../services/db';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import {
  X,
  MessageCircle,
  Share2,
  Copy,
  Trash2,
  Plus,
  Search,
  MapPin,
  Package,
  CheckCircle2,
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

  const ginItems = useMemo(() => {
    return items.filter((item) => Boolean(item.gin_code && item.gin_code.trim()));
  }, [items]);

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
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const buildWhatsAppMessage = (): string => {
    const today = new Date().toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const lines: string[] = [
      `📋 *قائمة (قين) — مستودع قطع الغيار ASMO*`,
      `📅 التاريخ: ${today}`,
      `📦 إجمالي المواد في قائمة قين: *${ginItems.length}* مادة`,
      `━━━━━━━━━━━━━━━━━━━━`,
    ];

    ginItems.forEach((item, idx) => {
      const ginTag =
        item.gin_code && item.gin_code !== 'قين' ? ` | قين: ${item.gin_code}` : ' | (قين)';
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

  const handleSendWhatsApp = async () => {
    if (ginItems.length === 0) {
      showTempStatus('⚠️ قائمة قين فارغة حالياً — أضف مادة أولاً');
      return;
    }
    const text = buildWhatsAppMessage();
    const encoded = encodeURIComponent(text);
    const whatsappUrl = `https://wa.me/?text=${encoded}`;

    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({
          title: 'قائمة (قين) — جرد مستودع ASMO',
          text,
          dialogTitle: 'إرسال قائمة (قين) عبر الواتساب...',
        });
        showTempStatus('✅ تم فتح مشاركة الواتساب لقائمة قين');
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
    showTempStatus('✅ جاري فتح الواتساب لإرسال قائمة قين...');
  };

  const handleCopyText = async () => {
    if (ginItems.length === 0) {
      showTempStatus('⚠️ قائمة قين فارغة حالياً');
      return;
    }
    try {
      await navigator.clipboard.writeText(buildWhatsAppMessage());
      showTempStatus('✅ تم نسخ نص قائمة (قين) للحافظة — يمكنك لصقه في الواتساب مباشرة');
    } catch {
      showTempStatus('⚠️ تعذر النسخ التلقائي');
    }
  };

  const handleAddExistingToGin = async (partNumber: string) => {
    const val = customGinNote.trim() || 'قين';
    await dbService.setItemGinCode(partNumber, val);
    onRefresh();
    showTempStatus(`✅ تمت إضافة المادة (${partNumber}) إلى قائمة قين`);
  };

  const handleRemoveFromGin = async (partNumber: string) => {
    await dbService.setItemGinCode(partNumber, null);
    onRefresh();
    showTempStatus(`تمت إزالة المادة (${partNumber}) من قائمة قين`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
      dir="rtl"
    >
      <div className="bg-[#2C1E18] border-2 border-emerald-600/70 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 bg-gradient-to-l from-emerald-950 via-[#231713] to-[#231713] border-b border-emerald-700/50 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-400/50 flex items-center justify-center text-emerald-300">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-base sm:text-lg text-white">
                  قائمة (قين) — الإرسال السريع عبر الواتساب
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-600 text-white text-xs font-black">
                  {ginItems.length} مادة
                </span>
              </div>
              <p className="text-[11px] text-emerald-200/80">
                جميع المواد المحددة بخيار (قين) عند الإضافة اليدوية أو المضافة هنا لإرسالها عبر الواتساب
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

        {/* Action Bar */}
        <div className="p-3.5 bg-[#1F1511] border-b border-[#3D271F] flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSendWhatsApp}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-black text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-emerald-950/80 border border-emerald-400/60 cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              <span>إرسال قائمة (قين) عبر الواتساب 💬</span>
            </button>

            <button
              type="button"
              onClick={handleCopyText}
              className="px-3.5 py-2.5 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-amber-200 font-bold text-xs flex items-center gap-1.5 border border-[#52382D] cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>نسخ نص القائمة 📋</span>
            </button>
          </div>

          {onOpenAddModal && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAddModal();
              }}
              className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مادة جديدة يدوياً مع خيار (قين)</span>
            </button>
          )}
        </div>

        {statusMessage && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-emerald-950/90 border border-emerald-500/70 text-emerald-200 text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Quick Add from existing inventory */}
        <div className="p-3.5 border-b border-[#3D271F] bg-[#251914] space-y-2 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2 relative">
              <Search className="w-3.5 h-3.5 text-amber-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchAddQuery}
                onChange={(e) => setSearchAddQuery(e.target.value)}
                placeholder="ابحث برقم القطعة أو الاسم لإضافة مادة موجودة إلى قائمة (قين)..."
                className="w-full pr-9 pl-3 py-2 rounded-xl bg-[#19110D] border border-[#4A342B] text-neutral-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <input
                type="text"
                value={customGinNote}
                onChange={(e) => setCustomGinNote(e.target.value)}
                placeholder="بيان / رقم قين (اختياري)"
                className="w-full px-3 py-2 rounded-xl bg-[#19110D] border border-[#4A342B] text-emerald-300 font-bold focus:outline-none focus:border-emerald-500"
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
                    <span className="text-neutral-200">{cand.description_ar}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddExistingToGin(cand.part_number)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-[11px] shrink-0 cursor-pointer"
                  >
                    + ضم لقائمة قين
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* List Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
          {ginItems.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <Package className="w-10 h-10 text-emerald-500/50 mx-auto" />
              <p className="text-neutral-200 font-bold text-sm">
                لا توجد مواد مضافة في قائمة (قين) حالياً
              </p>
              <p className="text-neutral-400 text-xs max-w-md mx-auto">
                عند إضافة أي مادة يدوياً يمكنك اختيار (وضع قين) لتظهر هنا وترسلها عبر الواتساب، أو اختيار (تجاهل قين) لتضاف للمخزون كما في السابق.
              </p>
            </div>
          ) : (
            ginItems.map((item, idx) => (
              <div
                key={item.part_number}
                className="p-3 rounded-xl bg-[#1F1511] border border-emerald-800/50 hover:border-emerald-500/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-600/60 font-black">
                      #{idx + 1}
                    </span>
                    <span className="font-mono font-black text-amber-300 text-sm bg-[#140D0A] px-2.5 py-0.5 rounded border border-[#3D271F]">
                      {item.part_number}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-600/25 text-emerald-200 border border-emerald-400/50 font-black">
                      قين: {item.gin_code}
                    </span>
                    <span className="font-bold text-white text-sm">{item.description_ar}</span>
                  </div>
                  <div className="flex items-center gap-3 text-neutral-400 flex-wrap">
                    <span className="text-amber-200 font-mono font-bold flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-amber-500" />
                      الموقع: {item.location_code}
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

                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRemoveFromGin(item.part_number)}
                    className="px-3 py-1.5 rounded-lg bg-red-950/70 hover:bg-red-800 text-red-200 border border-red-700/60 font-bold flex items-center gap-1 cursor-pointer"
                    title="إزالة من قائمة قين فقط (تبقى المادة في المخزون)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>إزالة من قين</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 bg-[#231713] border-t border-[#3D271F] flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">
            إزالة المادة من قائمة (قين) لا يحذفها من المخزون العام.
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
