import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

export interface ExportInventoryItem {
  partNumber: string;
  location: string;
  quantity: number | string;
  description: string;
}

export const exportAndShareForEditing = async (inventoryData: any[]): Promise<boolean> => {
  try {
    // 1. تحويل بيانات الجرد إلى صيغة CSV (إكسل)
    // أضف \ufeff في البداية لدعم اللغة العربية في إكسل (UTF-8 BOM)
    let csvContent = "\ufeffرقم القطعة,الموقع,الكمية,الوصف\n";
    inventoryData.forEach(item => {
      const partNumber = item.partNumber || item.part_number || '';
      const location = item.location || item.location_code || '';
      const quantity = item.quantity ?? item.total_qty ?? item.qty ?? 0;
      const description = (item.description || item.desc_ar || item.desc_en || '').replace(/,/g, ' ');
      csvContent += `${partNumber},${location},${quantity},${description}\n`;
    });

    // 2. حفظ الملف مؤقتاً في ذاكرة التطبيق (Cache)
    const fileName = `ASMO_Inventory_${new Date().toISOString().split('T')[0]}.csv`;

    if (Capacitor.isNativePlatform()) {
      const savedFile = await Filesystem.writeFile({
        path: fileName,
        data: csvContent,
        directory: Directory.Cache,
        encoding: Encoding.UTF8
      });

      // 3. فتح نافذة الإرسال (Share Sheet) في الجوال
      await Share.share({
        title: 'تقرير الجرد (قابل للتعديل)',
        text: 'مرفق تقرير الجرد. يمكنك فتحه والتعديل عليه عبر برنامج Excel.',
        url: savedFile.uri, // مسار الملف الذي تم حفظه
        dialogTitle: 'إرسال التقرير إلى...'
      });
    } else {
      // للمتصفح: تنزيل الملف المباشر بدعم الترميز العربي UTF-8 BOM
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    return true;
  } catch (error) {
    console.error('خطأ في تصدير أو مشاركة الملف:', error);
    return false;
  }
};
