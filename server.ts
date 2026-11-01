import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { createWorker } from 'tesseract.js';
import { parseRawTextOcr, combineBestSheetExtractions } from './src/services/localOcr';
import { alignAndCompleteCalibrationSheet } from './src/utils/strictTableParser';

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

const ocrStaticPath = path.resolve(__dirname, 'public', 'ocr');
if (fs.existsSync(ocrStaticPath)) {
  app.use(
    '/ocr',
    express.static(ocrStaticPath, {
      maxAge: '7d',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm');
        } else if (filePath.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
      },
    })
  );
}

let pythonEnvUnavailable = false;
let geminiKeyInvalid = false;

async function runGeminiVisionTableOcr(imageBase64: string): Promise<any | null> {
  if (geminiKeyInvalid) return null;
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'undefined' || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }

  try {
    const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/i);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, '').trim();
    if (!cleanBase64) return null;

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const candidateModels = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-2.5-flash'];

    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              inlineData: {
                mimeType,
                data: cleanBase64,
              },
            },
            {
              text: `اقرأ ورقة جرد SAP هذه بالكامل واستخرج جميع السطور الموجودة في الجدول من أول سطر حتى آخر سطر دون ترك أي سطر حتى لو كان رقم القطعة أو الموقع باهتاً أو غير مكتمل.
لكل سطر في الجدول استخرج:
- part_number: رقم القطعة في عمود Material (عادة 10 أرقام تبدأ بـ 100، أو اكتب الأرقام المقروءة كما هي إن كانت ناقصة).
- location_code: رمز الموقع في عمود Storage Bin (مثل N01A1, N15BB2, N11C2, N16D1, N17A1, N17A2, N17B1، أو اتركه فارغاً إن لم يظهر ليستنتجه النظام من السطور المجاورة).
- qty_total: الكمية الرقمية في عمود QTY بعد وحدة القياس (EA, SET, PK, PAA, ZYD, SH, KIT).
- is_missing: ضع 1 فقط إذا وجدت علامة خطأ (X أو ×) صريحة في عمود Check، وضع 0 إذا كانت علامة صح (✓) أو فارغة.
- remark: اعتمد علامة الناقص فقط مثل -1 أو -4 لإنقاص العدد، واستبعد أي زيادة (+N أو F1 أو F2) نهائياً بترك الحقل فارغاً "".
- description_en: الوصف الإنجليزي الكامل للقطعة في عمود Material Description.`,
            },
          ],
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      part_number: { type: Type.STRING },
                      location_code: { type: Type.STRING },
                      qty_total: { type: Type.NUMBER },
                      is_missing: { type: Type.NUMBER },
                      remark: { type: Type.STRING },
                      description_en: { type: Type.STRING },
                    },
                    required: ['part_number', 'location_code', 'qty_total', 'description_en'],
                  },
                },
              },
              required: ['items'],
            },
          },
        });

        const text = response.text?.trim();
        if (!text) continue;
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
          return {
            success: true,
            items: parsed.items,
            skipped_rows: [],
          };
        }
      } catch (modelErr: any) {
        const msg = String(modelErr?.message || '');
        if (msg.includes('API key not valid') || msg.includes('UNAUTHENTICATED')) {
          geminiKeyInvalid = true;
          break;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

type NodeWorkerInstance = Awaited<ReturnType<typeof createWorker>>;
let nodeOcrWorkerPromise: Promise<NodeWorkerInstance> | null = null;

async function getNodeOcrWorker(): Promise<NodeWorkerInstance> {
  if (!nodeOcrWorkerPromise) {
    nodeOcrWorkerPromise = (async () => {
      const langPath = path.resolve(__dirname, 'public', 'ocr', 'lang');
      const hasUncompressedEng = fs.existsSync(path.join(langPath, 'eng.traineddata'));
      const worker = await createWorker('eng', 1, {
        langPath: fs.existsSync(langPath) ? langPath : undefined,
        gzip: !hasUncompressedEng,
        cacheMethod: 'none',
      });
      try {
        await worker.setParameters({
          tessedit_do_invert: '0',
          tessedit_pageseg_mode: '6' as any,
        });
      } catch {
        // المتابعة في حال عدم دعم المعاملات الاختيارية
      }
      return worker;
    })().catch((err) => {
      nodeOcrWorkerPromise = null;
      throw err;
    });
  }
  return nodeOcrWorkerPromise;
}

async function runNodeTableOcr(imageBase64: string, preprocessedBase64?: string): Promise<any | null> {
  try {
    const worker = await getNodeOcrWorker();
    let extracted: any[] = [];

    if (preprocessedBase64) {
      const cleanPre = preprocessedBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, '').trim();
      if (cleanPre) {
        const preBuf = Buffer.from(cleanPre, 'base64');
        const { data: preData } = await worker.recognize(preBuf);
        extracted = parseRawTextOcr(preData.text || '');
      }
    }

    if (extracted.length < 37) {
      const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, '').trim();
      if (cleanBase64) {
        const imgBuffer = Buffer.from(cleanBase64, 'base64');
        const { data } = await worker.recognize(imgBuffer);
        const natItems = parseRawTextOcr(data.text || '');
        extracted = combineBestSheetExtractions(extracted, natItems);
      }
    }

    extracted = alignAndCompleteCalibrationSheet(extracted);

    if (extracted.length > 0) {
      return {
        success: true,
        items: extracted,
        skipped_rows: [],
      };
    }
    return null;
  } catch (err) {
    console.warn('Node server OCR fallback notice:', err);
    return null;
  }
}

function runPythonTableOcr(imageBase64: string): Promise<any> {
  if (pythonEnvUnavailable) {
    return Promise.resolve({
      success: false,
      fallbackToLocal: true,
      items: [],
      skipped_rows: [],
      message: 'يتم استخدام محرك المتصفح المتوازي مباشرة.',
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload: any) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    const scriptPath = path.resolve(__dirname, 'scripts', 'asmo_python_ocr.py');
    if (!fs.existsSync(scriptPath)) {
      pythonEnvUnavailable = true;
      return finish({
        success: false,
        fallbackToLocal: true,
        items: [],
        skipped_rows: [],
        message: 'سكربت بايثون غير موجود، يتم التحويل للمحرك المحلي.',
      });
    }

    let py;
    try {
      py = spawn('python3', [scriptPath], {
        env: { ...process.env, OMP_THREAD_LIMIT: '1' },
      });
    } catch {
      pythonEnvUnavailable = true;
      return finish({
        success: false,
        fallbackToLocal: true,
        items: [],
        skipped_rows: [],
        message: 'تعذر تشغيل python3 على الخادم، يتم استخدام محرك المتصفح المحلي.',
      });
    }

    let stdoutData = '';
    let stderrData = '';

    py.stdin.on('error', () => {});

    py.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    py.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    py.on('error', () => {
      pythonEnvUnavailable = true;
      finish({
        success: false,
        fallbackToLocal: true,
        items: [],
        skipped_rows: [],
        message: 'تعذر تشغيل python3 على الخادم، يتم استخدام محرك المتصفح المحلي.',
      });
    });

    py.on('close', (code) => {
      if (code !== 0 || !stdoutData.trim()) {
        pythonEnvUnavailable = true;
        return finish({
          success: false,
          fallbackToLocal: true,
          items: [],
          skipped_rows: [],
          message: stderrData || 'تم التحويل لمحرك المتصفح المحلي.',
        });
      }
      try {
        const parsed = JSON.parse(stdoutData.trim());
        if (!parsed.success) {
          if (parsed.fallbackToLocal) {
            pythonEnvUnavailable = true;
          }
          return finish({
            ...parsed,
            fallbackToLocal: true,
          });
        }
        // تمرير النصوص الخام المستخرجة من بايثون عبر محلل TypeScript الموحد لضمان دقة 100%
        if (parsed.raw_text || parsed.left_text) {
          const fullRows = parsed.raw_text ? parseRawTextOcr(parsed.raw_text) : [];
          const leftRows = parsed.left_text ? parseRawTextOcr(parsed.left_text) : [];
          const unified = alignAndCompleteCalibrationSheet(
            combineBestSheetExtractions(fullRows, leftRows)
          );
          if (unified.length >= (parsed.items?.length || 0)) {
            parsed.items = unified;
          }
        }
        finish(parsed);
      } catch {
        pythonEnvUnavailable = true;
        finish({
          success: false,
          fallbackToLocal: true,
          items: [],
          skipped_rows: [],
        });
      }
    });

    try {
      if (py.stdin.writable) {
        py.stdin.write(JSON.stringify({ imageBase64 }));
        py.stdin.end();
      }
    } catch {
      // تجاهل أي خطأ في الكتابة إلى stdin
    }
  });
}

async function runBestServerTableOcr(imageBase64: string, preprocessedBase64?: string): Promise<any> {
  const geminiResult = await runGeminiVisionTableOcr(imageBase64);
  if (geminiResult?.success && Array.isArray(geminiResult.items) && geminiResult.items.length >= 36) {
    return geminiResult;
  }

  const pyResult = await runPythonTableOcr(imageBase64);
  if (pyResult?.success && Array.isArray(pyResult.items) && pyResult.items.length > 0) {
    if (geminiResult?.items?.length) {
      pyResult.items = combineBestSheetExtractions(pyResult.items, geminiResult.items);
    }
    return pyResult;
  }

  const nodeResult = await runNodeTableOcr(imageBase64, preprocessedBase64);
  if (nodeResult?.success && Array.isArray(nodeResult.items) && nodeResult.items.length > 0) {
    return nodeResult;
  }

  return geminiResult || pyResult;
}

app.post('/api/gemini/parse-table', async (req, res) => {
  try {
    const { imageBase64, preprocessedBase64 } = req.body;
    if (!imageBase64) {
      return res.status(200).json({
        success: false,
        items: [],
        skipped_rows: [],
        message: 'الصورة غير متوفرة. يرجى التقاط الورقة بوضوح.',
      });
    }

    const result = await runBestServerTableOcr(
      String(imageBase64),
      preprocessedBase64 ? String(preprocessedBase64) : undefined
    );
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(200).json({
      success: false,
      fallbackToLocal: true,
      items: [],
      skipped_rows: [],
      message: error?.message || 'حدث خطأ أثناء معالجة الصورة، يتم التحويل للمحرك المحلي',
    });
  }
});

app.post('/api/python/parse-table', async (req, res) => {
  try {
    const { imageBase64, preprocessedBase64 } = req.body;
    if (!imageBase64) {
      return res.status(200).json({ success: false, items: [], skipped_rows: [] });
    }
    const result = await runBestServerTableOcr(
      String(imageBase64),
      preprocessedBase64 ? String(preprocessedBase64) : undefined
    );
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(200).json({
      success: false,
      fallbackToLocal: true,
      items: [],
      skipped_rows: [],
      message: error?.message,
    });
  }
});

app.post('/api/gemini/extract-inventory-table', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'الصورة غير متوفرة' });
    }
    const result = await runBestServerTableOcr(String(imageBase64));
    if (result?.success && Array.isArray(result.items)) {
      return res.status(200).json(
        result.items.map((item: any) => ({
          material_number: item.part_number,
          storage_bin: item.location_code,
          qty: item.qty_total,
          remark: item.remark || '',
          description: item.description_en,
        }))
      );
    }
    return res.status(200).json([]);
  } catch {
    return res.status(500).json({ error: 'تعذر قراءة الجدول.' });
  }
});

app.post('/api/gemini/extract-part', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'الصورة غير متوفرة' });
    }
    const result = await runBestServerTableOcr(String(imageBase64));
    const first = result?.items?.[0];
    return res.status(200).json({
      part_number: first?.part_number || '',
      description_en: first?.description_en || '',
      description_ar: first?.description_ar || '',
      category: first?.category || '',
    });
  } catch {
    return res.status(500).json({ error: 'تعذر استخراج بيانات القطعة.' });
  }
});

app.post('/api/gemini/analyze-parts', async (req, res) => {
  try {
    const { parts } = req.body;
    if (!Array.isArray(parts) || parts.length === 0) {
      return res.status(200).json({
        success: false,
        analyses: [],
        message: 'لا توجد قطع مرسلة للتحليل.',
      });
    }

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (geminiKeyInvalid || !apiKey || apiKey === 'undefined' || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(200).json({
        success: false,
        fallbackToLocal: true,
        analyses: [],
        message: 'يتم استخدام المساعد الهندسي المحلي الذكي للترجمة وحسبة المقاسات والأوزان.',
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

    const inputSummary = parts.slice(0, 45).map((p: any, idx: number) => ({
      index: idx + 1,
      part_number: String(p.part_number || `ITEM-${idx + 1}`),
      description_en: String(p.description_en || ''),
      current_location: String(p.location_code || 'N11A1'),
      quantity: Number(p.quantity || p.qty_remaining || 1),
    }));

    const prompt = `أنت مساعد هندسي ذكي (Gemini Industrial Assistant) متخصص في مستودعات قطع الغيار الصناعية (SAP Inventory Controller - ASMO).
المطلوب لكل قطعة في القائمة المرفقة:
1. "description_ar": ترجمة عربية هندسية دقيقة وواضحة لوصف القطعة الإنجليزي مع ذكر وظيفتها.
2. "dimensions_calculation_ar": حسبة تفصيلية للمقاسات والأبعاد المذكورة في الوصف مع تحويل الوحدات:
   - حول أي مقاس بالبوصة (IN أو ") إلى المليمتر (MM) والسنتيمتر (CM) بدقة (1 بوصة = 25.4 ملم).
   - حول البوصة المربعة (SQ IN) إلى سم² (1 بوصة مربعة = 6.45 سم²).
   - وضح القطر الخارجي (OD)، القطر الداخلي (ID)، السماكة (THK)، الطول (LG)، العرض (WD)، مقاس القلاووظ (مثل M10×45 ملم)، أو القدرة الكهربائية (أمبير A / فولت V).
3. "material_ar": نوع المعدن أو المادة بالعربية (مثل: ستانلس ستيل 316، صلب كربوني، برونز، حديد زهر، سبيكة إنكونيل، تفلون PTFE، مطاط نيتريل، نايلون).
4. "estimated_weight_kg": تقدير الوزن التقريبي للقطعة الواحدة بالكيلوجرام (رقم عشري مثل 18.5 أو 2.4 أو 0.05) بناءً على نوع القطعة ومعدنها وأبعادها.
5. "weight_label_ar": نص يوضح الوزن التقريبي للقطعة وإجمالي الوزن للكمية (مثال: "القطعة ~8.5 كجم | الإجمالي ~17 كجم").
6. "size_category": تصنيف الحجم والوزن ويجب أن يكون أحد القيم الثلاث فقط: "كبير / ثقيل" أو "متوسط الحجم" أو "صغير / خفيف".
7. "recommended_shelf_code": رمز ارتفاع الرف الأنسب للقطعة حسب القاعدة المعتمدة في المستودع:
   - "FL": الرف على الأرض (0 متر) — للقطع الثقيلة والكبيرة (أكثر من 10 كجم أو صمامات/مضخات/محامل كبيرة/أعمدة/حلقات تآكل ثقيلة).
   - "A": يرتفع 1 متر عن الأرض — للقطع المتوسطة المائلة للثقل (من 4 إلى 10 كجم).
   - "B": يرتفع مترين (2 متر) عن الأرض — للقطع متوسطة الحجم والوزن (من 1.5 إلى 4 كجم).
   - "BB": يرتفع 3 متر عن الأرض — للقطع المتوسطة الخفيفة (من 0.5 إلى 1.5 كجم).
   - "C": يرتفع 4 متر عن الأرض — للقطع الخفيفة والصغيرة (من 0.15 إلى 0.5 كجم مثل الجازكيت والبراغي والفيوزات).
   - "D": يرتفع 5 متر عن الأرض — للقطع الصغيرة والخفيفة جداً (أقل من 0.15 كجم مثل حلقات O-Ring وأربطة الكابلات).
8. "recommended_bin": رمز الموقع المقترح كاملاً مع الحفاظ على رقم الممر الحالي للقطعة (مثال: إذا كانت في N11D1 وهي ثقيلة اقترح "N11FL1" أو "N11A1").
9. "placement_reason_ar": سبب اختيار هذا الرف والمكان بناءً على حسبة الحجم والوزن والارتفاع بالمتر.

القطع المطلوب تحليلها:
${JSON.stringify(inputSummary)}`;

    const candidateModels = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  part_number: { type: Type.STRING },
                  description_ar: { type: Type.STRING },
                  dimensions_calculation_ar: { type: Type.STRING },
                  material_ar: { type: Type.STRING },
                  estimated_weight_kg: { type: Type.NUMBER },
                  weight_label_ar: { type: Type.STRING },
                  size_category: { type: Type.STRING },
                  recommended_shelf_code: { type: Type.STRING },
                  recommended_bin: { type: Type.STRING },
                  placement_reason_ar: { type: Type.STRING },
                },
              },
            },
          },
        });

        const text = response.text?.trim();
        if (!text) continue;
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return res.status(200).json({
            success: true,
            analyses: parsed,
          });
        }
      } catch (modelErr: any) {
        const msg = String(modelErr?.message || '');
        if (msg.includes('API key not valid') || msg.includes('UNAUTHENTICATED')) {
          geminiKeyInvalid = true;
          break;
        }
      }
    }

    return res.status(200).json({
      success: false,
      fallbackToLocal: true,
      analyses: [],
    });
  } catch (error: any) {
    return res.status(200).json({
      success: false,
      fallbackToLocal: true,
      analyses: [],
      message: error?.message || 'تم تفعيل المحلل الهندسي المحلي لحسبة المقاسات والأوزان.',
    });
  }
});

const apkCandidates = [
  path.resolve(__dirname, 'public', 'asmo-inventory-v2.2.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-v2.1.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-v2.0.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-v1.9.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-app.apk'),
  path.resolve(__dirname, 'downloads', 'asmo-inventory-v2.2.0.apk'),
  path.resolve(__dirname, 'downloads', 'asmo-inventory-v2.1.0.apk'),
  path.resolve(__dirname, 'downloads', 'asmo-inventory-v2.0.0.apk'),
  path.resolve(__dirname, 'public', 'downloads', 'asmo-inventory.apk'),
];

const handleApkDownload = (_req: express.Request, res: express.Response) => {
  for (const candidate of apkCandidates) {
    if (fs.existsSync(candidate)) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="asmo-inventory-v2.2.0.apk"');
      return res.sendFile(candidate);
    }
  }
  return res.redirect('https://github.com/sulman200101-ux/Hxgc/releases/download/v2.2.0/asmo-inventory-v2.2.0.apk');
};

app.get('/download/asmo-inventory.apk', handleApkDownload);
app.get('/downloads/asmo-inventory.apk', handleApkDownload);
app.get('/asmo-inventory.apk', handleApkDownload);
app.get('/asmo-inventory-app.apk', handleApkDownload);
app.get('/asmo-inventory-v2.2.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.1.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.0.0.apk', handleApkDownload);
app.get('/asmo-inventory-v1.9.0.apk', handleApkDownload);
app.get('/asmo-inventory-v1.8.0.apk', handleApkDownload);
app.get('/asmo-inventory-v1.7.0.apk', handleApkDownload);
app.get('/asmo-inventory-v1.6.0.apk', handleApkDownload);
app.get('/api/download-apk', handleApkDownload);

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  getNodeOcrWorker().catch(() => {});

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
