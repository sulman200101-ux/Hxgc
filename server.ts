import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

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

/**
 * تشغيل محرك بايثون الذكي (OpenCV + NumPy + C++ Tesseract Multi-Core) مباشرةً بدون الحاجة إلى Gemini API
 */
function runPythonTableOcr(imageBase64: string): Promise<any> {
  return new Promise((resolve) => {
    const scriptPath = path.resolve(__dirname, 'scripts', 'asmo_python_ocr.py');
    if (!fs.existsSync(scriptPath)) {
      return resolve({
        success: false,
        fallbackToLocal: true,
        items: [],
        skipped_rows: [],
        message: 'سكربت بايثون غير موجود، يتم التحويل للمحرك المحلي.',
      });
    }

    const py = spawn('python3', [scriptPath], {
      env: { ...process.env, OMP_THREAD_LIMIT: '1' },
    });

    let stdoutData = '';
    let stderrData = '';

    py.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    py.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    py.on('error', () => {
      resolve({
        success: false,
        fallbackToLocal: true,
        items: [],
        skipped_rows: [],
        message: 'تعذر تشغيل python3 على الخادم، يتم استخدام محرك المتصفح المحلي.',
      });
    });

    py.on('close', (code) => {
      if (code !== 0 || !stdoutData.trim()) {
        return resolve({
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
          return resolve({
            ...parsed,
            fallbackToLocal: true,
          });
        }
        resolve(parsed);
      } catch {
        resolve({
          success: false,
          fallbackToLocal: true,
          items: [],
          skipped_rows: [],
        });
      }
    });

    py.stdin.write(JSON.stringify({ imageBase64 }));
    py.stdin.end();
  });
}

// مسار القراءة الرئيسي المعتمد كلياً على بايثون (OpenCV + OCR) مع الإبقاء على نفس الرابط لتوافق الواجهة
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

    const result = await runPythonTableOcr(String(imageBase64));
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(200).json({
      success: false,
      fallbackToLocal: true,
      items: [],
      skipped_rows: [],
      message: error?.message || 'حدث خطأ أثناء معالجة الصورة عبر محرك بايثون',
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
    const result = await runPythonTableOcr(String(imageBase64));
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
    return res.status(500).json({ error: 'تعذر قراءة الجدول عبر محرك بايثون.' });
  }
});

app.post('/api/gemini/extract-part', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'الصورة غير متوفرة' });
    }
    const result = await runPythonTableOcr(String(imageBase64));
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
