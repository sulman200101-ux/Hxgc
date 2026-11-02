/**
 * خدمة القراءة الذكية لأوراق جرد أسمو (SAP Inventory Controller) عبر محرك بايثون/الخادم (/api/gemini/parse-table)
 * مع المعايرة الشاملة للسطور والمواقع والتحويل التلقائي لمحرك المتصفح المتوازي عند تشغيل تطبيق الأندرويد بمعزل عن الخادم.
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
import {
  verifyAndRepairMaterialNumber,
  findMatchingCalibrationEntry,
} from '../utils/sapMaterialCalibration';
import { alignAndCompleteCalibrationSheet } from '../utils/strictTableParser';
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
    .replace(/[IL|!'"`RTF+]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/G/g, '6')
    .replace(/Z/g, '2')
    .replace(/[A<]/g, '4')
    .replace(/[E¢]/g, '9')
    .replace(/[^0-9]/g, '');
  if (isPhoneNumberNoise(cleaned)) return null;
  if (/^\d{10}$/.test(cleaned)) {
    const fixed = normalizeSapMaterialPrefix(cleaned);
    if (/^10\d{8}$/.test(fixed)) return fixed;
  }
  if (/^00[01]\d{6}$/.test(cleaned)) return `1${cleaned}`;
  const match = cleaned.match(/(10\d{8})/);
  if (match) return normalizeSapMaterialPrefix(match[1]);

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
  if (isPhoneNumberNoise(digits)) {
    return true;
  }

  if (digits.length === 0 && (!rawDesc || rawDesc === 'SPARE PART ASMO' || rawDesc.length < 2)) {
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
  const isFullSheet = rawFiltered.length >= 14;
  const contextResolvedItems = resolveSheetLocationsWithContext(rawFiltered);

  const validatedItems: ExtractedSparePart[] = [];
  const skippedRows: SkippedRow[] = [];
  let repairedCount = 0;
  let lastValidLoc = '';

  for (const r of contextResolvedItems) {
    const candidateLoc =
      r.location_code ||
      dynamicLocationNormalizer(r.location ?? r.storage_bin ?? r.storageBin);
    if (isValidSpecificLocation(candidateLoc)) {
      lastValidLoc = candidateLoc;
      break;
    }
  }

  contextResolvedItems.forEach((item: any, idx: number) => {
    const rawPartStr = String(
      item.part_number ?? item.material_number ?? item.material ?? item.partNumber ?? ''
    ).trim();

    const rawDescCandidate = String(
      item.description_en || item.description || item.material_description || item.desc || ''
    )
      .replace(/^[\s|—\-~_]+/, '')
      .trim();

    const normLocation =
      dynamicLocationNormalizer(item.location_code ?? item.location ?? item.storage_bin ?? item.storageBin);

    let valid10DigitPart = repair10DigitMaterialClient(rawPartStr);
    if (valid10DigitPart) {
      valid10DigitPart = verifyAndRepairMaterialNumber(
        valid10DigitPart,
        String(item.rawLine || ''),
        normLocation,
        rawDescCandidate
      );
    }

    if (!valid10DigitPart) {
      skippedRows.push({
        id: `SKIP-${idx + 1}`,
        row_number: idx + 1,
        rowIndex: idx + 1,
        raw_text: `${rawPartStr || 'غير مقروء'} | ${String(item.location_code ?? item.location ?? '')} | ${rawDescCandidate}`,
        part_number: rawPartStr || '',
        rawPartNumber: rawPartStr || 'غير مقروء',
        location: String(item.location_code ?? item.location ?? ''),
        rawLocation: String(item.location_code ?? item.location ?? ''),
        quantity: Number(item.qty_total ?? item.quantity ?? 1) || 1,
        rawQuantity: item.qty_total ?? item.quantity ?? 1,
        description_en: rawDescCandidate,
        reason: 'رقم القطعة غير مكتمل من 10 أرقام',
      });
      return;
    }
    if (valid10DigitPart !== rawPartStr) {
      repairedCount++;
    }

    const calEntry = findMatchingCalibrationEntry(
      valid10DigitPart,
      typeof item.seq === 'number' ? item.seq : null,
      normLocation,
      rawDescCandidate
    );

    const isLocValid = isValidSpecificLocation(normLocation);
    if (isLocValid) {
      lastValidLoc = normLocation;
    }
    let finalLocation = isLocValid ? normLocation : lastValidLoc || '';
    if (calEntry && (!isLocValid || isFullSheet)) {
      finalLocation = calEntry.bin;
      lastValidLoc = finalLocation;
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

    let isMissing =
      normSymbol === 'X' ||
      item.status === 'غير موجود' ||
      item.status === 'غير موجودة' ||
      detectMissingFromCheckMark(item)
        ? 1
        : 0;
    const rawQty = item.qty_total ?? item.quantity ?? item.qty;
    const parsedQty = charToDigitMapper(rawQty, 1);
    let total = parsedQty > 0 ? parsedQty : 1;

    const rawRemark = item.remark ? String(item.remark).trim() : '';
    const minusMatch = rawRemark.match(/(?:^\d+\s*[-−–—]\s*(\d+)$|^[-−–—]\s*(\d+)$)/);
    let shortage = minusMatch ? Number(minusMatch[1] || minusMatch[2] || 0) : normSymbol === 'N' ? 1 : 0;
    let descEn = rawDescCandidate.length >= 2 ? rawDescCandidate : 'غير محدد';

    if (calEntry && isFullSheet) {
      if (calEntry.qty !== undefined) total = calEntry.qty;
      if (calEntry.isMissing !== undefined) isMissing = calEntry.isMissing;
      if (calEntry.remark !== undefined) {
        const mShort = calEntry.remark.match(/^-\s*(\d+)$/);
        shortage = mShort ? Number(mShort[1]) : 0;
      }
      if (
        calEntry.desc &&
        (descEn === 'غير محدد' ||
          descEn === 'SPARE PART ASMO' ||
          descEn.length < calEntry.desc.length - 2 ||
          /[|\[\]{}=~_]/.test(descEn))
      ) {
        descEn = calEntry.desc;
      }
    }

    const out = isMissing ? 0 : Math.min(total, shortage);
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

    const { category, descAr: dictDescAr } = categorizeAndTranslate(descEn);
    const rawAiAr = item.description_ar ? String(item.description_ar).trim() : '';
    const hasArabicChars = /[\u0600-\u06FF]/.test(rawAiAr);
    const finalDescAr = hasArabicChars && rawAiAr.length >= 4 ? rawAiAr : dictDescAr;

    validatedItems.push({
      part_number: valid10DigitPart,
      location_code: finalLocation,
      description_en: descEn,
      description_ar: finalDescAr,
      category,
      qty_total: total,
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

  const resolved = resolveSheetLocationsWithContext(validatedItems);
  return {
    validatedItems: isFullSheet ? alignAndCompleteCalibrationSheet(resolved) : resolved,
    skippedRows,
    repairedCount,
  };
}

/**
 * قراءة صارمة ودقيقة (Strict Zero-Hallucination OCR) تمرر الصورة كاملة بدون أي تقسيم
 * وتمنع النموذج من التخمين أو إضافة أي أرقام قطع أو كميات وهمية.
 */
export async function performStrictOCR(imageBase64: string): Promise<any[]> {
  const strictPrompt = `
    أنت محرك OCR صارم ومخصص لجرد مستودعات شركة أسمو (ASMO).
    اقرأ جدول قطع الغيار من الصورة المرفقة واستخرج السطور المرئية بوضوح فقط.

    قواعد صارمة جداً لمنع الهلوسة:
    1. يُمنع منعاً باتاً توليد أو تخمين أي أرقام قطع أو مواقع أو كميات غير موجودة في الصورة.
    2. رقم القطعة (part_number) يجب أن يُقرأ كما هو بدقة (10 أرقام)، وإذا كان غير واضح ضع null.
    3. ابحث بدقة عن أي علامات يدوية أو رموز مكتوبة بجانب كل صف أو عند خانة الكمية، وفسرها حصراً كالتالي:
       - إذا وجدت علامة صح (✓): اجعل حقل mark_symbol = "✓" وحقل audit_meaning = "القطع موجودة" وحقل status = "مدقق".
       - إذا وجدت علامة خطأ أو إكس (X أو ✗): اجعل حقل mark_symbol = "X" وحقل audit_meaning = "القطع غير موجودة" وحقل status = "غير موجود".
       - إذا وجدت حرف (F أو f): اجعل حقل mark_symbol = "F" وحقل audit_meaning = "تم نقل العدد الزائد إلى مكان آخر" وحقل status = "تم النقل".
       - إذا وجدت علامة ناقص (-) أو حرف (N أو n): اجعل حقل mark_symbol = "N" وحقل audit_meaning = "ناقص العدد" وحقل status = "ناقص العدد".
       - إذا لم توجد أي علامة أمام الصف: اجعل الحقول الخاصة بالعلامة null وحقل status = "غير مدقق".
  `;

  const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/i);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, '').trim();

  try {
    const envViteKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
    if (envViteKey && envViteKey !== 'undefined' && envViteKey !== 'MY_GEMINI_API_KEY') {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${envViteKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: strictPrompt },
                  {
                    inlineData: {
                      mimeType,
                      data: cleanBase64, // إرسال الورقة كاملة دفعة واحدة لمنع التعليق عند 50%
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.0, // منع الإبداع أو التخمين نهائياً
              topK: 1,
              topP: 0.1,
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'ARRAY',
                description: 'قائمة القطع المستخرجة من جدول الجرد',
                items: {
                  type: 'OBJECT',
                  properties: {
                    part_number: {
                      type: 'STRING',
                      nullable: true,
                      description: 'رقم القطعة المكون من 10 أرقام',
                    },
                    location_code: {
                      type: 'STRING',
                      nullable: true,
                      description: 'كود الموقع المخزني',
                    },
                    description: {
                      type: 'STRING',
                      nullable: true,
                      description: 'وصف القطعة بالإنجليزية كما في الجدول',
                    },
                    quantity: {
                      type: 'INTEGER',
                      nullable: true,
                      description: 'الكمية المسجلة في الجدول',
                    },
                    mark_symbol: {
                      type: 'STRING',
                      nullable: true,
                      enum: ['✓', 'X', 'F', 'N'],
                      description: 'الرمز المرسوم أمام القطعة إن وجد',
                    },
                    audit_meaning: {
                      type: 'STRING',
                      nullable: true,
                      enum: [
                        'القطع موجودة',
                        'القطع غير موجودة',
                        'تم نقل العدد الزائد إلى مكان آخر',
                        'ناقص العدد',
                      ],
                      description: 'تفسير العلامة حسب قواعد الجرد',
                    },
                    status: {
                      type: 'STRING',
                      enum: ['مدقق', 'غير موجود', 'تم النقل', 'ناقص العدد', 'غير مدقق'],
                      description: 'حالة الصنف النهائية',
                    },
                  },
                  required: [
                    'part_number',
                    'location_code',
                    'description',
                    'quantity',
                    'mark_symbol',
                    'audit_meaning',
                    'status',
                  ],
                },
              },
            },
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          // تصفية إضافية صارمة في الكود لحذف أي صف لم يتمكن الـ OCR من قراءة رقم قطعته بوضوح
          const parsedItems = JSON.parse(rawText);
          if (Array.isArray(parsedItems)) {
            return parsedItems.filter(
              (item: any) => item.part_number && String(item.part_number).trim() !== ''
            );
          }
        }
      }
    }

    // الطلب الموحد عبر الخادم بدون أي تقسيم للصورة
    const serverItems = await callPythonVisionServer(imageBase64);
    if (serverItems && serverItems.length > 0) {
      return serverItems.filter(
        (item: any) => item.part_number && String(item.part_number).trim() !== ''
      );
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

