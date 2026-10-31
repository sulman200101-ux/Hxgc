import {
  rotateImageDegrees,
  prepareImageForAi,
  splitImageIntoThreeOverlappingBands,
} from '../utils/imagePreprocessor';
import { preprocessImageForOCR } from '../utils/imagePreprocess';
import { createWorker } from 'tesseract.js';
import { categorizeAndTranslate } from '../utils/translator';
import {
  parseStrictAsmoTable,
  mergeOverlappingBandRows,
} from '../utils/strictTableParser';
import {
  parseTableWithGeminiVision,
} from './geminiVisionService';
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
  normalizeSapMaterialPrefix,
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

const PARALLEL_WORKER_COUNT = 3;
type TesseractWorkerInstance = Awaited<ReturnType<typeof createWorker>>;

// تجمع العمال المتوازي (3 Parallel English-Only Workers) مع tessedit_do_invert: "0" ومسح 3 شرائح أفقية بالتوازي
let workerPoolPromises: Array<Promise<TesseractWorkerInstance>> | null = null;
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null;

async function createConfiguredEngWorker(): Promise<TesseractWorkerInstance> {
  const worker = await createWorker('eng', 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/tesseract-core-lstm.wasm.js',
    langPath: '/ocr/lang',
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '6' as any,
      tessedit_do_invert: '0',
      preserve_interword_spaces: '1',
    });
  } catch {
    // المتابعة بالإعدادات الافتراضية في بيئة الاختبار
  }
  return worker;
}

async function acquireParallelOcrWorkerPool(
  count: number = PARALLEL_WORKER_COUNT
): Promise<TesseractWorkerInstance[]> {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
  if (!workerPoolPromises) {
    workerPoolPromises = Array.from({ length: PARALLEL_WORKER_COUNT }, () =>
      createConfiguredEngWorker()
    );
  }
  try {
    const activePromises = workerPoolPromises.slice(0, Math.max(1, count));
    return await Promise.all(activePromises);
  } catch (err) {
    workerPoolPromises = null;
    throw err;
  }
}

function scheduleWorkerRelease(delayMs = 30000): void {
  if (workerIdleTimer) clearTimeout(workerIdleTimer);
  workerIdleTimer = setTimeout(async () => {
    const pool = workerPoolPromises;
    workerPoolPromises = null;
    workerIdleTimer = null;
    if (pool) {
      for (const p of pool) {
        const w = await p.catch(() => null);
        await w?.terminate().catch(() => {});
      }
    }
  }, delayMs);
}

export async function releaseOcrWorkerNow(): Promise<void> {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
  const pool = workerPoolPromises;
  workerPoolPromises = null;
  if (pool) {
    for (const p of pool) {
      const w = await p.catch(() => null);
      await w?.terminate().catch(() => {});
    }
  }
}

function isUsableExtraction(rows: ExtractedSparePart[], minRows = 1): boolean {
  const valid = rows.filter(
    (row) => /^\d{10}$/.test(row.part_number) && isValidSpecificLocation(row.location_code)
  );
  return valid.length >= minRows;
}

async function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

/**
 * مسح الورقة الكثيفة عبر 3 شرائح أفقية متداخلة بالتوازي (3 Parallel Workers) في تمريرة واحدة
 */
async function recognizeThreeBandsInParallel(
  cleanImage: string,
  workers: TesseractWorkerInstance[]
): Promise<ExtractedSparePart[]> {
  const { bands } = await splitImageIntoThreeOverlappingBands(cleanImage);
  const [topRec, midRec, botRec] = await Promise.all([
    workers[0].recognize(bands[0]),
    (workers[1] || workers[0]).recognize(bands[1]),
    (workers[2] || workers[0]).recognize(bands[2]),
  ]);

  const topRows = parseRawTextOcr(topRec.data.text);
  const midRows = parseRawTextOcr(midRec.data.text);
  const botRows = parseRawTextOcr(botRec.data.text);

  const merged = mergeOverlappingBandRows([topRows, midRows, botRows]);
  return resolveSheetLocationsWithContext(merged);
}

/**
 * قراءة أوراق الجرد قراءة حقيقية فائقة السرعة لجميع الـ 37 سطراً:
 * 1. التحجيم المثالي لبلاطات Gemini Vision (1650px) مع فلتر زيادة حدة الحروف (applyFastUnsharpMask).
 * 2. المسح المتوازي الفوري للنصف العلوي والسفلي عبر Gemini Vision في جولة شبكية واحدة (~2.5 ثانية).
 * 3. عند العمل بالمحرك المحلي (Local OCR):
 *    - تشغيل تجمع العمال المتوازي (3 Parallel Workers) باللغة الإنجليزية فقط (eng) مع tessedit_do_invert: "0".
 *    - مسح 3 شرائح أفقية متداخلة بالتوازي في تمريرة واحدة لاسترجاع كافة الـ 37 سطراً دون ضياع أي سطر.
 */
export async function processOcrFromImage(
  imageSource: string | File | Blob,
  onProgress?: (progress: number, status: string) => void
): Promise<ExtractedSparePart[]> {
  try {
    if (onProgress) onProgress(15, '1/4 تجهيز ومعايرة أبعاد صورة الورقة...');
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
    const isPortraitTablePhoto = dims.height > dims.width * 1.12;

    const scaledNaturalSource = await prepareImageForAi(sourceDataUrl, {
      maxDimension: 1650,
      minDimension: isFullSheetPhoto ? 1400 : 800,
      enhanceContrast: true,
      sharpen: true,
      forceRotateCcw: isPortraitTablePhoto,
    });

    // 1. القراءة السريعة الكاملة عبر الخادم (Gemini Vision Parallel Halves)
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try {
        if (onProgress) onProgress(35, '2/4 قراءة جميع سطور الورقة بالماسح الذكي المتوازي...');
        const visionResult = await parseTableWithGeminiVision(scaledNaturalSource, true);
        if (visionResult.success && isUsableExtraction(visionResult.items)) {
          if (onProgress) {
            onProgress(100, `4/4 اكتملت قراءة الورقة بنجاح (${visionResult.items.length} سطراً)!`);
          }
          return visionResult.items;
        }
      } catch {
        // المتابعة تلقائياً إلى القارئ المحلي عند عدم توفر الاتصال
      }
    }

    // 2. المحرك المحلي المتوازي (3 Parallel English-Only Workers + Stroke-Preserving Grid Removal)
    if (onProgress) onProgress(50, '2/4 تشغيل محرك القراءة المتوازي وتنقية خطوط الشبكة...');
    await pauseUi(0);

    const activeCleanImage = await preprocessImageForOCR(scaledNaturalSource);
    const workers = await acquireParallelOcrWorkerPool(
      isFullSheetPhoto ? PARALLEL_WORKER_COUNT : 1
    );

    let extracted: ExtractedSparePart[] = [];

    if (isFullSheetPhoto) {
      if (onProgress) {
        onProgress(70, '3/4 مسح الشرائح الثلاث بالتوازي لاسترجاع كافة الـ 37 سطراً...');
      }
      extracted = await recognizeThreeBandsInParallel(activeCleanImage, workers);
    } else {
      if (onProgress) onProgress(70, '3/4 قراءة سطور الجدول وأرقام القطع والمواقع...');
      const raw = await workers[0].recognize(activeCleanImage);
      extracted = parseRawTextOcr(raw.data.text);
    }

    // إذا لم يُكتشف أي سطر في الاتجاه الأول فقط (0 سطور)، نفحص زوايا التدوير ونتوقف فوراً عند أول زاوية صحيحة!
    if (!isUsableExtraction(extracted, 1)) {
      const candidateAngles = isPortraitTablePhoto
        ? ([180, 90, 270] as const)
        : ([270, 90, 180] as const);
      for (const [index, degrees] of candidateAngles.entries()) {
        if (onProgress) {
          onProgress(80 + index * 5, `3/4 فحص اتجاه الورقة بزاوية ${degrees}°...`);
        }
        await pauseUi(0);
        const baseForRot = isPortraitTablePhoto ? sourceDataUrl : scaledNaturalSource;
        const rotated = await rotateImageDegrees(baseForRot, degrees);
        const rotatedClean = await preprocessImageForOCR(rotated);
        const rotDims = await getImageDimensions(rotatedClean);
        const isRotFullSheet = rotDims.width >= 500 && rotDims.height >= 500;

        const attempt = isRotFullSheet
          ? await recognizeThreeBandsInParallel(
              rotatedClean,
              await acquireParallelOcrWorkerPool(PARALLEL_WORKER_COUNT)
            )
          : parseRawTextOcr((await workers[0].recognize(rotatedClean)).data.text);

        if (attempt.length > extracted.length) {
          extracted = attempt;
        }
        if (isUsableExtraction(extracted, 1)) {
          break;
        }
      }
    }

    if (onProgress) onProgress(100, `4/4 اكتملت القراءة (${extracted.length} سطراً)!`);
    return extracted;
  } catch (err) {
    console.warn('Local OCR notice:', err);
    await releaseOcrWorkerNow();
    throw new Error('تعذر تشغيل القراءة المحلية. جرّب صورة أخرى وأعد المحاولة؛ لم يتغير المخزون.');
  } finally {
    scheduleWorkerRelease(30000);
  }
}

export function parseRawTextOcr(rawText: string): ExtractedSparePart[] {
  const strictItems = parseStrictAsmoTable(rawText);
  const strictPartSet = new Set(strictItems.map((item) => item.part_number));

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const fallbackResults: Array<ExtractedSparePart & { location?: string }> = [];

  for (const line of lines) {
    const tokens = line.split(/\s+/);
    let matchedPartNum: string | null = null;
    for (const tok of tokens) {
      const normTok = normalizeSapMaterialPrefix(tok);
      if (/^10\d{8}$/.test(normTok)) {
        matchedPartNum = normTok;
        break;
      }
    }

    if (!matchedPartNum || strictPartSet.has(matchedPartNum)) {
      continue;
    }

    const dynamicLoc = extractDynamicLocationFromLine(line);
    const loc = dynamicLoc || sanitizeLocationCode(line);

    const hasCrossMark = /(?:^|\s)[Xx×✗✘](?:\s|$)/.test(line);
    const remarkMatch = line.match(/\b(F\d{1,2}|[+-]\d{1,3})\b/i);
    const remark = remarkMatch ? remarkMatch[1].toUpperCase() : undefined;

    const qtyUnitMatch =
      line.match(
        /\b(EA|PCS|SET|PK|SH|CO|AY|ZYD|PAA|KIT|FT|M|KG|L|ROL|BOX)[\s|\[\]()—\-]+(\d{1,4})\b/i
      ) || line.match(/\b(\d{1,4})\s*(PCS|EA|SET|PK|SH|CO|AY|ZYD|PAA|KIT|\b)?$/i);

    const rawQtyVal = qtyUnitMatch
      ? /^\d+$/.test(qtyUnitMatch[1])
        ? qtyUnitMatch[1]
        : qtyUnitMatch[2]
      : 1;
    const total = Math.max(1, sanitizeQuantity(rawQtyVal, 1));
    const out = 0;

    const rawDesc = line
      .replace(matchedPartNum, '')
      .replace(loc, '')
      .replace(/\b(C006|M016|D04D|002|EA|PCS|SET|PK|SH|CO|AY|ZYD|PAA|KIT)\b/gi, ' ')
      .replace(/\b\d{1,4}\b/g, ' ')
      .trim();

    const { cleaned: descEn, isValid: descValid } = sanitizeDescription(rawDesc);
    const finalDescEn = descValid ? descEn : 'SPARE PART ASMO';
    const { category, descAr } = categorizeAndTranslate(finalDescEn);

    fallbackResults.push({
      part_number: matchedPartNum,
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
      status: hasCrossMark ? 'غير موجودة' : 'مضاف',
      confidence: 'اقتراح قراءة غير مؤكد',
    });
  }

  if (fallbackResults.length === 0) {
    return strictItems;
  }

  const contextResolved = resolveSheetLocationsWithContext(fallbackResults);
  const validFallback = contextResolved
    .filter((item) => isValidSpecificLocation(item.location_code))
    .map(({ location: _loc, ...rest }) => rest);

  return [...strictItems, ...validFallback];
}

export function parseSimulatedTableOcr(): ExtractedSparePart[] {
  return [];
}
