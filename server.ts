import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

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

// تقديم ملفات محرك OCR المحلي (/ocr/worker.min.js وملفات WASM واللغات) مباشرة وبأعلى سرعة
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

/**
 * قراءة جدول الجرد السحابية السريعة عبر Gemini Vision (gemini-3.8-flash)
 * تستخرج كافة السطور المقروءة حتى لو كان بعض النص باهتاً أو غير مكتمل
 */
async function runGeminiVisionTableOcr(imageBase64: string): Promise<any | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'undefined' || apiKey.trim() === '') {
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

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
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
- location_code: رمز الموقع في عمود Storage Bin (مثل N01A1, N15BB2, N11C2, D1، أو اتركه فارغاً إن لم يظهر ليستنتجه النظام من السطور المجاورة).
- qty_total: الكمية الرقمية في عمود QTY بعد وحدة القياس (EA, SET, PK, PAA, ZYD, SH, KIT).
- is_missing: ضع 1 فقط إذا وجدت علامة خطأ (X أو ×) صريحة في عمود Check، وضع 0 إذا كانت علامة صح (✓) أو فارغة.
- remark: الملاحظات المكتوبة باليد مثل -1 أو -4 أو F2 إن وجدت، وإلا نص فارغ.
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
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
      return {
        success: true,
        items: parsed.items,
        skipped_rows: [],
      };
    }
    return null;
  } catch (err) {
    console.warn('Gemini Vision OCR fallback notice:', err);
    return null;
  }
}

/**
 * تشغيل محرك بايثون الذكي (OpenCV + NumPy + C++ Tesseract Multi-Core) كبديل خادمي
 */
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

    // منع خطأ write EPIPE عند إغلاق عملية بايثون مبكراً
    py.stdin.on('error', () => {
      // تجاهل خطأ EPIPE بأمان دون إيقاف خادم Node
    });

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

// مسار القراءة السحابي الهجين (Gemini Vision السريع أولاً ثم بايثون ثم البديل المحلي التلقائي)
app.post('/api/gemini/parse-table', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(200).json({
        success: false,
        items: [],
        skipped_rows: [],
        message: 'الصورة غير متوفرة. يرجى التقاط الورقة بوضوح.',
      });
    }

    const geminiResult = await runGeminiVisionTableOcr(String(imageBase64));
    if (geminiResult && geminiResult.success && Array.isArray(geminiResult.items) && geminiResult.items.length > 0) {
      return res.status(200).json(geminiResult);
    }

    const result = await runPythonTableOcr(String(imageBase64));
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
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(200).json({ success: false, items: [], skipped_rows: [] });
    }
    const result = await runPythonTableOcr(String(imageBase64));
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
    const geminiResult = await runGeminiVisionTableOcr(String(imageBase64));
    const result = geminiResult?.success ? geminiResult : await runPythonTableOcr(String(imageBase64));
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
    const geminiResult = await runGeminiVisionTableOcr(String(imageBase64));
    const result = geminiResult?.success ? geminiResult : await runPythonTableOcr(String(imageBase64));
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

const apkCandidates = [
  path.resolve(__dirname, 'public', 'asmo-inventory-v1.6.0.apk'),
  path.resolve(__dirname, 'downloads', 'asmo-inventory-v1.6.0.apk'),
  path.resolve(__dirname, 'public', 'downloads', 'asmo-inventory.apk'),
];

const handleApkDownload = (_req: express.Request, res: express.Response) => {
  for (const candidate of apkCandidates) {
    if (fs.existsSync(candidate)) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="asmo-inventory-v1.6.0.apk"');
      return res.sendFile(candidate);
    }
  }
  return res.redirect('https://github.com/sulman200101-ux/Hxgc/releases/download/v1.6.0/asmo-inventory-v1.6.0.apk');
};

app.get('/download/asmo-inventory.apk', handleApkDownload);
app.get('/downloads/asmo-inventory.apk', handleApkDownload);
app.get('/asmo-inventory.apk', handleApkDownload);
app.get('/asmo-inventory-v1.6.0.apk', handleApkDownload);
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
