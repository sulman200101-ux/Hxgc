import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

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
  if (typeof raw === 'number') {
    if (isNaN(raw) || raw <= 0) return defaultValue;
    return Math.floor(raw);
  }

  const str = String(raw)
    .trim()
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!t]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Gg]/g, '6')
    .replace(/[q]/g, '9');

  const parsed = parseInt(str.replace(/[^0-9]/g, ''), 10);
  return isNaN(parsed) || parsed <= 0 ? defaultValue : parsed;
}

function strict10DigitMaterialFilter(raw: any): string | null {
  const value = String(raw ?? '').trim();
  if (/^\d{10}$/.test(value)) return value;
  const stripped = value.replace(/^[|\[\]()]+|[|\[\]()]+$/g, '');
  const exactInStr = stripped.match(/(?:^|[^0-9])(100\d{7})(?=[^0-9]|$)/);
  if (exactInStr) return exactInStr[1];

  const repaired = stripped
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/[Gg]/g, '6')
    .replace(/[Bb]/g, '8')
    .replace(/[^0-9]/g, '');
  if (/^10\d{8}$/.test(repaired)) return repaired;
  if (/^00[01]\d{6}$/.test(repaired)) return `1${repaired}`;
  const m = repaired.match(/(100\d{7})/);
  return m ? m[1] : null;
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
    !['C006', 'M016', 'D04D', 'EA', 'SET', 'PK', 'SH', 'CO', 'AY', 'PAA', 'ZYD', 'KIT'].includes(sapFixed)
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

    const apiKey = (
      process.env.GEMINI_API_KEY ||
      process.env.VITE_GEMINI_API_KEY ||
      process.env.API_KEY ||
      ''
    ).trim();
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

    const systemInstruction = `You are an industrial Document AI system specialized in reading dense, 37-row SAP Inventory Controller sheets (both upright and rotated 90/180/270 degrees).
CRITICAL RULES:
1. Read the entire table from top to bottom without skipping a single row (all ~37 rows).
2. Extract each row into the JSON array: part_number (10 digits starting with 100 in Material column), location (Storage Bin column, e.g. N13B1, N16D1; if covered by a checkmark, infer from adjacent row), quantity (printed integer in QTY column, never 0), check_mark ("X" if handwritten X/×, "✓" if checked), is_missing (true only if handwritten X/×), remark (handwritten shortage like "-1" or "-4"), and description (full English Material Description).`;

    const prompt = `Read every single row of this SAP Inventory Controller table from top to bottom without skipping any row (all ~37 rows). Extract part_number (10 digits), location (Storage Bin), quantity (QTY integer), check_mark, is_missing, remark, and full English description.`;

    const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
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
            temperature: 0.05,
            responseSchema: {
              type: Type.ARRAY,
              description: 'قائمة بجميع صفوف جدول الجرد بالكامل دون تخطي أي سطر',
              items: {
                type: Type.OBJECT,
                required: ['part_number', 'location', 'quantity', 'description'],
                properties: {
                  seq: { type: Type.INTEGER },
                  part_number: {
                    type: Type.STRING,
                    description: 'Exact 10-digit Material code starting with 100.',
                  },
                  location: {
                    type: Type.STRING,
                    description: 'Storage Bin code (e.g. N13B1, N16D1).',
                  },
                  quantity: {
                    type: Type.INTEGER,
                    description: 'Printed integer quantity in QTY column (>= 1).',
                  },
                  check_mark: { type: Type.STRING },
                  is_missing: { type: Type.BOOLEAN },
                  remark: { type: Type.STRING },
                  description: {
                    type: Type.STRING,
                    description: 'Full English Material Description.',
                  },
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
      const normQuantity = Math.max(1, charToDigitMapper(rawQty, 1));
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
      const rawDesc = String(item.description ?? item.description_en ?? item.desc ?? '').trim();
      const desc = rawDesc.length >= 2 ? rawDesc : 'SPARE PART ASMO';
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
          : 'اسم الموقع غير واضح في عمود Storage Bin';

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

    const apiKey = (
      process.env.GEMINI_API_KEY ||
      process.env.VITE_GEMINI_API_KEY ||
      process.env.API_KEY ||
      ''
    ).trim();
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
            description: 'أي ملاحظات مكتوبة بخط اليد في عمود Remark مثل F2 أو -4، اتركه فارغاً إن لم يوجد',
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
    2. استخرج البيانات صفاً بصف دون تخطي أي سطر، وركز على الأعمدة التالية: Material, Storage Bin, QTY, Remark, Material Description.
    `;

    const systemInstruction = `أنت نظام متطور لاستخراج البيانات من جداول الجرد الصناعية (Document AI).
يجب قراءة الجدول بالكامل من البداية للنهاية دون تخطي أي صف، ووضع قيم فارغة "" للحقول غير المقروءة.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        prompt,
        { inlineData: { data: cleanBase64, mimeType } },
      ],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema,
        maxOutputTokens: 8192,
        temperature: 0.05,
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

    const apiKey = (
      process.env.GEMINI_API_KEY ||
      process.env.VITE_GEMINI_API_KEY ||
      process.env.API_KEY ||
      ''
    ).trim();
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
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        prompt,
        { inlineData: { data: cleanBase64, mimeType } },
      ],
      config: {
        responseMimeType: 'application/json',
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
