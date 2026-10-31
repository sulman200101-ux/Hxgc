import { GoogleGenAI, Type, type Schema } from '@google/genai';

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
  // إزالة الترويسة من الصورة إذا كانت موجودة
  const base64Data = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '');

  // تعريف هيكل البيانات الصارم (Array of Objects يمثل صفوف الجدول)
  const responseSchema: Schema = {
    type: Type.ARRAY,
    description: 'قائمة بجميع صفوف المواد الموجودة في جدول الجرد من البداية للنهاية دون تخطي أي صف',
    items: {
      type: Type.OBJECT,
      properties: {
        material_number: {
          type: Type.STRING,
          description: 'رقم المادة (Material) مثل 1001011116، أو "" إذا كان غير مقروء',
        },
        storage_bin: {
          type: Type.STRING,
          description: 'موقع التخزين (Storage Bin) مثل N16D1، أو "" إذا كان غير مقروء',
        },
        qty: {
          type: Type.NUMBER,
          description: 'الكمية (QTY) المطبوعة كأرقام',
        },
        remark: {
          type: Type.STRING,
          description:
            'أي ملاحظات مكتوبة بخط اليد في عمود Remark مثل F2 أو -4، أو "" إن لم يوجد',
        },
        description: {
          type: Type.STRING,
          description: 'وصف المادة بالكامل (Material Description)، أو "" إذا كان غير مقروء',
        },
      },
      required: ['material_number', 'storage_bin', 'qty', 'remark', 'description'],
    },
  };

  const prompt = `
    الصورة المرفقة تحتوي على جدول جرد كثيف (Inventory Sheet يحتوي على حوالي 37 صفاً أو أكثر).
    التعليمات الصارمة:
    1. اقرأ الجدول من البداية للنهاية صفاً بصف دون تخطي أي صف، وبغض النظر عن اتجاه الصورة (أفقية أو مقلوبة/مدورة).
    2. استخرج الأعمدة التالية لكل صف: Material, Storage Bin, QTY, Remark, Material Description.
    3. تجاهل علامات "الصح" في عمود Check.
    4. ضع قيمة فارغة "" لأي حقل نصي غير مقروء أو فارغ.
  `;

  try {
    // 1. المحاولة عبر المسار الخادمي الآمن أولاً
    const serverRes = await fetch('/api/gemini/extract-inventory-table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64Data, mimeType: 'image/jpeg' }),
    });

    if (serverRes.ok) {
      const data = await serverRes.json();
      if (Array.isArray(data)) {
        return data as ExtractedInventoryTableRow[];
      }
      if (Array.isArray(data?.items)) {
        return data.items as ExtractedInventoryTableRow[];
      }
    }

    // 2. الاتصال المباشر عبر @google/genai عند توفر مفتاح العميل
    const clientKey = (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_GEMINI_API_KEY;
    if (!clientKey) {
      throw new Error('لم يتمكن النظام من قراءة الجدول. تأكد من وضوح الصورة.');
    }

    const ai = new GoogleGenAI({ apiKey: clientKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        prompt,
        { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
      ],
      config: {
        systemInstruction: DENSE_TABLE_SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema,
        maxOutputTokens: 8192,
        temperature: 0.1,
      },
    });

    const resultText = response.text || '[]';
    return JSON.parse(resultText) as ExtractedInventoryTableRow[];
  } catch (error) {
    console.error('خطأ في قراءة جدول الجرد:', error);
    throw new Error('لم يتمكن النظام من قراءة الجدول. تأكد من وضوح الصورة.');
  }
};

export const extractSparePartData = async (
  base64Image: string
): Promise<ExtractedSparePartData> => {
  const prompt = `
    أنت خبير في التعرف على قطع الغيار الصناعية وإدارة المخزون.
    قم بقراءة الصورة المرفقة واستخرج البيانات التالية بدقة:
    1. part_number: رقم القطعة (تجاهل أرقام الهواتف أو التواريخ).
    2. description: وصف القطعة بالعربية والإنجليزية إذا توفر.
    3. category: صنف القطعة (مثل: فلاتر، سيور، زيوت، إلخ).

    **قواعد صارمة جداً:**
    - أرجع الناتج بصيغة JSON فقط، بدون أي نصوص إضافية أو علامات تنسيق (Markdown).
    - إذا لم تكن متأكداً من حقل معين، اجعل قيمته "".
    - لا تقم بتأليف بيانات غير موجودة في الصورة.
  `;

  const base64Data = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '');

  try {
    const serverRes = await fetch('/api/gemini/extract-part', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64Data, mimeType: 'image/jpeg' }),
    });

    if (serverRes.ok) {
      const data = await serverRes.json();
      if (data && typeof data.part_number === 'string') {
        return {
          part_number: data.part_number || '',
          description_en: data.description_en || '',
          description_ar: data.description_ar || '',
          category: data.category || '',
        };
      }
    }

    const clientKey = (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_GEMINI_API_KEY;
    if (!clientKey) {
      throw new Error('فشل في استخراج البيانات من الصورة.');
    }

    const ai = new GoogleGenAI({ apiKey: clientKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        prompt,
        { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
      ],
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0.1,
        responseSchema: {
          type: Type.OBJECT,
          required: ['part_number', 'description_en', 'description_ar', 'category'],
          properties: {
            part_number: { type: Type.STRING },
            description_en: { type: Type.STRING },
            description_ar: { type: Type.STRING },
            category: { type: Type.STRING },
          },
        },
      },
    });

    const resultText = response.text || '{}';
    return JSON.parse(resultText) as ExtractedSparePartData;
  } catch (error) {
    console.error('Gemini OCR Error:', error);
    throw new Error('فشل في استخراج البيانات من الصورة.');
  }
};
