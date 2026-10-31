import {
  rotateImageDegrees,
  prepareImageForAi,
  splitImageIntoThreeBands,
} from '../utils/imagePreprocessor';
import { preprocessImageForOCR } from '../utils/imagePreprocess';
import { createWorker } from 'tesseract.js';
import { categorizeAndTranslate } from '../utils/translator';
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

// تجمع العامل المحلي (Reusable Tesseract Worker Pool) مخصص للغة الإنجليزية والأرقام فقط لمضاعفة السرعة والدقة 3 مرات
let sharedWorkerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null;

async function acquireOcrWorker(): Promise<Awaited<ReturnType<typeof createWorker>>> {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
  if (!sharedWorkerPromise) {
    sharedWorkerPromise = (async () => {
      const worker = await createWorker('eng', 1, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/tesseract-core-lstm.wasm.js',
        langPath: '/ocr/lang',
      });
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: '6' as any,
          preserve_interword_spaces: '1',
        });
      } catch {
        // المتابعة بالإعدادات الافتراضية في بيئة الاختبار
      }
      return worker;
    })();
  }
  try {
    return await sharedWorkerPromise;
  } catch (err) {
    sharedWorkerPromise = null;
    throw err;
  }
}

function scheduleWorkerRelease(delayMs = 25000): void {
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
    img.onload = () =>
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

/**
 * دمج نتائج الشرائح الثلاث المتداخلة (علوية + وسطى + سفلية) بالترتيب دون تكرار منطقة التداخل
 */
function mergeThreeBandRows(
  baseRows: ExtractedSparePart[],
  topRows: ExtractedSparePart[],
  midRows: ExtractedSparePart[],
  botRows: ExtractedSparePart[]
): ExtractedSparePart[] {
  const topAndMid = mergeOverlappingSheetRows([], topRows, midRows);
  const allBands = mergeOverlappingSheetRows(baseRows, topAndMid, botRows);
  return allBands.length >= baseRows.length ? allBands : baseRows;
}

/**
 * قراءة أوراق الجرد قراءة حقيقية فائقة السرعة لجميع الـ 37 سطراً:
 * 1. تدوير الصور الطولية الملتقطة بالجوال (90° عكس عقارب الساعة) وتجهيزها بدقة مثالية
 * 2. القراءة عبر المسار الخادمي (/api/gemini/parse-table) مع دعم الدمج النصفي لاستخراج الـ 37 سطراً كاملة
 * 3. عند العمل بالمحرك المحلي (Tesseract):
 *    - استخدام نموذج الإنجليزية والأرقام فقط (eng + PSM 6) مع الترجمة العربية الفورية
 *    - إيقاف التدوير فوراً بمجرد اكتشاف اتجاه الورقة الصحيح (تجنب التوقف عند 82%)
 *    - تقسيم الورقة الكثيفة إلى 3 شرائح أفقية متداخلة (علوية، وسطى، سفلية) لاسترجاع جميع الـ 37 سطراً دون ضياع الأسطر الوسطى أو السفلية
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
      maxDimension: 1850,
      minDimension: isFullSheetPhoto ? 1500 : 800,
      enhanceContrast: true,
      forceRotateCcw: isPortraitTablePhoto,
    });

    // 1. القراءة السريعة الكاملة عبر الخادم (Gemini Vision)
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

    // 2. المحرك المحلي السريع (English-only Tesseract WASM Pool + Instant Arabic Translator)
    if (onProgress) onProgress(50, '2/4 تشغيل محرك القراءة الضوئي السريع وتنقية الصورة...');
    await pauseUi(0);

    let activeCleanImage = await preprocessImageForOCR(scaledNaturalSource);
    const worker = await acquireOcrWorker();

    if (onProgress) onProgress(65, '3/4 قراءة سطور الجدول وأرقام القطع والمواقع...');
    const raw = await worker.recognize(activeCleanImage);
    let extracted = parseRawTextOcr(raw.data.text);

    // إذا لم يُكتشف أي سطر في الاتجاه الأول فقط (0 سطور)، نفحص زوايا التدوير ونتوقف فوراً عند أول زاوية صحيحة!
    if (!isUsableExtraction(extracted, 1)) {
      const candidateAngles = isPortraitTablePhoto
        ? ([180, 90, 270] as const)
        : ([270, 90, 180] as const);
      for (const [index, degrees] of candidateAngles.entries()) {
        if (onProgress) {
          onProgress(72 + index * 5, `3/4 فحص اتجاه الورقة بزاوية ${degrees}°...`);
        }
        await pauseUi(0);
        const baseForRot = isPortraitTablePhoto ? sourceDataUrl : scaledNaturalSource;
        const rotated = await rotateImageDegrees(baseForRot, degrees);
        const rotatedClean = await preprocessImageForOCR(rotated);
        const rotRec = await worker.recognize(rotatedClean);
        const attempt = parseRawTextOcr(rotRec.data.text);
        if (attempt.length > extracted.length) {
          extracted = attempt;
          activeCleanImage = rotatedClean;
        }
        // إيقاف التدوير فوراً بمجرد اكتشاف سطور صحيحة في هذا الاتجاه!
        if (isUsableExtraction(extracted, 1)) {
          break;
        }
      }
    }

    // إذا كانت الورقة كثيفة واستخرج المسح الكامل أقل من 35 سطراً (مثلاً 8 سطور فقط)،
    // نقوم بتقسيم الورقة في اتجاهها الصحيح إلى 3 شرائح أفقية متداخلة عالية الوضوح لاسترجاع جميع الـ 37 سطراً!
    if (isFullSheetPhoto && isUsableExtraction(extracted, 1) && extracted.length < 35) {
      if (onProgress) {
        onProgress(85, '3/4 مسح الشرائح التفصيلية لاسترجاع كافة الـ 37 سطراً...');
      }
      await pauseUi(0);
      const { topBand, midBand, botBand } = await splitImageIntoThreeBands(activeCleanImage);
      const topRec = await worker.recognize(topBand);
      if (onProgress) onProgress(90, '3/4 استكمال قراءة الشريحة الوسطى...');
      const midRec = await worker.recognize(midBand);
      if (onProgress) onProgress(95, '3/4 استكمال قراءة الشريحة السفلية...');
      const botRec = await worker.recognize(botBand);

      const topRows = parseRawTextOcr(topRec.data.text);
      const midRows = parseRawTextOcr(midRec.data.text);
      const botRows = parseRawTextOcr(botRec.data.text);

      const merged = mergeThreeBandRows(extracted, topRows, midRows, botRows);
      if (merged.length > extracted.length) {
        extracted = merged;
      }
    }

    if (onProgress) onProgress(100, `4/4 اكتملت القراءة (${extracted.length} سطراً)!`);
    return extracted;
  } catch (err) {
    console.warn('Local OCR notice:', err);
    await releaseOcrWorkerNow();
    throw new Error('تعذر تشغيل القراءة المحلية. جرّب صورة أخرى وأعد المحاولة؛ لم يتغير المخزون.');
  } finally {
    scheduleWorkerRelease(25000);
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
    if (strictPartSet.has(partNum)) {
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
      .replace(partNum, '')
      .replace(loc, '')
      .replace(/\b(C006|M016|D04D|002|EA|PCS|SET|PK|SH|CO|AY|ZYD|PAA|KIT)\b/gi, ' ')
      .replace(/\b\d{1,4}\b/g, ' ')
      .trim();

    const { cleaned: descEn, isValid: descValid } = sanitizeDescription(rawDesc);
    const finalDescEn = descValid ? descEn : 'SPARE PART ASMO';
    const { category, descAr } = categorizeAndTranslate(finalDescEn);

    fallbackResults.push({
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
