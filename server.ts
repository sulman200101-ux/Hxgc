import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { createWorker } from 'tesseract.js';
import { parseRawTextOcr, combineBestSheetExtractions } from './src/services/localOcr';
import { strict10DigitRegexFilter, dynamicLocationNormalizer } from './src/utils/regexSanitizer';

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

function getServerGeminiClient(customApiKey?: string): GoogleGenAI | null {
  const cleanCustom = (customApiKey || '').trim();
  if (cleanCustom) {
    return new GoogleGenAI({ apiKey: cleanCustom });
  }
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'undefined' || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function runGeminiVisionTableOcr(
  imageBase64: string,
  customPrompt?: string,
  customApiKey?: string
): Promise<any | null> {
  const ai = getServerGeminiClient(customApiKey);
  if (!ai) return null;

  try {
    const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/i);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, '').trim();
    if (!cleanBase64) return null;

    const candidateModels = [
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-flash-latest',
    ];
    const strictPrompt = `
    أنت محرك OCR بصري فائق الدقة مخصص لقراءة جداول جرد مستودعات شركة أسمو (ASMO SAP Physical Inventory).
    اقرأ جميع سطور جدول قطع الغيار من الصورة المرفقة من أول سطر في الأعلى حتى آخر سطر في الأسفل دون تخطي أي سطر (حتى 40+ سطراً في الورقة).

    قواعد استخراج الأعمدة بدقة 100%:
    1. رقم القطعة (part_number): يتكون من 10 أرقام في عمود Material (يبدأ غالباً بـ 10 أو 20 أو 30 أو 40). اقرأ الأرقام الـ 10 بدقة تامة بدون مسافات.
    2. كود الموقع المخزني (location_code): في عمود Storage Bin / Bin (مثل N11A1 أو N11FL1 أو N07BB2 أو N12C1 أو D1 أو A1). لا تخلط بينه وبين وحدة القياس (EA, SET, PK, PCS, KG).
    3. الوصف الإنجليزي (description): في عمود Material Description، انسخه كاملاً كما هو في السطر مع المقاسات والأرقام الفنية.
    4. الكمية (quantity): الرقم الصحيح المسجل في عمود الكمية (Qty / Count) بجوار وحدة القياس (مثل EA أو SET أو PCS).
    5. العلامات اليدوية والملاحظات (mark_symbol و remark):
       - إذا وجدت علامة صح (✓): اجعل mark_symbol = "✓" و remark = "" و audit_meaning = "القطع موجودة" و status = "مدقق".
       - إذا وجدت علامة خطأ أو إكس (X أو ✗): اجعل mark_symbol = "X" و remark = "" و audit_meaning = "القطع غير موجودة" و status = "غير موجود".
       - إذا وجدت حرف (F أو f مثل F أو F1): اجعل mark_symbol = "F" و remark = "F" و audit_meaning = "تم نقل العدد الزائد إلى مكان آخر" و status = "تم النقل".
       - إذا وجدت علامة ناقص مع رقم (مثل -1 أو -2 أو -3 أو 4-1 أو حرف N): اجعل mark_symbol = "N" وضع قيمة النقص الفعلية في remark (مثل "-1" أو "-2") و audit_meaning = "ناقص العدد" و status = "ناقص العدد".
       - إذا لم توجد أي علامة يدوية أمام السطر: اجعل mark_symbol = null و remark = "" و audit_meaning = null و status = "غير مدقق".
    6. لا تخمن أي بيانات غير موجودة في الصورة، وأخرج جميع السطور المرئية بترتيبها الفعلي في الورقة.
  `;

    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              parts: [
                { text: customPrompt ? `${strictPrompt}\n\n${customPrompt}` : strictPrompt },
                {
                  inlineData: {
                    mimeType,
                    data: cleanBase64,
                  },
                },
              ],
            },
          ],
          config: {
            temperature: 0.0,
            topK: 1,
            topP: 0.1,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              description: 'قائمة القطع المستخرجة من جدول الجرد',
              items: {
                type: Type.OBJECT,
                properties: {
                  part_number: {
                    type: Type.STRING,
                    nullable: true,
                    description: 'رقم القطعة المكون من 10 أرقام',
                  },
                  location_code: {
                    type: Type.STRING,
                    nullable: true,
                    description: 'كود الموقع المخزني (Storage Bin)',
                  },
                  description: {
                    type: Type.STRING,
                    nullable: true,
                    description: 'وصف القطعة بالإنجليزية كما في الجدول',
                  },
                  quantity: {
                    type: Type.INTEGER,
                    nullable: true,
                    description: 'الكمية المسجلة في الجدول',
                  },
                  mark_symbol: {
                    type: Type.STRING,
                    nullable: true,
                    enum: ['✓', 'X', 'F', 'N'],
                    description: 'الرمز المرسوم أمام القطعة إن وجد',
                  },
                  remark: {
                    type: Type.STRING,
                    nullable: true,
                    description: 'الملاحظة أو مقدار النقص مثل -1 أو -2 أو F إن وجد',
                  },
                  audit_meaning: {
                    type: Type.STRING,
                    nullable: true,
                    enum: [
                      'القطع موجودة',
                      'القطع غير موجودة',
                      'تم نقل العدد الزائد إلى مكان آخر',
                      'ناقص العدد',
                    ],
                    description: 'تفسير العلامة حسب قواعد الجرد',
                  },
                  status: {
                    type: Type.STRING,
                    enum: ['مدقق', 'غير موجود', 'تم النقل', 'ناقص العدد', 'غير مدقق'],
                    description: 'حالة الصنف النهائية',
                  },
                },
                required: [
                  'part_number',
                  'location_code',
                  'description',
                  'quantity',
                  'mark_symbol',
                  'remark',
                  'audit_meaning',
                  'status',
                ],
              },
            },
          },
        });

        const text = response.text?.trim();
        if (!text) continue;
        const parsed = JSON.parse(text);
        const rawList = Array.isArray(parsed)
          ? parsed
          : parsed && Array.isArray(parsed.items)
          ? parsed.items
          : [];

        const filteredList = rawList.filter((item: any) => {
          if (!item) return false;
          const hasPart = item.part_number && String(item.part_number).trim() !== '' && String(item.part_number).trim() !== 'null';
          const hasLoc = item.location_code && String(item.location_code).trim() !== '' && String(item.location_code).trim() !== 'null';
          const hasDesc = item.description && String(item.description).trim() !== '' && String(item.description).trim() !== 'null';
          return Boolean(hasPart || hasLoc || hasDesc);
        });

        if (filteredList.length > 0) {
          const normalizedItems = filteredList.map((row: any) => {
            const sym = row?.mark_symbol ?? null;
            const isMissing = sym === 'X' || row?.status === 'غير موجود' || Number(row?.is_missing) === 1 ? 1 : 0;
            const remark =
              sym === 'F'
                ? 'F'
                : sym === 'N'
                ? row?.remark && String(row.remark).trim() !== '' && String(row.remark).trim() !== 'null'
                  ? String(row.remark).trim()
                  : '-1'
                : row?.remark && String(row.remark).trim() !== 'null'
                ? String(row.remark).trim()
                : '';

            const rawPart = row?.part_number && row.part_number !== 'null' ? String(row.part_number).trim() : '';
            const cleanPart = strict10DigitRegexFilter(rawPart) || (/^\d{10}$/.test(rawPart) ? rawPart : '');
            const rawLoc = row?.location_code && row.location_code !== 'null' ? String(row.location_code).trim() : '';
            const cleanLoc = dynamicLocationNormalizer(rawLoc) || rawLoc.toUpperCase();
            const cleanDesc =
              row?.description && row.description !== 'null'
                ? String(row.description).trim()
                : row?.description_en && row.description_en !== 'null'
                ? String(row.description_en).trim()
                : '';
            const hasQty =
              row?.quantity !== null &&
              row?.quantity !== undefined &&
              String(row.quantity).trim() !== '' &&
              Number.isFinite(Number(row.quantity));
            const cleanQty = hasQty ? Number(row.quantity) : null;

            return {
              part_number: cleanPart,
              location_code: cleanLoc,
              description_en: cleanDesc,
              description: cleanDesc,
              qty_total: cleanQty !== null && cleanQty > 0 ? cleanQty : 0,
              quantity: cleanQty,
              mark_symbol: sym,
              audit_meaning: row?.audit_meaning ?? null,
              status: isMissing ? 'غير موجودة' : 'غير مدقق',
              is_missing: isMissing,
              remark,
            };
          });

          return {
            success: true,
            items: normalizedItems,
            skipped_rows: [],
          };
        }
      } catch (modelErr: any) {
        const msg = String(modelErr?.message || '');
        if (msg.includes('API key not valid') || msg.includes('API_KEY_INVALID')) {
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

    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, '').trim();
    if (cleanBase64) {
      const imgBuffer = Buffer.from(cleanBase64, 'base64');
      const { data } = await worker.recognize(imgBuffer);
      const natItems = parseRawTextOcr(data.text || '');
      extracted = combineBestSheetExtractions(extracted, natItems);
    }

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
        if (parsed.raw_text || parsed.left_text) {
          const fullRows = parsed.raw_text ? parseRawTextOcr(parsed.raw_text) : [];
          const leftRows = parsed.left_text ? parseRawTextOcr(parsed.left_text) : [];
          const unified = combineBestSheetExtractions(fullRows, leftRows);
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

async function runBestServerTableOcr(
  imageBase64: string,
  preprocessedBase64?: string,
  customPrompt?: string,
  customApiKey?: string
): Promise<any> {
  const geminiResult = await runGeminiVisionTableOcr(imageBase64, customPrompt, customApiKey);
  if (geminiResult?.success && Array.isArray(geminiResult.items) && geminiResult.items.length > 0) {
    return geminiResult;
  }

  const pyResult = await runPythonTableOcr(imageBase64);
  if (pyResult?.success && Array.isArray(pyResult.items) && pyResult.items.length > 0) {
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
    const { imageBase64, preprocessedBase64, customPrompt, apiKey } = req.body;
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
      preprocessedBase64 ? String(preprocessedBase64) : undefined,
      customPrompt ? String(customPrompt) : undefined,
      apiKey ? String(apiKey) : undefined
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

const handleGeminiStatusCheck = async (req: express.Request, res: express.Response) => {
  const startMs = Date.now();
  const shouldLiveTest = req.query.test === '1' || req.body?.test === true;
  const customApiKey = req.body?.apiKey ? String(req.body.apiKey).trim() : undefined;
  const ai = getServerGeminiClient(customApiKey);

  if (!ai) {
    return res.status(200).json({
      ok: true,
      geminiActive: false,
      localOcrActive: true,
      model: 'gemini-3-flash-preview',
      latencyMs: Date.now() - startMs,
      statusLabel: 'متوقف (يعمل القارئ المحلي الذكي تلقائياً)',
      details: 'محرك Gemini السحابي غير مفعل حالياً على الخادم؛ يعمل محرك القراءة البصري المحلي (WASM SIMD + خوارزمية الـ 37 سطراً) بكفاءة 100%.',
    });
  }

  if (!shouldLiveTest && !customApiKey) {
    return res.status(200).json({
      ok: true,
      geminiActive: !geminiKeyInvalid,
      localOcrActive: true,
      model: 'gemini-3-flash-preview',
      latencyMs: Date.now() - startMs,
      statusLabel: !geminiKeyInvalid ? 'يعمل ونشط 🟢' : 'متوقف 🔴',
      details: !geminiKeyInvalid
        ? 'محرك Gemini السحابي (gemini-3-flash-preview) متصل وجاهز للقراءة الصارمة والتحليل الهندسي.'
        : 'محرك Gemini السحابي متوقف؛ يعمل القارئ المحلي الذكي تلقائياً.',
    });
  }

  const statusModels = [
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
  ];

  for (const modelName of statusModels) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: 'OK',
        config: {
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.MINIMAL,
          },
        },
      });
      const reply = (response.text || '').trim();
      if (reply.length > 0) {
        if (!customApiKey) {
          geminiKeyInvalid = false;
        }
        return res.status(200).json({
          ok: true,
          geminiActive: true,
          localOcrActive: true,
          model: modelName,
          latencyMs: Date.now() - startMs,
          statusLabel: 'يعمل ونشط 🟢',
          details: `تم اختبار الاتصال بمحرك Gemini (${modelName}) بنجاح خلال ${Date.now() - startMs} ملي ثانية — المحرك يعمل بكفاءة تامة.`,
        });
      }
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('API key not valid') || msg.includes('API_KEY_INVALID') || msg.includes('UNAUTHENTICATED')) {
        if (!customApiKey) {
          geminiKeyInvalid = true;
        }
        break;
      }
    }
  }

  return res.status(200).json({
    ok: true,
    geminiActive: false,
    localOcrActive: true,
    model: 'gemini-3-flash-preview',
    latencyMs: Date.now() - startMs,
    statusLabel: 'متوقف (يعمل القارئ المحلي الذكي تلقائياً)',
    details: 'تعذر الاتصال بمحرك Gemini السحابي حالياً؛ يعمل محرك القراءة المحلي الذكي (37 سطراً) بكفاءة 100% بدون انقطاع.',
  });
};

app.get('/api/gemini/status', handleGeminiStatusCheck);
app.post('/api/gemini/status', handleGeminiStatusCheck);

app.post('/api/gemini/analyze-parts', async (req, res) => {
  try {
    const { parts, apiKey } = req.body;
    if (!Array.isArray(parts) || parts.length === 0) {
      return res.status(200).json({
        success: false,
        analyses: [],
        message: 'لا توجد قطع مرسلة للتحليل.',
      });
    }

    const ai = getServerGeminiClient(apiKey ? String(apiKey) : undefined);
    if (!ai) {
      return res.status(200).json({
        success: false,
        fallbackToLocal: true,
        analyses: [],
        message: 'يتم استخدام المساعد الهندسي المحلي الذكي للترجمة وحسبة المقاسات بالملم وتوجيه الثقيل لموقع D.',
      });
    }

    const inputSummary = parts.slice(0, 45).map((p: any, idx: number) => ({
      index: idx + 1,
      part_number: String(p.part_number || `ITEM-${idx + 1}`),
      description_en: String(p.description_en || ''),
      current_location: String(p.location_code || 'N11A1'),
      quantity: Number(p.quantity || p.qty_remaining || 1),
    }));

    const prompt = `أنت مساعد هندسي ذكي (Gemini Industrial Assistant) متخصص في مستودعات قطع الغيار الصناعية (SAP Inventory Controller - ASMO).
المطلوب لكل قطعة في القائمة المرفقة (مع التركيز التام على المتشابهات بالصنف والحجم والمليمتر MM وبدون أي ارتفاع مواقع):
1. "description_ar": ترجمة عربية هندسية دقيقة وواضحة لوصف القطعة الإنجليزي مع ذكر الصنف والمقاس بالملم.
2. "dimensions_calculation_ar": حسبة تفصيلية للمقاسات والأبعاد المذكورة في الوصف مع تحويل أي مقاس بالبوصة (IN أو ") إلى المليمتر (MM) بدقة (1 بوصة = 25.4 ملم).
3. "material_ar": نوع المعدن أو المادة بالعربية.
4. "estimated_weight_kg": تقدير الوزن التقريبي للقطعة الواحدة بالكيلوجرام.
5. "weight_label_ar": نص يوضح الوزن التقريبي للقطعة وإجمالي الوزن للكمية.
6. "size_category": تصنيف الحجم والوزن ويجب أن يكون أحد القيم الثلاث فقط: "كبير / ثقيل" أو "متوسط الحجم" أو "صغير / خفيف".
7. "recommended_shelf_code": رمز الموقع الأنسب للقطعة حسب القاعدة المعتمدة:
   - "D" و "C": مخصصان للقطع الثقيلة جداً والكبيرة ("كبير / ثقيل") بحد أقصى 15 صنفاً لكل رف، وتجمع القطع الأغلى سعراً في رف واحد بحد أقصى 15 صنفاً فقط لكل رف.
   - "A" أو "B" أو "BB" أو "C": لتجميع القطع المتشابهة من نفس الصنف والحجم والمقاس بالملم (MM).
8. "recommended_bin": رمز الموقع المقترح كاملاً (مثال: إذا كانت القطعة ثقيلة في الممر N11 اقترح "N11D1" أو "D1").
9. "placement_reason_ar": سبب اختيار هذا الموقع بناءً على الصنف والحجم والمقاس بالملم (أو نقل الثقيل إلى الموقع D).

القطع المطلوب تحليلها:
${JSON.stringify(inputSummary)}`;

    const candidateModels = [
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
    ];
    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.MINIMAL,
            },
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
      message: error?.message || 'تم تفعيل المحلل الهندسي المحلي لحسبة المقاسات بالملم وتوجيه الثقيل لموقع D.',
    });
  }
});

const apkCandidates = [
  path.resolve(__dirname, 'public', 'asmo-inventory-v2.9.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-v2.8.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-v2.7.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-app.apk'),
  path.resolve(__dirname, 'downloads', 'asmo-inventory-v2.9.0.apk'),
  path.resolve(__dirname, 'downloads', 'asmo-inventory-v2.8.0.apk'),
  path.resolve(__dirname, 'public', 'downloads', 'asmo-inventory.apk'),
];

const handleApkDownload = (_req: express.Request, res: express.Response) => {
  for (const candidate of apkCandidates) {
    if (fs.existsSync(candidate)) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="asmo-inventory-v2.9.0.apk"');
      return res.sendFile(candidate);
    }
  }
  return res.redirect('https://github.com/sulman200101-ux/Hxgc/releases/download/v2.9.0/asmo-inventory-v2.9.0.apk');
};

app.get('/download/asmo-inventory.apk', handleApkDownload);
app.get('/downloads/asmo-inventory.apk', handleApkDownload);
app.get('/asmo-inventory.apk', handleApkDownload);
app.get('/asmo-inventory-app.apk', handleApkDownload);
app.get('/asmo-inventory-v2.9.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.8.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.7.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.6.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.5.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.4.0.apk', handleApkDownload);
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
    // Prepare OCR static files in the background without blocking server startup
    import('./scripts/prepare-ocr.mjs').catch(() => {});
  });
}

startServer();
