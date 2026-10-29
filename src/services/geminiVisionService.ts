/**
 * خدمة قراءة ومعالجة أوراق جرد أسمو (SAP Inventory Controller) عبر المسار الخادمي الآمن (/api/gemini/parse-table)
 * مدعومة بالخوارزميات المساعدة الذكية (Assistive OCR & Context Recovery Engine):
 * 1. ضغط وتجهيز الصورة قبل الإرسال لمنع أي تعليق أو بطء في الشبكة
 * 2. قراءة كامل الورقة أياً كان اتجاهها (أفقي أو عمودي مدور 90°) وعدد أصنافها بالكامل دون نقص
 * 3. خوارزمية إصلاح رقم القطعة (10 أرقام Material) وترميم الخانات المطموسة بخطوط الجدول
 * 4. خوارزمية استنتاج الموقع الفعلي (Storage Bin) من السطور المجاورة إذا غطت علامة (✓ أو ×) خانة الموقع
 * 5. تمييز مرن ودقيق لعلامة اليد (✓ صح = موجودة | × خطأ = غير موجودة) والملاحظات (F1, F2, F3, -4)
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
} from '../utils/regexSanitizer';
import { prepareImageForAi } from '../utils/imagePreprocessor';
import type { SkippedRow } from '../components/SkippedRowsModal';

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
  skippedRows?: SkippedRow[];
  totalDetectedRows?: number;
  isSheetComplete?: boolean;
  repairedCount?: number;
  message?: string;
  error?: GeminiVisionError;
}

function repair10DigitMaterialClient(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const strict = strict10DigitRegexFilter(String(raw));
  if (strict) return strict;
  const cleaned = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[OQ𝐷]/g, '0')
    .replace(/[IL|!]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/G/g, '6')
    .replace(/Z/g, '2')
    .replace(/[^0-9]/g, '');
  if (/^10\d{8}$/.test(cleaned)) return cleaned;
  const match = cleaned.match(/(10\d{8})/);
  return match ? match[1] : null;
}

/**
 * فحص هل السطر مجرد ترويسة جدول أو تذييل صفحة فارغ (وليس سطر قطعة حقيقي)
 */
function isHeaderOrFooterNoise(item: any): boolean {
  if (!item) return true;
  const rawPart = String(item.part_number ?? item.material ?? '').trim().toUpperCase();
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
  if (digits.length === 0 && (!rawDesc || rawDesc === 'SPARE PART ASMO' || rawDesc.length < 3)) {
    return true;
  }

  return false;
}

/**
 * إرسال الصورة للمسار الخادمي الآمن `/api/gemini/parse-table` مع تطبيق الخوارزميات المساعدة الذكية
 */
export async function parseTableWithGeminiVision(
  imageSource: string | File | Blob
): Promise<GeminiVisionResult> {
  try {
    let base64String = '';
    if (typeof imageSource === 'string') {
      base64String = imageSource;
    } else {
      base64String = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(imageSource);
      });
    }

    // ضغط وتحسين الصورة لتسريع الإرسال ومنع التعليق
    const optimizedDataUrl = await prepareImageForAi(base64String, {
      maxDimension: 1600,
      enhanceContrast: true,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    let data: any = null;
    try {
      const response = await fetch('/api/gemini/parse-table', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageBase64: optimizedDataUrl,
          mimeType: 'image/jpeg',
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        const candidateData = await response.json();
        if (
          candidateData &&
          (candidateData.success ||
            (Array.isArray(candidateData.items) && candidateData.items.length > 0))
        ) {
          data = candidateData;
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (!data || (!data.success && (!data.items || data.items.length === 0))) {
      return {
        success: false,
        items: [],
        skippedRows: [],
        isSheetComplete: false,
        message:
          '⚠️ تحذير: لم يتمكن الماسح السحابي من قراءة الورقة — سيتم استخدام القارئ المحلي الذكي.',
      };
    }

    // فلترة أي ترويسة جدول أو تذييل فارغ
    const rawFiltered = (data.items || []).filter((item: any) => !isHeaderOrFooterNoise(item));

    // تطبيق خوارزمية استنتاج الموقع الفعلي من السطور المجاورة في نفس الورقة
    const contextResolvedItems = resolveSheetLocationsWithContext(rawFiltered);

    const validatedItems: ExtractedSparePart[] = [];
    const skippedRows: SkippedRow[] = [];
    let repairedCount = 0;

    contextResolvedItems.forEach((item: any, idx: number) => {
      const rawPartStr = String(
        item.part_number ?? item.material ?? item.partNumber ?? ''
      ).trim();

      const valid10DigitPart = repair10DigitMaterialClient(rawPartStr);
      if (valid10DigitPart && valid10DigitPart !== rawPartStr) {
        repairedCount++;
      }

      const normLocation = item.location_code || dynamicLocationNormalizer(item.location);
      const isLocValid = isValidSpecificLocation(normLocation);

      const isMissing = detectMissingFromCheckMark(item);
      const total = Math.max(0, charToDigitMapper(item.qty_total ?? item.quantity ?? 1, 1));
      const out = 0;
      const descEn = String(
        item.description_en || item.description || 'SPARE PART ASMO'
      ).trim();
      const remark = item.remark ? String(item.remark).trim() : undefined;

      if (valid10DigitPart && isLocValid) {
        const { category, descAr } = categorizeAndTranslate(descEn);

        validatedItems.push({
          part_number: valid10DigitPart,
          location_code: normLocation,
          description_en: descEn,
          description_ar: descAr,
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
        let reason = '';
        if (!valid10DigitPart) {
          if (cleanDigits.length > 0 && cleanDigits.length <= 5) {
            reason = `الرقم (${cleanDigits}) هو رقم التسلسل (#) وليس رقم القطعة المكون من 10 أرقام (Material)`;
          } else if (cleanDigits.length > 0) {
            reason = `رقم القطعة (${cleanDigits}) غير مكتمل (${cleanDigits.length} أرقام بدلاً من 10 أرقام)`;
          } else {
            reason = 'رقم القطعة (10 أرقام) غير واضح في هذا السطر';
          }
        } else if (!isLocValid) {
          reason = `اسم الموقع غير واضح في هذا السطر`;
        }

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
      success: validatedItems.length > 0,
      items: validatedItems,
      skippedRows,
      repairedCount,
      totalDetectedRows: validatedItems.length + skippedRows.length,
      isSheetComplete: validatedItems.length > 0 && skippedRows.length === 0,
      message: data.message,
    };
  } catch (err: any) {
    return {
      success: false,
      items: [],
      skippedRows: [],
      isSheetComplete: false,
      message:
        '⚠️ تعذر الاتصال بالخادم، جاري التحويل للقارئ المحلي.',
    };
  }
}
