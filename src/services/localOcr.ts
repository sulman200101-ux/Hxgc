import {
  rotateImageDegrees,
  prepareImageForAi,
  splitImageIntoOverlappingHalves,
} from '../utils/imagePreprocessor';
import { preprocessImageForOCR } from '../utils/imagePreprocess';
import { createWorker } from 'tesseract.js';
import { categorizeAndTranslate } from '../utils/translator';
import { preprocessImageWithOpenCV } from '../utils/imagePreprocessing';
import { parseStrictAsmoTable } from '../utils/strictTableParser';
import {
  parseTableWithGeminiVision,
  mergeOverlappingSheetRows,
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

// تجمع العامل المحلي (Reusable Tesseract Worker Pool) لتسريع قراءة الأوراق المتتالية ومنع إعادة تحميل WASM
let sharedWorkerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null;

async function acquireOcrWorker(): Promise<Awaited<ReturnType<typeof createWorker>>> {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
  if (!sharedWorkerPromise) {
    sharedWorkerPromise = (async () => {
      try {
        return await createWorker(['eng', 'ara'], 1, {
          workerPath: '/ocr/worker.min.js',
          corePath: '/ocr/tesseract-core-lstm.wasm.js',
          langPath: '/ocr/lang',
        });
      } catch {
        return await createWorker('eng', 1, {
          workerPath: '/ocr/worker.min.js',
          corePath: '/ocr/tesseract-core-lstm.wasm.js',
          langPath: '/ocr/lang',
        });
      }
    })();
  }
  try {
    return await sharedWorkerPromise;
  } catch (err) {
    sharedWorkerPromise = null;
    throw err;
  }
}

function scheduleWorkerRelease(delayMs = 20000): void {
  if (workerIdleTimer) clearTimeout(workerIdleTimer);
  workerIdleTimer = setTimeout(async () => {
    const p = sharedWorkerPromise;
    sharedWorkerPromise = null;
    workerIdleTimer = null;
    if (p) {
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
  const p = sharedWorkerPromise;
  sharedWorkerPromise = null;
  if (p) {
    const w = await p.catch(() => null);
    await w?.terminate().catch(() => {});
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
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

/**
 * قراءة أوراق الجرد قراءة حقيقية كاملة (بدون أي أرقام قطع مخزنة مسبقاً):
 * 1. تدوير الصور الطولية الملتقطة بالجوال (90° عكس عقارب الساعة) وتكبيرها لدقة 2200px
 * 2. إرسال الصورة الطبيعية الواضحة (دون فلتر التباين الحاد الذي يمسح السطور) إلى Gemini Vision مع دعم تقسيم الورقة لنصفين (Top/Bottom Halves) لضمان قراءة الـ 37 سطراً كاملة
 * 3. في حال عدم توفر الاتصال، تشغيل محرك Tesseract المحلي مع توحيد الإضاءة الموضعي وتقسيم النصفين لاسترجاع كافة السطور
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

    // تجهيز الصورة الطبيعية الواضحة (بدون طمس الرمادي) لإرسالها لمحرك الذكاء الاصطناعي البصري
    const scaledNaturalSource = await prepareImageForAi(sourceDataUrl, {
      maxDimension: 2200,
      minDimension: isFullSheetPhoto ? 1800 : 800,
      enhanceContrast: true,
      forceRotateCcw: isPortraitTablePhoto,
    });

    // 1. القراءة الذكية الكاملة عبر Gemini Vision (المتصفح المباشر في AI Studio أو الخادم)
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try {
        if (onProgress) onProgress(35, '2/4 قراءة جميع سطور الورقة بالماسح الذكي...');
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

    // 2. المحرك المحلي (Offline Tesseract WASM Pool) مع تنقية الإضاءة الموضعية بدون طمس الحروف
    if (onProgress) onProgress(50, '2/4 تشغيل محرك القراءة الضوئي المحلي وتنقية الظلال...');
    await pauseUi(0);

    const preprocessedShadowFree = await preprocessImageForOCR(scaledNaturalSource);
    const worker = await acquireOcrWorker();

    if (onProgress) onProgress(65, '3/4 قراءة سطور الجدول وأرقام القطع والمواقع...');
    const raw = await worker.recognize(preprocessedShadowFree);
    let extracted = parseRawTextOcr(raw.data.text);

    // إذا كانت الورقة كاملة واستخرج المحرك المحلي عدداً جزئياً من السطور (بين 8 و 34 سطراً)،
    // نقوم بقراءة النصف العلوي والنصف السفلي بتكبير عالٍ ودمج السطور المفقودة!
    if (isFullSheetPhoto && extracted.length >= 8 && extracted.length < 34) {
      if (onProgress) onProgress(78, '3/4 فحص تفصيلي للنصف العلوي والسفلي لاستكمال كافة السطور...');
      await pauseUi(0);
      const { topHalf, bottomHalf } = await splitImageIntoOverlappingHalves(preprocessedShadowFree);
      const topRec = await worker.recognize(topHalf);
      const botRec = await worker.recognize(bottomHalf);
      const topRows = parseRawTextOcr(topRec.data.text);
      const botRows = parseRawTextOcr(botRec.data.text);
      const merged = mergeOverlappingSheetRows(extracted, topRows, botRows);
      if (merged.length > extracted.length) {
        extracted = merged;
      }
    }

    // إذا كانت الورقة تحتاج تدوير إضافي، نجرب زوايا التدوير
    const minExpectedRows = isFullSheetPhoto ? 3 : 1;
    if (!isUsableExtraction(extracted, minExpectedRows)) {
      const candidateAngles = isPortraitTablePhoto ? ([180, 90, 270] as const) : ([270, 90, 180] as const);
      for (const [index, degrees] of candidateAngles.entries()) {
        if (onProgress) onProgress(82 + index * 5, `3/4 معايرة اتجاه الورقة بزاوية ${degrees}°...`);
        await pauseUi(0);
        const baseForRot = isPortraitTablePhoto ? sourceDataUrl : scaledNaturalSource;
        const rotated = await rotateImageDegrees(baseForRot, degrees);
        const rotatedClean = await preprocessImageForOCR(rotated);
        const rotRec = await worker.recognize(rotatedClean);
        const attempt = parseRawTextOcr(rotRec.data.text);
        if (attempt.length > extracted.length) {
          extracted = attempt;
        }
        if (isUsableExtraction(extracted, minExpectedRows)) break;
      }
    }

    // إذا لم تنجح القراءة المباشرة، تطبيق فلتر OpenCV المحسن لإزالة الظلال وخطوط الجدول
    if (!isUsableExtraction(extracted)) {
      if (onProgress) onProgress(94, '3/4 تحسين التباين وإزالة خطوط الشبكة...');
      await pauseUi(0);
      const preprocessed = await preprocessImageWithOpenCV(scaledNaturalSource, {
        rotateCounterClockwise90: false,
      });
      const enhRec = await worker.recognize(preprocessed.cleanedDataUrl);
      const enhanced = parseRawTextOcr(enhRec.data.text);
      if (enhanced.length > extracted.length || isUsableExtraction(enhanced)) {
        extracted = enhanced;
      }
    }

    if (onProgress) onProgress(100, `4/4 اكتملت القراءة (${extracted.length} سطراً)!`);
    return extracted;
  } catch (err) {
    console.warn('Local OCR notice:', err);
    await releaseOcrWorkerNow();
    throw new Error('تعذر تشغيل القراءة المحلية. جرّب صورة أخرى وأعد المحاولة؛ لم يتغير المخزون.');
  } finally {
    scheduleWorkerRelease(20000);
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

  for (const line of lines) {
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

    const partMatch = normalizedDigitsLine.match(/\b(10\d{8})\b/);
    if (!partMatch) {
      continue;
    }

    const partNum = partMatch[1];
    const dynamicLoc = extractDynamicLocationFromLine(line);
    const loc = dynamicLoc || sanitizeLocationCode(line);

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
      .replace(partNum, '')
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
  return contextResolved
    .filter((item) => isValidSpecificLocation(item.location_code))
    .map(({ location: _loc, ...rest }) => rest);
}

export function parseSimulatedTableOcr(): ExtractedSparePart[] {
  return [];
}
