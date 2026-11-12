import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { InventoryItem, LocationSummary } from '../types';
import { isConsumablePart, isFLLocation, isALocation } from '../services/transferSuggestions';
export { exportAndShareForEditing } from './csvExportUtil';

export interface PdfExportOptions {
  filename?: string;
  title?: string;
  reportElementId: string;
}

export type PdfProgress = (done: number, total: number) => void;

let fontData: Promise<string> | undefined;
let exporting = false;

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

async function arabicFont(): Promise<string> {
  fontData ??= fetch('/fonts/Amiri-Regular.ttf')
    .then(async (response) => {
      if (!response.ok) throw new Error('تعذر تحميل الخط العربي المحلي');
      return base64(new Uint8Array(await response.arrayBuffer()));
    })
    .catch((error) => {
      fontData = undefined;
      throw error;
    });
  return fontData;
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function progress(done: number, total: number, callback?: PdfProgress) {
  callback?.(done, total);
  window.dispatchEvent(new CustomEvent('asmo-pdf-progress', { detail: { done, total } }));
}

function getStrictItemStatusLabel(item: InventoryItem): string {
  if (item.is_missing === 1 || item.status === 'غير موجودة' || item.status === 'مفقود') {
    return '× غير موجودة';
  }
  const parts: string[] = [];
  if (item.user_verified === 1 && item.status === 'مدقق') {
    parts.push('✓ مدقق');
  } else {
    parts.push('غير مدقق');
  }
  if (item.is_moved === 1 && (item.status === 'منقول' || item.status === 'تم النقل')) {
    parts.push(`منقول من ${item.old_location || 'السابق'}`);
  }
  if (isConsumablePart(item)) {
    const targetShelf = isFLLocation(item.location_code)
      ? 'FL'
      : isALocation(item.location_code)
      ? 'A'
      : 'A/FL';
    parts.push(`استهلاكية (${targetShelf})`);
  }
  return parts.join(' | ');
}

export function buildInventoryWhatsAppSummary(
  items: InventoryItem[],
  title: string,
  filename?: string
): string {
  const dateStr = new Date().toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const totalQty = items.reduce((acc, i) => acc + (Number(i.qty_remaining) || 0), 0);
  const consumableCount = items.filter((i) => isConsumablePart(i)).length;
  const movedCount = items.filter(
    (i) => i.is_moved === 1 && (i.status === 'منقول' || i.status === 'تم النقل')
  ).length;
  const verifiedCount = items.filter((i) => i.user_verified === 1 && i.status === 'مدقق').length;

  const headerLines = [
    `📋 *${title}*`,
    `🏭 مستودع قطع الغيار — أسمو (ASMO)`,
    `📅 التاريخ: ${dateStr}`,
    `📦 إجمالي الأصناف: *${items.length}* صنف (المتبقي: *${totalQty}* وحدة)`,
    consumableCount > 0 ? `🔄 القطع الاستهلاكية (إلى A أو FL): *${consumableCount}* صنف` : '',
    movedCount > 0 ? `🟢 القطع المنقولة من قِبل المستخدم: *${movedCount}* صنف` : '',
    verifiedCount > 0 ? `✅ القطع المدققة من قِبل المستخدم: *${verifiedCount}* صنف` : '',
    filename ? `📎 مرفق ملف PDF: *${filename}*` : '',
    `━━━━━━━━━━━━━━━━━━━━`,
  ]
    .filter(Boolean)
    .join('\n');

  const previewRows = items
    .slice(0, 20)
    .map((item, idx) => {
      const consTag = isConsumablePart(item) ? ' [🔄 استهلاكية ⬅ A/FL]' : '';
      const moveTag =
        item.is_moved === 1 && (item.status === 'منقول' || item.status === 'تم النقل')
          ? ` (منقول من ${item.old_location || 'السابق'} ⬅ ${item.location_code})`
          : ` [${item.location_code}]`;
      const auditTag =
        item.is_missing === 1 || item.status === 'غير موجودة'
          ? '× غير موجودة'
          : item.user_verified === 1 && item.status === 'مدقق'
          ? '✓ مدقق'
          : 'غير مدقق';
      return (
        `${idx + 1}) *${item.part_number}*${consTag}\n` +
        `   🔹 ${item.description_ar || item.description_en}\n` +
        `   📍 الموقع: *${ moveTag.trim() }* | المتبقي: *${item.qty_remaining}* | الحالة: ${auditTag}`
      );
    })
    .join('\n\n');

  const extra =
    items.length > 20
      ? `\n\n... بالإضافة إلى *${items.length - 20}* صنفاً آخر مدرجاً بالكامل في ملف الـ PDF المرفق.`
      : '';

  return `${headerLines}\n${previewRows}${extra}`;
}

export async function createTablePdf({
  title,
  headers,
  rows,
  filename,
  onProgress,
}: {
  title: string;
  headers: string[];
  rows: string[][];
  filename: string;
  onProgress?: PdfProgress;
}): Promise<File> {
  if (exporting) throw new Error('يوجد تقرير قيد التصدير؛ انتظر اكتماله');
  exporting = true;
  try {
    progress(0, rows.length, onProgress);
    await pause();
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    pdf.addFileToVFS('Amiri.ttf', await arabicFont());
    pdf.addFont('Amiri.ttf', 'Amiri', 'normal');
    pdf.setFont('Amiri');
    pdf.setFontSize(13);
    const width = pdf.internal.pageSize.getWidth();
    const height = pdf.internal.pageSize.getHeight();
    pdf.text(title, width - 10, 12, { align: 'right' });
    pdf.setFontSize(9);
    pdf.text(
      `Records: ${rows.length} | ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })}`,
      width - 10,
      19,
      { align: 'right' }
    );
    let startY = 24;
    for (let start = 0; start < Math.max(rows.length, 1); start += 40) {
      if (startY > height - 32) {
        pdf.addPage();
        startY = 12;
      }
      autoTable(pdf, {
        head: [headers],
        body: rows.slice(start, start + 40),
        startY,
        margin: { top: 12, bottom: 14, left: 9, right: 9 },
        styles: {
          font: 'Amiri',
          fontStyle: 'normal',
          fontSize: 8,
          cellPadding: 1.4,
          overflow: 'linebreak',
          halign: 'right',
        },
        headStyles: {
          font: 'Amiri',
          fontStyle: 'normal',
          fillColor: [68, 47, 33],
          textColor: 255,
        },
        didParseCell: (data) => {
          if (/[\u0600-\u06ff]/.test(data.cell.text.join(' '))) {
            data.cell.text = data.cell.text.map((line) =>
              line.replace(/[A-Za-z0-9][A-Za-z0-9 \t#.,:/()×+\-]*/g, (text) =>
                Array.from(text).reverse().join('')
              )
            );
          }
        },
        willDrawCell: (data) => {
          pdf.setR2L(/[\u0600-\u06ff]/.test(data.cell.text.join(' ')));
        },
        didDrawCell: () => {
          pdf.setR2L(false);
        },
        alternateRowStyles: { fillColor: [247, 247, 247] },
        showHead: 'everyPage',
        rowPageBreak: 'avoid',
      });
      startY = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2;
      progress(Math.min(start + 40, rows.length), rows.length, onProgress);
      await pause();
    }
    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      pdf.setPage(page);
      pdf.setFontSize(8);
      pdf.text(`${page} / ${pages}`, width / 2, height - 6, { align: 'center' });
      if (page % 20 === 0) await pause();
    }
    return new File([pdf.output('blob')], filename, { type: 'application/pdf' });
  } finally {
    exporting = false;
    window.dispatchEvent(new CustomEvent('asmo-pdf-progress', { detail: null }));
  }
}

/**
 * فتح رابط خارجي (مثل واتساب أو البريد) بأمان داخل بيئة العرض دون استخدام window.open المحظور
 */
export function triggerExternalShareLink(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function savePdfFile(
  file: File,
  whatsappOptions?: { sendViaWhatsApp?: boolean; title?: string; text?: string }
): Promise<string | undefined> {
  const summaryText =
    whatsappOptions?.text ||
    `📋 *${whatsappOptions?.title || 'تقرير PDF — مستودع أسمو ASMO'}*\n📎 الملف المرفق: ${file.name}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(summaryText)}`;

  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.writeFile({
      path: `reports/${file.name}`,
      data: base64(new Uint8Array(await file.arrayBuffer())),
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({
      title: whatsappOptions?.title || 'تقرير PDF — ASMO',
      text: summaryText,
      url: result.uri,
      dialogTitle: 'إرسال تقرير PDF عبر واتساب 📲',
    });
    return whatsappUrl;
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);

  if (whatsappOptions?.sendViaWhatsApp) {
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: whatsappOptions.title || file.name,
          text: summaryText,
        });
        return whatsappUrl;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          return whatsappUrl;
        }
      }
    }
    triggerExternalShareLink(whatsappUrl);
  }

  return whatsappUrl;
}

async function inventoryFile(
  items: InventoryItem[],
  title: string,
  onProgress?: PdfProgress,
  sendViaWhatsApp = false
): Promise<File> {
  const filename = `ASMO-${Date.now()}.pdf`;
  const file = await createTablePdf({
    title,
    filename,
    onProgress,
    headers: [
      '#',
      'رقم القطعة',
      'الوصف العربي / الاسم الأصلي',
      'الموقع الحالي',
      'الإجمالي',
      'المصروف',
      'المتبقي',
      'الحالة / استهلاكية / الموقع السابق',
    ],
    rows: items.map((item, index) => [
      String(index + 1),
      item.part_number,
      `${item.description_ar || ''}${isConsumablePart(item) ? ' [قطعة استهلاكية A/FL]' : ''}\n${item.description_en || ''}`,
      item.location_code,
      String(item.qty_total),
      String(item.qty_out),
      String(item.qty_remaining),
      getStrictItemStatusLabel(item),
    ]),
  });
  const summaryText = buildInventoryWhatsAppSummary(items, title, filename);
  await savePdfFile(file, {
    sendViaWhatsApp,
    title,
    text: summaryText,
  });
  return file;
}

export async function exportCategoryToPdfFile({
  categoryName,
  items,
  onProgress,
  sendViaWhatsApp = false,
}: {
  categoryName: string;
  items: InventoryItem[];
  onProgress?: PdfProgress;
  sendViaWhatsApp?: boolean;
}): Promise<File> {
  return inventoryFile(items, `تقرير تصنيف: ${categoryName}`, onProgress, sendViaWhatsApp);
}

export async function exportLocationToPdfFile({
  locationCode,
  items,
  summary,
  onProgress,
  sendViaWhatsApp = false,
}: {
  locationCode: string;
  items: InventoryItem[];
  summary?: LocationSummary;
  onProgress?: PdfProgress;
  sendViaWhatsApp?: boolean;
}): Promise<File> {
  return inventoryFile(items, `تقرير موقع: ${locationCode}`, onProgress, sendViaWhatsApp);
}

export async function exportInventoryListToPdfFile({
  items,
  title = 'تقرير الجرد الشامل',
  onProgress,
  sendViaWhatsApp = false,
}: {
  items: InventoryItem[];
  title?: string;
  onProgress?: PdfProgress;
  sendViaWhatsApp?: boolean;
}): Promise<File> {
  return inventoryFile(items, title, onProgress, sendViaWhatsApp);
}

export async function generateReportPdfBlob({
  reportElementId,
}: {
  reportElementId: string;
}): Promise<{
  pdfBlob: Blob;
  pdfFile: File;
  dataUri: string;
  downloadUrl: string;
  filename: string;
}> {
  const element = document.getElementById(reportElementId);
  if (!element) throw new Error('تعذر العثور على التقرير');
  const tableRows = Array.from(element.querySelectorAll('table tr')).map((row) =>
    Array.from(row.querySelectorAll('th,td')).map((cell) => (cell as HTMLElement).innerText)
  );
  const title = element.querySelector('h1,h2')?.textContent || 'تقرير ASMO';
  const pdfFile = await createTablePdf({
    title,
    headers: tableRows.length ? tableRows[0] : ['البيانات'],
    rows: tableRows.length
      ? tableRows.slice(1)
      : element.innerText
          .split('\n')
          .filter(Boolean)
          .map((text) => [text]),
    filename: `ASMO-report-${Date.now()}.pdf`,
  });
  const dataUri = `data:application/pdf;base64,${base64(
    new Uint8Array(await pdfFile.arrayBuffer())
  )}`;
  const downloadUrl = URL.createObjectURL(pdfFile);
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 120000);
  return {
    pdfBlob: pdfFile,
    pdfFile,
    filename: pdfFile.name,
    dataUri,
    downloadUrl,
  };
}

export async function sharePdfFile({
  reportElementId,
  title,
  text,
  targetApp = 'whatsapp',
}: {
  reportElementId: string;
  title: string;
  text: string;
  targetApp?: 'whatsapp' | 'email' | 'any';
}): Promise<{ sharedViaFile: boolean; filename: string; downloadUrl: string; whatsappUrl?: string }> {
  const result = await generateReportPdfBlob({ reportElementId });
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;

  if (Capacitor.isNativePlatform()) {
    const saved = await Filesystem.writeFile({
      path: `reports/${result.pdfFile.name}`,
      data: base64(new Uint8Array(await result.pdfFile.arrayBuffer())),
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({
      title,
      text,
      url: saved.uri,
      dialogTitle: targetApp === 'whatsapp' ? 'إرسال التقرير عبر واتساب 📲' : 'مشاركة تقرير PDF',
    });
    return {
      sharedViaFile: true,
      filename: result.filename,
      downloadUrl: result.downloadUrl,
      whatsappUrl,
    };
  }

  // تنزيل ملف الـ PDF تلقائياً للمستخدم
  await savePdfFile(result.pdfFile);

  if (navigator.canShare?.({ files: [result.pdfFile] })) {
    try {
      await navigator.share({ files: [result.pdfFile], title, text });
      return {
        sharedViaFile: true,
        filename: result.filename,
        downloadUrl: result.downloadUrl,
        whatsappUrl,
      };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return {
          sharedViaFile: false,
          filename: result.filename,
          downloadUrl: result.downloadUrl,
          whatsappUrl,
        };
      }
    }
  }

  if (targetApp === 'whatsapp') {
    triggerExternalShareLink(whatsappUrl);
  } else if (targetApp === 'email') {
    triggerExternalShareLink(mailtoUrl);
  }

  return {
    sharedViaFile: false,
    filename: result.filename,
    downloadUrl: result.downloadUrl,
    whatsappUrl,
  };
}
