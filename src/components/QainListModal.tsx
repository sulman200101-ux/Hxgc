import React, { useState, useMemo } from 'react';
import { InventoryItem } from '../types';
import { exportInventoryListToPdfFile } from '../utils/pdfExportUtil';
import { isConsumablePart } from '../services/transferSuggestions';
import {
  X,
  MessageCircle,
  Search,
  Plus,
  CheckCircle2,
  MapPin,
  FileDown,
  Share2,
  Trash2,
  ArrowRightLeft,
  RefreshCw,
  Edit3,
  Check,
  Loader2,
} from 'lucide-react';

interface QainListModalProps {
  isOpen: boolean;
  allItems: InventoryItem[];
  onClose: () => void;
  onToggleQain: (partNumber: string, forceValue?: boolean, note?: string) => Promise<void>;
  onUpdateQainNote: (partNumber: string, note: string) => Promise<void>;
  onToggleManualAudit: (partNumber: string) => Promise<void>;
  onToggleConsumable: (partNumber: string) => Promise<void>;
  onOpenLocation: (locationCode: string) => void;
  onOpenRelocate: (item: InventoryItem) => void;
  onOpenAddNewWithQain: () => void;
}

export const QainListModal: React.FC<QainListModalProps> = ({
  isOpen,
  allItems,
  onClose,
  onToggleQain,
  onUpdateQainNote,
  onToggleManualAudit,
  onToggleConsumable,
  onOpenLocation,
  onOpenRelocate,
  onOpenAddNewWithQain,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [editingNotePart, setEditingNotePart] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);

  const qainItems = useMemo(
    () => allItems.filter((item) => item.is_qain === 1),
    [allItems]
  );

  const searchCandidates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allItems
      .filter(
        (item) =>
          item.part_number.toLowerCase().includes(q) ||
          item.location_code.toLowerCase().includes(q) ||
          (item.description_ar && item.description_ar.toLowerCase().includes(q)) ||
          (item.description_en && item.description_en.toLowerCase().includes(q)) ||
          (item.category && item.category.toLowerCase().includes(q))
      )
      .slice(0, 20);
  }, [allItems, searchQuery]);

  if (!isOpen) return null;

  const handleExportQainPdf = async () => {
    if (qainItems.length === 0) return;
    setIsExporting(true);
    try {
      await exportInventoryListToPdfFile({
        items: qainItems,
        title: `تقرير قائمة قطع قين (${qainItems.length} قطعة)`,
      });
      setCopiedMessage('تم تصدير قائمة قين بصيغة PDF بنجاح! 📥');
      setTimeout(() => setCopiedMessage(null), 4000);
    } catch {
      setCopiedMessage('تعذر تصدير ملف PDF حالياً.');
      setTimeout(() => setCopiedMessage(null), 4000);
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyOrShareQain = async () => {
    if (qainItems.length === 0) return;
    const lines = qainItems.map((it, i) => {
      const auditTag = it.is_manual_audit === 1 ? ' [مدقق يدوي ✓]' : '';
      const consTag = isConsumablePart(it) ? ' [استهلاكية A/FL]' : '';
      const noteTag = it.qain_note ? ` — ملاحظة: ${it.qain_note}` : '';
      return `${i + 1}. رقم القطعة: ${it.part_number} | الموقع: ${it.location_code} | المتبقي: ${it.qty_remaining} | ${it.description_ar || it.description_en}${auditTag}${consTag}${noteTag}`;
    });
    const text = `📋 قائمة قطع قين - أسمو (${qainItems.length} قطعة):\n${lines.join('\n')}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'قائمة قطع قين - أسمو', text });
      } else {
        await navigator.clipboard.writeText(text);
        setCopiedMessage('تم نسخ قائمة قين للحافظة بنجاح ✓');
        setTimeout(() => setCopiedMessage(null), 3500);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedMessage('تم نسخ قائمة قين للحافظة بنجاح ✓');
        setTimeout(() => setCopiedMessage(null), 3500);
      } catch {
        // ignore
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm overflow-y-auto"
      dir="rtl"
    >
      <div className="bg-[#231713] border-2 border-emerald-500/60 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 bg-gradient-to-l from-emerald-950 via-[#1E2B24] to-[#231713] border-b border-emerald-600/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/25 border border-emerald-400/60 flex items-center justify-center text-emerald-300">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-black text-white">
                  قائمة قطع قين (القطع المعلمة بعلامة قين)
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500 text-neutral-950 font-mono font-black text-xs">
                  {qainItems.length} قطعة
                </span>
              </div>
              <p className="text-[11px] text-emerald-200/80">
                ضع علامة (قين 💬) أو (مدقق يدوي ✓) أو (استهلاكية 🔄) على أي قطعة أثناء التدقيق الميداني
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAddNewWithQain();
              }}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-black flex items-center gap-1 shadow-md cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة قطعة جديدة لقين</span>
            </button>

            {qainItems.length > 0 && (
              <>
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={handleExportQainPdf}
                  className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-black flex items-center gap-1 shadow-md cursor-pointer"
                >
                  {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                  <span>تصدير PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyOrShareQain}
                  className="px-3 py-1.5 rounded-xl bg-teal-800 hover:bg-teal-700 text-teal-100 text-xs font-bold flex items-center gap-1 border border-teal-500/40 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>نسخ / مشاركة</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-neutral-300 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {copiedMessage && (
          <div className="px-4 py-2 bg-emerald-900/60 border-b border-emerald-500/40 text-emerald-200 text-xs font-bold flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{copiedMessage}</span>
          </div>
        )}

        {/* شريط البحث السريع لإضافة أي قطعة من المخزون إلى قائمة قين */}
        <div className="p-3.5 bg-[#1C120E] border-b border-[#3D271F] space-y-2.5">
          <div className="relative">
            <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 ابحث برقم القطعة (10 أرقام) أو الاسم أو الموقع لوضع علامة (قين 💬) أو (مدقق يدوي ✓)..."
              className="w-full pl-9 pr-10 py-2 rounded-xl bg-[#271A14] text-neutral-100 placeholder-neutral-400 border border-emerald-600/50 focus:outline-none focus:border-emerald-400 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {searchQuery.trim() !== '' && (
            <div className="max-h-52 overflow-y-auto space-y-1.5 bg-[#150E0B] p-2 rounded-xl border border-[#3D271F]">
              {searchCandidates.length === 0 ? (
                <p className="text-center text-neutral-400 text-xs py-2">
                  لا توجد قطعة مطابقة في المخزون حالياً — يمكنك إضافتها بزر &quot;إضافة قطعة جديدة لقين&quot; أعلاه.
                </p>
              ) : (
                searchCandidates.map((cand) => {
                  const isMarkedQain = cand.is_qain === 1;
                  const isManualAudited = cand.is_manual_audit === 1;
                  const isCons = isConsumablePart(cand);
                  return (
                    <div
                      key={cand.part_number}
                      className="p-2 rounded-lg bg-[#241813] border border-[#3E2920] flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-amber-300 bg-[#160E0B] px-2 py-0.5 rounded">
                          {cand.part_number}
                        </span>
                        <span className="font-mono text-emerald-300 font-bold">
                          {cand.location_code}
                        </span>
                        <span className="font-bold text-white">{cand.description_ar}</span>
                        <span className="text-neutral-400 text-[11px]" dir="ltr">
                          {cand.description_en}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onToggleQain(cand.part_number)}
                          className={`px-2.5 py-1 rounded-lg font-black text-[11px] flex items-center gap-1 border cursor-pointer transition-all ${
                            isMarkedQain
                              ? 'bg-emerald-600 text-white border-emerald-300'
                              : 'bg-emerald-950/80 hover:bg-emerald-800 text-emerald-200 border-emerald-600/60'
                          }`}
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          <span>{isMarkedQain ? 'علامة قين ✓' : '+ وضع علامة قين'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onToggleManualAudit(cand.part_number)}
                          className={`px-2.5 py-1 rounded-lg font-black text-[11px] flex items-center gap-1 border cursor-pointer transition-all ${
                            isManualAudited
                              ? 'bg-teal-600 text-white border-teal-300'
                              : 'bg-stone-800 hover:bg-teal-900 text-teal-200 border-teal-700/60'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isManualAudited ? 'مدقق يدوي ✓' : 'مدقق يدوي'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onToggleConsumable(cand.part_number)}
                          className={`px-2 py-1 rounded-lg font-bold text-[11px] flex items-center gap-1 border cursor-pointer ${
                            isCons
                              ? 'bg-cyan-700 text-white border-cyan-400'
                              : 'bg-stone-800 text-cyan-200 border-cyan-700/50'
                          }`}
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>{isCons ? 'استهلاكية ✓' : 'استهلاكية'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* قائمة القطع المعلمة بعلامة قين */}
        <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
          {qainItems.length === 0 ? (
            <div className="text-center py-12 space-y-3 bg-[#1B120E] rounded-2xl border border-[#3A271F] p-6">
              <MessageCircle className="w-10 h-10 text-emerald-400/60 mx-auto" />
              <p className="text-neutral-200 font-bold text-sm">
                لا توجد قطع معلمة بـ (علامة قين 💬) حالياً
              </p>
              <p className="text-neutral-400 text-xs max-w-md mx-auto">
                يمكنك البحث أعلاه عن أي قطعة لوضع علامة (قين 💬) عليها، أو الضغط على زر (💬 قين) الموجود بجانب كل قطعة أثناء تصفح المواقع وجدول القطع.
              </p>
            </div>
          ) : (
            qainItems.map((item, idx) => {
              const isManualAudited = item.is_manual_audit === 1;
              const isCons = isConsumablePart(item);
              const isEditingThisNote = editingNotePart === item.part_number;
              const currentDraft =
                noteDrafts[item.part_number] !== undefined
                  ? noteDrafts[item.part_number]
                  : item.qain_note || '';

              return (
                <div
                  key={`${item.part_number}-${idx}`}
                  className="p-3.5 rounded-xl bg-[#1B130F] border border-emerald-600/50 hover:border-emerald-400 transition-all space-y-2 text-xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white font-black text-[11px] inline-flex items-center gap-1">
                          <MessageCircle className="w-3 h-3" />
                          علامة قين ✓
                        </span>
                        <span className="font-mono font-bold text-amber-300 bg-[#120C09] px-2 py-0.5 rounded border border-[#3D271F]">
                          رقم: {item.part_number}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenLocation(item.location_code);
                          }}
                          className="font-mono font-bold text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900 px-2 py-0.5 rounded border border-emerald-600/40 flex items-center gap-1 cursor-pointer"
                        >
                          <MapPin className="w-3 h-3 text-emerald-400" />
                          <span>الموقع: {item.location_code}</span>
                        </button>
                        <span className="font-bold text-white text-sm">
                          {item.description_ar}
                        </span>
                        {isManualAudited && (
                          <span className="px-2 py-0.5 rounded-md bg-teal-950 text-teal-200 border border-teal-400 font-black text-[11px] inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-teal-300" />
                            مدقق يدوي ✓
                          </span>
                        )}
                        {isCons && (
                          <span className="px-2 py-0.5 rounded-md bg-cyan-950 text-cyan-200 border border-cyan-500/60 font-bold text-[11px]">
                            🔄 استهلاكية (A/FL)
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-neutral-400 flex-wrap">
                        <span>
                          المتبقي بالمخزون:{' '}
                          <strong className="text-emerald-400 font-mono">{item.qty_remaining}</strong>{' '}
                          (الإجمالي: {item.qty_total})
                        </span>
                        <span>•</span>
                        <span className="font-sans" dir="ltr">
                          {item.description_en}
                        </span>
                        {item.qain_note && !isEditingThisNote && (
                          <>
                            <span>•</span>
                            <span className="text-amber-300 font-bold">
                              ملاحظة قين: {item.qain_note}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
                      <button
                        type="button"
                        onClick={() => onToggleManualAudit(item.part_number)}
                        className={`px-2.5 py-1 rounded-lg font-black text-[11px] border flex items-center gap-1 cursor-pointer transition-all ${
                          isManualAudited
                            ? 'bg-teal-600 text-white border-teal-300 shadow'
                            : 'bg-stone-800 hover:bg-teal-900 text-teal-200 border-teal-600/50'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{isManualAudited ? 'مدقق يدوي ✓' : 'تدقيق يدوي'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleConsumable(item.part_number)}
                        className={`px-2.5 py-1 rounded-lg font-bold text-[11px] border flex items-center gap-1 cursor-pointer transition-all ${
                          isCons
                            ? 'bg-cyan-700 text-white border-cyan-400'
                            : 'bg-stone-800 hover:bg-cyan-950 text-cyan-200 border-cyan-600/50'
                        }`}
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>{isCons ? 'استهلاكية ✓' : 'تحديد كاستهلاكية'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingNotePart(isEditingThisNote ? null : item.part_number);
                          setNoteDrafts((prev) => ({
                            ...prev,
                            [item.part_number]: item.qain_note || '',
                          }));
                        }}
                        className="px-2 py-1 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-amber-200 border border-[#52382D] flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>ملاحظة</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenRelocate(item);
                        }}
                        className="px-2 py-1 rounded-lg bg-emerald-900/70 hover:bg-emerald-800 text-emerald-200 border border-emerald-500/40 font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowRightLeft className="w-3 h-3" />
                        <span>نقل</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleQain(item.part_number, false)}
                        className="p-1.5 rounded-lg bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800/50 cursor-pointer"
                        title="إزالة علامة قين"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isEditingThisNote && (
                    <div className="flex items-center gap-2 pt-2 border-t border-[#33221B]">
                      <input
                        type="text"
                        value={currentDraft}
                        onChange={(e) =>
                          setNoteDrafts((prev) => ({
                            ...prev,
                            [item.part_number]: e.target.value,
                          }))
                        }
                        placeholder="اكتب ملاحظة خاصة بهذه القطعة في قائمة قين..."
                        className="flex-1 px-3 py-1.5 rounded-lg bg-[#120C09] border border-emerald-600/50 text-white text-xs"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          await onUpdateQainNote(item.part_number, currentDraft);
                          setEditingNotePart(null);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
                      >
                        حفظ الملاحظة
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
