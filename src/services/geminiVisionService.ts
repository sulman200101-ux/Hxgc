/**
 * خدمة قراءة ومعالجة أوراق جرد أسمو (SAP Inventory Controller) بالذكاء الاصطناعي البصري
 * تدعم:
 * 1. القراءة عبر المسار الخادمي (/api/gemini/parse-table)
 * 2. إرسال الصورة الطبيعية الواضحة بعد تدوير الصور الطولية 90° عكس عقارب الساعة (دون طمس السطور بفلتر التباين الحاد)
 * 3. القراءة المزدوجة التلقائية للنصف العلوي والسفلي (Split-Table Halves) إذا رجعت الورقة الكاملة بأقل من 34 سطراً لضمان قراءة الـ 37 سطراً كاملة
 * 4. استخراج الكمية الصحيحة دائماً (>= 1) والوصف الإنجليزي الكامل والموقع الفعلي مع استنتاج المواقع المطموسة بعلامة اليد
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
} from '../utils/regexSanitizer';
import { prepareImageForAi, splitImageIntoOverlappingHalves } from '../utils/imagePreprocessor';
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

function isPhoneNumberNoise(digits: string): boolean {
  return /^(?:05\d{8}|966\d{8,9}|00966\d{8,9}|01[1-9]\d{7})$/.test(digits);
}

export function repair10DigitMaterialClient(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const rawDigits = String(raw).replace(/[^0-9]/g, '');
  if (isPhoneNumberNoise(rawDigits)) return null;

  const strict = strict10DigitRegexFilter(String(raw));
  if (strict && !isPhoneNumberNoise(strict)) return strict;

  const repairedByUtil = repair10DigitMaterialCode(String(raw));
  if (repairedByUtil && !isPhoneNumberNoise(repairedByUtil)) return repairedByUtil;

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
  if (isPhoneNumberNoise(cleaned)) return null;
  if (/^10\d{8}$/.test(cleaned)) return cleaned;
  if (/^00[01]\d{6}$/.test(cleaned)) return `1${cleaned}`;
  const match = cleaned.match(/(10\d{8})/);
  return match ? match[1] : null;
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

export function getCandidateApiUrls(endpointPath: string): string[] {
  const path = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return [`${window.location.origin}${path}`, path];
  }
  return [path];
}

/**
 * استدعاء الخادم لقراءة صورة واحدة عبر المسار الخادمي (/api/gemini/parse-table)
 */
async function callGeminiVisionRaw(dataUrl: string, customPrompt?: string): Promise<any[] | null> {
  const urls = getCandidateApiUrls('/api/gemini/parse-table');
  for (const url of urls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: dataUrl,
          mimeType: 'image/jpeg',
          customPrompt,
        }),
        signal: controller.signal,
      });
      if (response.ok) {
        const candidateData = await response.json();
        if (candidateData && Array.isArray(candidateData.items) && candidateData.items.length > 0) {
          return candidateData.items;
        }
      }
    } catch {
      // المتابعة للرابط التالي أو المعالجة في المستوى الأعلى
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return null;
}

/**
 * تحويل وتدقيق مصفوفة العناصر الخام المستخرجة من Gemini Vision إلى ExtractedSparePart[]
 */
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
    // ضمان عدم إرجاع كمية 0 أو فارغة (NaN) عندما يكون الحقل غير واضح، بل اعتماد 1 كقيمة افتراضية آمنة
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
        reason = 'اسم الموقع غير واضح في هذا السطر';
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

  return { validatedItems, skippedRows, repairedCount };
}

/**
 * دمج نتائج النصف العلوي والنصف السفلي للورقة مع منع تكرار منطقة التداخل في المنتصف
 */
export function mergeOverlappingSheetRows(
  baseRows: ExtractedSparePart[],
  topRows: ExtractedSparePart[],
  bottomRows: ExtractedSparePart[]
): ExtractedSparePart[] {
  const combinedSource = topRows.length + bottomRows.length > baseRows.length
    ? [...topRows, ...bottomRows]
    : baseRows;

  // لبناء قائمة كاملة بدون فقدان التكرار الحقيقي (مثل قطعتين بنفس الرقم في C006 و M016) وبدون تكرار منطقة التداخل:
  // ندمج topRows ثم نضيف من bottomRows العناصر التي لم تظهر في آخر 8 أسطر من topRows بنفس (part_number + location_code + qty_total)
  if (topRows.length > 0 && bottomRows.length > 0) {
    const merged: ExtractedSparePart[] = [...topRows];
    const overlapTail = topRows.slice(-10);
    const usedOverlapIndices = new Set<number>();

    for (const botRow of bottomRows) {
      const matchIdx = overlapTail.findIndex(
        (tRow, idx) =>
          !usedOverlapIndices.has(idx) &&
          tRow.part_number === botRow.part_number &&
          tRow.location_code === botRow.location_code
      );
      if (matchIdx !== -1) {
        usedOverlapIndices.add(matchIdx);
        // إذا كان الوصف في النصف السفلي أوضح (ليس SPARE PART ASMO)، نحدّث السطر الموجود
        const targetIdxInMerged = topRows.length - overlapTail.length + matchIdx;
        if (
          merged[targetIdxInMerged] &&
          merged[targetIdxInMerged].description_en === 'SPARE PART ASMO' &&
          botRow.description_en !== 'SPARE PART ASMO'
        ) {
          merged[targetIdxInMerged] = botRow;
        }
      } else {
        merged.push(botRow);
      }
    }

    // نضيف أيضاً أي سطر استخرجه المسح الكامل (baseRows) ولم يظهر في الجزأين
    for (const baseRow of baseRows) {
      const exists = merged.some(
        (m) => m.part_number === baseRow.part_number && m.location_code === baseRow.location_code
      );
      if (!exists) {
        merged.push(baseRow);
      } else {
        // تحسين الوصف إذا كان في baseRow أوضح
        const idx = merged.findIndex(
          (m) =>
            m.part_number === baseRow.part_number &&
            m.location_code === baseRow.location_code &&
            m.description_en === 'SPARE PART ASMO' &&
            baseRow.description_en !== 'SPARE PART ASMO'
        );
        if (idx !== -1) {
          merged[idx] = baseRow;
        }
      }
    }

    return merged;
  }

  return combinedSource;
}

/**
 * قراءة ورقة الجرد بالكامل عبر Gemini Vision (المتصفح المباشر أو الخادم)
 * مع التفعيل التلقائي للقراءة المقسمة (Top/Bottom Split Scan) إذا كانت الورقة كثيفة ورجعت بأقل من 34 سطراً
 */
export async function parseTableWithGeminiVision(
  imageSource: string | File | Blob,
  alreadyPrepared = false
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
        maxDimension: 2200,
        minDimension: 1800,
        enhanceContrast: true,
      });
    }

    const rawItems = await callGeminiVisionRaw(cleanImageDataUrl);
    if (!rawItems || rawItems.length === 0) {
      return {
        success: false,
        items: [],
        skippedRows: [],
        isSheetComplete: false,
        message: '⚠️ تحذير: لم يتمكن الماسح السحابي من قراءة الورقة — سيتم استخدام القارئ المحلي الذكي.',
      };
    }

    let { validatedItems, skippedRows, repairedCount } = normalizeRawVisionItems(rawItems);

    // إذا كانت الورقة كاملة ولكن تم استخراج أقل من 34 سطراً (مثلاً 28 سطراً كما يحدث في الجداول الكثيفة)،
    // نقوم فوراً بتقسيم الورقة إلى نصف علوي ونصف سفلي وقراءتهما لاسترجاع السطور الـ 9 المتبقية بالكامل!
    if (validatedItems.length >= 10 && validatedItems.length < 35) {
      try {
        const { topHalf, bottomHalf } = await splitImageIntoOverlappingHalves(cleanImageDataUrl);
        const [topRaw, botRaw] = await Promise.all([
          callGeminiVisionRaw(
            topHalf,
            'اقرأ جميع صفوف هذا النصف العلوي من جدول الجرد سطراً بسطر دون تخطي أي صف، واستخرج رقم القطعة (10 أرقام) والموقع والكمية والوصف الكامل.'
          ),
          callGeminiVisionRaw(
            bottomHalf,
            'اقرأ جميع صفوف هذا النصف السفلي من جدول الجرد سطراً بسطر حتى آخر سطر في أسفل الورقة دون تخطي أي صف، واستخرج رقم القطعة (10 أرقام) والموقع والكمية والوصف الكامل.'
          ),
        ]);

        const topNorm = topRaw ? normalizeRawVisionItems(topRaw) : null;
        const botNorm = botRaw ? normalizeRawVisionItems(botRaw) : null;

        if (topNorm || botNorm) {
          const merged = mergeOverlappingSheetRows(
            validatedItems,
            topNorm?.validatedItems || [],
            botNorm?.validatedItems || []
          );
          if (merged.length > validatedItems.length) {
            validatedItems = merged;
            repairedCount += (topNorm?.repairedCount || 0) + (botNorm?.repairedCount || 0);
          }
        }
      } catch {
        // الاحتفاظ بالنتيجة الأساسية في حال تعذر المسح التكميلي
      }
    }

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
      message: '⚠️ تعذر الاتصال بالخادم، جاري التحويل للقارئ المحلي.',
    };
  }
}
