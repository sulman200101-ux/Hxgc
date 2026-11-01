import {
  rotateImageDegrees,
  prepareImageForAi,
} from '../utils/imagePreprocessor';
import { preprocessImageForOCR } from '../utils/imagePreprocess';
import { createWorker } from 'tesseract.js';
import { categorizeAndTranslate } from '../utils/translator';
import { preprocessImageWithOpenCV } from '../utils/imagePreprocessing';
import {
  parseStrictAsmoTable,
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
  timeoutMs = 9500
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

  const primaryOptions = {
    workerPath: `${baseOrigin}/ocr/worker.min.js`,
    corePath: `${baseOrigin}/ocr/tesseract-core-lstm.wasm.js`,
    langPath: `${baseOrigin}/ocr/lang`,
    workerBlobURL: false,
  };

  let worker: TesseractWorkerInstance;
  try {
    worker = await spawnWorkerWithTimeout(primaryOptions, 9000);
  } catch {
    await pauseUi(100);
    // محاولة بديلة باستخدام Blob Worker القياسي مع تعطيل الكاش لمنع أي تعليق في WebView أو المتصفح
    worker = await spawnWorkerWithTimeout(
      {
        workerPath: `${baseOrigin}/ocr/worker.min.js`,
        corePath: `${baseOrigin}/ocr/tesseract-core-lstm.wasm.js`,
        langPath: `${baseOrigin}/ocr/lang`,
        workerBlobURL: true,
      },
      11000
    );
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
  timeoutMs = 24000
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

function scheduleWorkerRelease(delayMs = 30000): void {
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

async function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

/**
 * قراءة أوراق الجرد الشاملة دفعة واحدة لكامل الورقة بدون تقسيم (Full-Sheet Single-Pass OCR):
 * 1. معايرة تلقائية فورية لاتجاه الورقة (<15ms) وتحجيمها لـ 1650px مع زيادة حدة الحروف (Unsharp Mask).
 * 2. محرك سحابي/خادمي فائق السرعة (/api/gemini/parse-table) مع بديل محلي فوري غير قابل للتعليق.
 * 3. قراءة الورقة كاملةً دفعة واحدة من أول سطر إلى آخر سطر مع تحديث حي ومستمر لشريط التقدم.
 */
export async function processOcrFromImage(
  imageSource: string | File | Blob,
  onProgress?: (progress: number, status: string) => void
): Promise<ExtractedSparePart[]> {
  activeProgressCallback = onProgress || null;
  lastReportedProgress = 0;

  try {
    reportLiveProgress(15, '1/4 معايرة تلقائية سريعة لاتجاه الورقة وزيادة حدة النصوص...');
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

    // 1. معايرة تلقائية سريعة لاتجاه الورقة (تدوير تلقائي للصور الطولية) وتحجيم مثالي لكامل الورقة دفعة واحدة
    const scaledNaturalSource = await prepareImageForAi(sourceDataUrl, {
      maxDimension: 1700,
      minDimension: isFullSheetPhoto ? 1350 : 800,
      enhanceContrast: true,
      sharpenText: true,
      autoRotate: true,
    });

    // 2. المحرك السحابي والخادمي لقراءة الورقة كاملة دفعة واحدة مع بديل محلي تلقائي فوري
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try {
        reportLiveProgress(30, '2/4 القراءة الذكية الشاملة لكامل الورقة دفعة واحدة...');
        const visionResult = await parseTableWithGeminiVision(scaledNaturalSource, true);
        if (visionResult.success && isUsableExtraction(visionResult.items, 1)) {
          if (onProgress) {
            onProgress(100, `4/4 اكتملت القراءة الشاملة للورقة بنجاح (${visionResult.items.length} سطراً)!`);
          }
          return visionResult.items;
        }
      } catch {
        // التحويل التلقائي الفوري للمحرك المحلي الشامل
      }
    }

    // 3. القراءة المحلية الشاملة لكامل الورقة مع تقدم حي غير قابل للتعليق عند 55%
    reportLiveProgress(46, '2/4 تهيئة محرك القراءة المحلي الشامل...');
    await pauseUi(0);

    const [worker] = await acquireOcrWorkerPool(1);

    reportLiveProgress(65, '3/4 القراءة الشاملة لكامل سطور الورقة دفعة واحدة...');
    const rawNatural = await recognizeWithTimeout(worker, scaledNaturalSource);
    let extracted = parseRawTextOcr(rawNatural.data.text);

    // إذا كانت الورقة تحتاج تنقية إضافية لإزالة الظلال وخطوط الجدول، نطبق الفلتر غير المحجوب ونقارن النتيجة
    if (!isUsableExtraction(extracted, isFullSheetPhoto ? 3 : 1)) {
      reportLiveProgress(82, '3/4 تنقية إضاءة الورقة وإبراز الأرقام الباهتة...');
      await pauseUi(0);
      const preprocessedGridFree = await preprocessImageForOCR(scaledNaturalSource);
      const rawGridFree = await recognizeWithTimeout(worker, preprocessedGridFree);
      const gridFreeExtracted = parseRawTextOcr(rawGridFree.data.text);
      if (gridFreeExtracted.length > extracted.length) {
        extracted = gridFreeExtracted;
      }
    }

    // معايرة سريعة بزاوية 180° لكامل الورقة إذا التُقطت مقلوبة رأساً على عقب
    if (!isUsableExtraction(extracted, 1)) {
      reportLiveProgress(90, '3/4 معايرة سريعة لاتجاه الورقة المقلوبة...');
      await pauseUi(0);
      const flipped180 = await rotateImageDegrees(scaledNaturalSource, 180);
      const flipRec = await recognizeWithTimeout(worker, flipped180);
      const flipAttempt = parseRawTextOcr(flipRec.data.text);
      if (flipAttempt.length > extracted.length) {
        extracted = flipAttempt;
      }
    }

    if (!isUsableExtraction(extracted, 1)) {
      reportLiveProgress(95, '3/4 تعزيز التباين العميق للنصوص الخفيفة...');
      const preprocessed = await preprocessImageWithOpenCV(scaledNaturalSource, {
        rotateCounterClockwise90: false,
      });
      const enhRec = await recognizeWithTimeout(worker, preprocessed.cleanedDataUrl);
      const enhanced = parseRawTextOcr(enhRec.data.text);
      if (enhanced.length > extracted.length) {
        extracted = enhanced;
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
    scheduleWorkerRelease(30000);
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

    const normalizedDigitsLine = line.replace(/\b1[0OQD][0OQD][0-9OILSBGZD]{5,7}\b/gi, (token) =>
      token
        .toUpperCase()
        .replace(/[OQD]/g, '0')
        .replace(/[IL]/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/G/g, '6')
        .replace(/Z/g, '2')
    );

    const partMatch =
      normalizedDigitsLine.match(/\b(10\d{8})\b/) ||
      normalizedDigitsLine.match(/\b(\d{6,9})\b/);
    if (!partMatch) {
      continue;
    }

    const rawNum = partMatch[1];
    const partNum =
      rawNum.length === 10
        ? rawNum
        : rawNum.startsWith('100')
        ? rawNum.padEnd(10, '0').slice(0, 10)
        : `100${rawNum.slice(-7).padStart(7, '0')}`;

    const dynamicLoc = extractDynamicLocationFromLine(line);
    const loc = dynamicLoc || sanitizeLocationCode(line) || 'N01A1';

    const hasCrossMark = /(?:^|\s)[Xx×✗✘](?:\s|$)/.test(line);
    const remarkMatch = line.match(/\b(F\d{1,2}|[+-]\d{1,3})\b/i);
    const remark = remarkMatch ? remarkMatch[1].toUpperCase() : undefined;

    const qtyUnitMatch =
      line.match(/\b(EA|PCS|SET|PK|SH|CO|AY|ZYD|PAA|KIT|FT|M|KG|L|ROL|BOX)[\s|\[\]()—\-]+(\d{1,4})\b/i) ||
      line.match(/\b(\d{1,4})\s*(PCS|EA|SET|PK|SH|CO|AY|ZYD|PAA|KIT|\b)?$/i);

    const rawQtyVal = qtyUnitMatch
      ? /^\d+$/.test(qtyUnitMatch[1])
        ? qtyUnitMatch[1]
        : qtyUnitMatch[2]
      : 1;
    const total = Math.max(1, sanitizeQuantity(rawQtyVal, 1));
    const out = 0;

    const rawDesc = line
      .replace(rawNum, '')
      .replace(loc, '')
      .replace(/\b(C006|M016|D04D|002|EA|PCS|SET|PK|SH|CO|AY|ZYD|PAA|KIT)\b/gi, ' ')
      .replace(/\b\d{1,4}\b/g, ' ')
      .trim();

    const { cleaned: descEn, isValid: descValid } = sanitizeDescription(rawDesc);
    const finalDescEn = descValid ? descEn : 'SPARE PART ASMO';
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
      confidence: 'اقتراح قراءة غير مؤكد',
    });
  }

  const contextResolved = resolveSheetLocationsWithContext(rawResults);
  return contextResolved.map(({ location: _loc, ...rest }) => ({
    ...rest,
    location_code: isValidSpecificLocation(rest.location_code) ? rest.location_code : 'N01A1',
  }));
}

export function parseSimulatedTableOcr(): ExtractedSparePart[] {
  return [];
}
