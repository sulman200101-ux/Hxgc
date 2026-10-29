/**
 * خدمة قراءة ومعالجة أوراق جرد أسمو (SAP Inventory Controller) عبر Gemini Vision API
 * مدعومة بالخوارزميات المساعدة الذكية (Assistive OCR & Context Recovery Engine):
 * 1. سرعة فائقة (2-3 ثوانٍ) بفضل تفعيل thinkingLevel: MINIMAL وضغط الصور الذكي
 * 2. قراءة كامل الورقة أياً كان عدد أصنافها (10، 20، 36، 37، 50 صنفاً) بالكامل دون نقص
 * 3. خوارزمية إصلاح رقم القطعة (10 أرقام Material) وترميم الخانات المطموسة بخطوط الجدول
 * 4. خوارزمية استنتاج الموقع الفعلي (Storage Bin) من السطور المجاورة إذا غطت علامة (✓ أو ×) خانة الموقع
 * 5. تمييز مرن ودقيق لعلامة اليد (✓ صح = موجودة | × خطأ = غير موجودة) دون رفض الورقة
 */

import { ExtractedSparePart } from './localOcr';
import { categorizeAndTranslate } from '../utils/translator';
import {
  strict10DigitRegexFilter,
  dynamicLocationNormalizer,
  isValidSpecificLocation,
  detectMissingFromCheckMark,
  charToDigitMapper,
  resolveSheetLocationsWithContext,
} from '../utils/regexSanitizer';
import { SkippedRow } from '../components/SkippedRowsModal';

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

export const SAP_INVENTORY_VISION_PROMPT = `You are an expert industrial AI vision system specialized in reading ASMO "SAP Inventory Controller" spare parts sheets (in any orientation: landscape or rotated 90 degrees portrait).

TABLE COLUMNS (in order):
1. "#" (Short sequence number: 1 to 5 digits like 198, 653, 654, 8428, 18195) -> Extract as "seq". NEVER put "#" in "part_number"!
2. "Material" (Part Number: 10-digit number starting with 100, e.g. "1001523111", "1000029819", "1000082689", "1001023714") -> Extract the full 10 digits as "part_number". Even if a pen mark touches a digit, read the 10-digit number starting with 100 carefully.
3. "Plant" (C006, M016, D04D) and "Area" (002) -> Ignore.
4. "Storage Bin" (Exact Location Code: e.g. "N01B1", "N01B2", "N01BB1", "N01BB2", "N01C1", "N01C2", "N01D1", "N01D2", "N01FL1", "N11C2", "N06C1") -> Extract as "location". If a row belongs to the same bin group as the row above it, output that bin code. NEVER output "عام".
5. "Bun" (Unit: EA, PK, AY, SET, SH, CO).
6. "QTY" (Integer quantity) -> Extract as integer "quantity".
7. "Check" (Handwritten mark column):
   - If marked with handwritten cross "X" or "×" -> set "is_missing": true and "check_mark": "X".
   - If marked with handwritten checkmark "✓", "✔", "/", -> set "is_missing": false and "check_mark": "CHECK". Blank or uncertain marks must be UNVERIFIED; never infer a checkmark.
8. "Remark" (Handwritten note like "+90", "+3", "+96", "-7", "F1", "F2") -> Extract as "remark".
9. "Material Description" (English description) -> Extract as "description".

MANDATE:
- Extract EVERY SINGLE ITEM ROW on the sheet from top to bottom (whether the sheet has 5 rows, 24 rows, 36 rows, 37 rows, or more).
- Ignore table headers, page footers, and blank margins.
- Return ONLY a valid JSON array:
  [{"seq": 18195, "part_number": "1001523111", "location": "N01B1", "quantity": 2, "check_mark": "CHECK", "is_missing": false, "remark": "", "description": "GASKET PUMP CCR UNIT 1,2 &3 SEAL"}]`;

const REMOTE_SERVER_ENDPOINTS = [
  '/api/gemini/parse-table',
  'https://ais-pre-26cszvvbcyrq76ragsx5nc-242614928618.europe-west2.run.app/api/gemini/parse-table',
  'https://ais-dev-26cszvvbcyrq76ragsx5nc-242614928618.europe-west2.run.app/api/gemini/parse-table',
];

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
    rawDesc.includes('ITEMS') && !rawPart
  ) {
    return true;
  }

  // إذا لم يكن هناك أي أرقام على الإطلاق في رقم القطعة وكان الوصف فارغاً
  const digits = rawPart.replace(/[^0-9]/g, '');
  if (digits.length === 0 && (!rawDesc || rawDesc === 'SPARE PART ASMO' || rawDesc.length < 3)) {
    return true;
  }

  return false;
}

/**
 * إرسال الصورة مباشرة للموديل مع تطبيق الخوارزميات المساعدة الذكية لقبول الأوراق الميدانية بدقة وسرعة
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

    let cleanBase64 = base64String;
    if (cleanBase64.includes(',')) {
      cleanBase64 = cleanBase64.split(',')[1];
    }
    cleanBase64 = cleanBase64.replace(/\s+/g, '');

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    let data: any = null;

    // 1. اتصال مباشر فائق السرعة (2-3 ثوانٍ) مع تفعيل thinkingLevel: MINIMAL لمنع البطء وانتهاء المهلة
    if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
      const models = [
        { name: 'gemini-3-flash-preview', useMinimalThinking: true },
        { name: 'gemini-3.5-flash', useMinimalThinking: false },
        { name: 'gemini-3.6-flash', useMinimalThinking: false },
        { name: 'gemini-flash-lite-latest', useMinimalThinking: false },
      ];

      for (const m of models) {
        try {
          const directUrl = `https://generativelanguage.googleapis.com/v1beta/models/${m.name}:generateContent?key=${apiKey}`;
          const genConfig: any = {
            responseMimeType: 'application/json',
            maxOutputTokens: 8192,
            temperature: 0.0,
          };
          if (m.useMinimalThinking) {
            genConfig.thinkingConfig = { thinkingLevel: 'MINIMAL' };
          }

          const directResp = await fetch(directUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: SAP_INVENTORY_VISION_PROMPT },
                    { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
                  ],
                },
              ],
              generationConfig: genConfig,
            }),
          });

          if (directResp.ok) {
            const jsonResp = await directResp.json();
            const textContent = jsonResp?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textContent) {
              const cleanedText = textContent
                .trim()
                .replace(/^```json\s*/i, '')
                .replace(/^```\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();

              let parsed: any = null;
              try {
                parsed = JSON.parse(cleanedText);
              } catch {
                const matchArr = cleanedText.match(/\[\s*\{[\s\S]*\}\s*\]/);
                if (matchArr) {
                  try {
                    parsed = JSON.parse(matchArr[0]);
                  } catch {}
                }
              }

              const itemsArray = Array.isArray(parsed)
                ? parsed
                : parsed && Array.isArray(parsed.items)
                ? parsed.items
                : [];

              if (itemsArray.length > 0) {
                data = {
                  success: true,
                  items: itemsArray,
                  skipped_rows: [],
                };
                break;
              }
            }
          }
        } catch (directErr) {
          console.warn(`Direct Gemini call with ${m.name} notice:`, directErr);
        }
      }
    }

    // 2. إذا لم ينجح الاتصال المباشر، تجربة مسار السيرفر المحلي أو السحابي (يدعم APK والمحاكي معاً)
    if (!data) {
      for (const endpoint of REMOTE_SERVER_ENDPOINTS) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              imageBase64: base64String,
              mimeType: 'image/jpeg',
            }),
          });

          if (response.ok) {
            const candidateData = await response.json();
            if (
              candidateData &&
              (candidateData.success ||
                (Array.isArray(candidateData.items) && candidateData.items.length > 0))
            ) {
              data = candidateData;
              break;
            }
          }
        } catch (endpointErr) {
          console.warn(`Endpoint ${endpoint} unreachable:`, endpointErr);
        }
      }
    }

    if (!data || (!data.success && (!data.items || data.items.length === 0))) {
      return {
        success: false,
        items: [],
        skippedRows: [],
        isSheetComplete: false,
        message:
          '⚠️ تحذير: لم يتمكن الماسح من قراءة الورقة — يرجى التأكد من وضوح الصورة وإعادة رفع الورقة مرة أخرى.',
      };
    }

    // فلترة أي ترويسة جدول أو تذييل فارغ
    const rawFiltered = (data.items || []).filter((item: any) => !isHeaderOrFooterNoise(item));

    // تطبيق خوارزمية استنتاج الموقع الفعلي من السطور المجاورة في نفس الورقة (لمعالجة طمس الموقع بعلامة ✓ أو ×)
    const contextResolvedItems = resolveSheetLocationsWithContext(rawFiltered);

    const validatedItems: ExtractedSparePart[] = [];
    const skippedRows: SkippedRow[] = [];
    let repairedCount = 0;

    contextResolvedItems.forEach((item: any, idx: number) => {
      const rawPartStr = String(
        item.part_number ?? item.material ?? item.partNumber ?? ''
      ).trim();

      let valid10DigitPart = strict10DigitRegexFilter(rawPartStr);
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
      const seqNum = item.seq ? Number(item.seq) : undefined;



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
    console.error('Error calling parseTableWithGeminiVision:', err);
    return {
      success: false,
      items: [],
      skippedRows: [],
      isSheetComplete: false,
      message:
        '⚠️ تعذر قراءة الورقة: يرجى التأكد من وضوح الصورة وإعادة رفع الورقة مرة أخرى.',
    };
  }
}
