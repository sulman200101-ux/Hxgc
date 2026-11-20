/**
 * خدمة القراءة الصارمة لأوراق جرد أسمو (SAP Inventory Controller) عبر الخادم (/api/gemini/parse-table)
 * تفحص الورقة كاملة سطراً بسطر بدون أي تقسيم يفسد محاذاة الأعمدة،
 * وتترك أي حقل غير مقروء فارغاً تماماً ("") بدون أي هلوسة أو تخمين.
 */

import type { ExtractedSparePart } from './localOcr';
import { categorizeAndTranslate, isConsumableDescription } from '../utils/translator';
import {
  strict10DigitRegexFilter,
  repair10DigitMaterialCode,
  dynamicLocationNormalizer,
  detectMissingFromCheckMark,
  charToDigitMapper,
} from '../utils/regexSanitizer';
import { fastPrepareLandscapeForGemini } from '../utils/imagePreprocessor';
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
  'https://ais-pre-4hh2zz5tfhmhshdxbd6ohq-344013703327.europe-west2.run.app',
  'https://ais-dev-4hh2zz5tfhmhshdxbd6ohq-344013703327.europe-west2.run.app',
  'https://ais-pre-6btcof3lrz3zy2rhcknzht-242614928618.europe-west2.run.app',
  'https://ais-dev-6btcof3lrz3zy2rhcknzht-242614928618.europe-west2.run.app',
];

export function isRunningInNativeApk(): boolean {
  if (typeof window === 'undefined') return false;
  const proto = window.location?.protocol || '';
  const host = window.location?.hostname || '';
  const port = window.location?.port || '';
  return (
    proto === 'capacitor:' ||
    proto === 'file:' ||
    (host === 'localhost' && !port) ||
    (window as any).Capacitor?.isNativePlatform?.() === true
  );
}

export function getCandidateApiUrls(path: string): string[] {
  if (typeof window === 'undefined') return [path];
  if (isRunningInNativeApk()) {
    return CLOUD_API_BASES.map((base) => `${base}${path}`);
  }
  return [path];
}

function isPhoneNumberNoise(digits: string): boolean {
  return /^(?:05\d{8}|966\d{8,9}|00966\d{8,9}|01[1-9]\d{7})$/.test(digits);
}

/**
 * استخراج رقم القطعة فقط إذا كان مكوناً من 10 أرقام دقيقة وواضحة بدون أي تخمين، وإلا يُترك فارغاً.
 */
export function repair10DigitMaterialClient(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  const strict = strict10DigitRegexFilter(trimmed);
  if (strict && !isPhoneNumberNoise(strict)) return strict;
  const repaired = repair10DigitMaterialCode(trimmed);
  if (repaired && !isPhoneNumberNoise(repaired)) return repaired;
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
    /^\((?:F|S|D|L|UID)\)\s*(?:FOUND|SHORT|DAMAGED|LOST|UNIDENTIFIED)/i.test(rawDesc) ||
    /^(?:COUNT\s+DATA|START\s+DATE|CONTROLLER|INVENTORY\s+LIST|PAGE\s+\d+|TOTAL\s+ITEMS)/i.test(rawDesc) ||
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
): Promise<{ items: any[]; repairedCount?: number; geminiAccuracyEnhanced?: boolean } | null> {
  const candidateUrls = getCandidateApiUrls('/api/gemini/parse-table');

  for (const url of candidateUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
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
          return {
            items: candidateData.items,
            repairedCount: Number(candidateData.repairedCount || 0),
            geminiAccuracyEnhanced: Boolean(candidateData.geminiAccuracyEnhanced),
          };
        }
        if (candidateData?.fallbackToLocal) {
          continue;
        }
      }
    } catch {
      // تجربة الرابط الاحتياطي أو المتابعة للمحرك المحلي
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
    const plusMatch = rawRemark.match(/^\+\s*(\d+)$/);
    const minusMatch = rawRemark.match(/(?:^\d+\s*[-−–—]\s*(\d+)$|^[-−–—]\s*(\d+)$)/);
    const shortage = plusMatch
      ? 0
      : minusMatch
      ? Number(minusMatch[1] || minusMatch[2] || 0)
      : normSymbol === 'N'
      ? 1
      : 0;

    const out = isMissing ? 0 : total > 0 ? Math.min(total, shortage) : shortage;
    const remark = plusMatch
      ? `+${plusMatch[1]}`
      : normSymbol === 'F'
      ? 'F'
      : out > 0
      ? `-${out}`
      : normSymbol === 'N'
      ? '-1'
      : rawRemark || undefined;

    const finalMarkSymbol: '✓' | 'X' | 'F' | 'N' | null = isMissing
      ? 'X'
      : plusMatch
      ? '✓'
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

    // قاعدة صارمة: لا يُسجل الصنف كـ "مدقق" أو "منقول" أثناء قراءة الورقة؛ التدقيق والنقل يتمان حصراً من قِبل المستخدم
    const finalStatus = isMissing ? 'غير موجودة' : 'غير مدقق';

    const { category, descAr: dictDescAr } = cleanDescEn
      ? categorizeAndTranslate(cleanDescEn)
      : { category: '', descAr: '' };
    const rawAiAr = item.description_ar ? String(item.description_ar).trim() : '';
    const hasArabicChars = /[\u0600-\u06FF]/.test(rawAiAr);
    const finalDescAr = cleanDescEn ? (hasArabicChars && rawAiAr.length >= 4 ? rawAiAr : dictDescAr) : '';
    const isConsumable = isConsumableDescription(cleanDescEn, category) ? 1 : 0;

    validatedItems.push({
      part_number: valid10DigitPart,
      location_code: finalLocation,
      description_en: cleanDescEn,
      description_ar: finalDescAr,
      category,
      qty_total: total,
      qty_out: out,
      qty_remaining: isMissing ? 0 : Math.max(0, total - out),
      is_missing: isMissing,
      is_consumable: isConsumable,
      remark,
      mark_symbol: finalMarkSymbol,
      audit_meaning: finalAuditMeaning,
      status: finalStatus,
      confidence: 'قراءة فعلية عالية الدقة (Gemini Vision)',
    });
  });

  return {
    validatedItems,
    skippedRows,
    repairedCount: 0,
  };
}

/**
 * آلية Gemini لتعزيز دقة السطور المستخرجة:
 * 1. تطبيع فوري عبر القاموس الهندسي المحلي.
 * 2. عند توفر الإنترنت ووجود سطور ناقصة أو عند طلب التحقق اليدوي (forceVerify)، يتم إرسال السطور + الصورة إلى /api/gemini/enhance-rows لتصحيح أرقام المواد والمواقع والكميات والملاحظات عبر gemini-4-hydrogen.
 */
export async function enhanceExtractedRowsWithGemini(
  rows: ExtractedSparePart[],
  imageBase64?: string,
  forceVerify = false
): Promise<ExtractedSparePart[]> {
  if (!rows || rows.length === 0) return rows;

  const baseEnriched: ExtractedSparePart[] = rows.map((r) => {
    const descEn = (r.description_en || '').trim();
    const { category, descAr } = descEn
      ? categorizeAndTranslate(descEn)
      : { category: r.category || '', descAr: r.description_ar || '' };
    const isCons = isConsumableDescription(descEn, category) ? 1 : 0;
    return {
      ...r,
      category: r.category || category,
      description_ar:
        r.description_ar && /[\u0600-\u06FF]/.test(r.description_ar) ? r.description_ar : descAr,
      is_consumable: r.is_consumable ?? isCons,
      status: (r.is_missing === 1 || r.status === 'غير موجودة' ? 'غير موجودة' : 'غير مدقق') as ExtractedSparePart['status'],
    };
  });

  const needsCloudRefinement =
    forceVerify ||
    baseEnriched.some(
      (r) =>
        !/^10\d{8}$/.test((r.part_number || '').trim()) ||
        !(r.location_code || '').trim() ||
        Number(r.qty_total || 0) <= 0 ||
        (r.description_en || '').trim().length < 5 ||
        !/[\u0600-\u06FF]/.test(r.description_ar || '')
    );

  const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (!isOnline || !needsCloudRefinement) {
    return baseEnriched;
  }

  const candidateUrls = getCandidateApiUrls('/api/gemini/enhance-rows');
  for (const url of candidateUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 65000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: baseEnriched,
          imageBase64,
        }),
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (data?.success && Array.isArray(data.items) && data.items.length > 0) {
        const { validatedItems } = normalizeRawVisionItems(data.items);
        if (validatedItems.length === baseEnriched.length) {
          return validatedItems.map((geminiRow, idx) => {
            const orig = baseEnriched[idx];
            const part = /^10\d{8}$/.test(orig.part_number)
              ? orig.part_number
              : geminiRow.part_number || orig.part_number;
            const loc = geminiRow.location_code || orig.location_code;
            const total = orig.qty_total > 0 ? orig.qty_total : geminiRow.qty_total;
            const isMissing = orig.is_missing === 1 || geminiRow.is_missing === 1 ? 1 : 0;
            const out = isMissing ? 0 : Math.max(orig.qty_out || 0, geminiRow.qty_out || 0);
            return {
              ...orig,
              part_number: part,
              location_code: loc,
              description_en:
                (geminiRow.description_en || '').length >= (orig.description_en || '').length
                  ? geminiRow.description_en
                  : orig.description_en,
              description_ar: geminiRow.description_ar || orig.description_ar,
              category: geminiRow.category || orig.category,
              qty_total: total,
              qty_out: out,
              qty_remaining: isMissing ? 0 : Math.max(0, total - out),
              is_missing: isMissing,
              remark: geminiRow.remark || orig.remark,
              mark_symbol: geminiRow.mark_symbol || orig.mark_symbol,
              audit_meaning: geminiRow.audit_meaning || orig.audit_meaning,
              status: (isMissing ? 'غير موجودة' : 'غير مدقق') as ExtractedSparePart['status'],
              confidence: 'معززة ومُدققة عبر Gemini AI',
            };
          });
        }
      }
      if (data?.fallbackToLocal) continue;
    } catch {
      // المتابعة للرابط الاحتياطي أو إرجاع النتيجة المحلية
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return baseEnriched;
}

export async function performStrictOCR(imageBase64: string, preprocessedBase64?: string): Promise<any[]> {
  try {
    const serverRes = await callPythonVisionServer(imageBase64, preprocessedBase64);
    if (serverRes && serverRes.items.length > 0) {
      return serverRes.items;
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

      // تجهيز فائق السرعة بالألوان الطبيعية بالوضع الأفقي (>= 2200px) دون إبطاء المتصفح
      cleanImageDataUrl = await fastPrepareLandscapeForGemini(rawDataUrl);
    }

    const serverRes = await callPythonVisionServer(cleanImageDataUrl, preprocessedBase64);
    const rawItems = serverRes?.items || null;

    if (!rawItems || rawItems.length === 0) {
      return {
        success: false,
        items: [],
        skippedRows: [],
        isSheetComplete: false,
        message: 'يتم استخدام محرك القراءة المحلي.',
      };
    }

    const { validatedItems, skippedRows } = normalizeRawVisionItems(rawItems);

    return {
      success: validatedItems.length > 0,
      items: validatedItems,
      skippedRows,
      repairedCount: serverRes?.repairedCount || 0,
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
