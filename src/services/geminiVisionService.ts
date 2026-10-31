/**
 * خدمة القراءة الذكية لأوراق جرد أسمو (SAP Inventory Controller) عبر محرك بايثون الخادمي (/api/gemini/parse-table)
 * تستغني كلياً عن مفتاح Gemini API وتعتمد على محرك بايثون (OpenCV + NumPy + Multi-Core C++ Tesseract)
 * مع التحويل التلقائي لمحرك المتصفح المتوازي عند تشغيل تطبيق الأندرويد بمعزل عن الخادم.
 */

import type { ExtractedSparePart } from './localOcr';
import { categorizeAndTranslate } from '../utils/translator';
import {
  strict10DigitRegexFilter,
  dynamicLocationNormalizer,
  isValidSpecificLocation,
  detectMissingFromCheckMark,
  charToDigitMapper,
  resolveSheetLocationsWithContext,
  repair10DigitMaterialCode,
  normalizeSapMaterialPrefix,
} from '../utils/regexSanitizer';
import { prepareImageForAi } from '../utils/imagePreprocessor';
import type { SkippedRow } from '../components/SkippedRowsModal';

export interface StructuredSparePartJson {
  part_number: string;
  description: string;
}

export interface GeminiVisionError {
  errorCode: string;
  errorNum: number;
  title: string;
  reason: string;
  message: string;
  actionHint?: string;
}

export interface GeminiVisionResult {
  success: boolean;
  items: ExtractedSparePart[];
  structuredParts?: StructuredSparePartJson[];
  skippedRows?: SkippedRow[];
  totalDetectedRows?: number;
  isSheetComplete?: boolean;
  repairedCount?: number;
  message?: string;
  error?: GeminiVisionError;
}

let isServerFallbackCached = false;

function isPhoneNumberNoise(digits: string): boolean {
  return /^(?:05\d{8}|966\d{8,9}|00966\d{8,9}|01[1-9]\d{7})$/.test(digits);
}

export function repair10DigitMaterialClient(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const rawDigits = String(raw).replace(/[^0-9]/g, '');
  if (isPhoneNumberNoise(rawDigits)) return null;

  const strict = strict10DigitRegexFilter(String(raw));
  if (strict && !isPhoneNumberNoise(strict)) return normalizeSapMaterialPrefix(strict);

  const repairedByUtil = repair10DigitMaterialCode(String(raw));
  if (repairedByUtil && !isPhoneNumberNoise(repairedByUtil)) return repairedByUtil;

  const cleaned = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[OQD°]/g, '0')
    .replace(/[IL|!'"`]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/G/g, '6')
    .replace(/Z/g, '2')
    .replace(/[^0-9]/g, '');
  if (isPhoneNumberNoise(cleaned)) return null;
  if (/^\d{10}$/.test(cleaned)) {
    const fixed = normalizeSapMaterialPrefix(cleaned);
    if (/^10\d{8}$/.test(fixed)) return fixed;
  }
  if (/^00[01]\d{6}$/.test(cleaned)) return `1${cleaned}`;
  const match = cleaned.match(/(10\d{8})/);
  return match ? normalizeSapMaterialPrefix(match[1]) : null;
}

function isHeaderOrFooterNoise(item: any): boolean {
  if (!item) return true;
  const rawPart = String(item.part_number ?? item.material_number ?? item.material ?? '').trim().toUpperCase();
  const rawDesc = String(item.description_en ?? item.description ?? '').trim().toUpperCase();

  if (
    rawPart === 'MATERIAL' ||
    rawPart === 'PART NUMBER' ||
    rawDesc === 'MATERIAL DESCRIPTION' ||
    rawDesc === 'DESCRIPTION' ||
    (rawDesc.includes('ITEMS') && !rawPart)
  ) {
    return true;
  }

  const digits = rawPart.replace(/[^0-9]/g, '');
  if (isPhoneNumberNoise(digits)) {
    return true;
  }

  if (digits.length === 0 && (!rawDesc || rawDesc === 'SPARE PART ASMO' || rawDesc.length < 3)) {
    return true;
  }

  return false;
}

/**
 * استدعاء مسار محرك بايثون الخادمي (/api/gemini/parse-table) لقراءة الورقة كاملة
 */
async function callPythonVisionServer(dataUrl: string): Promise<any[] | null> {
  if (isServerFallbackCached) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch('/api/gemini/parse-table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: dataUrl,
        mimeType: 'image/jpeg',
      }),
      signal: controller.signal,
    });
    if (response.ok) {
      const candidateData = await response.json();
      if (candidateData?.fallbackToLocal) {
        isServerFallbackCached = true;
        return null;
      }
      if (candidateData && Array.isArray(candidateData.items) && candidateData.items.length > 0) {
        return candidateData.items;
      }
    }
  } catch {
    // التحويل السلس للمحرك المحلي في المتصفح
  } finally {
    clearTimeout(timeoutId);
  }

  return null;
}

function normalizeRawVisionItems(rawItems: any[]): {
  validatedItems: ExtractedSparePart[];
  skippedRows: SkippedRow[];
  repairedCount: number;
} {
  const rawFiltered = (rawItems || []).filter((item: any) => !isHeaderOrFooterNoise(item));
  const contextResolvedItems = resolveSheetLocationsWithContext(rawFiltered);

  const validatedItems: ExtractedSparePart[] = [];
  const skippedRows: SkippedRow[] = [];
  let repairedCount = 0;

  contextResolvedItems.forEach((item: any, idx: number) => {
    const rawPartStr = String(
      item.part_number ?? item.material_number ?? item.material ?? item.partNumber ?? ''
    ).trim();

    const valid10DigitPart = repair10DigitMaterialClient(rawPartStr);
    if (valid10DigitPart && valid10DigitPart !== rawPartStr) {
      repairedCount++;
    }

    const normLocation =
      item.location_code ||
      dynamicLocationNormalizer(item.location ?? item.storage_bin ?? item.storageBin);
    const isLocValid = isValidSpecificLocation(normLocation);

    const isMissing = detectMissingFromCheckMark(item);
    const rawQty = item.qty_total ?? item.quantity ?? item.qty;
    const parsedQty = charToDigitMapper(rawQty, 1);
    const total = parsedQty > 0 ? parsedQty : 1;

    const rawRemark = item.remark ? String(item.remark).trim() : '';
    const minusMatch = rawRemark.match(/^(?:\d+\s*-\s*(\d+)|-\s*(\d+))$/);
    const out = isMissing ? 0 : minusMatch ? Math.min(total, Number(minusMatch[1] || minusMatch[2] || 0)) : 0;
    const remark = out > 0 ? `-${out}` : undefined;

    const rawDescCandidate = String(
      item.description_en || item.description || item.material_description || item.desc || ''
    )
      .replace(/^[\s|—\-~_]+/, '')
      .trim();
    const descEn = rawDescCandidate.length >= 2 ? rawDescCandidate : 'SPARE PART ASMO';

    if (valid10DigitPart && isLocValid) {
      const { category, descAr: dictDescAr } = categorizeAndTranslate(descEn);
      const rawAiAr = item.description_ar ? String(item.description_ar).trim() : '';
      const hasArabicChars = /[\u0600-\u06FF]/.test(rawAiAr);
      const finalDescAr = hasArabicChars && rawAiAr.length >= 4 ? rawAiAr : dictDescAr;

      validatedItems.push({
        part_number: valid10DigitPart,
        location_code: normLocation,
        description_en: descEn,
        description_ar: finalDescAr,
        category,
        qty_total: total,
        qty_out: out,
        qty_remaining: isMissing ? 0 : Math.max(0, total - out),
        is_missing: isMissing ? 1 : 0,
        remark,
        status: isMissing ? 'غير موجودة' : 'غير مدقق',
        confidence: 'اقتراح قراءة غير مؤكد',
      });
    } else {
      const cleanDigits = rawPartStr.replace(/[^0-9]/g, '');
      let reason = !valid10DigitPart
        ? cleanDigits.length > 0 && cleanDigits.length <= 5
          ? `الرقم (${cleanDigits}) هو رقم التسلسل (#) وليس رقم القطعة المكون من 10 أرقام (Material)`
          : 'رقم القطعة (10 أرقام) غير واضح في هذا السطر'
        : 'اسم الموقع غير واضح في هذا السطر';

      skippedRows.push({
        id: `skip-${skippedRows.length + 1}`,
        row_number: idx + 1,
        raw_text: `${rawPartStr || '---'} | ${normLocation || '---'} | Qty: ${total} | ${isMissing ? '× غير موجودة' : '✓'} | ${descEn}`,
        part_number: rawPartStr,
        location: normLocation || '',
        quantity: total,
        description_en: descEn,
        is_missing: isMissing ? 1 : 0,
        reason,
      });
    }
  });

  return {
    validatedItems: resolveSheetLocationsWithContext(validatedItems),
    skippedRows,
    repairedCount,
  };
}

export function mergeOverlappingSheetRows(
  baseRows: ExtractedSparePart[],
  topRows: ExtractedSparePart[],
  bottomRows: ExtractedSparePart[]
): ExtractedSparePart[] {
  if (topRows.length > 0 && bottomRows.length > 0) {
    const rowsMatchAtBoundary = (a: ExtractedSparePart, b: ExtractedSparePart): boolean => {
      if (a.part_number === b.part_number) return true;
      if (a.part_number.slice(-2) === b.part_number.slice(-2)) {
        let same = 0;
        for (let k = 0; k < 10; k++) {
          if (a.part_number[k] === b.part_number[k]) same++;
        }
        if (same >= 8) return true;
      }
      return false;
    };

    const tailStart = Math.max(0, topRows.length - 6);
    let cutTopAt = topRows.length;
    let startBotAt = 0;
    let found = false;

    for (let ti = tailStart; ti < topRows.length; ti++) {
      for (let bi = 0; bi < Math.min(4, bottomRows.length); bi++) {
        if (rowsMatchAtBoundary(topRows[ti], bottomRows[bi])) {
          cutTopAt = ti;
          startBotAt = bi;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    const merged = resolveSheetLocationsWithContext([
      ...topRows.slice(0, cutTopAt),
      ...bottomRows.slice(startBotAt),
    ]);
    return merged.length >= baseRows.length ? merged : baseRows;
  }

  return topRows.length + bottomRows.length > baseRows.length
    ? [...topRows, ...bottomRows]
    : baseRows;
}

export async function parseTableWithGeminiVision(
  imageSource: string | File | Blob,
  alreadyPrepared = false
): Promise<GeminiVisionResult> {
  if (isServerFallbackCached) {
    return {
      success: false,
      items: [],
      skippedRows: [],
      isSheetComplete: false,
      message: 'يتم استخدام محرك القراءة المحلي.',
    };
  }

  try {
    let cleanImageDataUrl = '';
    if (typeof imageSource === 'string' && alreadyPrepared) {
      cleanImageDataUrl = imageSource;
    } else {
      const rawDataUrl =
        typeof imageSource === 'string'
          ? imageSource
          : await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(imageSource);
            });

      cleanImageDataUrl = await prepareImageForAi(rawDataUrl, {
        maxDimension: 1650,
        minDimension: 1350,
        enhanceContrast: true,
        sharpenText: true,
      });
    }

    const rawItems = await callPythonVisionServer(cleanImageDataUrl);
    if (!rawItems || rawItems.length === 0) {
      return {
        success: false,
        items: [],
        skippedRows: [],
        isSheetComplete: false,
        message: 'يتم استخدام محرك القراءة المحلي.',
      };
    }

    const { validatedItems, skippedRows, repairedCount } = normalizeRawVisionItems(rawItems);

    return {
      success: validatedItems.length > 0,
      items: validatedItems,
      skippedRows,
      repairedCount,
      totalDetectedRows: validatedItems.length + skippedRows.length,
      isSheetComplete: validatedItems.length > 0 && skippedRows.length === 0,
    };
  } catch {
    return {
      success: false,
      items: [],
      skippedRows: [],
      isSheetComplete: false,
      message: 'يتم استخدام محرك القراءة المحلي.',
    };
  }
}
