import type { ExtractedSparePart } from './localOcr';

export interface RawVerifiedSheetRow {
  seq: number;
  part_number: string;
  location_code: string;
  uom: string;
  qty_total: number;
  is_missing: number;
  remark: string;
  description_en: string;
}

/**
 * تم إزالة كافة أرقام القطع المخزنة مسبقاً بناءً على طلب المستخدم
 * ليعمل البرنامج بالكامل عبر محرك القراءة الفعلي (AI Vision + OCR) لأي عدد من الأوراق.
 */
export const SAP_PAGE_1_ROWS: RawVerifiedSheetRow[] = [];
export const SAP_PAGE_27_ROWS: RawVerifiedSheetRow[] = [];
export const SAP_PAGE_39_ROWS: RawVerifiedSheetRow[] = [];
export const SAP_PAGE_40_ROWS: RawVerifiedSheetRow[] = [];
export const SAP_PAGE_41_ROWS: RawVerifiedSheetRow[] = [];
export const SAP_PAGE_42_ROWS: RawVerifiedSheetRow[] = [];

export function toExtractedSpareParts(_rows: RawVerifiedSheetRow[]): ExtractedSparePart[] {
  return [];
}

export function matchVerifiedSheetByMetadata(
  _imageSource: string | File | Blob,
  _naturalWidth?: number,
  _naturalHeight?: number
): ExtractedSparePart[] | null {
  return null;
}

export async function matchVerifiedSheetByVisualSignature(
  _dataUrl: string
): Promise<ExtractedSparePart[] | null> {
  return null;
}

export function recoverFullVerifiedSheetIfMatched(
  _extracted: ExtractedSparePart[],
  _rawText?: string
): ExtractedSparePart[] | null {
  return null;
}
