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

  try {
    if (onProgress) onProgress(15, 'تنظيف الصورة برمجياً وإزالة الظلال...');
    const preprocessed = await preprocessImageWithOpenCV(imageSource);
    cleanedSource = preprocessed.cleanedDataUrl;

    if (onProgress) onProgress(40, 'تهيئة محرك القراءة المحلي...');
    const worker = await createWorker('eng');

    if (onProgress) onProgress(65, 'جاري قراءة واستخراج نصوص الجدول...');
    const ret = await worker.recognize(cleanedSource);
    const rawText = ret.data.text;

    if (onProgress) onProgress(90, 'تطبيق فلتر أسمو الصارم (10 أرقام + موقع محدد)...');
    await worker.terminate();

    let extracted = parseStrictAsmoTable(rawText);
    if (extracted.length === 0) {
      extracted = parseRawTextOcr(rawText);
    }

    if (onProgress) onProgress(100, 'اكتملت المعالجة بنجاح!');
    return extracted;
  } catch (err) {
    console.warn('Local OCR notice:', err);
    return [];
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
