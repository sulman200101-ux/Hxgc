import { rotateImageDegrees } from '../utils/imagePreprocessor';
import { createWorker } from 'tesseract.js';
import { categorizeAndTranslate } from '../utils/translator';
import { preprocessImageWithOpenCV } from '../utils/imagePreprocessing';
import { parseStrictAsmoTable } from '../utils/strictTableParser';
import {
  sanitizeQuantity,
  sanitizeLocationCode,
  sanitizeDescription,
  extractDynamicLocationFromLine,
  isValidSpecificLocation,
} from '../utils/regexSanitizer';
import { ItemStatus } from '../types';

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

export async function processOcrFromImage(
  imageSource: string | File | Blob,
  onProgress?: (progress: number, status: string) => void
): Promise<ExtractedSparePart[]> {
  let cleanedSource: string | File | Blob = imageSource;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;

  try {
    if (onProgress) onProgress(20, 'تهيئة محرك القراءة المحلي...');
    worker = await createWorker('eng', 1, { workerPath: '/ocr/worker.min.js', corePath: '/ocr/tesseract-core-lstm.wasm.js', langPath: '/ocr/lang' });
    if (onProgress) onProgress(50, 'قراءة الصورة الأصلية...');
    const raw = await worker.recognize(imageSource);
    let extracted = parseRawTextOcr(raw.data.text);
    const usable = (rows: ExtractedSparePart[]) => rows.some(row => /^\d{10}$/.test(row.part_number) && isValidSpecificLocation(row.location_code));
    if (!usable(extracted)) {
      const source = typeof imageSource === 'string' ? imageSource : await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(imageSource);
      });
      for (const [index, degrees] of ([270, 90, 180] as const).entries()) {
        if (onProgress) onProgress(60 + index * 10, 'محاولة قراءة الورقة باتجاه آخر...');
        const rotated = await rotateImageDegrees(source, degrees);
        const attempt = parseRawTextOcr((await worker.recognize(rotated)).data.text);
        if (attempt.length > extracted.length || usable(attempt)) extracted = attempt;
        if (usable(extracted)) break;
      }
    }
    if (!usable(extracted)) {
      if (onProgress) onProgress(90, 'محاولة تحسين الصورة...');
      const preprocessed = await preprocessImageWithOpenCV(imageSource, { rotateCounterClockwise90: false });
      cleanedSource = preprocessed.cleanedDataUrl;
      const enhanced = parseRawTextOcr((await worker.recognize(cleanedSource)).data.text);
      if (enhanced.length > extracted.length || usable(enhanced)) extracted = enhanced;
    }

    if (onProgress) onProgress(100, 'اكتملت المعالجة بنجاح!');
    return extracted;
  } catch (err) {
    console.warn('Local OCR notice:', err);
    throw new Error('تعذر تشغيل القراءة المحلية. جرّب صورة أخرى وأعد المحاولة؛ لم يتغير المخزون.');
  } finally {
    // Release OCR resources after success and failure before starting another sheet.
    await worker?.terminate().catch(() => {});
  }
}

export function parseRawTextOcr(rawText: string): ExtractedSparePart[] {
  const strictItems = parseStrictAsmoTable(rawText);
  if (strictItems.length > 0) {
    return strictItems;
  }

  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const results: ExtractedSparePart[] = [];

  for (const line of lines) {
    const partMatch = line.match(/\b(10\d{8})\b/);
    if (!partMatch) {
      continue;
    }

    const partNum = partMatch[1];
    const dynamicLoc = extractDynamicLocationFromLine(line);
    const loc = dynamicLoc || sanitizeLocationCode(line);
    if (!isValidSpecificLocation(loc)) {
      continue;
    }

    const hasCrossMark = /\b[Xx×✗✘]\b/.test(line);

    const qtyMatch = line.match(/\b(\d{1,4})\s*(PCS|EA|SET|PK|SH|CO|AY|\b)?$/i);
    const total = sanitizeQuantity(qtyMatch ? qtyMatch[1] : 1, 1);
    const out = 0;

    let rawDesc = line
      .replace(partNum, '')
      .replace(loc, '')
      .replace(/\b\d{1,4}\b/g, '')
      .trim();

    const { cleaned: descEn, isValid: descValid } = sanitizeDescription(rawDesc);

    if (descValid) {
      const { category, descAr } = categorizeAndTranslate(descEn);

      results.push({
        part_number: partNum,
        location_code: loc,
        description_en: descEn,
        description_ar: descAr,
        category,
        qty_total: total,
        qty_out: out,
        qty_remaining: hasCrossMark ? 0 : Math.max(0, total - out),
        is_missing: hasCrossMark ? 1 : 0,
        status: hasCrossMark ? 'غير موجودة' : 'مضاف',
        confidence: 'اقتراح قراءة غير مؤكد',
      });
    }
  }

  return results;
}

export function parseSimulatedTableOcr(): ExtractedSparePart[] {
  return [];
}
