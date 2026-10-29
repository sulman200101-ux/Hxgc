/**
 * محلل جدول أسمو الصارم (Strict Table Parser & Template Extractor)
 * مصمم خصيصاً لتصفية الضوضاء نهائياً واستخراج الأعمدة الأربعة فقط:
 * 1. رقم القطعة (Material): 10 أرقام متصلة تبدأ بـ 100 (مثل: 1001410488 أو 1000996904).
 *    قاعدة الرفض: أي نص يقرأ كحروف عشوائية (مثل SLSLSLS أو ULUGULY) يُرفض فوراً.
 * 2. الموقع (Storage Bin): استخراج رمز الموقع مباشرة (مثل: K01A1, K02B2, N02 FL1 2, P01 FL1 1).
 * 3. الكمية (QTY): أرقام صحيحة فقط (Integers) تمثل مخزون القطعة (مثل: 42, 5, 1).
 * 4. الوصف (Material Description): مطابقة الجملة بالقاموس الفني المحلي (مثل: GASKET, LAMP, O-RING, BEARING, BOLT).
 * 5. فلتر الحذف التلقائي (Auto-Discard Filter): رفض أي سطر لا يحتوي على رقم قطعة صحيح من 10 أرقام يبدأ بـ 100.
 */

import { ExtractedSparePart } from '../services/localOcr';
import { categorizeAndTranslate } from './translator';
import { sanitizeLocationCode } from './regexSanitizer';

// القاموس الفني لقطع غيار أسمو الصناعية
const TECHNICAL_TERMS_DICTIONARY = [
  'GASKET SPIRAL WOUND',
  'GASKET METAL GROOVED',
  'GASKET TEFLON',
  'GASKET FLANGE',
  'GASKET',
  'BOLT HEX STEEL',
  'BOLT CARBON STEEL',
  'BOLT STUD',
  'BOLT STAINLESS',
  'BOLT',
  'LAMP FLUORESCENT',
  'LAMP LED',
  'LAMP BULB',
  'LAMP',
  'O-RING VITON',
  'O-RING RUBBER',
  'O-RING',
  'BALL BEARING DEEP GROOVE',
  'BALL BEARING',
  'BEARING',
  'GATE VALVE FLANGED',
  'BALL VALVE',
  'CHECK VALVE',
  'VALVE',
  'PRESSURE GAUGE',
  'TEMPERATURE GAUGE',
  'GAUGE',
  'FILTER ELEMENT CARTRIDGE',
  'AIR FILTER',
  'FILTER',
  'MECHANICAL SEAL',
  'OIL SEAL',
  'SEAL',
  'FLANGE WELD NECK',
  'FLANGE',
  'HEX NUT HEAVY',
  'NUT',
  'PIPE FITTING',
  'COUPLING',
  'PUMP IMPELLER',
];

/**
 * فحص هل السلسلة مجرد حروف عشوائية مشوهة (مثل SLSLSLS أو ULUGULY أو XXXX)
 */
export function isRandomNoiseOrGibberish(text: string): boolean {
  if (!text || text.length < 3) return true;
  const upper = text.toUpperCase().replace(/[^A-Z]/g, '');

  // 1. تكرار الحروف بشكل مشوه مثل SLSLSLS أو ULUGULY
  if (/^(SL)+/i.test(upper) || /^(ULUG)+/i.test(upper) || /(.)\1{3,}/.test(upper)) {
    return true;
  }

  // 2. إذا كانت الكلمة لا تحتوي على أي حرف علة (Vowels: A, E, I, O, U) وطولها أكبر من 4
  if (upper.length >= 5 && !/[AEIOU]/.test(upper)) {
    return true;
  }

  // 3. نسبة تكرار حرفين بالتناوب مثل ABABAB
  if (upper.length >= 6) {
    const pair = upper.slice(0, 2);
    if (upper.startsWith(pair + pair + pair)) {
      return true;
    }
  }

  return false;
}

/**
 * استخراج رقم القطعة الصارم: 10 أرقام متصلة تبدأ برقم 100
 */
export function extractStrictMaterialNumber(line: string): string | null {
  // شرط القبول: 10 أرقام متصلة تبدأ بـ 100
  const match = line.match(/\b(100\d{7})\b/);
  if (match) {
    return match[1];
  }
  return null;
}

/**
 * استخراج رمز الموقع (Storage Bin): K01A1, K02B2, N02 FL1 2, P01 FL1 1, N03 A01...
 */
export function extractStrictStorageBin(line: string, partNumber: string): string {
  const withoutPart = line.replace(partNumber, '');

  // 1. نمط K01A1 أو K02B2 أو M03C1
  const kBinMatch = withoutPart.match(/\b([A-Z]\d{2}[A-Z]\d{1,2})\b/i);
  if (kBinMatch) {
    return kBinMatch[1].toUpperCase();
  }

  // 2. النمط المركب الديناميكي [A-Z][0-9]{2}\s+[A-Z0-9]+\s+[0-9A-Z]+ (مثل N02 FL1 2 أو P01 FL1 1)
  const compoundMatch = withoutPart.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+\s+[0-9A-Z]+)\b/i);
  if (compoundMatch) {
    return compoundMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
  }

  // 3. نمط الرف/الطابق الثنائي مثل N03 A01 أو P01 FL1
  const twoPartMatch = withoutPart.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]{2,4})\b/i);
  if (twoPartMatch) {
    return twoPartMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
  }

  // 4. نمط LOC-A1-04
  const locMatch = withoutPart.match(/\b(LOC-[A-Z0-9-]{3,10})\b/i);
  if (locMatch) {
    return locMatch[1].toUpperCase();
  }

  // استخدام المطهّر العام للموقع
  return sanitizeLocationCode(withoutPart);
}

/**
 * استخراج الكمية الصارمة (QTY): أرقام صحيحة فقط (Integers)
 */
export function extractStrictQuantity(line: string, partNumber: string, storageBin: string): { total: number; out: number } {
  if (!storageBin) return { total: 0, out: 0 };
  const tokens = Array.from(line.matchAll(/\S+/g));
  let end = -1;
  for (let i = 0; i < tokens.length && end < 0; i++) {
    for (let width = 1; width <= 3 && i + width <= tokens.length; width++) {
      const last = tokens[i + width - 1];
      const candidate = line.slice(tokens[i].index!, last.index! + last[0].length);
      if (sanitizeLocationCode(candidate) === storageBin) { end = last.index! + last[0].length; break; }
    }
  }
  if (end < 0) return { total: 0, out: 0 };
  const tail = line.slice(end);
  const match = tail.match(/^\s*(?:\|\s*)?(?:(?:EA|SET|PK|SH|CO|AY|KG)\s+)?(\d{1,9})(?=\s|\||$)/i);
  return { total: match ? Number(match[1]) : 0, out: 0 };
}

/**
 * استخراج الوصف ومطابقته بالقاموس المحلي (Material Description)
 */
export function extractStrictDescription(
  line: string,
  partNumber: string,
  storageBin: string
): { descEn: string; descAr: string; category: string } {
  const upper = line.toUpperCase();
  const starts = TECHNICAL_TERMS_DICTIONARY.map(term => upper.indexOf(term)).filter(index => index >= 0);
  const descEn = starts.length ? line.slice(Math.min(...starts)).trim() : '';
  const { category, descAr } = categorizeAndTranslate(descEn);
  return { descEn, descAr, category };
}

/**
 * القاموس المرجعي لأرقام قطع أسمو (10 أرقام تبدأ بـ 100)
 */
function getAsmoReferenceDescription(partNum: string): string {
  const map: Record<string, string> = {
    '1001410488': 'GASKET SPIRAL WOUND 3 INCH 150#',
    '1000996904': 'GASKET SPIRAL WOUND 4 IN',
    '1001354367': 'BOLT HEX 80 MM STEEL',
    '1000801147': 'LAMP FLUORESCENT 36 WATT',
    '1002441190': 'BOLT CARBON STEEL 4 IN',
    '1001883341': 'LAMP LED 15 WATT 220V',
    '1003112005': 'GASKET METAL GROOVED 2 IN',
    '1005112849': 'BOLT STUD LENGTH 6 CM WIDE 2 CM',
    '1008332119': 'BOLT 3 MM STAINLESS',
    '1004551201': 'BALL BEARING 6205-2RS',
    '1007781992': 'O-RING VITON 75 SHORE',
    '1006112040': 'GATE VALVE 2 INCH FLANGED',
  };

  return map[partNum] || 'SPARE PART ASMO MATERIAL';
}

/**
 * الدالة الرئيسية: فلتر الاستخراج الصارم لجدول أسمو
 * تطبق فلتر الحذف التلقائي (Auto-Discard Filter):
 * أي سطر لا يحتوي على رقم قطعة صحيح يبدأ بـ 100 ومكون من 10 أرقام يُرفض فوراً!
 */
export function parseStrictAsmoTable(rawText: string): ExtractedSparePart[] {
  if (!rawText) return [];

  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const results: ExtractedSparePart[] = [];
  const seenParts = new Set<string>();

  for (const line of lines) {
    // ==========================================
    // 3. فلتر الحذف التلقائي (Auto-Discard Filter)
    // ==========================================
    // شرط القبول الحتمي: 10 أرقام متصلة تبدأ بـ 100
    const partNumber = extractStrictMaterialNumber(line);
    if (!partNumber) {
      // رفض السطر فوراً وتجاهل خطوط الجدول والترويسات والشطبات والحروف العشوائية!
      continue;
    }

    // منع التكرار لنفس رقم القطعة في نفس المسح
    if (seenParts.has(partNumber)) {
      continue;
    }
    seenParts.add(partNumber);

    // 2. عمود الموقع (Storage Bin)
    const storageBin = extractStrictStorageBin(line, partNumber);

    // 3. عمود الكمية (QTY: أرقام صحيحة فقط)
    const { total, out } = extractStrictQuantity(line, partNumber, storageBin);

    // 4. عمود الوصف الفني (Material Description)
    const { descEn, descAr, category } = extractStrictDescription(line, partNumber, storageBin);

    results.push({
      part_number: partNumber,
      location_code: storageBin,
      description_en: descEn,
      description_ar: descAr,
      category,
      qty_total: total,
      qty_out: out,
      qty_remaining: Math.max(0, total - out),
      confidence: 'اقتراح غير مؤكد: راجع رقم القطعة والكمية والعلامات مقابل الأصل',
    });
  }

  return results;
}
