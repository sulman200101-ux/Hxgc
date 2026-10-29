/**
 * محلل جدول أسمو الصارم والموسع (Strict & Resilient SAP Table Parser)
 * يدعم استخراج جميع الأعمدة من أوراق SAP Inventory Controller:
 * 1. رقم القطعة (Material): 10 أرقام تبدأ بـ 100 مع تصحيح الأخطاء البصرية البسيطة للـ OCR (مثل O->0, I/l->1) داخل سياق رقم الـ Material.
 * 2. الموقع (Storage Bin): مثل N11C2, N11FL1, N11FL2, N12A1, N12A2, N16D1, N16D2, N17A1, N17A2, N17B1 مع استنتاج السياق المجاور.
 * 3. الكمية (QTY): أرقام صحيحة بعد وحدة القياس (EA, SET, PK, SH, CO, AY, KG, PAA, ZYD).
 * 4. العلامات والملاحظات (Check & Remark): استخراج علامة × (غير موجودة) والملاحظات مثل F1, F2, F3, F5, F20, -4, SET.
 * 5. الوصف الكامل (Material Description): قراءة الوصف الفني الكامل دون بتر.
 */

import { ExtractedSparePart } from '../services/localOcr';
import { categorizeAndTranslate } from './translator';
import { sanitizeLocationCode, isValidSpecificLocation, resolveSheetLocationsWithContext } from './regexSanitizer';

const TECHNICAL_TERMS_DICTIONARY = [
  'GASKET SPIRAL WOUND',
  'GASKET METAL GROOVED',
  'GASKET TEFLON',
  'GASKET FLANGE',
  'GASKET',
  'RING WEAR',
  'SUPPORT',
  'SEAL',
  'CONTACTOR',
  'NUT',
  'SPACER',
  'SLEEVE SHAFT',
  'SLEEVE',
  'WASHER',
  'BUSHING PUMP',
  'BUSHING',
  'O-RING',
  'IGNITER',
  'SPRING RELIEF VALVE',
  'SPRING',
  'SCREW CAP',
  'SCREW',
  'BEARING BALL',
  'BEARING',
  'PACKING',
  'TIE, CABLE',
  'TIE CABLE',
  'FUSE',
  'RING, BALL',
  'RING, SEAT',
  'RING, THROTTLE',
  'RING',
  'POWER SUPPLY',
  'TEE',
  'GLOVES',
  'ADAPTER',
  'REGULATOR',
  'VALVE',
  'RETAINER',
  'MODULE',
  'KIT',
  'RELAY',
  'PIN',
  'SENSOR',
  'METER',
  'CAP',
  'STUD ASSEMBLY',
  'STUD',
  'LABYRINTH',
  'MEMBRANE',
  'BOLT HEX STEEL',
  'BOLT CARBON STEEL',
  'BOLT STUD',
  'BOLT STAINLESS',
  'BOLT',
  'LAMP FLUORESCENT',
  'LAMP LED',
  'LAMP BULB',
  'LAMP',
  'BALL BEARING DEEP GROOVE',
  'GATE VALVE FLANGED',
  'BALL VALVE',
  'CHECK VALVE',
  'PRESSURE GAUGE',
  'TEMPERATURE GAUGE',
  'GAUGE',
  'FILTER ELEMENT CARTRIDGE',
  'AIR FILTER',
  'FILTER',
  'MECHANICAL SEAL',
  'OIL SEAL',
  'FLANGE WELD NECK',
  'FLANGE',
  'HEX NUT HEAVY',
  'PIPE FITTING',
  'COUPLING',
  'PUMP IMPELLER',
];

export function isRandomNoiseOrGibberish(text: string): boolean {
  if (!text || text.length < 3) return true;
  const upper = text.toUpperCase().replace(/[^A-Z]/g, '');
  if (/^(SL)+/i.test(upper) || /^(ULUG)+/i.test(upper) || /(.)\1{3,}/.test(upper)) {
    return true;
  }
  if (upper.length >= 5 && !/[AEIOU]/.test(upper)) {
    return true;
  }
  if (upper.length >= 6) {
    const pair = upper.slice(0, 2);
    if (upper.startsWith(pair + pair + pair)) {
      return true;
    }
  }
  return false;
}

/**
 * استخراج رقم القطعة الصارم: 10 أرقام تبدأ بـ 100، مع دعم إصلاح الحروف المتشابهة بصرياً في مخرجات Tesseract
 */
export function extractStrictMaterialNumber(line: string): string | null {
  const exactMatch = line.match(/\b(100\d{7})\b/);
  if (exactMatch) {
    return exactMatch[1];
  }

  // فحص الرموز التي تبدو كرقم قطعة من 10 خانات مع تداخل حرف بصري مثل O أو I أو l
  const tokens = line.split(/[\s|]+/);
  for (const token of tokens) {
    const cleaned = token.replace(/[^A-Za-z0-9]/g, '');
    if (cleaned.length === 10 && /^[1Il|][0OoQD]{2}[0-9OoQDIl|ZzSsBb]{7}$/.test(cleaned)) {
      const repaired = cleaned
        .replace(/^[Il|]/, '1')
        .replace(/[OoQD]/g, '0')
        .replace(/[Il|]/g, '1')
        .replace(/[Zz]/g, '2')
        .replace(/[Ss]/g, '5')
        .replace(/[Bb]/g, '8');
      if (/^100\d{7}$/.test(repaired)) {
        return repaired;
      }
    }
  }

  return null;
}

/**
 * استخراج رمز الموقع (Storage Bin): N11C2, N11FL1, N11FL2, N12A1, N16D1, N17A1, K01A1...
 */
export function extractStrictStorageBin(line: string, partNumber: string): string {
  const withoutPart = line.replace(partNumber, '');

  // 1. نمط SAP القياسي مثل N11C2, N11FL1, N11FL2, N01BB1, N16D1, N17A2
  const sapBinMatch = withoutPart.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{1,2})\b/i);
  if (sapBinMatch) {
    const candidate = sapBinMatch[1].toUpperCase();
    if (!['C006', 'M016', 'D04D'].includes(candidate)) {
      return candidate;
    }
  }

  // 2. النمط المركب الديناميكي مثل N02 FL1 2 أو P01 FL1 1
  const compoundMatch = withoutPart.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+\s+[0-9A-Z]+)\b/i);
  if (compoundMatch) {
    return compoundMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
  }

  // 3. نمط الرف الثنائي مثل N03 A01 أو P01 FL1
  const twoPartMatch = withoutPart.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]{2,4})\b/i);
  if (twoPartMatch) {
    return twoPartMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
  }

  // 4. نمط LOC-A1-04
  const locMatch = withoutPart.match(/\b(LOC-[A-Z0-9-]{3,10})\b/i);
  if (locMatch) {
    return locMatch[1].toUpperCase();
  }

  return sanitizeLocationCode(withoutPart);
}

function textAfterStorageBin(line: string, storageBin: string): string | null {
  if (!storageBin) return null;
  const tokens = Array.from(line.matchAll(/\S+/g));
  for (let i = 0; i < tokens.length; i++) {
    for (let width = 1; width <= 3 && i + width <= tokens.length; width++) {
      const last = tokens[i + width - 1];
      const candidate = line.slice(tokens[i].index!, last.index! + last[0].length);
      if (sanitizeLocationCode(candidate) === storageBin) return line.slice(last.index! + last[0].length);
    }
  }
  return null;
}

const QTY_FIELD = /^\s*(?:\|\s*)?(?:(?:EA|SET|PK|SH|CO|AY|KG|PAA|ZYD)\s+)?(\d{1,9})(?=\s|\||$)/i;

export function extractStrictQuantity(line: string, _partNumber: string, storageBin: string): { total: number; out: number } {
  const afterBin = textAfterStorageBin(line, storageBin);
  const match = afterBin?.match(QTY_FIELD);
  if (match) {
    return { total: Number(match[1]), out: 0 };
  }
  // بحث احتياطي بعد وحدة القياس مباشرة إذا لم يتطابق نص الموقع حرفياً
  const unitQtyMatch = line.match(/\b(?:EA|SET|PK|SH|CO|AY|KG|PAA|ZYD)\s+(\d{1,6})\b/i);
  if (unitQtyMatch) {
    return { total: Number(unitQtyMatch[1]), out: 0 };
  }
  return { total: 0, out: 0 };
}

/**
 * استخراج الملاحظات وعلامة الفحص (Check & Remark) من السطر بعد الكمية
 */
export function extractCheckAndRemark(
  line: string,
  storageBin: string
): { isMissing: number; remark: string } {
  const tail = textAfterStorageBin(line, storageBin) || '';
  const qtyMatch = tail.match(QTY_FIELD);
  const afterQty = qtyMatch ? tail.slice(qtyMatch[0].length).trim() : tail;

  const isMissing = /(?:^|\s|\|)([Xx×✗✘])(?=\s|\||$)/.test(afterQty) ? 1 : 0;
  let remark = '';
  const remarkMatch = afterQty.match(/\b(F\d{1,3}|-\s*\d{1,3}|\+\s*\d{1,3})\b/i);
  if (remarkMatch) {
    remark = remarkMatch[1].replace(/\s+/g, '').toUpperCase();
  }
  return { isMissing, remark };
}

export function extractStrictDescription(
  line: string,
  _partNumber: string,
  storageBin: string
): { descEn: string; descAr: string; category: string } {
  const upper = line.toUpperCase();
  const starts = TECHNICAL_TERMS_DICTIONARY.map(term => upper.indexOf(term)).filter(index => index >= 0);
  const tail = textAfterStorageBin(line, storageBin);
  const quantity = tail?.match(QTY_FIELD);
  let remaining = quantity && tail ? tail.slice(quantity[0].length).replace(/^\s*[|✓✔×Xx\/]+\s*/, '').trim() : '';
  remaining = remaining.replace(/^(?:F\d{1,3}|-\s*\d{1,3}|\+\s*\d{1,3})\s+/i, '').trim();

  const descEn = (starts.length ? line.slice(Math.min(...starts)).trim() : remaining) || 'SPARE PART ASMO';
  const { category, descAr } = categorizeAndTranslate(descEn);
  return { descEn, descAr, category };
}

export function parseStrictAsmoTable(rawText: string): ExtractedSparePart[] {
  if (!rawText) return [];

  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const rawResults: ExtractedSparePart[] = [];

  for (const line of lines) {
    const partNumber = extractStrictMaterialNumber(line);
    if (!partNumber) {
      continue;
    }

    const storageBin = extractStrictStorageBin(line, partNumber);
    const { total, out } = extractStrictQuantity(line, partNumber, storageBin);
    const { isMissing, remark } = extractCheckAndRemark(line, storageBin);
    const { descEn, descAr, category } = extractStrictDescription(line, partNumber, storageBin);

    rawResults.push({
      part_number: partNumber,
      location_code: storageBin,
      description_en: descEn,
      description_ar: descAr,
      category,
      qty_total: total,
      qty_out: out,
      qty_remaining: isMissing ? 0 : Math.max(0, total - out),
      is_missing: isMissing,
      remark: remark || undefined,
      status: isMissing ? 'غير موجودة' : 'غير مدقق',
      confidence: 'اقتراح غير مؤكد: راجع رقم القطعة والكمية والعلامات مقابل الأصل',
    });
  }

  // استنتاج الموقع من السطور المجاورة إذا طمست علامة القلم موقع أحد السطور في نفس الورقة
  const resolved = resolveSheetLocationsWithContext(rawResults);
  return resolved.filter(row => isValidSpecificLocation(row.location_code));
}
