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

// تجمع العمال المتوازي فائق السرعة (Parallel English-Only Worker Pool)
// يستخدم 'eng' فقط (لأن جداول SAP مطبوعة بالإنجليزية والأرقام، والترجمة العربية تتم عبر القاموس الهندسي الفوري)
// مع تفعيل tessedit_do_invert=0 لمنع مضاعفة زمن الشبكة العصبية LSTM، وتشغيل 3 عمال بالتوازي على أنوية المعالج!
let workerPoolPromises: Array<Promise<TesseractWorkerInstance>> = [];
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null;

async function createConfiguredFastWorker(): Promise<TesseractWorkerInstance> {
  const baseOrigin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  const workerOptions = {
    workerPath: `${baseOrigin}/ocr/worker.min.js`,
    corePath: `${baseOrigin}/ocr/tesseract-core-lstm.wasm.js`,
    langPath: `${baseOrigin}/ocr/lang`,
    workerBlobURL: false,
  };

  let worker: TesseractWorkerInstance;
  try {
    worker = await createWorker('eng', 1, workerOptions);
  } catch {
    await pauseUi(250);
    worker = await createWorker('eng', 1, workerOptions);
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

async function acquireOcrWorkerPool(desiredCount = 3): Promise<TesseractWorkerInstance[]> {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
  const hwCores =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  const poolSize = Math.max(1, Math.min(desiredCount, Math.floor(hwCores / 2) || 2));

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
 * 2. محرك سحابي عند توفر الإنترنت (Gemini Vision لكامل الورقة دفعة واحدة) مع بديل محلي تلقائي فوري.
 * 3. قراءة الورقة كاملةً دفعة واحدة من أول سطر إلى آخر سطر دون تقطيع أو تقسيم إلى شرائح، مع استخراج كافة السطور المقروءة.
 */
export async function processOcrFromImage(
  imageSource: string | File | Blob,
  onProgress?: (progress: number, status: string) => void
): Promise<ExtractedSparePart[]> {
  try {
    if (onProgress) onProgress(15, '1/4 معايرة تلقائية سريعة لاتجاه الورقة وزيادة حدة النصوص...');
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
      maxDimension: 1800,
      minDimension: isFullSheetPhoto ? 1400 : 800,
      enhanceContrast: true,
      sharpenText: true,
      autoRotate: true,
    });

    // 2. المحرك السحابي لقراءة الورقة كاملة دفعة واحدة عند توفر الإنترنت مع بديل محلي تلقائي فوري
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try {
        if (onProgress) onProgress(35, '2/4 القراءة الشاملة لكامل الورقة دفعة واحدة...');
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

    // 3. القراءة المحلية الشاملة لكامل الورقة دفعة واحدة بدون تقسيمها إلى شرائح
    if (onProgress) onProgress(55, '2/4 تنقية إضاءة الورقة كاملةً وإبراز الأرقام الباهتة...');
    await pauseUi(0);

    const preprocessedGridFree = await preprocessImageForOCR(scaledNaturalSource);
    const [worker] = await acquireOcrWorkerPool(1);

    if (onProgress) onProgress(75, '3/4 القراءة الشاملة لكامل سطور الورقة دفعة واحدة...');
    const raw = await worker.recognize(preprocessedGridFree);
    let extracted = parseRawTextOcr(raw.data.text);

    // إذا كانت الصورة الأصلية أوضح قبل فلتر الشبكة، نقرأ الورقة الكاملة مباشرة ونختار القراءة الأشمل
    if (!isUsableExtraction(extracted, isFullSheetPhoto ? 3 : 1)) {
      const rawNatural = await worker.recognize(scaledNaturalSource);
      const naturalExtracted = parseRawTextOcr(rawNatural.data.text);
      if (naturalExtracted.length > extracted.length) {
        extracted = naturalExtracted;
      }
    }

    // معايرة سريعة واحدة فقط بزاوية 180° لكامل الورقة إذا التُقطت مقلوبة رأساً على عقب
    if (!isUsableExtraction(extracted, 1)) {
      if (onProgress) onProgress(88, '3/4 معايرة سريعة لاتجاه الورقة المقلوبة...');
      await pauseUi(0);
      const flipped180 = await rotateImageDegrees(scaledNaturalSource, 180);
      const flipRec = await worker.recognize(flipped180);
      const flipAttempt = parseRawTextOcr(flipRec.data.text);
      if (flipAttempt.length > extracted.length) {
        extracted = flipAttempt;
      }
    }

    if (!isUsableExtraction(extracted, 1)) {
      const preprocessed = await preprocessImageWithOpenCV(scaledNaturalSource, {
        rotateCounterClockwise90: false,
      });
      const enhRec = await worker.recognize(preprocessed.cleanedDataUrl);
      const enhanced = parseRawTextOcr(enhRec.data.text);
      if (enhanced.length > extracted.length) {
        extracted = enhanced;
      }
    }

    if (onProgress) onProgress(100, `4/4 اكتملت القراءة الشاملة للورقة (${extracted.length} سطراً)!`);
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
      status: hasCrossMark ? 'غير موجودة' : 'مضاف',
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
