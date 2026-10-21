import React, { useRef, useState, useMemo, useEffect } from 'react';
import { InventoryItem } from '../types';
import { dbService } from '../services/db';
import { generateReportPdfBlob, sharePdfFile } from '../utils/pdfExportUtil';
import { exportAndShareForEditing } from '../utils/csvExportUtil';
import { 
  Printer, 
  X, 
  CheckCircle2, 
  Building2, 
  Calendar, 
  FileText, 
  UserCheck, 
  ShieldCheck, 
  MessageCircle, 
  Mail, 
  Share2, 
  Loader2,
  Filter,
  ArrowRightLeft,
  Layers,
  FileDown,
  ExternalLink,
  Download
} from 'lucide-react';

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
  const [actionFeedback, setActionFeedback] = useState<{ message: string; downloadUrl?: string; filename?: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  
  // خيار نطاق التقرير: القطع المنقولة أو كافة قطع الجرد
  const [reportScope, setReportScope] = useState<'moved' | 'all'>('moved');
  const [reportItems, setReportItems] = useState<InventoryItem[]>([]);

  // استعلام مباشر من قاعدة البيانات المحلية عند فتح الواجهة
  useEffect(() => {
    if (isOpen) {
      const movedFromDb = dbService.getMovedItems();
      const allFromDb = dbService.getAllItems();

      if (reportScope === 'moved') {
        if (movedFromDb.length > 0) {
          setReportItems(movedFromDb);
        } else if (propMovedItems && propMovedItems.length > 0) {
          setReportItems(propMovedItems);
        } else {
          setReportItems(allFromDb);
        }
      } else {
        setReportItems(allFromDb);
      }
    }
  }, [isOpen, reportScope, propMovedItems]);

  const currentDate = new Date().toLocaleDateString('ar-SA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const currentTime = new Date().toLocaleTimeString('ar-SA', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // حساب الإجماليات بشكل ديناميكي
  const totalQty = useMemo(() => {
    return reportItems.reduce((acc, i) => acc + (Number(i.qty_total) || 0), 0);
  }, [reportItems]);

  const remainingQty = useMemo(() => {
    return reportItems.reduce((acc, i) => acc + (Number(i.qty_remaining) || 0), 0);
  }, [reportItems]);

  const reportId = useMemo(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `REL-${year}${month}${day}-${reportItems.length || '0'}`;
  }, [reportItems.length]);

  if (!isOpen) return null;

  // استخدام طباعة المتصفح المباشرة (الحل الأضمن والأعلى دقة لنصوص عربية فكتور نقية 100%)
  const handlePrint = () => {
    window.print();
  };

  // 1. تصدير ومشاركة PDF عبر الواتساب 📲
  const handleShareWhatsApp = async () => {
    setIsExporting(true);
    setActionFeedback({ message: 'جاري توليد ملف PDF وتجهيز المشاركة عبر واتساب... 📲' });
    try {
      const intro = `📋 *مرفق تقرير نقل القطع الميداني رقم [${reportId}] للاعتماد في النظام الشامل*\n\n` +
        `🏢 *ASMO - إدارة المستودعات*\n` +
        `📅 التاريخ: ${currentDate} • ${currentTime}\n` +
        `📦 عدد الأصناف المدرجة: ${reportItems.length} صنف\n` +
        `🔢 إجمالي الكمية: ${totalQty} وحدة\n\n` +
        `*بيان حركة النقل الميداني للمواقع الجديدة:*\n`;

      const rows = reportItems.slice(0, 12).map((item, idx) => {
        return `${idx + 1}) القطعة: *${item.part_number}*\n` +
               `   الوصف: ${item.description_ar || item.description_en}\n` +
               `   الكمية: ${item.qty_total} | من: [${item.old_location || 'الموقع السابق'}] ⬅ إلى: [${item.location_code}]\n` +
               `   الحالة: تم النقل (${item.moved_at || 'الآن'})`;
      }).join('\n\n');

      const extra = reportItems.length > 12 ? `\n\n... بالإضافة إلى ${reportItems.length - 12} أصناف أخرى مدرجة في ملف الـ PDF المرفق.` : '';

      const outro = `\n\n✅ يرجى التكرم بالاعتماد ورصد المواقع الجديدة في النظام الشامل.\n` +
                    `رابط المنظومة: ${window.location.origin}`;

      const res = await sharePdfFile({
        reportElementId: 'relocation-printable-report',
        title: `تقرير نقل القطع الميداني - ASMO [${reportId}]`,
        text: intro + rows + extra + outro,
        targetApp: 'whatsapp',
      });

      setActionFeedback({
        message: `تم تصدير وحفظ ملف PDF (${res.filename}) بنجاح وجاري فتح واتساب! 📲`,
        downloadUrl: res.downloadUrl,
        filename: res.filename,
      });
      setTimeout(() => setActionFeedback(null), 8000);
    } catch (e: any) {
      console.error(e);
      setActionFeedback({ message: 'تم فتح تطبيق واتساب بنص التقرير 📲' });
    } finally {
      setIsExporting(false);
    }
  };

  // 2. تصدير وإرسال PDF عبر الإيميل ✉️
  const handleShareEmail = async () => {
    setIsExporting(true);
    setActionFeedback({ message: 'جاري توليد ملف PDF وتجهيز الإيميل... ✉️' });
    try {
      const subject = `تقرير نقل القطع الميداني - للاعتماد في النظام الشامل (ASMO) [${reportId}]`;

      const intro = `السلام عليكم ورحمة الله وبركاته،\n\n` +
        `سعادة المشرف العام / إدارة المستودعات المحترمين،\n\n` +
        `مرفق طيه تقرير نقل القطع الميداني رقم [${reportId}] كملف PDF رسمي للاعتماد والرصد في النظام الشامل بشركة ASMO.\n\n` +
        `بيانات التقرير الملخصة:\n` +
        `- رقم التقرير: ${reportId}\n` +
        `- تاريخ ووقت الإصدار: ${currentDate} - ${currentTime}\n` +
        `- إجمالي القطع: ${reportItems.length} صنف\n` +
        `- إجمالي الكميات: ${totalQty} وحدة\n\n` +
        `قائمة القطع المعتمدة:\n` +
        `----------------------------------------------------------------------\n`;

      const rows = reportItems.map((item, idx) => {
        return `${idx + 1}. رقم القطعة: ${item.part_number}\n` +
               `   الوصف: ${item.description_ar || item.description_en}\n` +
               `   الموقع القديم: ${item.old_location || '---'}\n` +
               `   الموقع الجديد: ${item.location_code}\n` +
               `   الكمية (QTY): ${item.qty_total}\n` +
               `   وقت النقل: ${item.moved_at || currentDate}\n` +
               `   حالة النقل: تم النقل`;
      }).join('\n\n');

      const outro = `\n----------------------------------------------------------------------\n\n` +
        `يرجى التكرم بمراجعة البيانات والملف المرفق وتأكيد اعتماد رصد المواقع على النظام الشامل.\n\n` +
        `وتقبلوا خالص التحية والتقدير،\n` +
        `مسؤول جرد المستودعات - ASMO\n` +
        `رابط المعاينة: ${window.location.origin}`;

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
        {/* Top Controls Bar (Hidden during print) */}
        <div className="p-4 bg-[#2A1B14] border-b border-[#432A1F] flex flex-col md:flex-row items-center justify-between gap-3.5 no-print print:hidden">
          {/* Right: Title & Count Badge */}
          <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-600/20 border border-amber-600/40 flex items-center justify-center text-amber-400 shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  تقرير الاعتماد (PDF Report)
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 font-mono">
                    {reportItems.length} صنف
                  </span>
                </h2>
                <p className="text-xs text-neutral-300">
                  تصدير وطباعة تقرير رسمي نقي بدقة A4 للاعتماد والرصد في النظام الشامل
                </p>
              </div>
            </div>

            {/* Mobile close button */}
            <button
              type="button"
              onClick={onClose}
              className="md:hidden p-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Center & Actions: Direct Print/PDF + WhatsApp + Email + Close */}
          <div className="flex flex-wrap items-center justify-center gap-2 w-full md:w-auto">
            {/* أزرار التبديل بين القطع المنقولة وكافة القطع */}
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

            {/* 🌟 الزر الأساسي الأضمن والأعلى دقة: طباعة / حفظ كـ PDF نقي عبر المتصفح 🌟 */}
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-700 to-indigo-800 hover:from-blue-600 hover:to-indigo-700 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-950/60 transition-all cursor-pointer border border-blue-400/40 active:scale-95"
              title="طباعة أو حفظ مباشر كملف PDF نقي وفكتور عالي الجودة عبر المتصفح"
            >
              <Printer className="w-4 h-4 text-blue-200" />
              <span>طباعة / حفظ كـ PDF نقي 🖨️</span>
            </button>

            {/* زر تصدير ومشاركة Excel القابل للتعديل 📊 */}
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
              className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-all cursor-pointer active:scale-95"
              title="تصدير ومشاركة تقرير الجرد كملف Excel CSV قابل للتعديل"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
              <span>مشاركة Excel 📊</span>
            </button>

            {/* زر تصدير ومشاركة PDF عبر الواتساب 📲 */}
            <button
              type="button"
              onClick={handleShareWhatsApp}
              disabled={isExporting}
              className="px-3 py-2 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-all cursor-pointer active:scale-95"
              title="توليد وتصدير ملف PDF ومشاركته مباشرة عبر تطبيق WhatsApp"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
              <span>واتساب 📲</span>
            </button>

            {/* زر تصدير وإرسال PDF عبر الإيميل ✉️ */}
            <button
              type="button"
              onClick={handleShareEmail}
              disabled={isExporting}
              className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-all cursor-pointer active:scale-95"
              title="توليد وتصدير ملف PDF وتجهيز رسالة الإيميل للمشرف"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              <span>إيميل ✉️</span>
            </button>

            {/* إغلاق ✖️ */}
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

        {/* Action feedback banner with direct PDF download link */}
        {actionFeedback && (
          <div className="bg-[#1C2826] border-b border-emerald-600/40 px-4 py-2.5 text-xs font-bold text-emerald-200 flex flex-wrap items-center justify-between gap-2 no-print print:hidden animate-in fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{actionFeedback.message}</span>
            </div>
            {actionFeedback.downloadUrl && (
              <a
                href={actionFeedback.downloadUrl}
                download={actionFeedback.filename || 'تقرير-الاعتماد-ASMO.pdf'}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1 transition-colors shadow-sm"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>تحميل / حفظ ملف PDF مرة أخرى</span>
              </a>
            )}
          </div>
        )}

        {/* Printable Document Body: Solid & Clean Full A4 Corporate PDF Template */}
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
          {/* 1. Header (Corporate Palette: #1e3a8a / #0f172a) */}
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
            {/* الطرف الأيمن: الشعار + اسم ASMO + وصف التقرير */}
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
                  تقرير حركة ونقل القطع الميداني
                </p>
              </div>
            </div>

            {/* الطرف الأيسر: مربع البيانات العلوي (report-info-box) */}
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
                <strong style={{ color: '#0f172a' }}>رقم التقرير:</strong>
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
                {reportScope === 'moved' ? 'بيان حركة القطع المنقولة' : 'بيان جرد الأصناف الشامل'}
              </div>
            </div>
          </div>

          {/* 2. Summary Cards (حد خارجي #e2e8f0 مع خلفية #f1f5f9 وأرقام بالكحلي #1e3a8a / #0f172a) */}
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
              <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px', lineHeight: 1.4 }}>إجمالي الكمية (QTY)</span>
              <strong style={{ fontSize: '18px', color: '#1e3a8a' }}>{totalQty.toLocaleString()} وحدة</strong>
            </div>
            <div style={{ backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', padding: '12px 14px', borderRadius: '6px', textAlign: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px', lineHeight: 1.4 }}>الكمية المتبقية</span>
              <strong style={{ fontSize: '18px', color: '#0f172a' }}>{remainingQty.toLocaleString()} وحدة</strong>
            </div>
            <div style={{ backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', padding: '12px 14px', borderRadius: '6px', textAlign: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px', lineHeight: 1.4 }}>الجهة المصدرة</span>
              <strong style={{ fontSize: '13px', color: '#1e3a8a' }}>إدارة المستودعات</strong>
            </div>
          </div>

          {/* 3. Official Clean Table with Zebra Striping and Corporate Header */}
          {reportItems.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: '8px', color: '#64748b', margin: '20px 0' }}>
              <p style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 6px 0' }}>لا توجد قطع مطابقة حالياً في السجل</p>
              <p style={{ fontSize: '13px', margin: '0' }}>قم بنقل القطع أو اختر خيار "كافة قطع الجرد" لعرض التقرير.</p>
            </div>
          ) : (
            <div style={{ width: '100%', overflowX: 'auto', marginBottom: '20px', flex: '1' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', direction: 'rtl', unicodeBidi: 'embed' }}>
                <thead>
                  <tr style={{ backgroundColor: '#1e3a8a', color: '#ffffff' }}>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', textAlign: 'center', width: '38px', fontWeight: '700', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>#</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', fontWeight: '700', textAlign: 'center', width: '150px', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>رقم القطعة (Part No)</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', fontWeight: '700', textAlign: 'right', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>اسم / وصف القطعة</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', textAlign: 'center', width: '60px', fontWeight: '700', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>الكمية</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', textAlign: 'center', width: '105px', fontWeight: '700', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>الموقع السابق</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', textAlign: 'center', width: '105px', fontWeight: '700', fontSize: '12px', color: '#ffffff', backgroundColor: '#172554' }}>الموقع الجديد</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', textAlign: 'center', width: '105px', fontWeight: '700', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>وقت التحديث</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #1e3a8a', textAlign: 'center', width: '95px', fontWeight: '700', fontSize: '12px', color: '#ffffff', backgroundColor: '#1e3a8a' }}>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {reportItems.map((item, idx) => {
                    const isMoved = item.is_moved === 1 || item.status === 'تم النقل' || item.status === 'منقول';
                    const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';

                    return (
                      <tr key={item.part_number} style={{ backgroundColor: rowBg }}>
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
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 'bold', color: '#0f172a', border: '1px solid #cbd5e1', fontSize: '11px' }}>
                          {item.qty_total}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: 'monospace', color: '#64748b', border: '1px solid #cbd5e1', fontSize: '11px' }}>
                          {item.old_location || '---'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 'bold', color: '#1e3a8a', backgroundColor: '#eff6ff', border: '1px solid #cbd5e1', fontSize: '11px' }}>
                          {item.location_code}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: '10px', color: '#64748b', border: '1px solid #cbd5e1' }}>
                          {item.moved_at || currentDate}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', border: '1px solid #cbd5e1', fontSize: '11px' }}>
                          {isMoved ? (
                            <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '600', backgroundColor: '#eff6ff', color: '#1e3a8a', border: '1px solid #bfdbfe' }}>
                              تم النقل
                            </span>
                          ) : (
                            <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '500', backgroundColor: '#ffffff', color: '#64748b', border: '1px solid #cbd5e1' }}>
                              {item.status || 'مضاف'}
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

          {/* Footer */}
          <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid #cbd5e1', textAlign: 'center', fontSize: '11px', color: '#64748b', lineHeight: 1.5 }}>
            تم إصدار هذا المستند رسمياً عبر نظام إدارة قطع الغيار ASMO
          </div>
        </div>
      </div>

      {/* Strict CSS for A4 PDF Print Template */}
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
