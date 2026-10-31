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
  const base64Data = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '');

  try {
    const serverRes = await fetch('/api/gemini/extract-inventory-table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64Data, mimeType: 'image/jpeg' }),
    });

    if (!serverRes.ok) {
      const errorBody = await serverRes.json().catch(() => null);
      throw new Error(errorBody?.error || 'لم يتمكن النظام من قراءة الجدول. تأكد من وضوح الصورة.');
    }

    const data = await serverRes.json();
    if (Array.isArray(data)) {
      return data as ExtractedInventoryTableRow[];
    }
    if (Array.isArray(data?.items)) {
      return data.items as ExtractedInventoryTableRow[];
    }

    throw new Error('لم يتمكن النظام من قراءة الجدول. تأكد من وضوح الصورة.');
  } catch (error) {
    console.error('خطأ في قراءة جدول الجرد:', error);
    throw new Error('لم يتمكن النظام من قراءة الجدول. تأكد من وضوح الصورة.');
  }
};

export const extractSparePartData = async (
  base64Image: string
): Promise<ExtractedSparePartData> => {
  const base64Data = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '');

  try {
    const serverRes = await fetch('/api/gemini/extract-part', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64Data, mimeType: 'image/jpeg' }),
    });

    if (!serverRes.ok) {
      const errorBody = await serverRes.json().catch(() => null);
      throw new Error(errorBody?.error || 'فشل في استخراج البيانات من الصورة.');
    }

    const data = await serverRes.json();
    if (data && typeof data.part_number === 'string') {
      return {
        part_number: data.part_number || '',
        description_en: data.description_en || '',
        description_ar: data.description_ar || '',
        category: data.category || '',
      };
    }

    throw new Error('فشل في استخراج البيانات من الصورة.');
  } catch (error) {
    console.error('Gemini OCR Error:', error);
    throw new Error('فشل في استخراج البيانات من الصورة.');
  }
};
