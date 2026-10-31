import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

let isGeminiKeyUnsupported = false;

function charToDigitMapper(raw: any, defaultValue: number = 1): number {
  if (raw === null || raw === undefined) return defaultValue;
  if (typeof raw === 'number') return isNaN(raw) ? defaultValue : Math.max(0, Math.floor(raw));

  const str = String(raw)
    .trim()
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Gg]/g, '6')
    .replace(/[q]/g, '9');

  const parsed = parseInt(str.replace(/[^0-9]/g, ''), 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function strict10DigitMaterialFilter(raw: any): string | null {
  let value = String(raw ?? '').trim();
  if (/^\d{10}$/.test(value)) return value;
  const repaired = value
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/[Gg]/g, '6')
    .replace(/[Bb]/g, '8')
    .replace(/[^0-9]/g, '');
  if (/^10\d{8}$/.test(repaired)) return repaired;
  return null;
}

function dynamicLocationNormalizer(rawLoc: any): string {
  if (!rawLoc) return '';
  let cleaned = String(rawLoc)
    .trim()
    .toUpperCase()
    .replace(/عام/g, '')
    .replace(/موقع[:\s]*/g, '')
    .replace(/\b(002\s*02|0020|002|C006|M016|D04D|BIN|LOC|LOCATION|STORAGE\s*BIN)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  let sapFixed = cleaned
    .replace(/\b([A-Z])[Oo](\d)/g, '$10$2')
    .replace(/\b([A-Z]\d)[Oo]/g, '$10')
    .replace(/\b([A-Z])[Il|](\d)/g, '$11$2')
    .replace(/\b([A-Z]\d)[Il|]([A-Z])/g, '$11$2')
    .replace(/([A-Z]{1,3})[Il|]\b/g, '$11')
    .replace(/([A-Z]{1,3})[Oo]\b/g, '$10');

  const splitSap = sapFixed.match(/^([A-Z]\d{2})\s+([A-Z]{1,3}\d{0,2})$/);
  if (splitSap) {
    sapFixed = `${splitSap[1]}${splitSap[2]}`;
  }

  const compactMatch = sapFixed.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{0,2})\b/);
  if (compactMatch && !['C006', 'M016', 'D04D'].includes(compactMatch[1])) {
    return compactMatch[1];
  }

  const match3 = sapFixed.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+\s+[0-9A-Z]+)\b/);
  if (match3) return match3[1].replace(/\s+/g, ' ').trim();

  const match2 = sapFixed.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+)\b/);
  if (match2) return match2[1].replace(/\s+/g, ' ').trim();

  if (
    /^[A-Z0-9][A-Z0-9\s\/._-]{1,18}$/i.test(sapFixed) &&
    /[A-Z]/i.test(sapFixed) &&
    !['C006', 'M016', 'D04D', 'EA', 'SET', 'PK', 'SH', 'CO', 'AY', 'PAA', 'ZYD'].includes(sapFixed)
  ) {
    return sapFixed;
  }

  return '';
}

function detectMissingFromCheckMark(item: any): boolean {
  if (!item) return false;
  if (item.is_missing === true || item.is_missing === 1 || item.is_missing === 'true') return true;
  if (item.status === 'غير موجودة') return true;
  const check = String(item.check ?? item.check_mark ?? item.checkMark ?? '').trim().toUpperCase();
  return (
    check === 'X' ||
    check === '×' ||
    check === '✗' ||
    check === '✘' ||
    check === '✕' ||
    check === '✖' ||
    check === 'MISSING' ||
    check === 'NOT FOUND'
  );
}

app.post('/api/gemini/parse-table', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;

    if (!imageBase64) {
      return res.status(200).json({
        success: false,
        items: [],
        skipped_rows: [],
        message: 'الصورة غير متوفرة. يرجى التقاط الورقة بوضوح.',
      });
    }

    let cleanBase64 = String(imageBase64);
    if (cleanBase64.includes(',')) {
      cleanBase64 = cleanBase64.split(',')[1];
    }
    cleanBase64 = cleanBase64.replace(/\s+/g, '');

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || isGeminiKeyUnsupported) {
      return res.status(200).json({
        success: false,
        fallbackToLocal: true,
        items: [],
        skipped_rows: [],
        message: 'يتم استخدام محرك القراءة المحلي الذكي.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const systemInstruction = `You are an advanced industrial Document AI system specialized in reading dense, 37+ row SAP Inventory Controller sheets (both upright and rotated 90/180/270 degrees).
CRITICAL RULES:
1. Read the entire table from beginning to end (top to bottom) without skipping a single row.
2. Extract each row into the structured JSON array: Material (part_number / material_number), Storage Bin (location / storage_bin), QTY (quantity / qty), Remark (remark), and Material Description (description).
3. Put an empty string "" for any unreadable or blank field.
4. Strictly ignore phone numbers or unrelated margin chatter.`;

    const prompt = `Perform a complete, top-to-bottom scan of this dense spare parts inventory sheet (approximately 37 rows or more).
1. Read every single row from beginning to end without skipping any row, handling rotated orientation automatically.
2. Extract: Material (10-digit code starting with 100), Storage Bin (e.g. N11C2, N16D1), QTY, Remark, and Material Description (plus Arabic translation description_ar).
3. If any field is blank or unreadable, output "" for that field.`;

    const candidateModels = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
    let response: any = null;

    for (const modelName of candidateModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: cleanBase64,
                },
              },
            ],
          },
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            maxOutputTokens: 8192,
            temperature: 0.1,
            ...(modelName === 'gemini-3.8-flash'
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
            responseSchema: {
              type: Type.ARRAY,
              description: 'قائمة بجميع المواد الموجودة في جدول الجرد',
              items: {
                type: Type.OBJECT,
                required: ['part_number', 'description'],
                properties: {
                  part_number: {
                    type: Type.STRING,
                    description: 'Exact spare part number (10 digits starting with 100). Never include phone numbers.',
                  },
                  material_number: {
                    type: Type.STRING,
                    description: 'رقم المادة (Material) مثل 1001011116',
                  },
                  storage_bin: {
                    type: Type.STRING,
                    description: 'موقع التخزين (Storage Bin) مثل N16D1',
                  },
                  qty: {
                    type: Type.NUMBER,
                    description: 'الكمية (QTY) المطبوعة كأرقام',
                  },
                  description: {
                    type: Type.STRING,
                    description: 'Clean technical description of the spare part, excluding distracting text or phone numbers.',
                  },
                  seq: { type: Type.INTEGER },
                  location: { type: Type.STRING },
                  quantity: { type: Type.INTEGER },
                  check_mark: { type: Type.STRING },
                  is_missing: { type: Type.BOOLEAN },
                  remark: { type: Type.STRING },
                  description_ar: { type: Type.STRING },
                },
              },
            },
          },
        });

        if (response && response.text) {
          break;
        }
      } catch (err: any) {
        const errMsg = String(err?.message || err || '');
        if (
          err?.status === 401 ||
          err?.status === 403 ||
          errMsg.includes('401') ||
          errMsg.includes('UNAUTHENTICATED') ||
          errMsg.includes('API key not valid') ||
          errMsg.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED')
        ) {
          isGeminiKeyUnsupported = true;
          break;
        }
      }
    }

    if (!response || !response.text) {
      return res.status(200).json({
        success: false,
        fallbackToLocal: true,
        items: [],
        skipped_rows: [],
        message: 'تعذر تحليل الصورة عبر السيرفر، جاري التحويل للمحرك المحلي.',
      });
    }

    const rawResponseText = response.text || '[]';
    const cleanedText = rawResponseText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: any = [];
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      const arrayMatch = cleanedText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (arrayMatch) {
        try {
          parsed = JSON.parse(arrayMatch[0]);
        } catch {}
      }
    }

    const rawItems: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
      ? parsed.items
      : [];

    let lastValidLoc = '';
    const preNormalized = rawItems.map((item) => {
      const rawLoc =
        item.location ??
        item.storage_bin ??
        item.location_code ??
        item.bin ??
        item.storageBin ??
        '';
      let normLoc = dynamicLocationNormalizer(rawLoc);
      if (normLoc) {
        lastValidLoc = normLoc;
      } else if (lastValidLoc) {
        normLoc = lastValidLoc;
      }
      return { ...item, _normLocation: normLoc };
    });

    let nextValidLoc = '';
    for (let i = preNormalized.length - 1; i >= 0; i--) {
      if (preNormalized[i]._normLocation) {
        nextValidLoc = preNormalized[i]._normLocation;
      } else if (nextValidLoc) {
        preNormalized[i]._normLocation = nextValidLoc;
      }
    }

    const validItems: any[] = [];
    const skippedRows: any[] = [];

    preNormalized.forEach((item, idx) => {
      const rawPart = String(
        item.part_number ??
          item.material_number ??
          item.partNumber ??
          item.material ??
          item.part ??
          ''
      ).trim();

      const finalPartNumber = strict10DigitMaterialFilter(rawPart);
      const normLocation = item._normLocation || '';
      const rawQty = item.quantity ?? item.qty ?? item.total_qty ?? 1;
      const normQuantity = charToDigitMapper(rawQty, 1);
      const isMissing = detectMissingFromCheckMark(item);
      const rawCheck = String(item.check_mark ?? item.check ?? '').trim();
      const checkMark = isMissing
        ? 'X'
        : /^(✓|✔|\/|CHECK)$/i.test(rawCheck)
        ? '✓'
        : '';
      const rawRemark = item.remark ? String(item.remark).trim() : '';
      const minusMatch = rawRemark.match(/^(?:\d+\s*-\s*(\d+)|-\s*(\d+))$/);
      const remark = minusMatch ? `-${minusMatch[1] || minusMatch[2]}` : '';
      const seqNum = item.seq ? Number(item.seq) : undefined;
      const desc = String(
        item.description ?? item.description_en ?? item.desc ?? 'SPARE PART ASMO'
      ).trim();
      const descAr = item.description_ar ? String(item.description_ar).trim() : '';

      if (finalPartNumber && normLocation) {
        validItems.push({
          seq: seqNum,
          part_number: finalPartNumber,
          material_number: finalPartNumber,
          location: normLocation,
          location_code: normLocation,
          storage_bin: normLocation,
          quantity: normQuantity,
          qty: normQuantity,
          qty_total: normQuantity,
          is_missing: isMissing ? 1 : 0,
          check_mark: checkMark,
          remark,
          description: desc,
          description_en: desc,
          description_ar: descAr,
        });
      } else if (rawPart.replace(/[^0-9]/g, '').length > 0) {
        const cleanDigits = rawPart.replace(/[^0-9]/g, '');
        const reason = !finalPartNumber
          ? cleanDigits.length <= 5
            ? `الرقم (${cleanDigits}) هو رقم التسلسل (#) وليس رقم القطعة المكون من 10 أرقام`
            : `رقم القطعة (${rawPart}) ناقص ولا يتكون من 10 أرقام كاملة`
          : `اسم الموقع غير واضح في عمود Storage Bin`;

        skippedRows.push({
          id: `skip-${idx + 1}`,
          row_number: idx + 1,
          raw_text: `${rawPart || '---'} | ${normLocation || '---'} | ${normQuantity} | ${isMissing ? '× غير موجودة' : '✓'} | ${desc}`,
          part_number: rawPart,
          location: normLocation,
          quantity: normQuantity,
          is_missing: isMissing,
          description_en: desc,
          reason,
        });
      }
    });

    return res.status(200).json({
      success: validItems.length > 0,
      items: validItems,
      skipped_rows: skippedRows,
    });
  } catch (error: any) {
    console.error('Error in /api/gemini/parse-table:', error);
    return res.status(200).json({
      success: false,
      items: [],
      skipped_rows: [],
      message: error?.message || 'حدث خطأ أثناء معالجة الصورة عبر السيرفر',
    });
  }
});

app.post('/api/gemini/extract-inventory-table', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'الصورة غير متوفرة' });
    }
    const cleanBase64 = String(imageBase64)
      .replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '')
      .replace(/\s+/g, '');

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(503).json({ error: 'مفتاح الخدمة السحابية غير متوفر' });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const responseSchema = {
      type: Type.ARRAY,
      description: 'قائمة بجميع المواد الموجودة في جدول الجرد',
      items: {
        type: Type.OBJECT,
        properties: {
          material_number: {
            type: Type.STRING,
            description: 'رقم المادة (Material) مثل 1001011116',
          },
          storage_bin: {
            type: Type.STRING,
            description: 'موقع التخزين (Storage Bin) مثل N16D1',
          },
          qty: {
            type: Type.NUMBER,
            description: 'الكمية (QTY) المطبوعة كأرقام',
          },
          remark: {
            type: Type.STRING,
            description:
              'أي ملاحظات مكتوبة بخط اليد في عمود Remark مثل F2 أو S&T، اتركه فارغاً إن لم يوجد',
          },
          description: {
            type: Type.STRING,
            description: 'وصف المادة بالكامل (Material Description)',
          },
        },
        required: ['material_number', 'storage_bin', 'qty', 'description'],
      },
    };

    const prompt = `
    أنت نظام متطور لاستخراج البيانات من جداول الجرد الصناعية (Document AI).
    الصورة المرفقة تحتوي على جدول جرد (Inventory Sheet).
    ملاحظات هامة جداً:
    1. الصورة قد تكون مقلوبة (Rotated)، اقرأ النص بالاتجاه الصحيح برمجياً.
    2. استخرج البيانات صفاً بصف، وركز على الأعمدة التالية: Material, Storage Bin, QTY, Remark, Material Description.
    3. تجاهل علامات "الصح" الموجودة في عمود Check.
    4. إذا كان هناك نص مكتوب بخط اليد في عمود Remark، قم بقراءته بدقة.
  `;

    const systemInstruction = `أنت نظام متطور لاستخراج البيانات من جداول الجرد الصناعية (Document AI).
يجب قراءة الجدول بالكامل من البداية للنهاية دون تخطي أي صف، وتجاهل علامات "الصح" في عمود Check، ووضع قيم فارغة "" للحقول غير المقروءة.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        prompt,
        { inlineData: { data: cleanBase64, mimeType } },
      ],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema,
        maxOutputTokens: 8192,
        temperature: 0.1,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const inventoryItems = JSON.parse(response.text || '[]');
    return res.status(200).json(inventoryItems);
  } catch (err: any) {
    console.error('Error in /api/gemini/extract-inventory-table:', err);
    return res.status(500).json({ error: 'لم يتمكن النظام من قراءة الجدول. تأكد من وضوح الصورة.' });
  }
});

app.post('/api/gemini/extract-part', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'الصورة غير متوفرة' });
    }
    const cleanBase64 = String(imageBase64)
      .replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '')
      .replace(/\s+/g, '');

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(503).json({ error: 'مفتاح الخدمة السحابية غير متوفر' });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

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

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        prompt,
        { inlineData: { data: cleanBase64, mimeType } },
      ],
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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

    const parsed = JSON.parse(response.text || '{}');
    return res.status(200).json({
      part_number: String(parsed.part_number || '').trim(),
      description_en: String(parsed.description_en || '').trim(),
      description_ar: String(parsed.description_ar || '').trim(),
      category: String(parsed.category || '').trim(),
    });
  } catch (err: any) {
    console.error('Error in /api/gemini/extract-part:', err);
    return res.status(500).json({ error: 'فشل في استخراج البيانات من الصورة.' });
  }
});

const apkFilePath = path.resolve(__dirname, 'public', 'downloads', 'asmo-inventory.apk');

const handleApkDownload = (_req: express.Request, res: express.Response) => {
  if (fs.existsSync(apkFilePath)) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="asmo-inventory-release.apk"');
    return res.sendFile(apkFilePath);
  }
  return res.redirect('https://github.com/sulman200101-ux/Hxgc/releases/download/v1.5.0/asmo-inventory-v1.5.0.apk');
};

app.get('/download/asmo-inventory.apk', handleApkDownload);
app.get('/downloads/asmo-inventory.apk', handleApkDownload);
app.get('/asmo-inventory.apk', handleApkDownload);
app.get('/api/download-apk', handleApkDownload);

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
