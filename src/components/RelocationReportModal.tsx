import React, { useRef, useState, useMemo, useEffect } from 'react';
import { InventoryItem } from '../types';
import { dbService } from '../services/db';
import { sharePdfFile } from '../utils/pdfExportUtil';
import { exportAndShareForEditing } from '../utils/csvExportUtil';
import {
  isConsumablePart,
  isALocation,
  isFLLocation,
  estimatePartSizeProfile,
} from '../services/transferSuggestions';
import { 
  Printer, 
  X, 
  CheckCircle2, 
  Calendar, 
  FileText, 
  MessageCircle, 
  Mail, 
  Share2, 
  Loader2,
  ArrowRightLeft,
  Layers,
  FileDown,
  RefreshCw,
} from 'lucide-react';

import type { StockDocument } from '../services/documents';

interface RelocationReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  movedItems?: InventoryItem[];
}

export const RelocationReportModal: React.FC<RelocationReportModalProps> = ({
  isOpen,
  onClose,
  movedItems: propMovedItems,
}) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    message: string;
    downloadUrl?: string;
    filename?: string;
    whatsappUrl?: string;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // خيار نطاق التقرير: القطع المنقولة أو القطع الاستهلاكية (A/FL) أو كافة قطع الجرد
  const [reportScope, setReportScope] = useState<'moved' | 'consumables' | 'all'>('moved');
  const [savedReports, setSavedReports] = useState<StockDocument[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>('ALL_MOVED');
  const [reportItems, setReportItems] = useState<InventoryItem[]>([]);

  useEffect(() => {
    if (isOpen) {
      const reports = dbService.getTransferReports();
      setSavedReports(reports);
      if (propMovedItems && propMovedItems.length > 0 && reports.length > 0) {
        setSelectedReportId(reports[reports.length - 1].id);
        setReportScope('moved');
      } else {
        setSelectedReportId('ALL_MOVED');
      }
    }
  }, [isOpen, propMovedItems]);

  useEffect(() => {
    if (!isOpen) return;
    const movedFromDb = dbService.getMovedItems();
    const allFromDb = dbService.getAllItems();

    if (reportScope === 'all') {
      setReportItems(allFromDb);
      return;
    }

    let baseMoved: InventoryItem[] = [];

    if (selectedReportId !== 'ALL_MOVED') {
      const targetDoc = savedReports.find((r) => r.id === selectedReportId);
      if (targetDoc) {
        if (targetDoc.transferredItemsSnapshot && targetDoc.transferredItemsSnapshot.length > 0) {
          baseMoved = targetDoc.transferredItemsSnapshot.map((s) => ({
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
            moved_at: s.moved_at || targetDoc.executedAt || targetDoc.createdAt,
            remark: s.remark || targetDoc.reason,
          }));
        } else {
          baseMoved = targetDoc.lines
            .map((l): InventoryItem | null => {
              const existing = dbService.getItemByPartNumber(l.part_number);
              return existing
                ? {
                    ...existing,
                    old_location: l.old_location || existing.old_location,
                    location_code: l.location || existing.location_code,
                    is_moved: 1,
                    user_moved: 1,
                    is_consumable: l.is_consumable ?? existing.is_consumable,
                    status: 'منقول',
                    moved_at: targetDoc.executedAt || targetDoc.createdAt,
                  }
                : null;
            })
            .filter((i): i is InventoryItem => Boolean(i));
        }
      }
    } else if (propMovedItems && propMovedItems.length > 0) {
      baseMoved = propMovedItems;
    } else {
      baseMoved = movedFromDb;
    }

    if (reportScope === 'consumables') {
      const sourcePool = baseMoved.length > 0 ? baseMoved : allFromDb.filter((i) => isConsumablePart(i));
      setReportItems(sourcePool.filter((i) => isConsumablePart(i)));
    } else {
      setReportItems(baseMoved);
    }
  }, [isOpen, reportScope, selectedReportId, savedReports, propMovedItems]);

  const activeSavedReport = useMemo(
    () =>
      selectedReportId !== 'ALL_MOVED'
        ? savedReports.find((r) => r.id === selectedReportId) || null
        : null,
    [selectedReportId, savedReports]
  );

  const reportDateObj = useMemo(() => {
    if (activeSavedReport) {
      const iso = activeSavedReport.executedAt || activeSavedReport.createdAt;
      const d = iso ? new Date(iso) : new Date();
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  }, [activeSavedReport]);

  const currentDate = reportDateObj.toLocaleDateString('ar-SA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const currentTime = reportDateObj.toLocaleTimeString('ar-SA', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const totalQty = useMemo(() => {
    return reportItems.reduce((acc, i) => acc + (Number(i.qty_total) || 0), 0);
  }, [reportItems]);

  const remainingQty = useMemo(() => {
    return reportItems.reduce((acc, i) => acc + (Number(i.qty_remaining) || 0), 0);
  }, [reportItems]);

  const consumableInReportCount = useMemo(() => {
    return reportItems.filter((i) => isConsumablePart(i)).length;
  }, [reportItems]);

  const reportTitleLabel = useMemo(() => {
    if (reportScope === 'all') return 'بيان جرد الأصناف الشامل';
    if (reportScope === 'consumables') return 'قائمة نقل القطع الاستهلاكية إلى حرف (A أو FL)';
    if (activeSavedReport?.reportTitle) return activeSavedReport.reportTitle;
    if (savedReports.length > 0) {
      return `إجمالي قوائم النقل اليومية المحفوظة (${savedReports.length} أيام)`;
    }
    return 'قائمة حركة القطع المنقولة من قِبل المستخدم';
  }, [reportScope, activeSavedReport, savedReports.length]);

  const reportId = useMemo(() => {
    if (activeSavedReport?.reportNumber) {
      const d = reportDateObj;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `قائمة-${activeSavedReport.reportNumber}-${year}${month}${day}`;
    }
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `REL-${year}${month}${day}-${reportItems.length || '0'}`;
  }, [activeSavedReport, reportDateObj, reportItems.length]);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  // 1. تصدير ومشاركة PDF عبر الواتساب 📲
  const handleShareWhatsApp = async () => {
    setIsExporting(true);
    setActionFeedback({ message: 'جاري توليد ملف PDF وتجهيز الإرسال عبر واتساب... 📲' });
    try {
      const intro =
        `📋 *مرفق ${reportTitleLabel} [${reportId}]*\n\n` +
        `🏢 *ASMO - إدارة المستودعات (SAP Inventory Controller)*\n` +
        `📅 التاريخ: ${currentDate} • ${currentTime}\n` +
        `📦 عدد الأصناف في القائمة: ${reportItems.length} صنف\n` +
        `🔄 القطع الاستهلاكية (إلى حرف A أو FL): ${consumableInReportCount} صنف\n` +
        `🔢 إجمالي الكمية: ${totalQty} وحدة\n\n` +
        `*قائمة النقل اليومية المعتمدة من قِبل المستخدم:*\n`;

      const rows = reportItems
        .slice(0, 22)
        .map((item, idx) => {
          const isCons = isConsumablePart(item);
          const sz = estimatePartSizeProfile(item);
          const shelfTag = isFLLocation(item.location_code)
            ? 'حرف FL'
            : isALocation(item.location_code)
            ? 'حرف A'
            : sz.consumableTargetType;
          const consLabel = isCons ? ` | 🔄 *قطعة استهلاكية (${shelfTag})*` : '';
          const isMoved = item.is_moved === 1 && (item.status === 'منقول' || item.status === 'تم النقل');
          const statusStr = isMoved
            ? 'منقول ✓'
            : item.user_verified === 1 && item.status === 'مدقق'
            ? 'مدقق ✓'
            : 'غير مدقق';
          return (
            `${idx + 1}) القطعة: *${item.part_number}*${consLabel}\n` +
            `   الوصف: ${item.description_ar || item.description_en}\n` +
            `   الكمية: ${item.qty_total} | من: [${item.old_location || 'السابق'}] ⬅ إلى الموقع الجديد: *[${item.location_code}]*\n` +
            `   الحالة: ${statusStr}`
          );
        })
        .join('\n\n');

      const extra =
        reportItems.length > 22
          ? `\n\n... بالإضافة إلى ${reportItems.length - 22} أصناف أخرى مدرجة بالكامل في ملف الـ PDF المرفق.`
          : '';

      const outro = `\n\n✅ تم حفظ القائمة في سجل النقل اليومي وتحديث المواقع الفعلية في النظام.`;

      const fullWhatsAppText = intro + rows + extra + outro;
      const directWaUrl = `https://wa.me/?text=${encodeURIComponent(fullWhatsAppText)}`;

      const res = await sharePdfFile({
        reportElementId: 'relocation-printable-report',
        title: `${reportTitleLabel} - ASMO [${reportId}]`,
        text: fullWhatsAppText,
        targetApp: 'whatsapp',
      });

      setActionFeedback({
        message: `تم تنزيل ملف PDF (${res.filename}) وتجهيز الإرسال عبر واتساب! 📲`,
        downloadUrl: res.downloadUrl,
        filename: res.filename,
        whatsappUrl: res.whatsappUrl || directWaUrl,
      });
    } catch (e: any) {
      console.error(e);
      setActionFeedback({ message: 'تم تجهيز نص التقرير لإرساله عبر واتساب 📲' });
    } finally {
      setIsExporting(false);
    }
  };

  // 2. تصدير وإرسال PDF عبر الإيميل ✉️
  const handleShareEmail = async () => {
    setIsExporting(true);
    setActionFeedback({ message: 'جاري توليد ملف PDF وتجهيز الإيميل... ✉️' });
    try {
      const subject = `${reportTitleLabel} - للاعتماد في النظام الشامل (ASMO) [${reportId}]`;

      const intro =
        `السلام عليكم ورحمة الله وبركاته،\n\n` +
        `سعادة المشرف العام / إدارة المستودعات المحترمين،\n\n` +
        `مرفق طيه تقرير وقائمة نقل القطع رقم [${reportId}] كملف PDF رسمي للاعتماد والرصد في النظام الشامل بشركة ASMO.\n\n` +
        `بيانات القائمة الملخصة:\n` +
        `- رقم القائمة: ${reportId}\n` +
        `- تاريخ ووقت الإصدار: ${currentDate} - ${currentTime}\n` +
        `- إجمالي القطع: ${reportItems.length} صنف (منها ${consumableInReportCount} قطعة استهلاكية موجهة إلى حرف A أو FL)\n` +
        `- إجمالي الكميات: ${totalQty} وحدة\n\n` +
        `قائمة القطع المعتمدة:\n` +
        `----------------------------------------------------------------------\n`;

      const rows = reportItems
        .map((item, idx) => {
          const isCons = isConsumablePart(item);
          return (
            `${idx + 1}. رقم القطعة: ${item.part_number}${isCons ? ' [قطعة استهلاكية — A/FL]' : ''}\n` +
            `   الوصف: ${item.description_ar || item.description_en}\n` +
            `   الموقع القديم: ${item.old_location || '---'}\n` +
            `   الموقع الجديد: ${item.location_code}\n` +
            `   الكمية (QTY): ${item.qty_total}\n` +
            `   وقت النقل: ${item.moved_at || currentDate}\n` +
            `   حالة النقل: ${item.is_moved === 1 ? 'منقول' : item.user_verified === 1 ? 'مدقق' : 'غير مدقق'}`
          );
        })
        .join('\n\n');

      const outro =
        `\n----------------------------------------------------------------------\n\n` +
        `يرجى التكرم بمراجعة البيانات والملف المرفق وتأكيد اعتماد رصد المواقع على النظام الشامل.\n\n` +
        `وتقبلوا خالص التحية والتقدير،\n` +
        `مسؤول جرد المستودعات - ASMO`;

      const res = await sharePdfFile({
        reportElementId: 'relocation-printable-report',
        title: subject,
        text: intro + rows + outro,
        targetApp: 'email',
      });

      setActionFeedback({
        message: `تم تصدير وتنزيل ملف PDF (${res.filename}) بنجاح وجاري فتح الإيميل! ✉️`,
        downloadUrl: res.downloadUrl,
        filename: res.filename,
      });
      setTimeout(() => setActionFeedback(null), 8000);
    } catch (e: any) {
      console.error(e);
      setActionFeedback({ message: 'تم فتح تطبيق البريد الإلكتروني ✉️' });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div 
        className="w-full max-w-5xl bg-[#20140F] border border-amber-900/40 rounded-3xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
        dir="rtl"
      >
        <div className="p-4 bg-[#2A1B14] border-b border-[#432A1F] flex flex-col md:flex-row items-center justify-between gap-3.5 no-print print:hidden">
          <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-600/20 border border-amber-600/40 flex items-center justify-center text-amber-400 shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 flex-wrap">
                  <span>قائمة النقل اليومية المحفوظة وتقرير PDF</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 font-mono">
                    {reportItems.length} صنف
                  </span>
                  {consumableInReportCount > 0 && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-200 font-bold border border-cyan-500/40">
                      🔄 استهلاكية (A/FL): {consumableInReportCount}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-neutral-300">
                  تحفظ قائمة النقل تلقائياً لكل يوم يتم فيه النقل مع الإشارة للقطع الاستهلاكية الموجهة إلى الحرف (A) أو (FL)
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="md:hidden p-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 w-full md:w-auto">
            <div className="flex items-center bg-[#1F1410] p-1 rounded-xl border border-[#432A1F]">
              <button
                type="button"
                onClick={() => setReportScope('moved')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  reportScope === 'moved'
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>المنقولة</span>
              </button>
              <button
                type="button"
                onClick={() => setReportScope('consumables')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  reportScope === 'consumables'
                    ? 'bg-cyan-700 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>استهلاكية (A / FL)</span>
              </button>
              <button
                type="button"
                onClick={() => setReportScope('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  reportScope === 'all'
                    ? 'bg-amber-700 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>الكل</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleShareWhatsApp}
              disabled={isExporting}
              className="px-3.5 py-2 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-md transition-all cursor-pointer active:scale-95"
              title="توليد وتصدير ملف PDF وإرساله مباشرة عبر تطبيق WhatsApp"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
              <span>إرسال PDF عبر واتساب 📲</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-700 to-indigo-800 hover:from-blue-600 hover:to-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-blue-950/60 transition-all cursor-pointer border border-blue-400/40 active:scale-95"
              title="طباعة أو حفظ مباشر كملف PDF نقي"
            >
              <Printer className="w-4 h-4 text-blue-200" />
              <span>طباعة / حفظ PDF 🖨️</span>
            </button>

            <button
              type="button"
              onClick={async () => {
                setIsExporting(true);
                const success = await exportAndShareForEditing(reportItems);
                if (success) {
                  setActionFeedback({ message: 'تم تجهيز ومشاركة تقرير Excel (CSV) القابل للتعديل بنجاح! 📊' });
                  setTimeout(() => setActionFeedback(null), 8000);
                }
                setIsExporting(false);
              }}
              disabled={isExporting}
              className="px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-all cursor-pointer active:scale-95"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
              <span>Excel 📊</span>
            </button>

            <button
              type="button"
              onClick={handleShareEmail}
              disabled={isExporting}
              className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-all cursor-pointer active:scale-95"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              <span>إيميل ✉️</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="hidden md:flex p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
              title="إغلاق ✖️"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* شريط اختيار قوائم النقل اليومية المحفوظة (كل يوم يتم فيه النقل يحفظ تلقائياً) */}
        {(reportScope === 'moved' || reportScope === 'consumables') && (
          <div className="px-4 py-2.5 bg-[#19110D] border-b border-[#432A1F] flex flex-wrap items-center gap-2 no-print print:hidden">
            <span className="text-xs font-black text-amber-300 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              <span>قوائم النقل اليومية المحفوظة ({savedReports.length} يوم):</span>
            </span>

            <button
              type="button"
              onClick={() => setSelectedReportId('ALL_MOVED')}
              className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                selectedReportId === 'ALL_MOVED'
                  ? 'bg-emerald-700 text-white border-emerald-400 shadow-sm'
                  : 'bg-[#251914] text-neutral-300 border-[#3D271F] hover:border-amber-500/50'
              }`}
            >
              كل القطع المنقولة ({dbService.getMovedItems().length})
            </button>

            {savedReports.length === 0 ? (
              <span className="text-[11px] text-neutral-400">
                لا توجد عمليات نقل مسجلة بعد — عند قيامك بأي عملية نقل تُحفظ تلقائياً في قائمة نقل اليوم مع الإشارة للقطع الاستهلاكية (A أو FL)
              </span>
            ) : (
              savedReports.map((rep, idx) => {
                const snaps = rep.transferredItemsSnapshot || [];
                const count = snaps.length || rep.lines.length;
                const consCount = snaps.filter((s) => s.is_consumable === 1).length;
                const label = rep.reportTitle || `قائمة نقل #${idx + 1}`;
                const isSelected = selectedReportId === rep.id;
                return (
                  <button
                    key={rep.id}
                    type="button"
                    onClick={() => setSelectedReportId(rep.id)}
                    className={`px-3 py-1 rounded-lg text-xs font-black border transition-all cursor-pointer flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-amber-600 text-white border-amber-300 shadow-md'
                        : 'bg-[#251914] text-amber-200 border-amber-800/50 hover:bg-[#32211A]'
                    }`}
                  >
                    <span>{label}</span>
                    <span className="px-1.5 py-0.5 rounded bg-black/30 text-[10px] font-mono">
                      {count} قطعة{consCount > 0 ? ` (🔄 ${consCount} استهلاكية)` : ''}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {actionFeedback && (
          <div className="bg-[#1C2826] border-b border-emerald-600/40 px-4 py-2.5 text-xs font-bold text-emerald-200 flex flex-wrap items-center justify-between gap-2 no-print print:hidden animate-in fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{actionFeedback.message}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {actionFeedback.whatsappUrl && (
                <a
                  href={actionFeedback.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 rounded-lg bg-[#25D366] hover:bg-[#1da851] text-white font-black text-[11px] flex items-center gap-1 transition-colors shadow-sm"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>فتح واتساب وإرسال التقرير الآن 📲</span>
                </a>
              )}
              {actionFeedback.downloadUrl && (
                <a
                  href={actionFeedback.downloadUrl}
                  download={actionFeedback.filename || 'قائمة-النقل-اليومية-ASMO.pdf'}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1 transition-colors shadow-sm"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>تحميل / حفظ ملف PDF</span>
                </a>
              )}
            </div>
          </div>
        )}

        <div 
          className="pdf-template pdf-container p-6 md:p-8 overflow-y-auto flex-1 bg-white text-slate-900" 
          id="relocation-printable-report" 
          ref={reportRef}
          style={{ 
            direction: 'rtl', 
            unicodeBidi: 'embed',
            fontFamily: "'Cairo', 'Amiri', 'Tajawal', sans-serif",
            wordSpacing: '4px',
            padding: '24px 28px',
            backgroundColor: '#ffffff',
            color: '#0f172a',
            minHeight: '1080px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            maxWidth: '860px',
            margin: '0 auto',
            width: '100%',
            boxSizing: 'border-box'
          }}
        >
          <div 
            className="report-header"
            style={{ 
              borderBottom: '2px solid #1e3a8a', 
              paddingBottom: '16px', 
              marginBottom: '20px', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              gap: '20px',
              direction: 'rtl',
              unicodeBidi: 'embed'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', direction: 'rtl', flex: '1' }}>
              <div style={{ 
                width: '50px', 
                height: '50px', 
                backgroundColor: '#1e3a8a', 
                color: '#ffffff', 
                borderRadius: '8px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                fontWeight: '900', 
                fontSize: '22px', 
                border: '1px solid #1e3a8a',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                flexShrink: 0
              }}>
                A
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', direction: 'rtl' }}>
                <h1 style={{ 
                  margin: '0 0 2px 0', 
                  fontSize: '24px', 
                  fontWeight: '900', 
                  color: '#1e3a8a', 
                  lineHeight: 1.3,
                  letterSpacing: '0px',
                  fontFamily: "'Cairo', sans-serif"
                }}>
                  ASMO
                </h1>
                <p style={{ 
                  margin: '0', 
                  fontSize: '13px', 
                  color: '#475569', 
                  fontWeight: '600', 
                  lineHeight: 1.5,
                  letterSpacing: '0px',
                  fontFamily: "'Cairo', sans-serif"
                }}>
                  قائمة النقل اليومية المحفوظة وتوجيه القطع الاستهلاكية إلى (A و FL)
                </p>
              </div>
            </div>

            <div 
              className="report-info-box"
              style={{ 
                textAlign: 'right', 
                fontSize: '11px', 
                color: '#334155', 
                backgroundColor: '#ffffff', 
                padding: '8px 10px', 
                borderRadius: '4px', 
                border: '1px solid #cbd5e1', 
                borderTop: '3px solid #1e3a8a',
                minWidth: '240px', 
                lineHeight: 1.6,
                letterSpacing: '0px',
                fontFamily: "'Cairo', sans-serif",
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                flexShrink: 0
              }}
            >
              <div style={{ padding: '4px 8px', borderRadius: '4px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', lineHeight: 1.6 }}>
                <strong style={{ color: '#0f172a' }}>رقم القائمة:</strong>
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#1e3a8a' }}>{reportId}</span>
              </div>
              <div style={{ padding: '4px 8px', borderRadius: '4px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', lineHeight: 1.6 }}>
                <strong style={{ color: '#0f172a' }}>التاريخ:</strong>
                <span style={{ color: '#334155' }}>{currentDate}</span>
              </div>
              <div style={{ padding: '4px 8px', borderRadius: '4px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', lineHeight: 1.6 }}>
                <strong style={{ color: '#0f172a' }}>الوقت:</strong>
                <span style={{ color: '#334155' }}>{currentTime}</span>
              </div>
              <div style={{ 
                padding: '4px 8px', 
                borderRadius: '4px', 
                backgroundColor: '#f1f5f9', 
                color: '#1e3a8a', 
                fontWeight: 'bold', 
                fontSize: '11px',
                textAlign: 'center',
                lineHeight: 1.6,
                border: '1px solid #cbd5e1'
              }}>
                {reportTitleLabel}
              </div>
            </div>
          </div>

          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(4, 1fr)', 
            gap: '12px', 
            marginBottom: '20px', 
            direction: 'rtl',
            unicodeBidi: 'embed'
          }}>
            <div style={{ backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', padding: '12px 14px', borderRadius: '6px', textAlign: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px', lineHeight: 1.4 }}>إجمالي الأصناف</span>
              <strong style={{ fontSize: '18px', color: '#1e3a8a' }}>{reportItems.length} صنف</strong>
            </div>
            <div style={{ backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', padding: '12px 14px', borderRadius: '6px', textAlign: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px', lineHeight: 1.4 }}>القطع الاستهلاكية (A / FL)</span>
              <strong style={{ fontSize: '18px', color: '#0891b2' }}>{consumableInReportCount} صنف</strong>
            </div>
            <div style={{ backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', padding: '12px 14px', borderRadius: '6px', textAlign: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px', lineHeight: 1.4 }}>إجمالي الكمية (QTY)</span>
              <strong style={{ fontSize: '18px', color: '#1e3a8a' }}>{totalQty.toLocaleString()} وحدة</strong>
            </div>
            <div style={{ backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', padding: '12px 14px', borderRadius: '6px', textAlign: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px', lineHeight: 1.4 }}>الكمية المتبقية</span>
              <strong style={{ fontSize: '18px', color: '#0f172a' }}>{remainingQty.toLocaleString()} وحدة</strong>
            </div>
          </div>

          {reportItems.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: '8px', color: '#64748b', margin: '20px 0' }}>
              <p style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 6px 0' }}>لا توجد قطع منقولة من قِبلك حتى الآن</p>
              <p style={{ fontSize: '13px', margin: '0' }}>لا يتم تسجيل أي قطعة كمنقولة إلا عندما تقوم بنقلها بنفسك، وتُحفظ كل عملية نقل تلقائياً في قائمة النقل اليومية مع الإشارة للقطع الاستهلاكية المنقولة إلى حرف (A) أو (FL).</p>
            </div>
          ) : (
            <div style={{ width: '100%', overflowX: 'auto', marginBottom: '20px', flex: '1' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', direction: 'rtl', unicodeBidi: 'embed' }}>
                <thead>
                  <tr style={{ backgroundColor: '#1e3a8a', color: '#ffffff' }}>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', textAlign: 'center', width: '36px', fontWeight: '700', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>#</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', fontWeight: '700', textAlign: 'center', width: '130px', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>رقم القطعة</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', fontWeight: '700', textAlign: 'right', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>اسم / وصف القطعة</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', fontWeight: '700', textAlign: 'center', width: '115px', fontSize: '12px', color: '#ffffff', backgroundColor: '#0e7490' }}>إشارة الاستهلاكية</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', textAlign: 'center', width: '55px', fontWeight: '700', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>الكمية</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', textAlign: 'center', width: '95px', fontWeight: '700', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>الموقع السابق</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', textAlign: 'center', width: '100px', fontWeight: '700', fontSize: '12px', color: '#ffffff', backgroundColor: '#172554' }}>الموقع الجديد (A/FL)</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', textAlign: 'center', width: '90px', fontWeight: '700', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {reportItems.map((item, idx) => {
                    const isMoved =
                      item.is_moved === 1 && (item.status === 'تم النقل' || item.status === 'منقول');
                    const isVerified = item.user_verified === 1 && item.status === 'مدقق';
                    const isCons = isConsumablePart(item);
                    const sz = estimatePartSizeProfile(item);
                    const targetShelfCode = isFLLocation(item.location_code)
                      ? 'FL'
                      : isALocation(item.location_code)
                      ? 'A'
                      : sz.consumableTargetType;
                    const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';

                    return (
                      <tr key={`${item.part_number}-${idx}`} style={{ backgroundColor: rowBg }}>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 'bold', color: '#64748b', border: '1px solid #cbd5e1', fontSize: '11px' }}>
                          {idx + 1}
                        </td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 'bold', color: '#0f172a', textAlign: 'center', border: '1px solid #cbd5e1', fontSize: '11px' }}>
                          {item.part_number}
                        </td>
                        <td style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right', fontSize: '11px' }}>
                          <div style={{ fontWeight: '700', color: '#0f172a', lineHeight: 1.4 }}>{item.description_ar || item.description_en}</div>
                          <div style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace', marginTop: '2px' }} dir="ltr">{item.description_en}</div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', border: '1px solid #cbd5e1', fontSize: '11px' }}>
                          {isCons ? (
                            <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', backgroundColor: '#ecfeff', color: '#0e7490', border: '1px solid #a5f3fc' }}>
                              🔄 استهلاكية (حرف {targetShelfCode})
                            </span>
                          ) : (
                            <span style={{ fontSize: '10px', color: '#64748b' }}>اعتيادية</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 'bold', color: '#0f172a', border: '1px solid #cbd5e1', fontSize: '11px' }}>
                          {item.qty_total}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: 'monospace', color: '#64748b', border: '1px solid #cbd5e1', fontSize: '11px' }}>
                          {item.old_location || '---'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 'bold', color: '#1e3a8a', backgroundColor: '#eff6ff', border: '1px solid #cbd5e1', fontSize: '11px' }}>
                          {item.location_code}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', border: '1px solid #cbd5e1', fontSize: '11px' }}>
                          {isMoved ? (
                            <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '600', backgroundColor: '#eff6ff', color: '#1e3a8a', border: '1px solid #bfdbfe' }}>
                              منقول
                            </span>
                          ) : isVerified ? (
                            <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '600', backgroundColor: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                              مدقق ✓
                            </span>
                          ) : (
                            <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '500', backgroundColor: '#ffffff', color: '#64748b', border: '1px solid #cbd5e1' }}>
                              غير مدقق
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid #cbd5e1', textAlign: 'center', fontSize: '11px', color: '#64748b', lineHeight: 1.5 }}>
            تم إصدار هذا المستند رسمياً عبر نظام إدارة قطع الغيار ASMO — قائمة النقل اليومية المحفوظة
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
          body {
            font-family: 'Cairo', 'Amiri', 'Arial', sans-serif !important;
            direction: rtl !important;
            unicode-bidi: embed !important;
            word-spacing: 4px !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            background: #ffffff !important;
            color: #0f172a !important;
          }
          .report-header {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            margin-bottom: 20px !important;
            direction: rtl !important;
            unicode-bidi: embed !important;
            border-bottom: 2px solid #1e3a8a !important;
          }
          .report-info-box {
            border: 1px solid #cbd5e1 !important;
            border-top: 3px solid #1e3a8a !important;
            background-color: #ffffff !important;
            border-radius: 4px !important;
            padding: 8px !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            font-size: 11px !important;
            direction: rtl !important;
            unicode-bidi: embed !important;
          }
          th {
            background-color: #1e3a8a !important;
            color: #ffffff !important;
            font-weight: 700 !important;
            padding: 8px 10px !important;
            font-size: 12px !important;
            border: 1px solid #1e3a8a !important;
            text-align: center !important;
          }
          tr:nth-child(even) {
            background-color: #f8fafc !important;
          }
          td {
            border: 1px solid #cbd5e1 !important;
            padding: 8px 10px !important;
            color: #334155 !important;
            font-size: 11px !important;
            text-align: center !important;
          }
          .no-print, .print\\:hidden {
            display: none !important;
          }
          #relocation-printable-report {
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            min-height: 270mm !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            direction: rtl !important;
            unicode-bidi: embed !important;
            font-family: 'Cairo', 'Amiri', sans-serif !important;
          }
        }
      `}</style>
    </div>
  );
};
