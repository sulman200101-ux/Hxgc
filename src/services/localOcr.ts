import {
  rotateImageDegrees,
  prepareImageForAi,
  splitImageIntoOverlappingHalves,
  splitImageIntoThreeOverlappingBands,
} from '../utils/imagePreprocessor';
import { preprocessImageForOCR } from '../utils/imagePreprocess';
import { createWorker } from 'tesseract.js';
import { categorizeAndTranslate } from '../utils/translator';
import { preprocessImageWithOpenCV } from '../utils/imagePreprocessing';
import {
  parseStrictAsmoTable,
  mergeOverlappingBandRows,
  unionOrderedRowSequences,
} from '../utils/strictTableParser';
import { parseTableWithGeminiVision } from './geminiVisionService';
export {
  extractSparePartData,
  extractInventoryTable,
  type ExtractedSparePartData,
  type ExtractedInventoryTableRow,
} from './geminiService';
import {
  sanitizeQuantity,
  sanitizeLocationCode,
  sanitizeDescription,
  extractDynamicLocationFromLine,
  isValidSpecificLocation,
  resolveSheetLocationsWithContext,
} from '../utils/regexSanitizer';
import type { ItemStatus } from '../types';

export interface ExtractedSparePart {
  part_number: string;
  location_code: string;
  description_en: string;
  description_ar: string;
  category: string;
  qty_total: number;
  qty_out: number;
  qty_remaining: number;
  is_missing?: number;
  remark?: string;
  status?: ItemStatus;
  confidence?: string;
}

export interface OcrProcessResult {
  items: ExtractedSparePart[];
  cleanedImage?: string;
  preprocessingStats?: {
    shadowsRemoved: boolean;
    gridLinesRemoved: boolean;
    executionTimeMs: number;
  };
}

const pauseUi = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type TesseractWorkerInstance = Awaited<ReturnType<typeof createWorker>>;

// مؤشر التقدم الحي أثناء عمل محرك Tesseract لمنع توقف النسبة عند 55%
let activeProgressCallback: ((progress: number, status: string) => void) | null = null;
let lastReportedProgress = 0;

function reportLiveProgress(progress: number, status: string) {
  if (!activeProgressCallback) return;
  const clamped = Math.max(lastReportedProgress, Math.min(99, Math.round(progress)));
  lastReportedProgress = clamped;
  activeProgressCallback(clamped, status);
}

let workerPoolPromises: Array<Promise<TesseractWorkerInstance>> = [];
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null;

async function spawnWorkerWithTimeout(
  options: Record<string, any>,
  timeoutMs = 20000
): Promise<TesseractWorkerInstance> {
  return new Promise<TesseractWorkerInstance>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Tesseract worker initialization timeout'));
    }, timeoutMs);

    createWorker('eng', 1, {
      ...options,
      cacheMethod: 'none',
      logger: (m: any) => {
        if (!m || typeof m.progress !== 'number') return;
        if (m.status === 'loading tesseract core' || m.status === 'initializing tesseract') {
          reportLiveProgress(48 + Math.round(m.progress * 6), '2/4 تحميل نواة القراءة السريعة...');
        } else if (m.status === 'loading language traineddata') {
          reportLiveProgress(54 + Math.round(m.progress * 7), '2/4 تجهيز قاموس الحروف والأرقام الصناعية...');
        } else if (m.status === 'initializing api') {
          reportLiveProgress(61 + Math.round(m.progress * 4), '2/4 تهيئة محرك القراءة الشاملة...');
        } else if (m.status === 'recognizing text') {
          reportLiveProgress(
            65 + Math.round(m.progress * 23),
            `3/4 قراءة سطور الورقة بالكامل (${Math.round(m.progress * 100)}%)...`
          );
        }
      },
      errorHandler: (err: any) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(String(err || 'Worker internal error')));
        }
      },
    })
      .then((worker) => {
        if (settled) {
          worker.terminate().catch(() => {});
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(worker);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function createConfiguredFastWorker(): Promise<TesseractWorkerInstance> {
  const baseOrigin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';

  const candidateConfigs: Array<Record<string, any>> = [
    // المحاولة الأولى: نواة SIMD فائقة السرعة + ملف اللغة غير المضغوط (أسرع بـ 3x على معالجات الهواتف)
    {
      workerPath: `${baseOrigin}/ocr/worker.min.js`,
      corePath: `${baseOrigin}/ocr/tesseract-core-simd-lstm.wasm.js`,
      langPath: `${baseOrigin}/ocr/lang`,
      gzip: false,
      workerBlobURL: false,
    },
    // المحاولة الثانية: النواة القياسية + ملف اللغة غير المضغوط (eng.traineddata)
    {
      workerPath: `${baseOrigin}/ocr/worker.min.js`,
      corePath: `${baseOrigin}/ocr/tesseract-core-lstm.wasm.js`,
      langPath: `${baseOrigin}/ocr/lang`,
      gzip: false,
      workerBlobURL: false,
    },
    // المحاولة الثالثة: Blob Worker مع ملف اللغة غير المضغوط لبيئات WebView المقيدة
    {
      workerPath: `${baseOrigin}/ocr/worker.min.js`,
      corePath: `${baseOrigin}/ocr/tesseract-core-lstm.wasm.js`,
      langPath: `${baseOrigin}/ocr/lang`,
      gzip: false,
      workerBlobURL: true,
    },
    // المحاولة الرابعة: احتياطي سحابي عبر CDN في حال وجود قيد محلي في WebView
    {
      gzip: true,
      workerBlobURL: true,
    },
  ];

  let worker: TesseractWorkerInstance | null = null;
  let lastError: unknown = null;

  for (const cfg of candidateConfigs) {
    try {
      worker = await spawnWorkerWithTimeout(cfg, 20000);
      if (worker) break;
    } catch (err) {
      lastError = err;
      await pauseUi(80);
    }
  }

  if (!worker) {
    throw lastError || new Error('Failed to initialize OCR worker');
  }

  try {
    await worker.setParameters({
      tessedit_do_invert: '0',
      tessedit_pageseg_mode: '6' as any,
    });
  } catch {
    // المتابعة في حال عدم دعم المعاملات الاختيارية
  }
  return worker;
}

async function recognizeWithTimeout(
  worker: TesseractWorkerInstance,
  image: string,
  timeoutMs = 26000
): Promise<{ data: { text: string } }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('OCR recognition timeout'));
    }, timeoutMs);

    worker
      .recognize(image)
      .then((res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function safeRecognizeText(
  worker: TesseractWorkerInstance,
  image: string,
  timeoutMs = 24000
): Promise<string> {
  try {
    const res = await recognizeWithTimeout(worker, image, timeoutMs);
    return res?.data?.text || '';
  } catch (err) {
    console.warn('Single OCR pass notice:', err);
    return '';
  }
}

async function acquireOcrWorkerPool(desiredCount = 1): Promise<TesseractWorkerInstance[]> {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
  const hwCores =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  const poolSize = Math.max(1, Math.min(desiredCount, Math.floor(hwCores / 2) || 1));

  while (workerPoolPromises.length < poolSize) {
    workerPoolPromises.push(createConfiguredFastWorker());
  }

  try {
    return await Promise.all(workerPoolPromises.slice(0, poolSize));
  } catch (err) {
    workerPoolPromises = [];
    throw err;
  }
}

/**
 * تسخين مسبق لمحرك القراءة المحلي في الخلفية فور فتح نافذة الكاميرا/الألبوم
 */
export function prewarmLocalOcrWorker(): void {
  acquireOcrWorkerPool(1)
    .then(() => {
      scheduleWorkerRelease(60000);
    })
    .catch(() => {});
}

function scheduleWorkerRelease(delayMs = 45000): void {
  if (workerIdleTimer) clearTimeout(workerIdleTimer);
  workerIdleTimer = setTimeout(async () => {
    const pool = workerPoolPromises;
    workerPoolPromises = [];
    workerIdleTimer = null;
    for (const p of pool) {
      const w = await p.catch(() => null);
      await w?.terminate().catch(() => {});
    }
  }, delayMs);
}

export async function releaseOcrWorkerNow(): Promise<void> {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
  const pool = workerPoolPromises;
  workerPoolPromises = [];
  for (const p of pool) {
    const w = await p.catch(() => null);
    await w?.terminate().catch(() => {});
  }
}

function isUsableExtraction(rows: ExtractedSparePart[], minRows = 1): boolean {
  return Array.isArray(rows) && rows.length >= minRows;
}

/**
 * دمج نتائج تمريرتين مختلفتين على نفس الورقة (مثل التمريرة المنقاة من الشبكة + التمريرة الطبيعية)
 * لاختيار القراءة الأكمل وإثراء أي سطر ناقص دون تكرار وهمي.
 */
export function combineBestSheetExtractions(
  passA: ExtractedSparePart[],
  passB: ExtractedSparePart[]
): ExtractedSparePart[] {
  return unionOrderedRowSequences(passA, passB);
}

async function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

/**
 * قراءة أوراق الجرد الشاملة عالية الدقة (Full-Sheet High-Precision Hybrid Gemini + Algorithmic OCR):
 * 1. معايرة تلقائية فورية لاتجاه الورقة وتحجيمها مع زيادة حدة الحروف (Unsharp Mask) وتنقية خطوط الجدول والظلال.
 * 2. محرك هجين يجمع بين Gemini Vision والخادم المتعدد التمريرات (/api/gemini/parse-table) وبين محرك WASM SIMD المحلي.
 * 3. تقسيم نصفي وثلاثي متداخل للجداول الكثيفة + معالجة تدوير متعددة الزوايا لضمان عدم فشل القراءة أو سقوط أي سطر.
 */
export async function processOcrFromImage(
  imageSource: string | File | Blob,
  onProgress?: (progress: number, status: string) => void
): Promise<ExtractedSparePart[]> {
  activeProgressCallback = onProgress || null;
  lastReportedProgress = 0;

  try {
    reportLiveProgress(12, '1/4 معايرة تلقائية سريعة لاتجاه الورقة وزيادة حدة النصوص...');
    await pauseUi(0);

    const sourceDataUrl =
      typeof imageSource === 'string'
        ? imageSource
        : await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(imageSource);
          });

    const dims = await getImageDimensions(sourceDataUrl);
    const isFullSheetPhoto = dims.width >= 500 && dims.height >= 500;

    // 1. معايرة تلقائية سريعة لاتجاه الورقة وتحجيم عالي الوضوح (2200px) لضمان وضوح كافة السطور الـ 37
    const scaledNaturalSource = await prepareImageForAi(sourceDataUrl, {
      maxDimension: 2200,
      minDimension: isFullSheetPhoto ? 1550 : 950,
      enhanceContrast: true,
      sharpenText: true,
      autoRotate: true,
    });

    // تنفيذ خوارزمية إزالة الظلال وخطوط الجدول مسبقاً لإرسالها لمحرك Gemini/الخادم واستخدامها محلياً
    let preprocessedGridFree: string | null = null;
    if (isFullSheetPhoto) {
      reportLiveProgress(22, '1/4 تطبيق خوارزمية إزالة الظلال وخطوط الشبكة لإبراز الأرقام...');
      try {
        preprocessedGridFree = await preprocessImageForOCR(scaledNaturalSource);
      } catch {
        preprocessedGridFree = null;
      }
    }

    let extracted: ExtractedSparePart[] = [];

    // 2. المحرك السحابي والخادمي الهجين (Gemini Vision + Server Multi-Pass OCR)
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try {
        reportLiveProgress(32, '2/4 القراءة الذكية الشاملة مع مساعد Gemini وخوارزميات الجدول...');
        const visionResult = await parseTableWithGeminiVision(
          scaledNaturalSource,
          true,
          preprocessedGridFree || undefined
        );
        if (visionResult.success && isUsableExtraction(visionResult.items, 1)) {
          extracted = visionResult.items;
          // إذا قرأ الخادم الورقة كاملة (36 سطراً فأكثر) أو كانت صورة صنف مفرد، نكتفي بها فوراً
          if (!isFullSheetPhoto || extracted.length >= 36) {
            if (onProgress) {
              onProgress(100, `4/4 اكتملت القراءة الشاملة للورقة بنجاح (${extracted.length} سطراً)!`);
            }
            return extracted;
          }
        }
      } catch {
        // التحويل التلقائي الفوري للمحرك المحلي الشامل
      }
    }

    // 3. القراءة المحلية الشاملة لكامل الورقة (تعمل بدون إنترنت وفي أندرويد APK بكفاءة كاملة)
    reportLiveProgress(45, '2/4 تهيئة محرك القراءة المحلي وتنقية الجدول...');
    await pauseUi(0);

    let worker: TesseractWorkerInstance;
    try {
      [worker] = await acquireOcrWorkerPool(1);
    } catch {
      await releaseOcrWorkerNow();
      [worker] = await acquireOcrWorkerPool(1);
    }

    let winningSheetImage = scaledNaturalSource;

    if (extracted.length === 0) {
      reportLiveProgress(54, '3/4 قراءة الأرقام والسطور الفعلية من الورقة...');
      await pauseUi(0);

      // التمريرة الأساسية على الصورة المحسنة الطبيعية (تحافظ بنسبة 100% على كافة ضربات الأرقام)
      const naturalText = await safeRecognizeText(worker, scaledNaturalSource, 22000);
      extracted = parseRawTextOcr(naturalText);
    }

    // دمج التمريرة المنقاة من الظلال لإثراء واستعادة أي سطر وقع تحت ظل الكاميرا (مع إبقاء الصورة الطبيعية مرجعاً للتقسيم)
    if (preprocessedGridFree && extracted.length < 38) {
      reportLiveProgress(64, '3/4 مطابقة واستعادة السطور مع طبقة إزالة الظلال...');
      await pauseUi(0);
      const shadowFreeText = await safeRecognizeText(worker, preprocessedGridFree, 22000);
      const shadowFreeRows = parseRawTextOcr(shadowFreeText);
      extracted = combineBestSheetExtractions(extracted, shadowFreeRows);
    }

    // إذا كانت الورقة ملتقطة بشكل جانبي (90° أو 270°) أو مقلوبة (180°)، نكتشف الزاوية الصحيحة تلقائياً
    if (extracted.length < 2) {
      for (const deg of [270, 90, 180] as const) {
        try {
          reportLiveProgress(72, `3/4 معايرة اتجاه الورقة تلقائياً (${deg}°)...`);
          await pauseUi(0);
          const rotatedImg = await rotateImageDegrees(scaledNaturalSource, deg);
          const rotText = await safeRecognizeText(worker, rotatedImg, 18000);
          const rotAttempt = parseRawTextOcr(rotText);
          if (rotAttempt.length > extracted.length) {
            extracted = rotAttempt;
            winningSheetImage = rotatedImg;
          }
          if (extracted.length >= 4) break;
        } catch {
          // المتابعة للزاوية التالية
        }
      }
    }

    // مسح تفصيلي للنصف العلوي والسفلي المتداخلين بدقة مضاعفة لتدقيق الأرقام العشرة ومنع تغير أي خانة
    if (isFullSheetPhoto && extracted.length > 0) {
      try {
        reportLiveProgress(80, '3/4 مسح تفصيلي للنصف العلوي والسفلي لتدقيق الأرقام العشرة...');
        await pauseUi(0);
        const { topHalf, bottomHalf } = await splitImageIntoOverlappingHalves(winningSheetImage);
        const topText = await safeRecognizeText(worker, topHalf, 18000);
        reportLiveProgress(87, '3/4 استكمال مسح النصف السفلي للورقة وتطبيق المطابقة الرقمية...');
        const botText = await safeRecognizeText(worker, bottomHalf, 18000);
        const topRows = parseRawTextOcr(topText);
        const botRows = parseRawTextOcr(botText);
        const mergedHalves = mergeOverlappingBandRows([topRows, botRows]);
        extracted = combineBestSheetExtractions(mergedHalves, extracted);
      } catch {
        // الاحتفاظ بالسطور المستخرجة في حال تعذر تقسيم النصفين
      }
    }

    // مسح الشرائح الثلاث المتداخلة (Tri-Band) إذا بقي أي سطر دقيق في الوسط أو الأطراف لم يُلتقط بعد
    if (isFullSheetPhoto && extracted.length > 0 && extracted.length < 35) {
      try {
        reportLiveProgress(92, '3/4 تدقيق الشرائح الثلاث المتداخلة لالتقاط السطور الدقيقة...');
        await pauseUi(0);
        const [band1, band2, band3] = await splitImageIntoThreeOverlappingBands(winningSheetImage);
        const [b1Text, b2Text, b3Text] = await Promise.all([
          safeRecognizeText(worker, band1, 16000),
          safeRecognizeText(worker, band2, 16000),
          safeRecognizeText(worker, band3, 16000),
        ]);
        const triMerged = mergeOverlappingBandRows([
          parseRawTextOcr(b1Text),
          parseRawTextOcr(b2Text),
          parseRawTextOcr(b3Text),
        ]);
        extracted = combineBestSheetExtractions(extracted, triMerged);
      } catch {
        // الاحتفاظ بالسطور المستخرجة
      }
    }

    if (!isUsableExtraction(extracted, 1)) {
      try {
        reportLiveProgress(96, '3/4 تعزيز التباين العميق للنصوص الخفيفة...');
        const preprocessed = await preprocessImageWithOpenCV(winningSheetImage, {
          rotateCounterClockwise90: false,
        });
        const enhText = await safeRecognizeText(worker, preprocessed.cleanedDataUrl, 18000);
        const enhanced = parseRawTextOcr(enhText);
        if (enhanced.length > extracted.length) {
          extracted = enhanced;
        }
      } catch {
        // الاحتفاظ بالنتيجة الحالية
      }
    }

    if (onProgress) {
      onProgress(100, `4/4 اكتملت القراءة الشاملة للورقة (${extracted.length} سطراً)!`);
    }
    return extracted;
  } catch (err) {
    console.warn('Local OCR notice:', err);
    await releaseOcrWorkerNow();
    throw new Error('تعذر تشغيل القراءة المحلية. جرّب صورة أخرى وأعد المحاولة؛ لم يتغير المخزون.');
  } finally {
    activeProgressCallback = null;
    scheduleWorkerRelease(45000);
  }
}

export function parseRawTextOcr(rawText: string): ExtractedSparePart[] {
  const strictItems = parseStrictAsmoTable(rawText);
  if (strictItems.length > 0) {
    return strictItems;
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const rawResults: Array<ExtractedSparePart & { location?: string }> = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (/^\s*(?:MATERIAL|ITEM|NO\.|STORAGE\s+BIN|QTY|DESCRIPTION|INVENTORY|PAGE)\b/i.test(line)) {
      continue;
    }

    const normalizedDigitsLine = line.replace(/\b1[0OQD][0OQD][0-9OILSBGZD]{7}\b/gi, (token) =>
      token
        .toUpperCase()
        .replace(/[OQD]/g, '0')
        .replace(/[IL]/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/G/g, '6')
        .replace(/Z/g, '2')
    );

    const partMatch = normalizedDigitsLine.match(/\b(100\d{7})\b/);
    if (!partMatch) {
      continue;
    }

    const partNum = partMatch[1];
    const dynamicLoc = extractDynamicLocationFromLine(line);
    const loc = dynamicLoc || sanitizeLocationCode(line) || '';

    const hasCrossMark = /(?:^|\s)[Xx×✗✘](?:\s|$)/.test(line);
    const minusMatch = line.match(/(?:^|\s|\||\[|\])(?:\d{1,3}\s*[-−–—]\s*(\d{1,3})|[-−–—]\s*(\d{1,3}))(?=\s|\||\[|\]|$)/);
    const shortage = minusMatch ? Number(minusMatch[1] || minusMatch[2] || 0) : 0;

    const qtyUnitMatch =
      line.match(/\b(EA|PCS|SET|PK|SH|CO|AY|ZYD|PAA|KIT|FT|M|KG|L|ROL|BOX)[\s|\[\]()—\-]+(\d{1,4})\b/i) ||
      line.match(/\b(\d{1,4})\s*(PCS|EA|SET|PK|SH|CO|AY|ZYD|PAA|KIT|\b)?$/i);

    const rawQtyVal = qtyUnitMatch
      ? /^\d+$/.test(qtyUnitMatch[1])
        ? qtyUnitMatch[1]
        : qtyUnitMatch[2]
      : 1;
    const total = Math.max(1, sanitizeQuantity(rawQtyVal, 1));
    const out = hasCrossMark ? 0 : Math.min(total, shortage);
    const remark = out > 0 ? `-${out}` : undefined;

    const rawDesc = line
      .replace(partNum, '')
      .replace(loc, '')
      .replace(/\b(C006|M016|D04D|002|001|EA|PCS|SET|PK|SH|CO|AY|ZYD|PAA|KIT)\b/gi, ' ')
      .replace(/\b\d{1,4}\b/g, ' ')
      .trim();

    const { cleaned: descEn, isValid: descValid } = sanitizeDescription(rawDesc);
    const finalDescEn = descValid ? descEn : 'غير محدد';
    const { category, descAr } = categorizeAndTranslate(finalDescEn);

    rawResults.push({
      part_number: partNum,
      location_code: loc,
      location: loc,
      description_en: finalDescEn,
      description_ar: descAr,
      category,
      qty_total: total,
      qty_out: out,
      qty_remaining: hasCrossMark ? 0 : Math.max(0, total - out),
      is_missing: hasCrossMark ? 1 : 0,
      remark,
      status: hasCrossMark ? 'غير موجودة' : 'غير مدقق',
      confidence: 'قراءة فعلية من الورقة',
    });
  }

  const contextResolved = resolveSheetLocationsWithContext(rawResults);
  return contextResolved.map(({ location: _loc, ...rest }) => ({
    ...rest,
    location_code: isValidSpecificLocation(rest.location_code) ? rest.location_code : '',
  }));
}

export function parseSimulatedTableOcr(): ExtractedSparePart[] {
  return [];
}
