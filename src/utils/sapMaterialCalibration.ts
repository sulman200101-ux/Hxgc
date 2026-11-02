/**
 * تم حذف جميع البيانات والأرقام المخزنة مسبقاً في الكود بالكامل بناءً على طلب المستخدم.
 * أي حقل لم يتمكن الـ OCR من قراءته بوضوح يُترك فارغاً تماماً دون أي تخمين أو استبدال من قواميس مخزنة.
 */

export interface SapCalibrationEntry {
  seq: number;
  part: string;
  bin: string;
  desc: string;
  qty?: number;
  isMissing?: number;
  remark?: string;
}

export const SAP_CALIBRATION_ENTRIES: SapCalibrationEntry[] = [];

export const KNOWN_SAP_PARTS_SET = new Set<string>();

export const SORTED_CALIBRATION_ENTRIES: SapCalibrationEntry[] = [];

export const CALIBRATION_SHEET_SLICES: SapCalibrationEntry[][] = [];

export function isVisuallyConfusableDigitPair(d1: string, d2: string): boolean {
  return d1 === d2;
}

export function hammingDistance10(a: string, b: string): number {
  if (a.length !== 10 || b.length !== 10) return 99;
  let dist = 0;
  for (let i = 0; i < 10; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  return 99;
}

export function extractRowSequenceNumber(_line: string, _partNumber: string = ''): number | null {
  return null;
}

export function findMatchingCalibrationEntry(
  _part10: string,
  _seqNum: number | null,
  _storageBin: string = '',
  _descEn: string = ''
): SapCalibrationEntry | null {
  return null;
}

export function recoverGarbledOrTruncatedMaterial(
  _line: string,
  _storageBin: string = '',
  _descEn: string = ''
): string | null {
  return null;
}

export function verifyAndRepairMaterialNumber(
  rawPart10: string,
  _line: string = '',
  _storageBin: string = '',
  _descEn: string = ''
): string {
  const trimmed = String(rawPart10 || '').trim();
  return /^\d{10}$/.test(trimmed) ? trimmed : '';
}

export function enforceWithinBinMonotonicity<
  T extends { part_number: string; location_code: string; description_en?: string }
>(rows: T[]): T[] {
  return rows;
}

export function resolveSameRowMaterialConflict(
  partA: string,
  partB: string,
  _locationCode: string,
  _descEn: string,
  _prevPart?: string,
  _nextPart?: string
): string {
  if (/^\d{10}$/.test(partA)) return partA;
  if (/^\d{10}$/.test(partB)) return partB;
  return '';
}
