import { getCandidateApiUrls, parseTableWithGeminiVision } from './geminiVisionService';

export interface ExtractedSparePartData {
  part_number: string;
  description_en: string;
  description_ar: string;
  category: string;
}

export interface ExtractedInventoryTableRow {
  material_number: string;
  storage_bin: string;
  qty: number;
  remark: string;
  description: string;
}

export const DENSE_TABLE_SYSTEM_PROMPT = `أنت نظام متطور لاستخراج البيانات من جداول الجرد الصناعية (Document AI).
يجب عليك قراءة الجدول بالكامل من البداية للنهاية دون تخطي أي صف مهما كان الجدول كثيفاً (حتى 40+ صفاً في الورقة) وحتى لو كانت الصورة مقلوبة أو مدورة.
تجاهل علامات "الصح" الموجودة في عمود Check، وضع قيمة نصية فارغة "" لأي حقل غير مقروء أو غير موجود، وأرجع النتيجة كمصفوفة JSON مطابقة تماماً للهيكل المطلوب.`;

export const extractInventoryTable = async (
  base64Image: string
): Promise<ExtractedInventoryTableRow[]> => {
  try {
    const directVision = await parseTableWithGeminiVision(base64Image);
    if (directVision.success && directVision.items.length > 0) {
      return directVision.items.map((item) => ({
        material_number: item.part_number,
        storage_bin: item.location_code,
        qty: item.qty_total,
        remark: item.remark || '',
        description: item.description_en,
      }));
    }
  } catch {
    // المتابعة للخادم
  }

  const base64Data = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '');
  const urls = getCandidateApiUrls('/api/gemini/extract-inventory-table');

  for (const url of urls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const serverRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Data, mimeType: 'image/jpeg' }),
        signal: controller.signal,
      });

      if (!serverRes.ok) continue;

      const data = await serverRes.json();
      if (Array.isArray(data) && data.length > 0) {
        return data as ExtractedInventoryTableRow[];
      }
      if (Array.isArray(data?.items) && data.items.length > 0) {
        return data.items as ExtractedInventoryTableRow[];
      }
    } catch {
      // المتابعة للرابط التالي
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error('لم يتمكن النظام من قراءة الجدول. تأكد من وضوح الصورة.');
};

export const extractSparePartData = async (
  base64Image: string
): Promise<ExtractedSparePartData> => {
  try {
    const directVision = await parseTableWithGeminiVision(base64Image);
    const first = directVision.items?.[0];
    if (first && first.part_number) {
      return {
        part_number: first.part_number || '',
        description_en: first.description_en || '',
        description_ar: first.description_ar || '',
        category: first.category || '',
      };
    }
  } catch {
    // المتابعة للخادم
  }

  const base64Data = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '');
  const urls = getCandidateApiUrls('/api/gemini/extract-part');

  for (const url of urls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const serverRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Data, mimeType: 'image/jpeg' }),
        signal: controller.signal,
      });

      if (!serverRes.ok) continue;

      const data = await serverRes.json();
      if (data && typeof data.part_number === 'string' && data.part_number.trim()) {
        return {
          part_number: data.part_number || '',
          description_en: data.description_en || '',
          description_ar: data.description_ar || '',
          category: data.category || '',
        };
      }
    } catch {
      // المتابعة للرابط التالي
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error('فشل في استخراج البيانات من الصورة.');
};
