/**
 * خدمة القراءة الصارمة لأوراق جرد أسمو (SAP Inventory Controller) عبر الخادم (/api/gemini/parse-table).
 * لا تحتوي على أي بيانات مخزنة مسبقاً؛ أي حقل لم يتمكن الـ OCR من قراءته بوضوح يُترك فارغاً تماماً ("").
 */

import type { ExtractedSparePart } from './localOcr';
import { categorizeAndTranslate } from '../utils/translator';
import {
  strict10DigitRegexFilter,
  dynamicLocationNormalizer,
  detectMissingFromCheckMark,
  charToDigitMapper,
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

const CLOUD_API_BASES = [
  'https://ais-pre-6btcof3lrz3zy2rhcknzht-242614928618.europe-west2.run.app',
  'https://ais-dev-6btcof3lrz3zy2rhcknzht-242614928618.europe-west2.run.app',
  'https://ais-pre-4hh2zz5tfhmhshdxbd6ohq-344013703327.europe-west2.run.app',
  'https://ais-dev-4hh2zz5tfhmhshdxbd6ohq-344013703327.europe-west2.run.app',
];

export function getCandidateApiUrls(path: string): string[] {
  if (typeof window === 'undefined') return [path];
  const proto = window.location?.protocol || '';
  const host = window.location?.hostname || '';
  const port = window.location?.port || '';
  const isNativeApk =
    proto === 'capacitor:' ||
    proto === 'file:' ||
    (host === 'localhost' && !port) ||
    (window as any).Capacitor?.isNativePlatform?.() === true;

  if (isNativeApk) {
    return CLOUD_API_BASES.map((base) => `${base}${path}`);
  }
  return [path];
}

function isPhoneNumberNoise(digits: string): boolean {
  return /^(?:05\d{8}|966\d{8,9}|00966\d{8,9}|01[1-9]\d{7})$/.test(digits);
}

/**
 * قراءة رقم القطعة فقط إذا كان مكوناً من 10 أرقام دقيقة وواضحة بدون أي تخمين، وإلا يُرجع null ليُترك الحقل فارغاً.
 */
export function repair10DigitMaterialClient(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  const strict = strict10DigitRegexFilter(trimmed);
  if (strict && !isPhoneNumberNoise(strict)) return strict;
  const exactMatch = trimmed.match(/\b(\d{10})\b/);
  if (exactMatch && !isPhoneNumberNoise(exactMatch[1])) return exactMatch[1];
  return null;
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
  if (digits && isPhoneNumberNoise(digits)) {
    return true;
  }

  return false;
}

async function callPythonVisionServer(
  dataUrl: string,
  preprocessedBase64?: string
): Promise<any[] | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return null;
  }

  const candidateUrls = getCandidateApiUrls('/api/gemini/parse-table');

  for (const url of candidateUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: dataUrl,
          preprocessedBase64,
          mimeType: 'image/jpeg',
        }),
        signal: controller.signal,
      });
      if (response.ok) {
        const candidateData = await response.json();
        if (candidateData && Array.isArray(candidateData.items) && candidateData.items.length > 0) {
          return candidateData.items;
        }
        if (candidateData?.fallbackToLocal) {
          continue;
        }
      }
    } catch {
      // تجربة الرابط الاحتياطي أو التحويل السلس للمحرك المحلي في المتصفح/الأندرويد
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return null;
}

function normalizeRawVisionItems(rawItems: any[]): {
  validatedItems: ExtractedSparePart[];
  skippedRows: SkippedRow[];
  repairedCount: number;
} {
  const rawFiltered = (rawItems || []).filter((item: any) => !isHeaderOrFooterNoise(item));

  const validatedItems: ExtractedSparePart[] = [];
  const skippedRows: SkippedRow[] = [];

  rawFiltered.forEach((item: any) => {
    const rawPartStr =
      item.part_number !== null && item.part_number !== undefined
        ? String(item.part_number ?? item.material_number ?? item.material ?? item.partNumber ?? '').trim()
        : '';

    const rawDescCandidate =
      item.description !== null && item.description !== undefined
        ? String(item.description || item.description_en || item.material_description || item.desc || '')
            .replace(/^[\s|—\-~_]+/, '')
            .trim()
        : String(item.description_en || '')
            .replace(/^[\s|—\-~_]+/, '')
            .trim();

    const cleanDescEn =
      rawDescCandidate &&
      rawDescCandidate !== 'غير محدد' &&
      rawDescCandidate !== 'SPARE PART ASMO' &&
      rawDescCandidate !== 'SPARE PART' &&
      rawDescCandidate !== 'null'
        ? rawDescCandidate
        : '';

    const rawLocVal =
      item.location_code !== null && item.location_code !== undefined
        ? String(item.location_code)
        : item.location !== null && item.location !== undefined
        ? String(item.location)
        : '';
    const finalLocation = rawLocVal && rawLocVal !== 'null' ? dynamicLocationNormalizer(rawLocVal) : '';

    // إذا كان رقم القطعة غير مقروء أو لا يتكون من 10 أرقام دقيقة يُترك فارغاً "" بدون أي تخمين
    const valid10DigitPart = repair10DigitMaterialClient(rawPartStr) || '';

    const rawQty = item.quantity !== undefined ? item.quantity : item.qty_total ?? item.qty;
    const hasExplicitQty = rawQty !== null && rawQty !== undefined && String(rawQty).trim() !== '';
    const parsedQty = hasExplicitQty ? charToDigitMapper(rawQty, 0) : 0;
    const total = parsedQty >= 0 ? parsedQty : 0;

    // إذا كان الصف فارغاً بالكامل نتجاوزه
    if (!valid10DigitPart && !finalLocation && !cleanDescEn && total === 0) {
      return;
    }

    const rawMarkSymbol = item.mark_symbol ?? item.check_mark ?? item.check ?? null;
    const normSymbol =
      rawMarkSymbol === '✓' || rawMarkSymbol === '✔'
        ? '✓'
        : rawMarkSymbol === 'X' || rawMarkSymbol === '✗' || rawMarkSymbol === '×'
        ? 'X'
        : rawMarkSymbol === 'F' || rawMarkSymbol === 'f'
        ? 'F'
        : rawMarkSymbol === 'N' || rawMarkSymbol === 'n' || rawMarkSymbol === '-'
        ? 'N'
        : null;

    const isMissing =
      normSymbol === 'X' ||
      item.status === 'غير موجود' ||
      item.status === 'غير موجودة' ||
      detectMissingFromCheckMark(item)
        ? 1
        : 0;

    const rawRemark = item.remark ? String(item.remark).trim() : '';
    const minusMatch = rawRemark.match(/(?:^\d+\s*[-−–—]\s*(\d+)$|^[-−–—]\s*(\d+)$)/);
    const shortage = minusMatch ? Number(minusMatch[1] || minusMatch[2] || 0) : normSymbol === 'N' ? 1 : 0;

    const out = isMissing ? 0 : total > 0 ? Math.min(total, shortage) : shortage;
    const remark =
      normSymbol === 'F'
        ? 'F'
        : out > 0
        ? `-${out}`
        : normSymbol === 'N'
        ? '-1'
        : undefined;

    const finalMarkSymbol: '✓' | 'X' | 'F' | 'N' | null = isMissing
      ? 'X'
      : normSymbol === 'F'
      ? 'F'
      : out > 0 || normSymbol === 'N'
      ? 'N'
      : normSymbol === '✓'
      ? '✓'
      : null;

    const finalAuditMeaning: string | null =
      item.audit_meaning ||
      item.audit_Meaning ||
      (finalMarkSymbol === '✓'
        ? 'القطع موجودة'
        : finalMarkSymbol === 'X'
        ? 'القطع غير موجودة'
        : finalMarkSymbol === 'F'
        ? 'تم نقل العدد الزائد إلى مكان آخر'
        : finalMarkSymbol === 'N'
        ? 'ناقص العدد'
        : null);

    const finalStatus = isMissing
      ? 'غير موجودة'
      : finalMarkSymbol === 'F' || item.status === 'تم النقل'
      ? 'تم النقل'
      : finalMarkSymbol === 'N' || item.status === 'ناقص العدد'
      ? 'ناقص العدد'
      : finalMarkSymbol === '✓' || item.status === 'مدقق'
      ? 'مدقق'
      : 'غير مدقق';

    const { category, descAr: dictDescAr } = cleanDescEn
      ? categorizeAndTranslate(cleanDescEn)
      : { category: '', descAr: '' };
    const rawAiAr = item.description_ar ? String(item.description_ar).trim() : '';
    const hasArabicChars = /[\u0600-\u06FF]/.test(rawAiAr);
    const finalDescAr = cleanDescEn ? (hasArabicChars && rawAiAr.length >= 4 ? rawAiAr : dictDescAr) : '';

    validatedItems.push({
      part_number: valid10DigitPart, // فارغ "" إذا لم يستطع قراءته
      location_code: finalLocation, // فارغ "" إذا لم يستطع قراءته
      description_en: cleanDescEn, // فارغ "" إذا لم يستطع قراءته
      description_ar: finalDescAr, // فارغ "" إذا لم يستطع قراءته
      category,
      qty_total: total, // 0 إذا لم يستطع قراءته
      qty_out: out,
      qty_remaining: isMissing ? 0 : Math.max(0, total - out),
      is_missing: isMissing,
      remark,
      mark_symbol: finalMarkSymbol,
      audit_meaning: finalAuditMeaning,
      status: finalStatus,
      confidence: 'قراءة فعلية من الورقة',
    });
  });

  return {
    validatedItems,
    skippedRows,
    repairedCount: 0,
  };
}

/**
 * قراءة صارمة ودقيقة (Strict Zero-Hallucination OCR) تمرر الصورة كاملة بدون أي تقسيم
 * عبر مسار الخادم الموحد (/api/gemini/parse-table) وتترك أي حقل غير مقروء فارغاً.
 */
export async function performStrictOCR(imageBase64: string): Promise<any[]> {
  try {
    const serverItems = await callPythonVisionServer(imageBase64);
    if (serverItems && serverItems.length > 0) {
      return serverItems;
    }

    return [];
  } catch (error) {
    console.error('فشل في قراءة الجدول:', error);
    throw error;
  }
}

export async function parseTableWithGeminiVision(
  imageSource: string | File | Blob,
  alreadyPrepared = false,
  preprocessedBase64?: string
): Promise<GeminiVisionResult> {
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
        maxDimension: 2000,
        minDimension: 1450,
        enhanceContrast: true,
        sharpenText: true,
      });
    }

    let rawItems: any[] | null = null;
    try {
      rawItems = await performStrictOCR(cleanImageDataUrl);
    } catch {
      rawItems = await callPythonVisionServer(cleanImageDataUrl, preprocessedBase64);
    }

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
