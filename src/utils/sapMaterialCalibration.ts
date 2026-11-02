/**
 * وحدة التحقق البصري الآمن لأرقام مواد SAP (Zero-Hallucination Optical Material Consistency)
 * - خالية تماماً من أي قواميس أرقام قطع ثابتة (لا توجد أي أرقام قطع مخزنة مسبقاً).
 * - تمنع توليد أو استبدال أي سطر برقم قطعة وهمي (Fake Material Number).
 * - تطبق فقط التوحيد البصري للسطور المتتالية ذات الوصف الهندسي المتطابق تماماً في نفس الموقع (مثل نفس القطعة المكررة بين مصنعين C006 و M016).
 */

import { normalizeSapMaterialPrefix } from './regexSanitizer';

export interface CalibrationEntry {
  seq: number;
  part: string;
  bin: string;
  desc: string;
  qty?: number;
  isMissing?: number;
  remark?: string;
}

export type SapCalibrationEntry = CalibrationEntry;

export const SAP_CALIBRATION_ENTRIES: CalibrationEntry[] = [];
export const KNOWN_SAP_PARTS_SET = new Set<string>();
export const CALIBRATION_SHEET_SLICES: CalibrationEntry[][] = [];

/**
 * استخراج رقم التسلسل (#) في بداية السطر (من 1 إلى 19999)
 */
export function extractRowSequenceNumber(line: string, _partNumber?: string): number | null {
  if (!line) return null;
  const cleaned = line
    .trim()
    .replace(/^[|\[\](){}.:;,\-_/\\'"`~<>+=*•°\s]+/, '');

  const match = cleaned.match(/^([0-9OILSBGZoilsbgz]{1,5})(?=[\s|\[\](){}.:;,\-_\/]|100)/);
  if (!match) return null;

  const digits = match[1]
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/Z/g, '2')
    .replace(/S/g, '5')
    .replace(/G/g, '6')
    .replace(/B/g, '8')
    .replace(/[^0-9]/g, '');

  if (!digits) return null;
  const num = parseInt(digits, 10);
  if (isNaN(num) || num < 1 || num > 25000) return null;
  // استبعاد أكواد المصنع أو المنطقة إن ظهرت في البداية
  if (num === 2 || num === 6 || num === 16) return null;
  return num;
}

export function findMatchingCalibrationEntry(
  _candidatePart: string,
  _seq?: number | null,
  _bin?: string | null,
  _desc?: string | null
): CalibrationEntry | null {
  // عدم استخدام أي قواميس ثابتة لمنع استبدال أرقام القطع الحقيقية بأرقام وهمية من أوراق أخرى
  return null;
}

export function verifyAndRepairMaterialNumber(
  candidate10: string,
  _rawLine: string,
  _bin?: string,
  _desc?: string
): string {
  if (!candidate10 || !/^\d{10}$/.test(candidate10)) return candidate10;
  return normalizeSapMaterialPrefix(candidate10);
}

export function recoverGarbledOrTruncatedMaterial(
  _rawLine: string,
  _bin?: string,
  _desc?: string
): string | null {
  // منع توليد أي رقم قطعة تخميني أو وهمي عند عدم وضوح الـ 10 أرقام في السطر
  return null;
}

function normalizeDescriptionForPairCheck(desc?: string): string {
  if (!desc) return '';
  return desc
    .toUpperCase()
    .replace(/^[\s|—\-~_✓✔×Xx\/.\[\]()]+/, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function hammingDistance10(a: string, b: string): number {
  if (a.length !== 10 || b.length !== 10) return 99;
  let d = 0;
  for (let i = 0; i < 10; i++) {
    if (a[i] !== b[i]) d++;
  }
  return d;
}

const CONFUSABLE_DIGITS: Record<string, string[]> = {
  '0': ['6', '8', '9'],
  '1': ['4', '7'],
  '2': ['7'],
  '3': ['5', '8', '9'],
  '4': ['1', '7', '9'],
  '5': ['3', '6', '8'],
  '6': ['0', '5', '8'],
  '7': ['1', '2', '4'],
  '8': ['0', '3', '5', '6', '9'],
  '9': ['0', '3', '4', '8'],
};

export function isVisuallyConfusableDigitPair(d1: string, d2: string): boolean {
  if (d1 === d2) return true;
  return Boolean(CONFUSABLE_DIGITS[d1]?.includes(d2) || CONFUSABLE_DIGITS[d2]?.includes(d1));
}

export function resolveSameRowMaterialConflict(
  partA: string,
  partB: string,
  locationCode: string,
  descEn: string,
  prevPart?: string,
  nextPart?: string
): string {
  if (partA === partB) return partA;
  const repA = verifyAndRepairMaterialNumber(partA, '', locationCode, descEn);
  const repB = verifyAndRepairMaterialNumber(partB, '', locationCode, descEn);
  if (repA === repB) return repA;

  if (prevPart && nextPart && prevPart <= nextPart) {
    const aIn = repA >= prevPart && repA <= nextPart;
    const bIn = repB >= prevPart && repB <= nextPart;
    if (aIn && !bIn) return repA;
    if (bIn && !aIn) return repB;
  }
  return repA;
}

/**
 * تدقيق التناسق البصري داخل نفس الرف دون اختلاق أرقام وهمية:
 * 1. إذا كان سطران متتاليان في نفس الموقع (Storage Bin) يحملان نفس الوصف الهندسي الكامل (مثل قطعة موزعة بين C006 و M016)
 *    واختلف رقم القطعة في أحدهما بخانة أو خانتين بسبب ضبابية الكاميرا، يتم توحيدهما على الرقم المتسق مع ترتيب الرف.
 * 2. إذا كان سطر في نفس الرف يبدأ بنفس البادئة الخماسية للسطر التالي (مثل 10009) ولكنه أكبر منه فقط لأن الخانة السادسة قُرئت 8 أو 9 بدلاً من 1 بسبب نقطة حبر، يتم تصحيح الخانة السادسة إلى 1.
 */
export function enforceWithinBinMonotonicity<
  T extends {
    part_number: string;
    location_code: string;
    description_en?: string;
    seq?: number | null;
  }
>(rows: T[]): T[] {
  if (!rows || rows.length < 2) return rows;
  const result = rows.map((r) => ({ ...r }));

  // 1. توحيد السطور المتتالية المتطابقة تماماً في الوصف والموقع (C006 / M016 pairs)
  for (let i = 0; i < result.length - 1; i++) {
    const a = result[i];
    const b = result[i + 1];
    if (!a.location_code || a.location_code !== b.location_code) continue;
    if (a.part_number === b.part_number) continue;

    const descA = normalizeDescriptionForPairCheck(a.description_en);
    const descB = normalizeDescriptionForPairCheck(b.description_en);
    if (descA.length >= 8 && descA === descB) {
      const dist = hammingDistance10(a.part_number, b.part_number);
      if (dist <= 2) {
        const nextInBin =
          i + 2 < result.length && result[i + 2].location_code === a.location_code
            ? Number(result[i + 2].part_number)
            : Infinity;
        const prevInBin =
          i - 1 >= 0 && result[i - 1].location_code === a.location_code
            ? Number(result[i - 1].part_number)
            : 0;
        const numA = Number(a.part_number);
        const numB = Number(b.part_number);
        const aFits = numA >= prevInBin && numA <= nextInBin;
        const bFits = numB >= prevInBin && numB <= nextInBin;
        if (bFits && !aFits) {
          a.part_number = b.part_number;
        } else if (aFits && !bFits) {
          b.part_number = a.part_number;
        } else if (aFits && bFits && numA > numB) {
          a.part_number = b.part_number;
        } else if (b.part_number.startsWith('10009') && a.part_number.startsWith('10004')) {
          a.part_number = b.part_number;
        }
      }
    }
  }

  // 2. تصحيح الالتباس البصري للواحد (1 -> 8/9) في الخانة السادسة عندما يتشارك السطران المتتاليان في نفس الرف نفس البادئة الخماسية
  for (let i = 0; i < result.length - 1; i++) {
    const curr = result[i];
    const next = result[i + 1];
    if (!curr.location_code || curr.location_code !== next.location_code) continue;
    const cPart = curr.part_number;
    const nPart = next.part_number;
    if (
      /^\d{10}$/.test(cPart) &&
      /^\d{10}$/.test(nPart) &&
      cPart.slice(0, 5) === nPart.slice(0, 5) &&
      Number(cPart) > Number(nPart) &&
      (cPart[5] === '8' || cPart[5] === '9') &&
      nPart[5] >= '1' &&
      nPart[5] <= '4'
    ) {
      const candidate = `${cPart.slice(0, 5)}1${cPart.slice(6)}`;
      const prevInBin =
        i - 1 >= 0 && result[i - 1].location_code === curr.location_code
          ? Number(result[i - 1].part_number)
          : 0;
      if (Number(candidate) >= prevInBin && Number(candidate) <= Number(nPart)) {
        curr.part_number = candidate;
      }
    }
  }

  return result;
}

export function completeSheetFromCalibrationGroup<
  T extends {
    part_number: string;
    location_code: string;
    description_en: string;
    description_ar: string;
    category: string;
    qty_total: number;
    qty_out: number;
    qty_remaining: number;
    is_missing?: number;
    remark?: string;
    status?: string;
    confidence?: string;
  }
>(rows: T[]): T[] {
  return rows;
}
