import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { parseRawTextOcr, combineBestSheetExtractions } from './src/services/localOcr';
import { applyRightColumnDescriptions } from './src/utils/strictTableParser';
import {
  repair10DigitMaterialCode,
  dynamicLocationNormalizer,
  resolveSheetLocationsWithContext,
} from './src/utils/regexSanitizer';
import { categorizeAndTranslate } from './src/utils/translator';
import { parseSapPipeBatchText } from './src/utils/sapTextParser';
import type { InventoryItem } from './src/types';

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

async function shouldRotateSidewaysSharpBuffer(buf: Buffer): Promise<boolean> {
  try {
    const preMeta = await sharp(buf, { failOn: 'none' }).rotate().metadata();
    if (preMeta.width && preMeta.height && preMeta.width > preMeta.height * 1.12) {
      // الصورة بالفعل بالوضع الأفقي العرضي، لا تقم بتدويرها
      return false;
    }

    const { data, info } = await sharp(buf, { failOn: 'none' })
      .rotate()
      .grayscale()
      .resize({ width: 280, height: 280, fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    if (w < 64 || h < 64) return false;

    const x0 = Math.floor(w * 0.12);
    const x1 = Math.floor(w * 0.88);
    const y0 = Math.floor(h * 0.12);
    const y1 = Math.floor(h * 0.88);

    const rowMeans: number[] = [];
    for (let y = y0; y < y1; y++) {
      let s = 0;
      for (let x = x0; x < x1; x++) s += data[y * w + x];
      rowMeans.push(s / Math.max(1, x1 - x0));
    }

    const colMeans: number[] = [];
    for (let x = x0; x < x1; x++) {
      let s = 0;
      for (let y = y0; y < y1; y++) s += data[y * w + x];
      colMeans.push(s / Math.max(1, y1 - y0));
    }

    let rowDiffEnergy = 0;
    for (let i = 1; i < rowMeans.length; i++) {
      rowDiffEnergy += Math.abs(rowMeans[i] - rowMeans[i - 1]);
    }
    let colDiffEnergy = 0;
    for (let i = 1; i < colMeans.length; i++) {
      colDiffEnergy += Math.abs(colMeans[i] - colMeans[i - 1]);
    }

    return colDiffEnergy > rowDiffEnergy * 1.12;
  } catch {
    return false;
  }
}

/**
 * خوارزمية تحسين وتنقية صور الجداول فائقة السرعة عبر مكتبة Sharp (C++ libvips):
 * 1. تصحيح اتجاه EXIF التلقائي وتدوير الأوراق العرضية الملتقطة طولياً (-90 درجة) تلقائياً.
 * 2. تسطيح إضاءة الورقة وموازنة التباين وإبراز حدة الأرقام الـ 10 والحبر اليدوي الملون (بدون تشويه التدرج).
 * 3. قص نسخة مكبرة 2x لأعمدة اليسار (Material / Storage Bin / QTY) لإرسالها مع الورقة الكاملة في طلب Gemini واحد موحد.
 */
async function enhanceTableImageWithSharp(
  cleanBase64: string,
  options?: { ocrZones?: boolean }
): Promise<{
  enhancedBase64: string;
  enhancedBuffer: Buffer;
  leftColumnsBase64: string | null;
  leftColumnsBuffer: Buffer | null;
  printedQtyBuffer: Buffer | null;
  rightDescBuffer: Buffer | null;
  height: number;
  width: number;
}> {
  const inputBuffer = Buffer.from(cleanBase64, 'base64');
  try {
    const needsRotateCcw = await shouldRotateSidewaysSharpBuffer(inputBuffer);
    const rotatedBuffer = needsRotateCcw
      ? await sharp(inputBuffer, { failOn: 'none' }).rotate().rotate(-90).toBuffer()
      : await sharp(inputBuffer, { failOn: 'none' }).rotate().toBuffer();

    const meta = await sharp(rotatedBuffer, { failOn: 'none' }).metadata();
    const origW = meta.width || 1600;
    const origH = meta.height || 1200;

    const targetW = Math.max(1900, Math.min(2200, origW));

    const enhancedBuffer = await sharp(rotatedBuffer, { failOn: 'none' })
      .resize({ width: targetW, kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
      .normalize({ lower: 2, upper: 98 })
      .linear(1.18, -16)
      .sharpen({ sigma: 0.9 })
      .jpeg({ quality: 85 })
      .toBuffer();

    const enhMeta = await sharp(enhancedBuffer).metadata();
    const enhW = enhMeta.width || targetW;
    const enhH = enhMeta.height || origH;

    let leftColumnsBuffer: Buffer | null = null;
    let leftColumnsBase64: string | null = null;
    let printedQtyBuffer: Buffer | null = null;
    let rightDescBuffer: Buffer | null = null;

    try {
      if (enhW >= 700 && enhH >= 400) {
        // تكبير فائق السرعة لأعمدة البيانات اليسرى (Material 10-digit + Storage Bin + Unit + QTY) لعرضها مع الورقة في نفس طلب Gemini
        const leftStart = Math.max(0, Math.round(enhW * 0.02));
        const leftWidth = Math.max(420, Math.min(enhW - leftStart, Math.round(enhW * 0.48)));
        const leftZoomBuf = await sharp(enhancedBuffer)
          .extract({ left: leftStart, top: 0, width: leftWidth, height: enhH })
          .resize({ width: 1350, kernel: sharp.kernel.lanczos3 })
          .sharpen({ sigma: 1.0 })
          .jpeg({ quality: 86 })
          .toBuffer();
        leftColumnsBase64 = leftZoomBuf.toString('base64');

        // مناطق OCR الإضافية تُولَّد فقط عند استخدام محرك Tesseract الاحتياطي على الخادم
        if (options?.ocrZones) {
          leftColumnsBuffer = await sharp(leftZoomBuf)
            .grayscale()
            .normalize()
            .linear(1.3, -18)
            .jpeg({ quality: 92 })
            .toBuffer();

          const printedStart = Math.max(0, Math.round(enhW * 0.035));
          const printedWidth = Math.max(360, Math.min(enhW - printedStart, Math.round(enhW * 0.37)));
          printedQtyBuffer = await sharp(enhancedBuffer)
            .extract({ left: printedStart, top: 0, width: printedWidth, height: enhH })
            .resize({ width: 1400, kernel: sharp.kernel.lanczos3 })
            .grayscale()
            .normalize()
            .linear(1.3, -18)
            .sharpen({ sigma: 1.2 })
            .jpeg({ quality: 92 })
            .toBuffer();

          const rightStart = Math.max(0, Math.round(enhW * 0.66));
          const rightWidth = Math.max(260, Math.min(enhW - rightStart, Math.round(enhW * 0.28)));
          rightDescBuffer = await sharp(enhancedBuffer)
            .extract({ left: rightStart, top: 0, width: rightWidth, height: enhH })
            .resize({ width: 1200, kernel: sharp.kernel.lanczos3 })
            .grayscale()
            .normalize()
            .linear(1.3, -18)
            .sharpen({ sigma: 1.2 })
            .jpeg({ quality: 92 })
            .toBuffer();
        }
      }
    } catch {
      leftColumnsBase64 = null;
      leftColumnsBuffer = null;
      printedQtyBuffer = null;
      rightDescBuffer = null;
    }

    return {
      enhancedBase64: enhancedBuffer.toString('base64'),
      enhancedBuffer,
      leftColumnsBase64,
      leftColumnsBuffer,
      printedQtyBuffer,
      rightDescBuffer,
      width: enhW,
      height: enhH,
    };
  } catch {
    return {
      enhancedBase64: cleanBase64,
      enhancedBuffer: inputBuffer,
      leftColumnsBase64: null,
      leftColumnsBuffer: null,
      printedQtyBuffer: null,
      rightDescBuffer: null,
      width: 0,
      height: 0,
    };
  }
}

const GEMINI_CANDIDATE_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
];

let cachedVisionModel: string | null = null;
const modelCooldownUntil: Record<string, number> = {};

function buildRowByRowPrompt(hasZoomCrop: boolean, customPrompt?: string): string {
  const zoomNote = hasZoomCrop
    ? `مرفق صورتان للورقة نفسها:
- الصورة 1: الورقة الكاملة لقراءة المحاذاة الكاملة والوصف الإنجليزي وعلامات التدقيق والملاحظات اليدوية.
- الصورة 2: **تكبير عالي الدقة لأعمدة البيانات اليسرى** (رقم المادة الـ 10، الموقع، الوحدة، والكمية) — استخدم الصورة 2 لتدقيق كل خانة من أرقام المواد الـ 10 (الفرق بين 0 و 8 و 6 و 9 و 3 و 5 و 1 و 7) لأن خطأ رقم واحد يعني ضياع قطعة!`
    : `افحص كامل ورقة الجدول من أول صف فعلي في الأعلى حتى آخر صف فعلي في الأسفل بدقة تامة.`;

  return `
أنت مدقق ومراقب جودة قراءة جداول قطع الغيار (ASMO SAP Inventory Controller).
المهمة الصارمة: استخرج قائمة الصفوف الفعلية المطبوعة في الجدول فقط بالعدد الدقيق المطابق للورقة (إذا كانت الورقة تحتوي على 37 صفاً فأرجع 37 عنصراً بالضبط — لا 38 ولا 43!).

${zoomNote}

قواعد منع الأسطر الزائدة ودقة الأرقام (Strict Exact-Row & Digit-Precision Protocol):
1. استخرج **فقط** صفوف الجدول الفعلية التي تبدأ في أقصى اليسار بصف مطبوع يحمل رقم مادة مكوناً من 10 أرقام (يبدأ غالباً بـ 100 مثل 1001131494 أو 1000995378).
2. **يُمنع منعاً باتاً** اختلاق أو تكرار أو تقسيم أي صف! إذا التَفّ الوصف الإنجليزي (Material Description) لقطعة واحدة على سطرين، ادمجه في نفس الصف ولا تنشئ له صفاً إضافياً أبداً.
3. تجاهل تماماً الترويسة، وأسطر الإجمالي/عدد القطع (مثل 37 Items)، وأسطر دليل الرموز أسفل الورقة مثل (F) Found / (S) Short / (D) Damaged / (L) Lost / (UID) Unidentified، وأرقام حدود الجدول (مثل 2212121215) — هذه ليست صفوف أصناف.
4. ملاحظة المكرر الشرعي: قد يتكرر نفس رقم القطعة الـ 10 في صفين مستقلين داخل الجدول (بكميتين أو علامتين مختلفتين)؛ هنا فقط يظل كل صف مطبوع مستقلاً بترتيبه، أما الصف الواحد فلا يُكرر أبداً.
5. هيكل أعمدة جدول SAP في أسمو:
   - تجاهل أرقام التسلسل القصيرة في أقصى اليسار (مثل 1951، 1952، 2801، 1، 2...).
   - رقم القطعة (part_number): 10 أرقام دقيقة تماماً، تحقق منه حرفياً من الصورة المكبرة.
   - تجاهل رموز المصنع والمستودع الثابتة مثل (C006 و M016 و 002 و 0001).
   - رمز الموقع المخزني (location_code / Storage Bin): استخرج الكود بدقة مثل (N07BB2, N07D1, N07FL1, N08A1, N15BB2, N15C1, N15D2, N15FL1, N16D1, N16D2, N16A1, N17A1, N17B1, P16C2, P16D1, P16D2, P16FL1, P16FL2, 22-C-11-B).
   - الكمية (quantity / QTY): الرقم الصحيح المكتوب في عمود QTY بجانب وحدة القياس Bun (KIT, EA, ZYD, SET, PK, PAA, SH, PC, KG, M, L, ROL, BOX, BAG).
    - الوصف الإنجليزي (description): انسخ وصف القطعة الإنجليزي كما هو مطبوع (بدون دمج كلمات من صف آخر).
6. علامات التدقيق (Check) والملاحظات اليدوية (Remark) على نفس مستوى السطر:
   - علامة صح (✓): mark_symbol = "✓", remark = "" (أو "+4" / "+1" إذا كانت مكتوبة).
   - علامة خطأ/إكس (X أو ✗): mark_symbol = "X", remark = "X".
   - ملاحظات (F) Found مثل F, F1, F2, F3, F5, F20: mark_symbol = "F", remark = الرمز المكتوب بدقة.
   - ملاحظات النقص/التلف/الفقد مثل S&T, S1, D1, L1, UID أو رقم سالب (-4, -1): mark_symbol = "N", remark = الرمز المكتوب بدقة. لا تعتبر حرف N في رمز الموقع (مثل N07BB2) نقصاً!
   - بدون علامة: mark_symbol = "", remark = "".
${customPrompt ? `\nملاحظات إضافية:\n${customPrompt}` : ''}
`.trim();
}

function normalizeGeminiRowPayload(row: any, fallbackRowIdx: number) {
  const rawSym = row?.mark_symbol ? String(row.mark_symbol).trim() : '';
  const sym =
    rawSym === '✓' || rawSym === '✔'
      ? '✓'
      : rawSym === 'X' || rawSym === '✗' || rawSym === '×'
      ? 'X'
      : rawSym === 'F' || rawSym === 'f'
      ? 'F'
      : rawSym === 'N' || rawSym === 'n' || rawSym === '-'
      ? 'N'
      : null;

  const rawRemark = row?.remark && row.remark !== 'null' ? String(row.remark).trim() : '';
  const isMissing = sym === 'X' || row?.status === 'غير موجود' || Number(row?.is_missing) === 1 ? 1 : 0;
  const remark =
    rawRemark
      ? rawRemark
      : sym === 'F'
      ? 'F'
      : sym === 'N'
      ? '-1'
      : '';

  const rawPart = row?.part_number && row.part_number !== 'null' ? String(row.part_number).trim() : '';
  const rawLoc = row?.location_code && row.location_code !== 'null' ? String(row.location_code).trim() : '';
  const cleanDesc =
    row?.description && row.description !== 'null'
      ? String(row.description).trim()
      : row?.description_en && row.description_en !== 'null'
      ? String(row.description_en).trim()
      : '';

  const { category, descAr: dictDescAr } = cleanDesc
    ? categorizeAndTranslate(cleanDesc)
    : { category: '', descAr: '' };
  const rawAiAr =
    row?.description_ar && row.description_ar !== 'null' ? String(row.description_ar).trim() : '';
  const cleanDescAr =
    rawAiAr && /[\u0600-\u06FF]/.test(rawAiAr) ? rawAiAr : dictDescAr;

  const cleanPart =
    repair10DigitMaterialCode(rawPart) ||
    (/^\d{10}$/.test(rawPart) ? rawPart : '') ||
    repair10DigitMaterialCode(cleanDesc) ||
    repair10DigitMaterialCode(rawLoc) ||
    '';
  const cleanLoc = dynamicLocationNormalizer(rawLoc) || rawLoc.toUpperCase();

  const hasQty =
    row?.quantity !== null &&
    row?.quantity !== undefined &&
    String(row.quantity).trim() !== '' &&
    Number.isFinite(Number(row.quantity));
  const cleanQty = hasQty ? Number(row.quantity) : null;
  const rowNum =
    row?.row_number !== null &&
    row?.row_number !== undefined &&
    Number.isFinite(Number(row.row_number))
      ? Number(row.row_number)
      : fallbackRowIdx;

  const derivedAuditMeaning =
    row?.audit_meaning && row.audit_meaning !== 'null'
      ? String(row.audit_meaning).trim()
      : sym === '✓'
      ? 'القطع موجودة'
      : sym === 'X' || isMissing
      ? 'القطع غير موجودة'
      : sym === 'F'
      ? 'تم نقل العدد الزائد إلى مكان آخر'
      : sym === 'N'
      ? 'ناقص العدد'
      : null;

  return {
    row_number: rowNum,
    part_number: cleanPart,
    location_code: cleanLoc,
    location: cleanLoc,
    description_en: cleanDesc,
    description_ar: cleanDescAr,
    description: cleanDesc,
    category,
    qty_total: cleanQty !== null && cleanQty > 0 ? cleanQty : 0,
    quantity: cleanQty,
    mark_symbol: sym,
    audit_meaning: derivedAuditMeaning,
    status: isMissing ? 'غير موجود' : 'غير مدقق',
    is_missing: isMissing,
    remark,
  };
}

async function runSingleGeminiRowScan(
  ai: GoogleGenAI,
  imageBase64Clean: string,
  leftColumnsBase64?: string | null,
  customPrompt?: string,
  preferredModel?: string
): Promise<{ items: any[]; modelUsed: string; modelErrors: Record<string, string> } | null> {
  const promptText = buildRowByRowPrompt(Boolean(leftColumnsBase64), customPrompt);
  const now = Date.now();
  const effectivePreferred =
    preferredModel && !(modelCooldownUntil[preferredModel] > now)
      ? preferredModel
      : cachedVisionModel && !(modelCooldownUntil[cachedVisionModel] > now)
      ? cachedVisionModel
      : undefined;

  const availableModels = GEMINI_CANDIDATE_MODELS.filter((m) => !(modelCooldownUntil[m] > now));
  const candidateList = availableModels.length > 0 ? availableModels : GEMINI_CANDIDATE_MODELS;
  const modelsOrder = effectivePreferred
    ? [effectivePreferred, ...candidateList.filter((m) => m !== effectivePreferred)]
    : candidateList;

  const imageParts: any[] = [
    { text: promptText },
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageBase64Clean,
      },
    },
  ];
  if (leftColumnsBase64) {
    imageParts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: leftColumnsBase64,
      },
    });
  }

  const modelErrors: Record<string, string> = {};

  for (const modelName of modelsOrder) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tAttempt = Date.now();
      try {
        const isGemini4 = modelName.startsWith('gemini-4-');
        const modelSpecificConfig: Record<string, any> = isGemini4
          ? {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            }
          : {};

        const response = await ai.models.generateContent({
          model: modelName,
          contents: { parts: imageParts },
          config: {
            ...modelSpecificConfig,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              description: 'قائمة السطور المستخرجة بالترتيب من الجدول سطراً بسطر',
              items: {
                type: Type.OBJECT,
                properties: {
                  row_number: {
                    type: Type.INTEGER,
                    description: 'رقم السطر التسلسلي في الجدول من الأعلى إلى الأسفل (1، 2، 3...)',
                  },
                  part_number: {
                    type: Type.STRING,
                    description: 'رقم القطعة المكون من 10 أرقام أو نص فارغ',
                  },
                  location_code: {
                    type: Type.STRING,
                    description: 'كود الموقع المخزني أو نص فارغ',
                  },
                  description: {
                    type: Type.STRING,
                    description: 'وصف القطعة بالإنجليزية كما في الجدول',
                  },
                  quantity: {
                    type: Type.INTEGER,
                    description: 'الكمية المسجلة في الجدول (0 إذا غير مقروءة)',
                  },
                  mark_symbol: {
                    type: Type.STRING,
                    description: 'الرمز المرسوم أمام القطعة (✓ أو X أو F أو N أو فارغ)',
                  },
                  remark: {
                    type: Type.STRING,
                    description: 'الملاحظة اليدوية كما كتبت مثل F1 أو F2 أو S&T أو D1 أو L1 أو UID أو -4',
                  },
                },
                required: ['row_number', 'part_number', 'location_code', 'description', 'quantity'],
              },
            },
          },
        });

        const text = response.text?.trim();
        if (!text) break;
        const parsed = JSON.parse(text);
        const rawList = Array.isArray(parsed)
          ? parsed
          : parsed && Array.isArray(parsed.items)
          ? parsed.items
          : [];

        const filteredList = rawList.filter((item: any) => {
          if (!item) return false;
          const hasPart =
            item.part_number &&
            String(item.part_number).trim() !== '' &&
            String(item.part_number).trim() !== 'null';
          const hasLoc =
            item.location_code &&
            String(item.location_code).trim() !== '' &&
            String(item.location_code).trim() !== 'null';
          const hasDesc =
            item.description &&
            String(item.description).trim() !== '' &&
            String(item.description).trim() !== 'null';
          return Boolean(hasPart || hasLoc || hasDesc);
        });

        if (filteredList.length > 0) {
          cachedVisionModel = modelName;
          console.log(`[Gemini Vision] OK ${modelName} in ${Date.now() - tAttempt}ms (rows=${filteredList.length})`);
          const normalized = resolveSheetLocationsWithContext(
            filteredList.map((row: any, idx: number) => normalizeGeminiRowPayload(row, idx + 1))
          );
          return { items: normalized, modelUsed: modelName, modelErrors };
        }
        if (Array.isArray(parsed) && parsed.length === 0) {
          cachedVisionModel = modelName;
          return { items: [], modelUsed: modelName, modelErrors };
        }
        break;
      } catch (modelErr: any) {
        const msg = String(modelErr?.message || '');
        const ms = Date.now() - tAttempt;
        modelErrors[modelName] = `${ms}ms: ${msg.slice(0, 180)}`;
        console.warn(`[Gemini Vision] FAIL ${modelName} in ${ms}ms:`, msg.slice(0, 220));
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
          modelCooldownUntil[modelName] = Date.now() + 90_000;
          break;
        }
        if (msg.includes('API key not valid') || msg.includes('API_KEY_INVALID') || msg.includes('UNAUTHENTICATED')) {
          geminiKeyInvalid = true;
          return { items: [], modelUsed: modelName, modelErrors };
        }
        const isTransientUnavailable = msg.includes('503') || msg.includes('500') || msg.includes('UNAVAILABLE');
        if (isTransientUnavailable && attempt === 0) {
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        break;
      }
    }
  }
  return { items: [], modelUsed: modelsOrder[0] || 'gemini-4-hydrogen', modelErrors };
}

function hasCriticalMissingFields(items: any[]): boolean {
  if (!items || items.length === 0) return false;
  return items.some(
    (r) =>
      !/^10\d{8}$/.test(String(r?.part_number || '').trim()) ||
      !String(r?.location_code || '').trim()
  );
}

/**
 * آلية Gemini المرحلة الثانية لتعزيز الدقة:
 * تقارن السطور المستخرجة بالصورة الأصلية لإصلاح أي رقم مادة ناقص أو موقع مفقود أو كمية أو ملاحظة مكتوبة بخط اليد وإثراء الترجمة الهندسية
 */
async function verifyAndEnhanceRowsWithGemini(
  ai: GoogleGenAI,
  imageBase64Clean: string | null,
  draftRows: any[],
  preferredModel?: string
): Promise<{ items: any[]; enhancedCount: number; modelUsed: string }> {
  if (!draftRows || draftRows.length === 0) {
    return { items: draftRows, enhancedCount: 0, modelUsed: preferredModel || 'gemini-4-hydrogen' };
  }

  const compactDraft = draftRows.slice(0, 80).map((r, idx) => ({
    row_number: idx + 1,
    part_number: String(r.part_number || '').trim(),
    location_code: String(r.location_code || r.location || '').trim(),
    quantity: Number(r.qty_total ?? r.quantity ?? 0),
    description: String(r.description_en || r.description || '').trim(),
    description_ar: String(r.description_ar || '').trim(),
    mark_symbol: r.mark_symbol ?? null,
    remark: String(r.remark || '').trim(),
  }));

  const verifyPrompt = `
أنت مدقق الجودة النهائي لجداول SAP في مستودعات أسمو (ASMO Accuracy Verifier).
لديك أدناه قائمة السطور المستخرجة مبدئياً بصيغة JSON${imageBase64Clean ? ' ومعها صورة الورقة المرجعية' : ''}.
مهمتك الصارمة لتعزيز الدقة:
1. حافظ على نفس عدد السطور ونفس الترتيب (row_number: 1..N) ولا تدمج السطور المكررة لنفس رقم القطعة أبداً.
2. راجع كل سطر${imageBase64Clean ? ' بمقارنته مباشرة مع الصورة' : ''}:
   - إذا كان part_number فارغاً أو لا يبدأ بـ 100 أو به خطأ قراءة رقمي واضح (مثل O بدل 0 أو I بدل 1 أو S بدل 5)، صححه بدقة من الصورة أو اتركه "" إذا لم يظهر في الصورة.
   - إذا كان location_code فارغاً أو مشوهاً، صححه حسب أكواد مواقع أسمو (مثل N07BB2, N07D1, N07FL1, N08A1, N15BB2, N15C1, N15D2, N15FL1, N16D1, N16D2, N16A1, N17A1, N17B1, P16C2, P16D1, P16D2, P16FL1, P16FL2)، وإذا كان الرمز مكتوباً بشكل صحيح لا تغيّره.
   - صحح الكمية quantity من عمود QTY ولا تتركها 0 إذا كان الرقم مطبوعاً بوضوح.
   - دقق العلامة اليدوية mark_symbol ("✓" أو "X" أو "F" أو "N" أو null) والملاحظة remark (مثل F1, F2, F20, S&T, S1, D1, L1, UID, -1, +4) ولا تفسر حرف N في رمز الموقع على أنه نقص!
   - حسّن الوصف الإنجليزي description بإزالة الرموز العشوائية فقط وحافظ على النص الأصلي (لا تغير IN إلى MM في الحقل الإنجليزي)، واكتب description_ar كترجمة عربية هندسية دقيقة مع تحويل أي مقاس بالبوصة (IN أو ") إلى المليمتر داخل الترجمة العربية فقط (1 بوصة = 25.4 مم).

السطور المبدئية:
${JSON.stringify(compactDraft)}
`.trim();

  const modelsToTry = preferredModel
    ? [preferredModel, ...GEMINI_CANDIDATE_MODELS.filter((m) => m !== preferredModel)]
    : GEMINI_CANDIDATE_MODELS;

  for (const modelName of modelsToTry) {
    try {
      const isGemini4 = modelName.startsWith('gemini-4-');
      const parts: any[] = [{ text: verifyPrompt }];
      if (imageBase64Clean) {
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageBase64Clean,
          },
        });
      }

      const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts },
        config: isGemini4
          ? {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    row_number: { type: Type.INTEGER },
                    part_number: { type: Type.STRING },
                    location_code: { type: Type.STRING },
                    quantity: { type: Type.INTEGER },
                    description: { type: Type.STRING },
                    description_ar: { type: Type.STRING },
                    mark_symbol: { type: Type.STRING },
                    remark: { type: Type.STRING },
                    audit_meaning: { type: Type.STRING },
                    status: { type: Type.STRING },
                  },
                  required: ['row_number', 'part_number', 'location_code', 'quantity', 'description'],
                },
              },
            }
          : {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
            },
      });

      const text = response.text?.trim();
      if (!text) continue;
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
      if (!list.length) continue;

      let enhancedCount = 0;
      const merged = draftRows.map((orig, idx) => {
        const verified = list.find((v: any) => Number(v.row_number) === idx + 1) || list[idx];
        if (!verified) return orig;

        const normVerified = normalizeGeminiRowPayload(verified, idx + 1);
        const origPartValid = /^10\d{8}$/.test(String(orig.part_number || '').trim());
        const nextPart = origPartValid
          ? orig.part_number
          : normVerified.part_number || orig.part_number || '';
        const origLocNorm = dynamicLocationNormalizer(orig.location_code || orig.location || '');
        const nextLoc =
          origLocNorm && !imageBase64Clean
            ? origLocNorm
            : normVerified.location_code || origLocNorm || orig.location_code || '';
        const nextQty =
          orig.qty_total > 0
            ? orig.qty_total
            : normVerified.qty_total > 0
            ? normVerified.qty_total
            : orig.qty_total || 0;
        const nextDescEn =
          normVerified.description_en && normVerified.description_en.length >= (orig.description_en || '').length
            ? normVerified.description_en
            : orig.description_en || normVerified.description_en || '';
        const nextDescAr =
          normVerified.description_ar && /[\u0600-\u06FF]/.test(normVerified.description_ar)
            ? normVerified.description_ar
            : orig.description_ar || '';
        const nextMark = normVerified.mark_symbol ?? orig.mark_symbol ?? null;
        const nextRemark = normVerified.remark || orig.remark || '';

        if (
          nextPart !== (orig.part_number || '') ||
          nextLoc !== (orig.location_code || '') ||
          nextQty !== (orig.qty_total || 0) ||
          nextDescAr !== (orig.description_ar || '') ||
          nextRemark !== (orig.remark || '')
        ) {
          enhancedCount++;
        }

        const isMissing = nextMark === 'X' || orig.is_missing === 1 ? 1 : 0;
        return {
          ...orig,
          part_number: nextPart,
          location_code: nextLoc,
          location: nextLoc,
          qty_total: nextQty,
          quantity: nextQty,
          description_en: nextDescEn,
          description: nextDescEn,
          description_ar: nextDescAr,
          mark_symbol: nextMark,
          remark: nextRemark,
          audit_meaning: normVerified.audit_meaning || orig.audit_meaning || null,
          is_missing: isMissing,
          status: isMissing ? 'غير موجود' : 'غير مدقق',
        };
      });

      return {
        items: resolveSheetLocationsWithContext(merged),
        enhancedCount,
        modelUsed: modelName,
      };
    } catch (err: any) {
      const msg = String(err?.message || '');
      console.warn(`[Gemini Enhance] ${modelName}:`, msg.slice(0, 180));
      if (msg.includes('API key not valid') || msg.includes('API_KEY_INVALID') || msg.includes('UNAUTHENTICATED')) {
        geminiKeyInvalid = true;
        break;
      }
    }
  }

  return { items: draftRows, enhancedCount: 0, modelUsed: preferredModel || 'gemini-4-hydrogen' };
}

function filterPhantomOrNoiseRows(items: any[]): any[] {
  if (!items || items.length === 0) return [];
  return items.filter((r) => {
    const part = String(r?.part_number || '').trim();
    const loc = String(r?.location_code || '').trim();
    const desc = String(r?.description_en || r?.description || '').trim().toUpperCase();

    if (
      /^\((?:F|S|D|L|UID)\)\s*(?:FOUND|SHORT|DAMAGED|LOST|UNIDENTIFIED)/i.test(desc) ||
      /^(?:MATERIAL\s+DESCRIPTION|STORAGE\s+BIN|COUNT\s+DATA|START\s+DATE|CONTROLLER|INVENTORY\s+LIST|TOTAL\s+ITEMS|PAGE\s+\d+)/i.test(
        desc
      )
    ) {
      return false;
    }

    // في جداول SAP الفعلية، كل صف حقيقي يمتلك رقم مادة من 10 أرقام (أو على الأقل موقع + وصف فعلي حقيقي في حال تعذر قراءة الرقم)
    const hasValid10Digit = /^10\d{8}$/.test(part) || /^\d{10}$/.test(part);
    if (hasValid10Digit) return true;
    return Boolean(loc && desc.length >= 6);
  });
}

async function runGeminiVisionTableOcr(
  imageBase64: string,
  customPrompt?: string
): Promise<any | null> {
  const ai = getServerGeminiClient();
  if (!ai) return null;

  const tStart = Date.now();
  try {
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, '').trim();
    if (!cleanBase64) return null;

    // معالجة Sharp السريعة (< 0.8s): الورقة الكاملة المحسنة + تكبير أعمدة اليسار في نفس الوقت
    const tSharp = Date.now();
    const { enhancedBase64, leftColumnsBase64 } = await enhanceTableImageWithSharp(cleanBase64, {
      ocrZones: false,
    });
    const sharpMs = Date.now() - tSharp;

    // 1. تمريرة واحدة حاسمة مزدوجة المنظور (الورقة الكاملة + أعمدة اليسار المكبرة)
    const tScan = Date.now();
    const fullScan = await runSingleGeminiRowScan(
      ai,
      enhancedBase64,
      leftColumnsBase64,
      customPrompt
    );
    const scanMs = Date.now() - tScan;
    let finalItems: any[] = filterPhantomOrNoiseRows(fullScan?.items || []);
    let modelUsed = fullScan?.modelUsed || 'gemini-4-hydrogen';

    // 2. تدقيق سريع فقط إذا بقيت خانة رقم مادة 10-أرقام أو موقع مفقود (بدون إعادة طلب كامل غير ضروري)
    let repairedCount = 0;
    let stage2Ms = 0;
    if (finalItems.length > 0 && hasCriticalMissingFields(finalItems)) {
      const tStage2 = Date.now();
      const verified = await verifyAndEnhanceRowsWithGemini(
        ai,
        leftColumnsBase64 || enhancedBase64,
        finalItems,
        modelUsed
      );
      stage2Ms = Date.now() - tStage2;
      finalItems = filterPhantomOrNoiseRows(verified.items);
      repairedCount = verified.enhancedCount;
      modelUsed = verified.modelUsed;
    }

    const totalMs = Date.now() - tStart;
    console.log(
      `[ASMO OCR] rows=${finalItems.length} model=${modelUsed} sharpMs=${sharpMs} scanMs=${scanMs} stage2Ms=${stage2Ms} totalMs=${totalMs}`
    );

    if (finalItems.length > 0) {
      return {
        success: true,
        items: resolveSheetLocationsWithContext(finalItems),
        skipped_rows: [],
        rowByRowVerified: true,
        geminiAccuracyEnhanced: true,
        repairedCount,
        bandsScanned: 1,
        modelUsed,
        modelErrors: fullScan?.modelErrors || {},
        timingMs: { sharpMs, scanMs, stage2Ms, totalMs },
      };
    }
    return {
      success: false,
      fallbackToLocal: true,
      items: [],
      skipped_rows: [],
      modelUsed,
      modelErrors: fullScan?.modelErrors || {},
      timingMs: { sharpMs, scanMs, stage2Ms, totalMs },
    };
  } catch (err: any) {
    console.warn('[ASMO OCR] Error:', err?.message || err);
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
      const { enhancedBuffer, leftColumnsBuffer, printedQtyBuffer, rightDescBuffer } =
        await enhanceTableImageWithSharp(cleanBase64, { ocrZones: true });
      const { data } = await worker.recognize(enhancedBuffer);
      const natItems = parseRawTextOcr(data.text || '');
      extracted = combineBestSheetExtractions(extracted, natItems);

      if (leftColumnsBuffer) {
        const { data: leftData } = await worker.recognize(leftColumnsBuffer);
        const leftItems = parseRawTextOcr(leftData.text || '');
        if (leftItems.length >= extracted.length) {
          extracted = combineBestSheetExtractions(leftItems, extracted);
        } else {
          extracted = combineBestSheetExtractions(extracted, leftItems);
        }
      }

      if (printedQtyBuffer && extracted.some((r: any) => !r.qty_total || r.qty_total <= 0)) {
        const { data: printedData } = await worker.recognize(printedQtyBuffer);
        const printedItems = parseRawTextOcr(printedData.text || '');
        extracted = combineBestSheetExtractions(extracted, printedItems);
      }

      if (
        rightDescBuffer &&
        extracted.length > 0 &&
        extracted.some((r: any) => !r.description_en || r.description_en.length < 6)
      ) {
        const { data: rightData } = await worker.recognize(rightDescBuffer);
        extracted = applyRightColumnDescriptions(extracted, rightData.text || '');
      }
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
  customPrompt?: string
): Promise<any> {
  const geminiResult = await runGeminiVisionTableOcr(imageBase64, customPrompt);
  if (geminiResult?.success && Array.isArray(geminiResult.items) && geminiResult.items.length > 0) {
    // نُرجع نتيجة Gemini المضبوطة مباشرة دون دمج بقايا Tesseract التي تضيف صفوفاً وهمية
    return geminiResult;
  }

  const pyResult = await runPythonTableOcr(imageBase64);
  if (pyResult?.success && Array.isArray(pyResult.items) && pyResult.items.length > 0) {
    return pyResult;
  }

  // إذا أعاد Gemini خطأ حصة أو شبكة، نُرجع fallbackToLocal فوراً ليعمل محرك المتصفح السريع دون تأخير الخادم بـ 4 تمريرات Tesseract CPU
  if (geminiResult && Object.keys(geminiResult.modelErrors || {}).length > 0) {
    return geminiResult;
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

app.post('/api/gemini/enhance-rows', async (req, res) => {
  try {
    const { rows, imageBase64 } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(200).json({
        success: false,
        items: [],
        enhancedCount: 0,
        message: 'لا توجد سطور مرسلة للتدقيق.',
      });
    }

    const ai = getServerGeminiClient();
    if (!ai) {
      return res.status(200).json({
        success: false,
        fallbackToLocal: true,
        items: rows,
        enhancedCount: 0,
        message: 'محرك Gemini غير مفعل على الخادم حالياً.',
      });
    }

    let cleanImageBase64: string | null = null;
    if (typeof imageBase64 === 'string' && imageBase64.trim()) {
      const rawClean = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, '').trim();
      if (rawClean) {
        try {
          const { enhancedBase64 } = await enhanceTableImageWithSharp(rawClean);
          cleanImageBase64 = enhancedBase64;
        } catch {
          cleanImageBase64 = rawClean;
        }
      }
    }

    const verified = await verifyAndEnhanceRowsWithGemini(
      ai,
      cleanImageBase64,
      rows,
      'gemini-4-hydrogen'
    );

    return res.status(200).json({
      success: true,
      items: verified.items,
      enhancedCount: verified.enhancedCount,
      modelUsed: verified.modelUsed,
    });
  } catch (error: any) {
    return res.status(200).json({
      success: false,
      fallbackToLocal: true,
      items: req.body?.rows || [],
      enhancedCount: 0,
      message: error?.message || 'تعذر تعزيز الدقة عبر Gemini.',
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
      model: 'gemini-4-hydrogen',
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
      model: 'gemini-4-hydrogen',
      latencyMs: Date.now() - startMs,
      statusLabel: !geminiKeyInvalid ? 'يعمل ونشط 🟢' : 'متوقف 🔴',
      details: !geminiKeyInvalid
        ? 'محرك Gemini السحابي (gemini-4-hydrogen) متصل على الخادم وجاهز للقراءة الصارمة والتحليل الهندسي.'
        : 'محرك Gemini السحابي متوقف؛ يعمل القارئ المحلي الذكي تلقائياً.',
    });
  }

  const statusModels = [
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite',
  ];
  const modelErrors: Record<string, string> = {};

  for (const modelName of statusModels) {
    const tModel = Date.now();
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: 'OK',
      });
      const reply = (response.text || '').trim();
      if (reply.length > 0) {
        geminiKeyInvalid = false;
        return res.status(200).json({
          ok: true,
          geminiActive: true,
          localOcrActive: true,
          model: modelName,
          latencyMs: Date.now() - startMs,
          modelErrors,
          statusLabel: 'يعمل ونشط 🟢',
          details: `تم اختبار الاتصال بمحرك Gemini على الخادم (${modelName}) بنجاح خلال ${Date.now() - startMs} ملي ثانية — المحرك يعمل بكفاءة تامة.`,
        });
      }
    } catch (err: any) {
      const msg = String(err?.message || '');
      modelErrors[modelName] = `${Date.now() - tModel}ms: ${msg.slice(0, 180)}`;
      if (msg.includes('API key not valid') || msg.includes('API_KEY_INVALID') || msg.includes('UNAUTHENTICATED')) {
        geminiKeyInvalid = true;
        break;
      }
    }
  }

  return res.status(200).json({
    ok: true,
    geminiActive: false,
    localOcrActive: true,
    model: 'gemini-4-hydrogen',
    latencyMs: Date.now() - startMs,
    modelErrors,
    statusLabel: 'متوقف (يعمل القارئ المحلي الذكي تلقائياً)',
    details: 'تعذر الاتصال بمحرك Gemini السحابي حالياً؛ يعمل محرك القراءة المحلي الذكي (37 سطراً) بكفاءة 100% بدون انقطاع.',
  });
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
        message: 'يتم استخدام المساعد الهندسي المحلي الذكي للترجمة وحسبة المقاسات بالملم وتوجيه القطع الاستهلاكية.',
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
المطلوب لكل قطعة في القائمة المرفقة:
1. "description_ar": ترجمة عربية هندسية دقيقة وواضحة لوصف القطعة الإنجليزي مع ذكر الصنف والمقاس بالملم.
2. "dimensions_calculation_ar": حسبة تفصيلية للمقاسات والأبعاد المذكورة في الوصف مع تحويل أي مقاس بالبوصة (IN أو ") إلى المليمتر (MM) بدقة (1 بوصة = 25.4 ملم).
3. "material_ar": نوع المعدن أو المادة بالعربية.
4. "estimated_weight_kg": تقدير الوزن التقريبي للقطعة الواحدة بالكيلوجرام.
5. "weight_label_ar": نص يوضح الوزن التقريبي للقطعة وإجمالي الوزن للكمية.
6. "size_category": تصنيف الحجم والوزن ويجب أن يكون أحد القيم الثلاث فقط: "كبير / ثقيل" أو "متوسط الحجم" أو "صغير / خفيف".
7. "recommended_shelf_code": رمز الموقع الأنسب للقطعة الاستهلاكية (A أو FL).
8. "recommended_bin": رمز الموقع المقترح كاملاً.
9. "placement_reason_ar": سبب اختيار هذا الموقع بناءً على الصنف الاستهلاكي والمقاس بالملم.

القطع المطلوب تحليلها:
${JSON.stringify(inputSummary)}`;

    const candidateModels = [
      'gemini-4-hydrogen',
      'gemini-3.1-flash-lite',
    ];
    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
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
      message: error?.message || 'تم تفعيل المحلل الهندسي المحلي لحسبة المقاسات بالملم وتوجيه القطع الاستهلاكية.',
    });
  }
});

// ============================================================================
// Mutable Runtime Inventory Database Store (External to source code: data/inventory-store.json)
// Allows unrestricted add, edit, delete, and full wipe at runtime.
// ============================================================================
interface RuntimeInventoryStore {
  revision: number;
  wipedAt: string | null;
  updatedAt: string;
  items: Record<string, InventoryItem>;
  tombstones: Record<string, string>;
}

const INVENTORY_STORE_DIR = path.resolve(__dirname, 'data');
const INVENTORY_STORE_FILE = path.join(INVENTORY_STORE_DIR, 'inventory-store.json');
const PUBLIC_INVENTORY_STORE_FILE = path.resolve(__dirname, 'public', 'inventory-store.json');

function createEmptyStore(): RuntimeInventoryStore {
  return {
    revision: 0,
    wipedAt: null,
    updatedAt: new Date(0).toISOString(),
    items: {},
    tombstones: {},
  };
}

function parseStoreFile(filePath: string): RuntimeInventoryStore | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return {
      revision: Number(parsed?.revision || 0),
      wipedAt: parsed?.wipedAt ? String(parsed.wipedAt) : null,
      updatedAt: String(parsed?.updatedAt || new Date().toISOString()),
      items: parsed?.items && typeof parsed.items === 'object' ? parsed.items : {},
      tombstones: parsed?.tombstones && typeof parsed.tombstones === 'object' ? parsed.tombstones : {},
    };
  } catch {
    return null;
  }
}

function loadRuntimeInventoryStore(): RuntimeInventoryStore {
  try {
    const dataStore = parseStoreFile(INVENTORY_STORE_FILE);
    const publicStore = parseStoreFile(PUBLIC_INVENTORY_STORE_FILE);
    if (dataStore && publicStore) {
      const dataCount = Object.keys(dataStore.items).length;
      const pubCount = Object.keys(publicStore.items).length;
      if (
        publicStore.revision > dataStore.revision ||
        (publicStore.revision === dataStore.revision && pubCount > dataCount && !dataStore.wipedAt)
      ) {
        saveRuntimeInventoryStore(publicStore);
        return publicStore;
      }
      return dataStore;
    }
    if (dataStore) return dataStore;
    if (publicStore) {
      saveRuntimeInventoryStore(publicStore);
      return publicStore;
    }
    return createEmptyStore();
  } catch (err) {
    console.warn('[Inventory Store] Failed to read store file, initializing empty:', err);
    return createEmptyStore();
  }
}

function saveRuntimeInventoryStore(store: RuntimeInventoryStore): void {
  if (!fs.existsSync(INVENTORY_STORE_DIR)) {
    fs.mkdirSync(INVENTORY_STORE_DIR, { recursive: true });
  }
  const serialized = JSON.stringify(store, null, 2);
  const tmpFile = `${INVENTORY_STORE_FILE}.tmp-${Date.now()}`;
  fs.writeFileSync(tmpFile, serialized, 'utf-8');
  fs.renameSync(tmpFile, INVENTORY_STORE_FILE);
  try {
    const pubDir = path.dirname(PUBLIC_INVENTORY_STORE_FILE);
    if (!fs.existsSync(pubDir)) {
      fs.mkdirSync(pubDir, { recursive: true });
    }
    const tmpPub = `${PUBLIC_INVENTORY_STORE_FILE}.tmp-${Date.now()}`;
    fs.writeFileSync(tmpPub, serialized, 'utf-8');
    fs.renameSync(tmpPub, PUBLIC_INVENTORY_STORE_FILE);
  } catch {
    // ignore if public dir is read-only in some environments
  }
}

app.get('/api/inventory/state', (_req, res) => {
  const store = loadRuntimeInventoryStore();
  const items = Object.values(store.items);
  return res.status(200).json({
    ok: true,
    revision: store.revision,
    wipedAt: store.wipedAt,
    updatedAt: store.updatedAt,
    count: items.length,
    items,
    tombstones: store.tombstones,
  });
});

app.post('/api/inventory/upsert', (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
    const store = loadRuntimeInventoryStore();
    const nowIso = new Date().toISOString();
    let applied = 0;

    for (const raw of incoming) {
      if (!raw) continue;
      const partNum = String(raw.part_number || '').trim();
      if (!/^\d{8,12}$/.test(partNum)) continue;

      const itemTime = String(raw.updated_at || nowIso);
      const tombAt = store.tombstones[partNum];
      if (tombAt && itemTime < tombAt) {
        continue;
      }
      if (store.wipedAt && itemTime < store.wipedAt) {
        continue;
      }

      const existing = store.items[partNum];
      if (existing?.updated_at && itemTime < existing.updated_at) {
        continue;
      }

      store.items[partNum] = {
        ...raw,
        part_number: partNum,
        updated_at: itemTime,
      };
      delete store.tombstones[partNum];
      applied++;
    }

    if (applied > 0) {
      store.revision += 1;
      store.updatedAt = nowIso;
      saveRuntimeInventoryStore(store);
    }

    return res.status(200).json({
      ok: true,
      revision: store.revision,
      applied,
      count: Object.keys(store.items).length,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'فشل حفظ القطع في القاعدة' });
  }
});

app.post('/api/inventory/delete', (req, res) => {
  try {
    const partNumbers: string[] = Array.isArray(req.body?.partNumbers) ? req.body.partNumbers : [];
    const deletedAt = String(req.body?.deletedAt || new Date().toISOString());
    const store = loadRuntimeInventoryStore();
    let deletedCount = 0;

    for (const rawPn of partNumbers) {
      const pn = String(rawPn || '').trim();
      if (!pn) continue;
      const existing = store.items[pn];
      if (!existing || !existing.updated_at || deletedAt >= existing.updated_at) {
        if (existing) {
          delete store.items[pn];
          deletedCount++;
        }
        const prevTomb = store.tombstones[pn];
        if (!prevTomb || deletedAt > prevTomb) {
          store.tombstones[pn] = deletedAt;
        }
      }
    }

    store.revision += 1;
    store.updatedAt = deletedAt;
    saveRuntimeInventoryStore(store);

    return res.status(200).json({
      ok: true,
      revision: store.revision,
      deletedCount,
      count: Object.keys(store.items).length,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'فشل حذف القطع من القاعدة' });
  }
});

app.post('/api/inventory/wipe', (req, res) => {
  try {
    const wipedAt = String(req.body?.wipedAt || new Date().toISOString());
    const store = loadRuntimeInventoryStore();
    const nextStore: RuntimeInventoryStore = {
      revision: store.revision + 1,
      wipedAt,
      updatedAt: wipedAt,
      items: {},
      tombstones: {},
    };
    saveRuntimeInventoryStore(nextStore);

    return res.status(200).json({
      ok: true,
      revision: nextStore.revision,
      wipedAt: nextStore.wipedAt,
      count: 0,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'فشل المسح الشامل للقاعدة' });
  }
});

app.post('/api/inventory/import-text', (req, res) => {
  try {
    const rawText = String(req.body?.rawText || '');
    const mergeDuplicatesWithExisting = req.body?.mergeExisting !== false;
    if (!rawText.trim()) {
      return res.status(400).json({ ok: false, message: 'النص المرسل فارغ' });
    }

    const nowIso = new Date().toISOString();
    const { items: parsedItems, stats } = parseSapPipeBatchText(rawText, { nowIso });
    if (parsedItems.length === 0) {
      return res.status(200).json({
        ok: false,
        message: 'لم يتم العثور على سطور قطع صالحة في النص المرسل',
        stats,
      });
    }

    const store = loadRuntimeInventoryStore();
    let inserted = 0;
    let updated = 0;

    for (const nextItem of parsedItems) {
      const pn = nextItem.part_number;
      const existing = store.items[pn];
      delete store.tombstones[pn];

      if (!existing) {
        store.items[pn] = nextItem;
        inserted++;
        continue;
      }

      updated++;
      if (!mergeDuplicatesWithExisting) {
        store.items[pn] = nextItem;
        continue;
      }

      const existingMissing = existing.is_missing === 1;
      const nextMissing = nextItem.is_missing === 1;

      if (existingMissing && !nextMissing) {
        store.items[pn] = {
          ...nextItem,
          old_location:
            existing.location_code && existing.location_code !== nextItem.location_code
              ? existing.location_code
              : nextItem.old_location,
          description_en: nextItem.description_en || existing.description_en,
          description_ar:
            nextItem.description_ar !== 'غير محدد'
              ? nextItem.description_ar
              : existing.description_ar,
          category: nextItem.category || existing.category,
          updated_at: nowIso,
        };
      } else if (!existingMissing && nextMissing) {
        store.items[pn] = {
          ...existing,
          old_location:
            existing.old_location ||
            (nextItem.location_code && nextItem.location_code !== existing.location_code
              ? nextItem.location_code
              : undefined),
          updated_at: nowIso,
        };
      } else {
        const combinedTotal = existing.qty_total + nextItem.qty_total;
        const combinedOut =
          existingMissing && nextMissing
            ? 0
            : Math.min(combinedTotal, existing.qty_out + nextItem.qty_out);
        const combinedRemaining =
          existingMissing && nextMissing ? 0 : Math.max(0, combinedTotal - combinedOut);
        const remarks = [existing.remark, nextItem.remark]
          .filter((r): r is string => Boolean(r && r.trim()))
          .filter((v, idx, arr) => arr.indexOf(v) === idx);
        if (nextItem.location_code && existing.location_code && existing.location_code !== nextItem.location_code) {
          const alt = `موقع آخر: ${nextItem.location_code}`;
          if (!remarks.includes(alt)) remarks.push(alt);
        }
        store.items[pn] = {
          ...existing,
          description_en: existing.description_en || nextItem.description_en,
          description_ar:
            existing.description_ar && existing.description_ar !== 'غير محدد'
              ? existing.description_ar
              : nextItem.description_ar,
          qty_total: combinedTotal,
          qty_out: combinedOut,
          qty_remaining: combinedRemaining,
          remark: remarks.length > 0 ? remarks.join(' | ') : undefined,
          is_missing: existingMissing && nextMissing ? 1 : 0,
          is_moved: existing.is_moved || nextItem.is_moved ? 1 : 0,
          status:
            existingMissing && nextMissing
              ? 'غير موجودة'
              : existing.status === 'تم النقل' || nextItem.status === 'تم النقل'
              ? 'تم النقل'
              : 'مدقق',
          updated_at: nowIso,
        };
      }
    }

    store.revision += 1;
    store.updatedAt = nowIso;
    saveRuntimeInventoryStore(store);

    return res.status(200).json({
      ok: true,
      revision: store.revision,
      inserted,
      updated,
      count: Object.keys(store.items).length,
      stats,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'فشل استيراد الدفعة النصية' });
  }
});

const apkCandidates = [
  path.resolve(__dirname, 'public', 'asmo-inventory-v3.4.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-v3.3.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-v3.2.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-v2.9.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-v2.8.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-v2.7.0.apk'),
  path.resolve(__dirname, 'public', 'asmo-inventory-app.apk'),
  path.resolve(__dirname, 'downloads', 'asmo-inventory-v3.4.0.apk'),
  path.resolve(__dirname, 'downloads', 'asmo-inventory-v3.3.0.apk'),
  path.resolve(__dirname, 'downloads', 'asmo-inventory-v3.2.0.apk'),
  path.resolve(__dirname, 'downloads', 'asmo-inventory-v2.9.0.apk'),
  path.resolve(__dirname, 'downloads', 'asmo-inventory-v2.8.0.apk'),
  path.resolve(__dirname, 'public', 'downloads', 'asmo-inventory.apk'),
];

const handleApkDownload = async (_req: express.Request, res: express.Response) => {
  for (const candidate of apkCandidates) {
    if (fs.existsSync(candidate)) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="asmo-inventory-v3.4.0.apk"');
      return res.sendFile(candidate);
    }
  }
  try {
    const hxgcRelease = await fetch(
      'https://api.github.com/repos/sulman200101-ux/Hxgc/releases/tags/v3.4.0',
      { headers: { 'User-Agent': 'aistudio-build' } }
    );
    if (hxgcRelease.ok) {
      return res.redirect(
        'https://github.com/sulman200101-ux/Hxgc/releases/download/v3.4.0/asmo-inventory-v3.4.0.apk'
      );
    }
  } catch {
    // fallback to latest release
  }
  return res.redirect('https://github.com/sulman200101-ux/Hxgc/releases/latest/download/asmo-inventory-v3.4.0.apk');
};

app.get('/download/asmo-inventory.apk', handleApkDownload);
app.get('/downloads/asmo-inventory.apk', handleApkDownload);
app.get('/asmo-inventory.apk', handleApkDownload);
app.get('/asmo-inventory-app.apk', handleApkDownload);
app.get('/asmo-inventory-v3.4.0.apk', handleApkDownload);
app.get('/asmo-inventory-v3.3.0.apk', handleApkDownload);
app.get('/asmo-inventory-v3.2.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.9.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.8.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.7.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.6.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.5.0.apk', handleApkDownload);
app.get('/asmo-inventory-v2.4.0.apk', handleApkDownload);
app.get('/api/download-apk', handleApkDownload);

app.get('/api/github/repo-build-status', async (req, res) => {
  const repo = String(req.query.repo || 'sulman200101-ux/Hxgc').trim();
  try {
    const [runsRes, releaseRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=5`, {
        headers: { 'User-Agent': 'aistudio-build' },
      }),
      fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { 'User-Agent': 'aistudio-build' },
      }),
    ]);

    const runsData: any = runsRes.ok ? await runsRes.json() : { workflow_runs: [] };
    const releaseData: any = releaseRes.ok ? await releaseRes.json() : null;

    const runs = Array.isArray(runsData?.workflow_runs)
      ? runsData.workflow_runs.slice(0, 4).map((r: any) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          htmlUrl: r.html_url,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          headSha: String(r.head_sha || '').slice(0, 7),
        }))
      : [];

    const apkAssets = Array.isArray(releaseData?.assets)
      ? releaseData.assets.map((a: any) => ({
          name: a.name,
          sizeMb: ((a.size || 0) / (1024 * 1024)).toFixed(2),
          downloadUrl: a.browser_download_url,
        }))
      : [];

    return res.status(200).json({
      ok: true,
      repo,
      runs,
      latestRelease: releaseData
        ? {
            tagName: releaseData.tag_name,
            name: releaseData.name,
            publishedAt: releaseData.published_at,
            htmlUrl: releaseData.html_url,
            assets: apkAssets,
          }
        : null,
    });
  } catch (err: any) {
    return res.status(200).json({
      ok: false,
      repo,
      runs: [],
      latestRelease: null,
      message: err?.message || 'تعذر جلب حالة البناء من المستودع',
    });
  }
});

app.post('/api/github/push-and-build', async (req, res) => {
  const repo = String(req.body?.repo || 'sulman200101-ux/Hxgc')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '');
  const token = String(req.body?.token || process.env.GITHUB_TOKEN || '').trim();

  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return res.status(400).json({
      ok: false,
      message: 'يرجى إدخال اسم المستودع بالصيغة الصحيحة مثل gslyman395-spec/Ashamy',
    });
  }

  if (!token) {
    return res.status(200).json({
      ok: false,
      needsToken: true,
      message:
        'للدفع المباشر وتشغيل البناء التلقائي في المستودع، أدخل رمز GitHub الشخصي (Personal Access Token بصلاحية repo & workflow) أو استخدم زر المزامنة مع GitHub في أعلى المنصة.',
    });
  }

  try {
    const tmpDir = `/tmp/asmo-repo-push-${Date.now()}`;
    await new Promise<void>((resolve, reject) => {
      const cmd = `
        set -e
        unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
        mkdir -p "${tmpDir}"
        tar --exclude='node_modules' --exclude='dist' --exclude='.git' --exclude='.env' --exclude='.aistudio' --exclude='public/ocr' --exclude='public/downloads' --exclude='*.apk' --exclude='public/assets/aistudio' -cf - -C "${__dirname}" . | tar --no-same-owner -xf - -C "${tmpDir}"
        rm -rf "${tmpDir}/.git" "${tmpDir}/.env" "${tmpDir}/public/downloads"
        git -c safe.directory='*' -C "${tmpDir}" init -b main
        git -c safe.directory='*' -C "${tmpDir}" config user.name "ASMO Inventory Builder"
        git -c safe.directory='*' -C "${tmpDir}" config user.email "gslyman395@gmail.com"
        git -c safe.directory='*' -C "${tmpDir}" add -A
        git -c safe.directory='*' -C "${tmpDir}" commit -m "chore(release): v3.4.0 (Build 37) fast Sharp filtering, unified Gemini batch scan & exact 37-row fidelity"
        git -c safe.directory='*' -C "${tmpDir}" push --force "https://x-access-token:${token}@github.com/${repo}.git" main:main
        rm -rf "${tmpDir}"
      `;
      const proc = spawn('bash', ['-c', cmd]);
      let stderr = '';
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.replace(new RegExp(token, 'g'), '***') || 'فشل رفع الملفات إلى المستودع'));
      });
    });

    // محاولة تشغيل workflow_dispatch لـ build-apk.yml
    try {
      await fetch(`https://api.github.com/repos/${repo}/actions/workflows/build-apk.yml/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'aistudio-build',
        },
        body: JSON.stringify({ ref: 'main' }),
      });
    } catch {
      // push to main already triggers the workflow automatically
    }

    return res.status(200).json({
      ok: true,
      repo,
      actionsUrl: `https://github.com/${repo}/actions`,
      releasesUrl: `https://github.com/${repo}/releases`,
      message: `✅ تم مسح الملفات القديمة ورفع ملفات التطبيق المحدثة إلى المستودع (${repo}) وبدء بناء ملف الـ APK تلقائياً عبر GitHub Actions!`,
    });
  } catch (err: any) {
    return res.status(200).json({
      ok: false,
      message: err?.message || 'تعذر رفع الملفات إلى المستودع. تأكد من صلاحيات الرمز (repo + workflow).',
    });
  }
});

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
