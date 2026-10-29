import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { InventoryItem, LocationSummary } from '../types';
export { exportAndShareForEditing } from './csvExportUtil';
export interface PdfExportOptions { filename?: string; title?: string; reportElementId: string }
export type PdfProgress = (done: number, total: number) => void;
let fontData: Promise<string> | undefined;
let exporting = false;
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
async function arabicFont(): Promise<string> {
  fontData ??= fetch('/fonts/Amiri-Regular.ttf').then(async response => {
    if (!response.ok) throw new Error('تعذر تحميل الخط العربي المحلي');
    return base64(new Uint8Array(await response.arrayBuffer()));
  }).catch(error => { fontData = undefined; throw error; });
  return fontData;
}
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function progress(done: number, total: number, callback?: PdfProgress) {
  callback?.(done, total);
  window.dispatchEvent(new CustomEvent('asmo-pdf-progress', { detail: { done, total } }));
}
export async function createTablePdf({ title, headers, rows, filename, onProgress }: {
  title: string; headers: string[]; rows: string[][]; filename: string; onProgress?: PdfProgress;
}): Promise<File> {
  if (exporting) throw new Error('يوجد تقرير قيد التصدير؛ انتظر اكتماله');
  exporting = true;
  try {
    progress(0, rows.length, onProgress); await pause();
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    pdf.addFileToVFS('Amiri.ttf', await arabicFont());
    pdf.addFont('Amiri.ttf', 'Amiri', 'normal'); pdf.setFont('Amiri'); pdf.setFontSize(13);
    const width = pdf.internal.pageSize.getWidth(); const height = pdf.internal.pageSize.getHeight();
    pdf.text(title, width - 10, 12, { align: 'right' }); pdf.setFontSize(9);
    pdf.text(`Records: ${rows.length} | ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })}`, width - 10, 19, { align: 'right' });
    let startY = 24;
    // Small text batches, not a whole-report canvas. Yield between batches so the UI stays usable.
    for (let start = 0; start < Math.max(rows.length, 1); start += 40) {
      if (startY > height - 32) { pdf.addPage(); startY = 12; }
      autoTable(pdf, {
        head: [headers], body: rows.slice(start, start + 40), startY, margin: { top: 12, bottom: 14, left: 9, right: 9 },
        styles: { font: 'Amiri', fontStyle: 'normal', fontSize: 8, cellPadding: 1.4, overflow: 'linebreak', halign: 'right' },
        headStyles: { font: 'Amiri', fontStyle: 'normal', fillColor: [68, 47, 33], textColor: 255 },
        didParseCell: data => {
          if (/[\u0600-\u06ff]/.test(data.cell.text.join(' '))) data.cell.text = data.cell.text.map(line => line.replace(/[A-Za-z0-9][A-Za-z0-9 \t#.,:/()×+\-]*/g, text => Array.from(text).reverse().join('')));
        },
        willDrawCell: data => { pdf.setR2L(/[\u0600-\u06ff]/.test(data.cell.text.join(' '))); },
        didDrawCell: () => { pdf.setR2L(false); },
        alternateRowStyles: { fillColor: [247, 247, 247] }, showHead: 'everyPage', rowPageBreak: 'avoid',
      });
      startY = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2;
      progress(Math.min(start + 40, rows.length), rows.length, onProgress); await pause();
    }
    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      pdf.setPage(page); pdf.setFontSize(8); pdf.text(`${page} / ${pages}`, width / 2, height - 6, { align: 'center' });
      if (page % 20 === 0) await pause();
    }
    return new File([pdf.output('blob')], filename, { type: 'application/pdf' });
  } finally {
    exporting = false; window.dispatchEvent(new CustomEvent('asmo-pdf-progress', { detail: null }));
  }
}
export async function savePdfFile(file: File): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.writeFile({ path: `reports/${file.name}`, data: base64(new Uint8Array(await file.arrayBuffer())), directory: Directory.Cache, recursive: true });
    await Share.share({ title: 'تقرير PDF', url: result.uri, dialogTitle: 'حفظ أو مشاركة التقرير' });
    return;
  }
  const url = URL.createObjectURL(file); const link = document.createElement('a');
  link.href = url; link.download = file.name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function inventoryFile(items: InventoryItem[], title: string, onProgress?: PdfProgress): Promise<File> {
  const file = await createTablePdf({ title, filename: `ASMO-${Date.now()}.pdf`, onProgress,
    headers: ['#', 'رقم القطعة', 'الوصف العربي / الاسم الأصلي', 'الموقع', 'الإجمالي', 'المصروف', 'المتبقي', 'الحالة'],
    rows: items.map((item, index) => [String(index + 1), item.part_number, `${item.description_ar || ''}\n${item.description_en || ''}`, item.location_code,
      String(item.qty_total), String(item.qty_out), String(item.qty_remaining), `${item.status}${item.is_moved ? ` — من ${item.old_location || ''}` : ''}`]),
  });
  await savePdfFile(file); return file;
}
export async function exportCategoryToPdfFile({ categoryName, items, onProgress }: { categoryName: string; items: InventoryItem[]; onProgress?: PdfProgress }): Promise<File> {
  return inventoryFile(items, `تقرير تصنيف: ${categoryName}`, onProgress);
}
export async function exportLocationToPdfFile({ locationCode, items, summary, onProgress }: { locationCode: string; items: InventoryItem[]; summary?: LocationSummary; onProgress?: PdfProgress }): Promise<File> {
  return inventoryFile(items, `تقرير موقع: ${locationCode}`, onProgress);
}
export async function exportInventoryListToPdfFile({ items, title = 'تقرير الجرد الشامل', onProgress }: { items: InventoryItem[]; title?: string; onProgress?: PdfProgress }): Promise<File> {
  return inventoryFile(items, title, onProgress);
}
export async function generateReportPdfBlob({ reportElementId }: { reportElementId: string }): Promise<{ pdfBlob: Blob; pdfFile: File; dataUri: string; downloadUrl: string; filename: string }> {
  const element = document.getElementById(reportElementId); if (!element) throw new Error('تعذر العثور على التقرير');
  const tableRows = Array.from(element.querySelectorAll('table tr')).map(row => Array.from(row.querySelectorAll('th,td')).map(cell => (cell as HTMLElement).innerText));
  const title = element.querySelector('h1,h2')?.textContent || 'تقرير ASMO';
  const pdfFile = await createTablePdf({ title, headers: tableRows.length ? tableRows[0] : ['البيانات'],
    rows: tableRows.length ? tableRows.slice(1) : element.innerText.split('\n').filter(Boolean).map(text => [text]), filename: `ASMO-report-${Date.now()}.pdf` });
  const dataUri = `data:application/pdf;base64,${base64(new Uint8Array(await pdfFile.arrayBuffer()))}`;
  return { pdfBlob: pdfFile, pdfFile, filename: pdfFile.name, dataUri, downloadUrl: URL.createObjectURL(pdfFile) };
}
export async function sharePdfFile({ reportElementId, title, text, targetApp }: { reportElementId: string; title: string; text: string; targetApp?: 'whatsapp' | 'email' | 'any' }): Promise<{ sharedViaFile: boolean; filename: string; downloadUrl: string }> {
  const result = await generateReportPdfBlob({ reportElementId }); await savePdfFile(result.pdfFile);
  if (!Capacitor.isNativePlatform() && navigator.canShare?.({ files: [result.pdfFile] })) {
    try { await navigator.share({ files: [result.pdfFile], title, text }); } catch (error) { if ((error as Error).name !== 'AbortError') throw error; }
  }
  return { sharedViaFile: Capacitor.isNativePlatform(), filename: result.filename, downloadUrl: result.downloadUrl };
}
