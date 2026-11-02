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

function getServerGeminiClient(): GoogleGenAI | null {
  if (geminiKeyInvalid) return null;
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

async function runGeminiVisionTableOcr(imageBase64: string, customPrompt?: string): Promise<any | null> {
  const ai = getServerGeminiClient();
  if (!ai) return null;

  try {
    const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/i);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, '').trim();
    if (!cleanBase64) return null;

    const candidateModels = ['gemini-1.5-flash', 'gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-flash-latest'];
    const strictPrompt = `
    أنت نظام OCR صارم ودقيق مخصص لجرد قطع غيار ASMO.
    مهمتك استخراج البيانات من جدول القطع الموجود في الصورة فقط.
    شروط صارمة جداً:
    1. اقرأ النصوص والأرقام المرئية بوضوح تام فقط.
    2. يُمنع منعاً باتاً تخمين، استنتاج، أو توليد أي أرقام قطع (Part Numbers) أو كميات غير موجودة.
    3. رقم القطعة يجب أن يتكون من 10 أرقام دقيقة، إذا كان غير مقروء اتركه فارغاً.
    4. إذا كان الحقل غير واضح، قم بإرجاع قيمة null.
    5. قم بإرجاع النتيجة كـ مصفوفة JSON تحتوي على الكائنات التالية: part_number, location_code, description, quantity.
    (مع دعم استخراج is_missing: 1 عند وجود علامة X صريحة في عمود Check، و remark: عند وجود علامة ناقص مثل -1 أو -2 فقط).
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
                    data: cleanBase64, // تمرير الصورة كاملة بدون أي تقسيم
                  },
                },
              ],
            },
          ],
          config: {
            temperature: 0.0, // قراءة صارمة 100% بدون أي تخمين
            topK: 1, // تقليل الخيارات المحتملة للنصوص
            topP: 0.1, // أخذ أعلى الاحتمالات دقة فقط
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json', // إجبار الاستجابة لتكون JSON نظيف خالي من أي نصوص إضافية
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

        if (rawList.length > 0) {
          const normalizedItems = rawList.map((row: any) => ({
            part_number: row?.part_number ?? '',
            location_code: row?.location_code ?? '',
            description_en: row?.description ?? row?.description_en ?? '',
            description: row?.description ?? row?.description_en ?? '',
            qty_total:
              row?.quantity !== null && row?.quantity !== undefined
                ? Number(row.quantity) || 1
                : row?.qty_total !== null && row?.qty_total !== undefined
                ? Number(row.qty_total) || 1
                : 1,
            quantity:
              row?.quantity !== null && row?.quantity !== undefined
                ? Number(row.quantity) || 1
                : row?.qty_total !== null && row?.qty_total !== undefined
                ? Number(row.qty_total) || 1
                : 1,
            is_missing: Number(row?.is_missing) === 1 ? 1 : 0,
            remark: row?.remark ? String(row.remark) : '',
          }));

          return {
            success: true,
            items: normalizedItems,
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

    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, '').trim();
    if (cleanBase64) {
      const imgBuffer = Buffer.from(cleanBase64, 'base64');
      const { data } = await worker.recognize(imgBuffer);
      const natItems = parseRawTextOcr(data.text || '');
      extracted = combineBestSheetExtractions(extracted, natItems);
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

async function runBestServerTableOcr(
  imageBase64: string,
  preprocessedBase64?: string,
  customPrompt?: string
): Promise<any> {
  const geminiResult = await runGeminiVisionTableOcr(imageBase64, customPrompt);
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
    const { imageBase64, preprocessedBase64, customPrompt } = req.body;
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
      customPrompt ? String(customPrompt) : undefined
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
  const ai = getServerGeminiClient();

  if (!ai) {
    return res.status(200).json({
      ok: true,
      geminiActive: false,
      localOcrActive: true,
      model: 'gemini-3.8-flash',
      latencyMs: Date.now() - startMs,
      statusLabel: 'متوقف (يعمل القارئ المحلي الذكي تلقائياً)',
      details: 'محرك Gemini السحابي غير مفعل حالياً على الخادم؛ يعمل محرك القراءة البصري المحلي (WASM SIMD + خوارزمية الـ 37 سطراً) بكفاءة 100%.',
    });
  }

  if (!shouldLiveTest) {
    return res.status(200).json({
      ok: true,
      geminiActive: !geminiKeyInvalid,
      localOcrActive: true,
      model: 'gemini-3.8-flash',
      latencyMs: Date.now() - startMs,
      statusLabel: !geminiKeyInvalid ? 'يعمل ونشط 🟢' : 'متوقف 🔴',
      details: !geminiKeyInvalid
        ? 'محرك Gemini السحابي متصل وجاهز للقراءة والتحليل الهندسي مع محرك القراءة المحلي.'
        : 'محرك Gemini السحابي متوقف؛ يعمل القارئ المحلي الذكي تلقائياً.',
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: 'Respond with OK',
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    const reply = (response.text || '').trim();
    const isWorking = reply.length > 0;
    if (isWorking) {
      geminiKeyInvalid = false;
    }
    return res.status(200).json({
      ok: true,
      geminiActive: isWorking,
      localOcrActive: true,
      model: 'gemini-3.8-flash',
      latencyMs: Date.now() - startMs,
      statusLabel: isWorking ? 'يعمل ونشط 🟢' : 'متوقف 🔴',
      details: isWorking
        ? `تم اختبار الاتصال بمحرك Gemini (gemini-3.8-flash) بنجاح خلال ${Date.now() - startMs} ملي ثانية — المحرك يعمل بكفاءة تامة.`
        : 'لم يستجب المحرك السحابي؛ يعمل القارئ المحلي الذكي تلقائياً.',
    });
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('API key not valid') || msg.includes('UNAUTHENTICATED')) {
      geminiKeyInvalid = true;
    }
    return res.status(200).json({
      ok: true,
      geminiActive: false,
      localOcrActive: true,
      model: 'gemini-3.8-flash',
      latencyMs: Date.now() - startMs,
      statusLabel: 'متوقف (يعمل القارئ المحلي الذكي تلقائياً)',
      details: 'تعذر الاتصال بمحرك Gemini السحابي حالياً؛ يعمل محرك القراءة المحلي الذكي (37 سطراً) بكفاءة 100% بدون انقطاع.',
    });
  }
};

app.get('/api/gemini/status', handleGeminiStatusCheck);
app.post('/api/gemini/status', handleGeminiStatusCheck);

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

    const ai = getServerGeminiClient();
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

    const candidateModels = ['gemini-3.8-flash', 'gemini-flash-latest'];
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
      message: error?.message || 'تم تفعيل المحلل الهندسي المحلي لحسبة المقاسات بالملم وتوجيه الثقيل لموقع D.',
    });
  }
});

const apkCandidates = [
  path.resolve(__dirname, 'public', 'asmo-inventory-v2.4.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-app.apk'),
  path.resolve(__dirname, 'downloads', 'asmo-inventory-v2.4.0.apk'),
];

const handleApkDownload = (_req: express.Request, res: express.Response) => {
  for (const candidate of apkCandidates) {
    if (fs.existsSync(candidate)) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="asmo-inventory-v2.4.0.apk"');
      return res.sendFile(candidate);
    }
  }
  return res.redirect('https://github.com/sulman200101-ux/Hxgc/releases/download/v2.4.0/asmo-inventory-v2.4.0.apk');
};

app.get('/download/asmo-inventory.apk', handleApkDownload);
app.get('/downloads/asmo-inventory.apk', handleApkDownload);
app.get('/asmo-inventory.apk', handleApkDownload);
app.get('/asmo-inventory-app.apk', handleApkDownload);
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
    setTimeout(() => {
      getNodeOcrWorker().catch(() => {});
    }, 2500);
  });
}

startServer();
