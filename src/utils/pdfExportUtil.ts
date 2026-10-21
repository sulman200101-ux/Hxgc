import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { InventoryItem, LocationSummary } from '../types';
export { exportAndShareForEditing } from './csvExportUtil';

export interface PdfExportOptions {
  filename?: string;
  title?: string;
  reportElementId: string;
}

/**
 * دالة تطهير وتنظيف المستند وحقن خط Cairo العربي وترميز UTF-8 القياسي
 */
function sanitizeClonedDocumentForHtml2Canvas(clonedDoc: Document) {
  try {
    // 1. إزالة كافة ملفات الأنماط التابعة لـ Tailwind لتجنب تعارضات oklch
    const styleElements = clonedDoc.querySelectorAll('style');
    styleElements.forEach((styleTag) => {
      if (styleTag.textContent) {
        styleTag.textContent = styleTag.textContent
          .replace(/oklch\([^)]+\)/gi, '#e2e8f0')
          .replace(/oklab\([^)]+\)/gi, '#e2e8f0')
          .replace(/letter-spacing:[^;]+;/gi, 'letter-spacing: 0 !important;')
          .replace(/letterSpacing:[^;]+;/gi, 'letter-spacing: 0 !important;');
      }
    });

    const linkElements = clonedDoc.querySelectorAll('link[rel="stylesheet"]');
    linkElements.forEach((link) => link.remove());

    // 2. حقن خط Cairo وترميز UTF-8 القياسي لضمان عدم تشوه أو تقطيع الحروف العربية
    const printTemplateStyle = clonedDoc.createElement('style');
    printTemplateStyle.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Amiri:wght@400;700&family=Noto+Sans+Arabic:wght@400;600;700&display=swap');
      
      * {
        box-sizing: border-box !important;
        letter-spacing: 0 !important;
        word-spacing: 4px !important;
        font-feature-settings: "liga" 1, "calt" 1 !important;
      }
      .pdf-container, body {
        font-family: 'Cairo', 'Noto Sans Arabic', 'Amiri', 'Segoe UI', Tahoma, sans-serif !important;
        direction: rtl !important;
        text-align: right !important;
        word-spacing: 4px !important;
        -webkit-font-smoothing: antialiased !important;
        background-color: #ffffff !important;
        color: #0f172a !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      h1, h2, h3, h4, p, span, div, strong, td, th {
        font-family: 'Cairo', 'Noto Sans Arabic', 'Amiri', 'Segoe UI', Tahoma, sans-serif !important;
        letter-spacing: 0 !important;
        word-spacing: 4px !important;
        direction: rtl !important;
      }
      table {
        width: 100% !important;
        border-collapse: collapse !important;
        font-size: 11px !important;
        margin-top: 12px !important;
        direction: rtl !important;
      }
      th {
        background-color: #1e3a8a !important;
        color: #ffffff !important;
        font-weight: 700 !important;
        border: 1px solid #1e3a8a !important;
        padding: 8px 10px !important;
        text-align: center !important;
        font-size: 12px !important;
      }
      tr:nth-child(even) {
        background-color: #f8fafc !important;
      }
      td {
        border: 1px solid #cbd5e1 !important;
        padding: 8px 10px !important;
        font-size: 11px !important;
        color: #334155 !important;
        text-align: center !important;
      }
      .report-info-box {
        border: 1px solid #cbd5e1 !important;
        border-top: 3px solid #1e3a8a !important;
        background-color: #ffffff !important;
        border-radius: 4px !important;
        padding: 8px !important;
      }
      .no-print { display: none !important; }
    `;
    clonedDoc.head.appendChild(printTemplateStyle);

    // 3. تطهير أي letter-spacing أو تباعد أحرف في العناصر
    const allElements = clonedDoc.querySelectorAll('*');
    allElements.forEach((node) => {
      const htmlEl = node as HTMLElement;
      if (htmlEl.style) {
        htmlEl.style.letterSpacing = '0px';
        if (htmlEl.style.cssText) {
          htmlEl.style.cssText = htmlEl.style.cssText
            .replace(/letter-spacing:[^;]+;/gi, 'letter-spacing: 0px !important;')
            .replace(/oklch\([^)]+\)/gi, '#e2e8f0')
            .replace(/oklab\([^)]+\)/gi, '#e2e8f0');
        }
      }
    });
  } catch (e) {
    console.warn('Document sanitization note:', e);
  }
}

/**
 * دالة لتوليد ملف PDF عالي الدقة من عنصر التقرير بمعايرة A4 متكاملة الأبعاد
 */
export async function generateReportPdfBlob({
  reportElementId,
}: {
  reportElementId: string;
}): Promise<{ pdfBlob: Blob; pdfFile: File; dataUri: string; downloadUrl: string; filename: string }> {
  const element = document.getElementById(reportElementId);
  if (!element) {
    throw new Error('تعذر العثور على عنصر التقرير');
  }

  // التأكد من اكتمال تحميل خط Cairo العربي في المتصفح قبل أخذ اللقطة
  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  } catch (e) {}

  let canvas: HTMLCanvasElement;

  try {
    canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      width: 800,
      windowWidth: 800,
      onclone: (clonedDoc) => {
        sanitizeClonedDocumentForHtml2Canvas(clonedDoc);
        const target = clonedDoc.getElementById(reportElementId);
        if (target) {
          target.style.width = '800px';
          target.style.minHeight = '1130px';
          target.style.boxSizing = 'border-box';
          target.style.display = 'flex';
          target.style.flexDirection = 'column';
          target.style.justifyContent = 'space-between';
          target.style.padding = '35px 30px';
          target.style.margin = '0 auto';
        }
      },
    });
  } catch (err: any) {
    console.warn('html2canvas primary render note, retrying with fallback container:', err);
    canvas = await html2canvas(element, {
      scale: 1.5,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      ignoreElements: (el) => el.tagName === 'STYLE',
    });
  }

  const imgData = canvas.toDataURL('image/jpeg', 0.98);

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const margin = 10;
  const pdfWidth = 210; // A4 width in mm
  const pdfHeight = 297; // A4 height in mm
  const contentWidth = pdfWidth - (margin * 2);
  const contentHeight = (canvas.height * contentWidth) / canvas.width;

  let heightLeft = contentHeight;
  let position = margin;

  pdf.addImage(imgData, 'JPEG', margin, position, contentWidth, contentHeight);
  heightLeft -= (pdfHeight - (margin * 2));

  while (heightLeft > 5) {
    position = heightLeft - contentHeight + margin;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', margin, position, contentWidth, contentHeight);
    heightLeft -= (pdfHeight - (margin * 2));
  }

  const pdfBlob = pdf.output('blob');
  const filename = `تقرير-الاعتماد-ASMO-${new Date().toISOString().slice(0, 10)}.pdf`;
  const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });
  const dataUri = pdf.output('datauristring');
  const downloadUrl = URL.createObjectURL(pdfBlob);

  return { pdfBlob, pdfFile, dataUri, downloadUrl, filename };
}

/**
 * دالة مساعدة عامة لتحويل أي عنصر HTML مباشرة إلى ملف PDF وتنزيله
 */
async function exportHtmlElementToPdf(element: HTMLElement, defaultFilename: string): Promise<File> {
  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  } catch (e) {}

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    windowWidth: 1100,
    onclone: (clonedDoc) => {
      sanitizeClonedDocumentForHtml2Canvas(clonedDoc);
    },
  });

  const imgData = canvas.toDataURL('image/jpeg', 0.98);
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const margin = 10;
  const contentWidth = 210 - (margin * 2);
  const contentHeight = (canvas.height * contentWidth) / canvas.width;

  pdf.addImage(imgData, 'JPEG', margin, margin, contentWidth, contentHeight);

  const pdfBlob = pdf.output('blob');
  const pdfFile = new File([pdfBlob], defaultFilename, { type: 'application/pdf' });

  const downloadUrl = URL.createObjectURL(pdfBlob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = downloadUrl;
  a.download = defaultFilename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  }, 10000);

  return pdfFile;
}

/**
 * 1. تحويل وتصدير تقرير موقع تخزيني بالكامل إلى ملف PDF حقيقي
 */
export async function exportLocationToPdfFile({
  locationCode,
  items,
  summary,
}: {
  locationCode: string;
  items: InventoryItem[];
  summary?: LocationSummary;
}): Promise<File> {
  const container = document.createElement('div');
  container.className = 'pdf-container';
  container.style.position = 'fixed';
  container.style.top = '-9999px';
  container.style.left = '-9999px';
  container.style.width = '1000px';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#0f172a';
  container.style.fontFamily = "'Cairo', sans-serif";
  container.style.direction = 'rtl';
  container.style.padding = '30px';

  const dateStr = new Date().toLocaleDateString('ar-SA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const totalQty = summary?.total_qty || items.reduce((acc, i) => acc + (Number(i.qty_total) || 0), 0);
  const remainingQty = summary?.remaining_qty || items.reduce((acc, i) => acc + (Number(i.qty_remaining) || 0), 0);
  const outQty = summary?.out_qty || items.reduce((acc, i) => acc + (Number(i.qty_out) || 0), 0);

  container.innerHTML = `
    <div style="border-bottom: 2px solid #334155; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; direction: rtl;">
      <div>
        <h1 style="color: #1e293b; margin: 0 0 5px 0; font-size: 22px; font-weight: bold; letter-spacing: 0; line-height: 1.5;">تقرير جرد مخزون موقع: ${locationCode}</h1>
        <p style="color: #64748b; margin: 0; font-size: 13px; letter-spacing: 0; line-height: 1.5;">ASMO</p>
      </div>
      <div style="text-align: right; font-size: 12px; color: #334155; background: #f8fafc; padding: 10px 12px; border-radius: 12px; border: 1px solid #cbd5e1; line-height: 1.6; display: flex; flexDirection: column; gap: 6px; min-width: 220px;">
        <div style="padding: 8px 10px; border-radius: 8px; background-color: #ffffff; border: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; line-height: 1.6;">
          <strong style="color: #0f172a;">التاريخ:</strong>
          <span>${dateStr}</span>
        </div>
        <div style="padding: 8px 10px; border-radius: 8px; background-color: #ffffff; border: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; line-height: 1.6;">
          <strong style="color: #0f172a;">عدد الأصناف:</strong>
          <span style="font-weight: bold; color: #0f172a;">${items.length} صنف</span>
        </div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 25px; direction: rtl;">
      <div style="background: #f8fafc; border: 1px solid #d1d5db; padding: 12px; border-radius: 8px; text-align: center;">
        <span style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">إجمالي الأصناف</span>
        <strong style="font-size: 18px; color: #0f172a;">${items.length}</strong>
      </div>
      <div style="background: #f8fafc; border: 1px solid #d1d5db; padding: 12px; border-radius: 8px; text-align: center;">
        <span style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">إجمالي المخزون</span>
        <strong style="font-size: 18px; color: #d97706;">${totalQty.toLocaleString()}</strong>
      </div>
      <div style="background: #f8fafc; border: 1px solid #d1d5db; padding: 12px; border-radius: 8px; text-align: center;">
        <span style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">الكمية الخارجة</span>
        <strong style="font-size: 18px; color: #ea580c;">${outQty.toLocaleString()}</strong>
      </div>
      <div style="background: #f8fafc; border: 1px solid #d1d5db; padding: 12px; border-radius: 8px; text-align: center;">
        <span style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">الكمية المتبقية</span>
        <strong style="font-size: 18px; color: #059669;">${remainingQty.toLocaleString()}</strong>
      </div>
    </div>

    <table style="width: 100%; border-collapse: collapse; font-size: 13px; direction: rtl;">
      <thead>
        <tr style="background-color: #f1f5f9; color: #1e293b;">
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center; width: 40px;">#</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center; width: 140px;">رقم القطعة (Part No)</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: right;">الوصف المعرب</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: right;">التصنيف</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">المخزون</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">الخارج</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">المتبقي</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">حالة النقل</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item, idx) => {
          const isMoved = item.is_moved === 1 || item.status === 'تم النقل' || item.status === 'منقول';
          const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
          const statusHtml = isMoved
            ? '<span style="background: #dcfce7; color: #15803d; padding: 4px 8px; border-radius: 12px; font-weight: bold; font-size: 11px; border: 1px solid #86efac;">🟢 تم النقل</span>'
            : '<span style="background: #fef3c7; color: #b45309; padding: 4px 8px; border-radius: 12px; font-weight: bold; font-size: 11px; border: 1px solid #fde68a;">🟠 لم تنتقل</span>';
          return `
            <tr style="background-color: ${bg};">
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center; font-weight: bold;">${idx + 1}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db; font-weight: bold; font-family: monospace; text-align: center;">${item.part_number}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db;">
                <div style="font-weight: bold;">${item.description_ar}</div>
                <div style="color: #64748b; font-size: 11px;">${item.description_en}</div>
              </td>
              <td style="padding: 10px; border: 1px solid #d1d5db;">${item.category}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center; font-weight: bold;">${item.qty_total}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center; color: #ea580c;">${item.qty_out}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center; font-weight: bold; color: #059669;">${item.qty_remaining}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">${statusHtml}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  document.body.appendChild(container);
  try {
    const filename = `تقرير-جرد-موقع-${locationCode}-أسمو-${new Date().toISOString().slice(0, 10)}.pdf`;
    const pdfFile = await exportHtmlElementToPdf(container, filename);
    return pdfFile;
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * 2. تحويل وتصدير تقرير صنف/تصنيف بالكامل إلى ملف PDF حقيقي
 */
export async function exportCategoryToPdfFile({
  categoryName,
  items,
}: {
  categoryName: string;
  items: InventoryItem[];
}): Promise<File> {
  const container = document.createElement('div');
  container.className = 'pdf-container';
  container.style.position = 'fixed';
  container.style.top = '-9999px';
  container.style.left = '-9999px';
  container.style.width = '1000px';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#0f172a';
  container.style.fontFamily = "'Cairo', sans-serif";
  container.style.direction = 'rtl';
  container.style.padding = '30px';

  const dateStr = new Date().toLocaleDateString('ar-SA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const totalQty = items.reduce((acc, i) => acc + (Number(i.qty_total) || 0), 0);
  const remainingQty = items.reduce((acc, i) => acc + (Number(i.qty_remaining) || 0), 0);

  container.innerHTML = `
    <div style="border-bottom: 2px solid #334155; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; direction: rtl;">
      <div>
        <h1 style="color: #1e293b; margin: 0 0 5px 0; font-size: 22px; font-weight: bold; letter-spacing: 0; line-height: 1.5;">تقرير حركة وتوزيع تصنيف: ${categoryName}</h1>
        <p style="color: #64748b; margin: 0; font-size: 13px; letter-spacing: 0; line-height: 1.5;">ASMO</p>
      </div>
      <div style="text-align: left; font-size: 12px; color: #475569; background: #f8fafc; padding: 10px 14px; border-radius: 8px; border: 1px solid #d1d5db; line-height: 1.5;">
        <div><strong>التاريخ:</strong> ${dateStr}</div>
        <div><strong>عدد القطع:</strong> ${items.length} صنف</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 25px; direction: rtl;">
      <div style="background: #f8fafc; border: 1px solid #d1d5db; padding: 12px; border-radius: 8px; text-align: center;">
        <span style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">عدد الأصناف</span>
        <strong style="font-size: 18px; color: #0f172a;">${items.length}</strong>
      </div>
      <div style="background: #f8fafc; border: 1px solid #d1d5db; padding: 12px; border-radius: 8px; text-align: center;">
        <span style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">إجمالي المخزون</span>
        <strong style="font-size: 18px; color: #d97706;">${totalQty.toLocaleString()}</strong>
      </div>
      <div style="background: #f8fafc; border: 1px solid #d1d5db; padding: 12px; border-radius: 8px; text-align: center;">
        <span style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">الكمية المتبقية</span>
        <strong style="font-size: 18px; color: #059669;">${remainingQty.toLocaleString()}</strong>
      </div>
    </div>

    <table style="width: 100%; border-collapse: collapse; font-size: 13px; direction: rtl;">
      <thead>
        <tr style="background-color: #f1f5f9; color: #1e293b;">
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center; width: 40px;">#</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center; width: 140px;">رقم القطعة</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: right;">الوصف المعرب</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">الموقع الحالي</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">المتبقي</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">حالة النقل</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item, idx) => {
          const isMoved = item.is_moved === 1 || item.status === 'تم النقل' || item.status === 'منقول';
          const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
          const statusHtml = isMoved
            ? '<span style="background: #dcfce7; color: #15803d; padding: 4px 8px; border-radius: 12px; font-weight: bold; font-size: 11px; border: 1px solid #86efac;">🟢 تم النقل</span>'
            : '<span style="background: #fef3c7; color: #b45309; padding: 4px 8px; border-radius: 12px; font-weight: bold; font-size: 11px; border: 1px solid #fde68a;">🟠 لم تنتقل</span>';
          return `
            <tr style="background-color: ${bg};">
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center; font-weight: bold;">${idx + 1}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db; font-weight: bold; font-family: monospace; text-align: center;">${item.part_number}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db;">
                <div style="font-weight: bold;">${item.description_ar}</div>
                <div style="color: #64748b; font-size: 11px;">${item.description_en}</div>
              </td>
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center; font-family: monospace;">${item.location_code}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center; font-weight: bold; color: #059669;">${item.qty_remaining}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">${statusHtml}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  document.body.appendChild(container);
  try {
    const cleanCat = categoryName.replace(/\s+/g, '-');
    const filename = `تقرير-تصنيف-${cleanCat}-أسمو-${new Date().toISOString().slice(0, 10)}.pdf`;
    const pdfFile = await exportHtmlElementToPdf(container, filename);
    return pdfFile;
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * 3. تحويل وتصدير جدول الأصناف الشامل بالكامل إلى ملف PDF حقيقي
 */
export async function exportInventoryListToPdfFile({
  items,
  title = 'تقرير الجرد الشامل للأصناف',
}: {
  items: InventoryItem[];
  title?: string;
}): Promise<File> {
  const container = document.createElement('div');
  container.className = 'pdf-container';
  container.style.position = 'fixed';
  container.style.top = '-9999px';
  container.style.left = '-9999px';
  container.style.width = '1000px';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#0f172a';
  container.style.fontFamily = "'Cairo', sans-serif";
  container.style.direction = 'rtl';
  container.style.padding = '30px';

  const dateStr = new Date().toLocaleDateString('ar-SA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const totalQty = items.reduce((acc, i) => acc + (Number(i.qty_total) || 0), 0);
  const remainingQty = items.reduce((acc, i) => acc + (Number(i.qty_remaining) || 0), 0);

  container.innerHTML = `
    <div style="border-bottom: 2px solid #334155; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; direction: rtl;">
      <div>
        <h1 style="color: #1e293b; margin: 0 0 5px 0; font-size: 22px; font-weight: bold; letter-spacing: 0; line-height: 1.5;">${title}</h1>
        <p style="color: #64748b; margin: 0; font-size: 13px; letter-spacing: 0; line-height: 1.5;">ASMO</p>
      </div>
      <div style="text-align: left; font-size: 12px; color: #475569; background: #f8fafc; padding: 10px 14px; border-radius: 8px; border: 1px solid #d1d5db; line-height: 1.5;">
        <div><strong>التاريخ:</strong> ${dateStr}</div>
        <div><strong>إجمالي الأصناف:</strong> ${items.length} صنف</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 25px; direction: rtl;">
      <div style="background: #f8fafc; border: 1px solid #d1d5db; padding: 12px; border-radius: 8px; text-align: center;">
        <span style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">عدد الأصناف</span>
        <strong style="font-size: 18px; color: #0f172a;">${items.length}</strong>
      </div>
      <div style="background: #f8fafc; border: 1px solid #d1d5db; padding: 12px; border-radius: 8px; text-align: center;">
        <span style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">إجمالي المخزون</span>
        <strong style="font-size: 18px; color: #d97706;">${totalQty.toLocaleString()}</strong>
      </div>
      <div style="background: #f8fafc; border: 1px solid #d1d5db; padding: 12px; border-radius: 8px; text-align: center;">
        <span style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">الكمية المتبقية</span>
        <strong style="font-size: 18px; color: #059669;">${remainingQty.toLocaleString()}</strong>
      </div>
    </div>

    <table style="width: 100%; border-collapse: collapse; font-size: 13px; direction: rtl;">
      <thead>
        <tr style="background-color: #f1f5f9; color: #1e293b;">
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center; width: 38px;">#</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center; width: 140px;">رقم القطعة</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: right;">الوصف المعرب</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">الموقع</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: right;">التصنيف</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">المخزون</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">المتبقي</th>
          <th style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">الحالة</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item, idx) => {
          const isMoved = item.is_moved === 1 || item.status === 'تم النقل' || item.status === 'منقول';
          const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
          const statusHtml = isMoved
            ? '<span style="background: #dcfce7; color: #15803d; padding: 4px 8px; border-radius: 12px; font-weight: bold; font-size: 11px; border: 1px solid #86efac;">🟢 منقول</span>'
            : '<span style="background: #fef3c7; color: #b45309; padding: 4px 8px; border-radius: 12px; font-weight: bold; font-size: 11px; border: 1px solid #fde68a;">🟠 لم تنتقل</span>';
          return `
            <tr style="background-color: ${bg};">
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center; font-weight: bold;">${idx + 1}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db; font-weight: bold; font-family: monospace; text-align: center;">${item.part_number}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db;">
                <div style="font-weight: bold;">${item.description_ar}</div>
                <div style="color: #64748b; font-size: 11px;">${item.description_en}</div>
              </td>
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center; font-family: monospace; font-weight: bold;">${item.location_code}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db;">${item.category}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center; font-weight: bold;">${item.qty_total}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center; font-weight: bold; color: #059669;">${item.qty_remaining}</td>
              <td style="padding: 10px; border: 1px solid #d1d5db; text-align: center;">${statusHtml}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  document.body.appendChild(container);
  try {
    const filename = `تقرير-الجرد-الشامل-أسمو-${new Date().toISOString().slice(0, 10)}.pdf`;
    const pdfFile = await exportHtmlElementToPdf(container, filename);
    return pdfFile;
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * 4. مشاركة وتصدير ملف PDF مباشرة عبر WhatsApp أو البريد مع حفظ وتنزيل الملف فوراً
 */
export async function sharePdfFile({
  reportElementId,
  title,
  text,
  targetApp,
}: {
  reportElementId: string;
  title: string;
  text: string;
  targetApp?: 'whatsapp' | 'email' | 'any';
}): Promise<{ sharedViaFile: boolean; filename: string; downloadUrl: string }> {
  const { pdfBlob, pdfFile, downloadUrl, filename } = await generateReportPdfBlob({ reportElementId });

  // تنزيل ملف الـ PDF فوراً للجهاز لضمان حفظه وجاهزيته للإرفاق
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
  }, 10000);

  // محاولة المشاركة كملف PDF مباشر عبر Web Share API
  if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
    try {
      await navigator.share({
        files: [pdfFile],
        title,
        text,
      });
      return { sharedViaFile: true, filename, downloadUrl };
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.warn('File share note:', e);
      }
    }
  }

  // Fallback: فتح التطبيق المستهدف مباشرة مع توجيه الرابط
  if (targetApp === 'whatsapp') {
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(
      text + `\n\n📄 تم تصدير وتنزيل ملف التقرير PDF باسم: [${filename}] جاهزاً للإرفاق.`
    )}`;
    window.open(whatsappUrl, '_blank');
  } else if (targetApp === 'email') {
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(
      text + `\n\n📄 مرفق طيه ملف التقرير بصيغة PDF باسم: [${filename}].`
    )}`;
    window.location.href = mailtoUrl;
  }

  return { sharedViaFile: false, filename, downloadUrl };
}
