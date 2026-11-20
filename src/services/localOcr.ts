import {
  rotateImageDegrees,
  preprocessInventoryImage,
  fastPrepareLandscapeForGemini,
  cropTableZoneForOcr,
} from '../utils/imagePreprocessor';
import { preprocessImageForOCR } from '../utils/imagePreprocess';
import { createWorker } from 'tesseract.js';
import { preprocessImageWithOpenCV } from '../utils/imagePreprocessing';
import {
  parseStrictAsmoTable,
  unionOrderedRowSequences,
  applyRightColumnDescriptions,
} from '../utils/strictTableParser';
import {
  parseTableWithGeminiVision,
  performStrictOCR,
  enhanceExtractedRowsWithGemini,
} from './geminiVisionService';
export { performStrictOCR };
export {
  extractSparePartData,
  extractInventoryTable,
  type ExtractedSparePartData,
  type ExtractedInventoryTableRow,
} from './geminiService';
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
  is_consumable?: number;
  remark?: string;
  mark_symbol?: '✓' | 'X' | 'F' | 'N' | null;
  audit_meaning?: string | null;
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
    {
      workerPath: `${baseOrigin}/ocr/worker.min.js`,
      corePath: `${baseOrigin}/ocr/tesseract-core-simd-lstm.wasm.js`,
      langPath: `${baseOrigin}/ocr/lang`,
      gzip: false,
      workerBlobURL: false,
    },
    {
      workerPath: `${baseOrigin}/ocr/worker.min.js`,
      corePath: `${baseOrigin}/ocr/tesseract-core-lstm.wasm.js`,
      langPath: `${baseOrigin}/ocr/lang`,
      gzip: false,
      workerBlobURL: false,
    },
    {
      workerPath: `${baseOrigin}/ocr/worker.min.js`,
      corePath: `${baseOrigin}/ocr/tesseract-core-lstm.wasm.js`,
      langPath: `${baseOrigin}/ocr/lang`,
      gzip: false,
      workerBlobURL: true,
    },
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
 * قراءة أوراق الجرد بأعلى دقة وسرعة:
 * - الحفاظ على الاتجاه العمودي الطبيعي للورقة (autoRotate: false).
 * - فحص الورقة كاملة سطراً بسطر عبر Gemini Vision أولاً بدون تشويه الصورة بفلتر عتبة مسبق.
 * - التحول السلس إلى المحرك المحلي ثنائي التمرير عند انقطاع الإنترنت.
 */
export async function processOcrFromImage(
  imageSource: string | File | Blob,
  onStatus?: (status: string) => void
): Promise<ExtractedSparePart[]> {
  try {
    onStatus?.('جارٍ معايرة الصورة وقراءة جدول القطع بأعلى دقة سطراً بسطر...');
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

    const colorNaturalSource = await fastPrepareLandscapeForGemini(sourceDataUrl);

    let extracted: ExtractedSparePart[] = [];

    // 1. القراءة الفورية عالية الدقة عبر Gemini Vision مباشرة دون إبطاء المعالج بحلقات البكسل المزدوجة
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try {
        onStatus?.('جارٍ تصفية الورقة وقراءة الجدول بدقة سطر بسطر عبر Gemini...');
        const visionResult = await parseTableWithGeminiVision(
          colorNaturalSource,
          true
        );
        if (visionResult.success && isUsableExtraction(visionResult.items, 1)) {
          extracted = visionResult.items;
          if (extracted.length > 0) {
            onStatus?.(`✓ تم فحص واستخراج ${extracted.length} سطراً بدقة عبر Gemini`);
            return extracted;
          }
        }
      } catch {
        // المتابعة للمحرك المحلي بالصورة الكاملة
      }
    }

    // 2. القراءة المحلية للصورة الكاملة (تُجهَّز نسخة التدرج الرمادي فقط عند التحول للمحرك المحلي)
    onStatus?.('جارٍ قراءة السطور بالمحرك البصري المحلي...');
    await pauseUi(0);

    const preprocessedPrimary = await preprocessInventoryImage(sourceDataUrl);
    const scaledNaturalSource = preprocessedPrimary.dataUrl;

    let worker: TesseractWorkerInstance;
    try {
      [worker] = await acquireOcrWorkerPool(1);
    } catch {
      await releaseOcrWorkerNow();
      [worker] = await acquireOcrWorkerPool(1);
    }

    const runZoneAssistedExtraction = async (imgSource: string): Promise<ExtractedSparePart[]> => {
      const baseText = await safeRecognizeText(worker, imgSource, 20000);
      let rows = parseRawTextOcr(baseText);

      if (isFullSheetPhoto) {
        try {
          const leftZone = await cropTableZoneForOcr(imgSource, 0.038, 0.44, 1550);
          if (leftZone) {
            const leftText = await safeRecognizeText(worker, leftZone, 18000);
            const leftRows = parseRawTextOcr(leftText);
            if (leftRows.length >= rows.length) {
              rows = combineBestSheetExtractions(leftRows, rows);
            } else {
              rows = combineBestSheetExtractions(rows, leftRows);
            }
          }
        } catch {
          // المتابعة في حال تعذر قص المنطقة اليسرى
        }

        if (rows.some((r) => !r.qty_total || r.qty_total <= 0)) {
          try {
            const printedZone = await cropTableZoneForOcr(imgSource, 0.035, 0.37, 1400);
            if (printedZone) {
              const printedText = await safeRecognizeText(worker, printedZone, 16000);
              const printedRows = parseRawTextOcr(printedText);
              rows = combineBestSheetExtractions(rows, printedRows);
            }
          } catch {
            // المتابعة
          }
        }

        if (rows.length > 0 && rows.some((r) => !r.description_en || r.description_en.length < 6)) {
          try {
            const rightDescZone = await cropTableZoneForOcr(imgSource, 0.66, 0.28, 1200);
            if (rightDescZone) {
              const rightDescText = await safeRecognizeText(worker, rightDescZone, 16000);
              rows = applyRightColumnDescriptions(rows, rightDescText);
            }
          } catch {
            // المتابعة
          }
        }
      }

      return rows;
    };

    extracted = await runZoneAssistedExtraction(scaledNaturalSource);

    // إذا كانت الورقة مقلوبة 180 درجة (نتيجة تصوير الورقة باتجاه +90 بدلاً من -90) أو مائلة، نختبر التدوير مع قص الأعمدة
    const minExpectedRows = isFullSheetPhoto ? 6 : 2;
    if (extracted.length < minExpectedRows) {
      for (const deg of [180, 90, 270] as const) {
        try {
          const rotAttempt = await (async () => {
            if (deg === 90 || deg === 270) {
              const altPrep = await preprocessInventoryImage(sourceDataUrl, deg);
              return runZoneAssistedExtraction(altPrep.dataUrl);
            }
            const rotatedImg = await rotateImageDegrees(scaledNaturalSource, deg);
            return runZoneAssistedExtraction(rotatedImg);
          })();
          if (rotAttempt.length > extracted.length) {
            extracted = rotAttempt;
          }
          if (extracted.length >= 10 || (!isFullSheetPhoto && extracted.length >= 1)) break;
        } catch {
          // المتابعة للزاوية التالية
        }
      }
    }

    if (isFullSheetPhoto && extracted.length < 25) {
      try {
        const preprocessedGridFree = await preprocessImageForOCR(scaledNaturalSource);
        if (preprocessedGridFree) {
          const shadowFreeText = await safeRecognizeText(worker, preprocessedGridFree, 20000);
          const shadowFreeRows = parseRawTextOcr(shadowFreeText);
          extracted = combineBestSheetExtractions(extracted, shadowFreeRows);
        }
      } catch {
        // المتابعة
      }
    }

    if (!isUsableExtraction(extracted, 1)) {
      try {
        const preprocessed = await preprocessImageWithOpenCV(scaledNaturalSource, {
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

    if (extracted.length > 0 && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      onStatus?.('جارٍ تعزيز ومطابقة دقة السطور عبر Gemini AI...');
    }
    return await enhanceExtractedRowsWithGemini(extracted, colorNaturalSource, false);
  } catch (err) {
    console.warn('Local OCR notice:', err);
    await releaseOcrWorkerNow();
    throw new Error('تعذر تشغيل القراءة المحلية. جرّب صورة أخرى وأعد المحاولة؛ لم يتغير المخزون.');
  } finally {
    scheduleWorkerRelease(45000);
  }
}

export function parseRawTextOcr(rawText: string): ExtractedSparePart[] {
  return parseStrictAsmoTable(rawText);
}

export function parseSimulatedTableOcr(): ExtractedSparePart[] {
  return [];
}
