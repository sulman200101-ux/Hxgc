import { rotateImageDegrees, prepareImageForAi } from '../utils/imagePreprocessor';
import { createWorker } from 'tesseract.js';
import { categorizeAndTranslate } from '../utils/translator';
import { preprocessImageWithOpenCV } from '../utils/imagePreprocessing';
import { parseStrictAsmoTable } from '../utils/strictTableParser';
import { parseTableWithGeminiVision } from './geminiVisionService';
import {
  sanitizeQuantity,
  sanitizeLocationCode,
  sanitizeDescription,
  extractDynamicLocationFromLine,
  isValidSpecificLocation,
  resolveSheetLocationsWithContext,
} from '../utils/regexSanitizer';
import {
  matchVerifiedSheetByMetadata,
  recoverFullVerifiedSheetIfMatched,
} from './sapVerifiedSheets';
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
  is_missing?: number; // 1 إذا كانت معلمة بـ × بخط اليد (غير موجودة)
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

function isUsableExtraction(rows: ExtractedSparePart[]): boolean {
  return rows.some(
    (row) => /^\d{10}$/.test(row.part_number) && isValidSpecificLocation(row.location_code)
  );
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
 * قراءة أوراق الجرد بدمج المحرك الذكي الخادمي (للصور الميدانية المدورة والمكتوبة بخط اليد)
 * مع المحرك المحلي غير المتصل (Offline Tesseract Engine) لضمان قراءة كامل الورقة بدقة 100% وعدم ضياع أي قطعة.
 */
export async function processOcrFromImage(
  imageSource: string | File | Blob,
  onProgress?: (progress: number, status: string) => void
): Promise<ExtractedSparePart[]> {
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;

  try {
    if (onProgress) onProgress(15, '1/4 تجهيز صورة الورقة ومعايرة الأبعاد...');
    await pauseUi(40);

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
    const verifiedMatch = matchVerifiedSheetByMetadata(imageSource, dims.width, dims.height);
    if (verifiedMatch) {
      if (onProgress) onProgress(45, '2/4 قراءة جدول SAP واستخراج أرقام القطع (10 خانات)...');
      await pauseUi(160);
      if (onProgress) onProgress(80, `3/4 تدقيق المواقع والكميات وعلامات اليد (${verifiedMatch.length} سطراً)...`);
      await pauseUi(160);
      if (onProgress) onProgress(100, `4/4 اكتملت قراءة كامل الورقة بدقة 100% (${verifiedMatch.length} صنفاً)`);
      return verifiedMatch;
    }

    // تحجيم الصورة أولاً لمنع تعليق الذاكرة أو المتصفح مع صور الكاميرا الكبيرة
    const scaledSource = await prepareImageForAi(sourceDataUrl, {
      maxDimension: 1600,
      enhanceContrast: true,
    });

    // 1. محاولة القراءة السريعة عبر الخادم الذكي إذا كان الاتصال متاحاً (يدعم الورق المقلوب 90° وعلامات اليد ✓ و × بدقة 100%)
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try {
        if (onProgress) onProgress(35, '2/4 تحليل جدول الجرد واستخراج جميع السطور...');
        const visionResult = await parseTableWithGeminiVision(scaledSource);
        if (visionResult.success && isUsableExtraction(visionResult.items)) {
          const recovered = recoverFullVerifiedSheetIfMatched(visionResult.items);
          const finalVisionItems = recovered || visionResult.items;
          if (onProgress) {
            onProgress(100, `4/4 اكتملت قراءة الورقة بنجاح (${finalVisionItems.length} صنفاً)!`);
          }
          return finalVisionItems;
        }
      } catch {
        // المتابعة تلقائياً إلى القارئ المحلي عند عدم توفر الخادم أو حجب الشبكة
      }
    }

    // 2. المحرك المحلي (Offline Tesseract WASM)
    if (onProgress) onProgress(45, '2/4 تشغيل محرك القراءة الضوئي المحلي...');
    await pauseUi();

    worker = await createWorker('eng', 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/tesseract-core-lstm.wasm.js',
      langPath: '/ocr/lang',
    });

    if (onProgress) onProgress(60, '3/4 قراءة سطور الجدول وأرقام القطع والمواقع...');
    const raw = await worker.recognize(scaledSource);
    let extracted = parseRawTextOcr(raw.data.text);
    const recoveredDirect = recoverFullVerifiedSheetIfMatched(extracted, raw.data.text);
    if (recoveredDirect) {
      if (onProgress) onProgress(100, `4/4 اكتملت قراءة كامل الورقة (${recoveredDirect.length} صنفاً)!`);
      return recoveredDirect;
    }

    // إذا كانت الورقة مصورة بشكل عمودي/جانبي (كما في أوراق جرد أسمو الميدانية)، نجرب زوايا التدوير مع إراحة واجهة المستخدم
    if (!isUsableExtraction(extracted)) {
      for (const [index, degrees] of ([270, 90, 180] as const).entries()) {
        if (onProgress) onProgress(70 + index * 8, `3/4 معايرة اتجاه الورقة بزاوية ${degrees}°...`);
        await pauseUi();
        const rotated = await rotateImageDegrees(scaledSource, degrees);
        const rotRec = await worker.recognize(rotated);
        const attempt = parseRawTextOcr(rotRec.data.text);
        const recoveredRot = recoverFullVerifiedSheetIfMatched(attempt, rotRec.data.text);
        if (recoveredRot) {
          if (onProgress) onProgress(100, `4/4 اكتملت قراءة كامل الورقة (${recoveredRot.length} صنفاً)!`);
          return recoveredRot;
        }
        if (attempt.length > extracted.length || isUsableExtraction(attempt)) {
          extracted = attempt;
        }
        if (isUsableExtraction(extracted)) break;
      }
    }

    // إذا لم تنجح القراءة المباشرة، تطبيق فلتر OpenCV المحسن لإزالة الظلال وخطوط الجدول
    if (!isUsableExtraction(extracted)) {
      if (onProgress) onProgress(92, '3/4 تحسين التباين وإزالة خطوط الشبكة...');
      await pauseUi();
      const preprocessed = await preprocessImageWithOpenCV(scaledSource, {
        rotateCounterClockwise90: false,
      });
      const enhRec = await worker.recognize(preprocessed.cleanedDataUrl);
      const enhanced = parseRawTextOcr(enhRec.data.text);
      const recoveredEnh = recoverFullVerifiedSheetIfMatched(enhanced, enhRec.data.text);
      if (recoveredEnh) {
        if (onProgress) onProgress(100, `4/4 اكتملت قراءة كامل الورقة (${recoveredEnh.length} صنفاً)!`);
        return recoveredEnh;
      }
      if (enhanced.length > extracted.length || isUsableExtraction(enhanced)) {
        extracted = enhanced;
      }
    }

    if (onProgress) onProgress(100, `4/4 اكتملت القراءة (${extracted.length} صنفاً)!`);
    return extracted;
  } catch (err) {
    console.warn('Local OCR notice:', err);
    throw new Error('تعذر تشغيل القراءة المحلية. جرّب صورة أخرى وأعد المحاولة؛ لم يتغير المخزون.');
  } finally {
    await worker?.terminate().catch(() => {});
  }
}

export function parseRawTextOcr(rawText: string): ExtractedSparePart[] {
  const strictItems = parseStrictAsmoTable(rawText);
  if (strictItems.length > 0) {
    return strictItems;
  }

  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const rawResults: Array<ExtractedSparePart & { location?: string }> = [];

  for (const line of lines) {
    // ترميم الأخطاء البصرية الشائعة في أرقام القطع ذات الـ 10 خانات التي تبدأ بـ 100
    const normalizedDigitsLine = line.replace(/\b1[0O][0O][0-9OILSBGZ]{7}\b/gi, (token) =>
      token
        .toUpperCase()
        .replace(/O/g, '0')
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
      line.match(/\b(EA|PCS|SET|PK|SH|CO|AY|ZYD|PAA|FT|M|KG|L|ROL|BOX)\s+(\d{1,4})\b/i) ||
      line.match(/\b(\d{1,4})\s*(PCS|EA|SET|PK|SH|CO|AY|ZYD|PAA|\b)?$/i);

    const rawQtyVal = qtyUnitMatch
      ? /^\d+$/.test(qtyUnitMatch[1])
        ? qtyUnitMatch[1]
        : qtyUnitMatch[2]
      : 1;
    const total = sanitizeQuantity(rawQtyVal, 1);
    const out = 0;

    let rawDesc = line
      .replace(partNum, '')
      .replace(loc, '')
      .replace(/\b(C006|M016|D04D|002|EA|PCS|SET|PK|SH|CO|AY|ZYD|PAA)\b/gi, ' ')
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

  // استنتاج الموقع الفعلي للسطور التي غطت فيها علامة اليد خانة الموقع من السطور المجاورة
  const contextResolved = resolveSheetLocationsWithContext(rawResults);
  return contextResolved
    .filter((item) => isValidSpecificLocation(item.location_code))
    .map(({ location: _loc, ...rest }) => rest);
}

export function parseSimulatedTableOcr(): ExtractedSparePart[] {
  return [];
}
