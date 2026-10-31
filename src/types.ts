export type ItemStatus =
  | 'مضاف'
  | 'موجود'
  | 'مفقود'
  | 'غير مدقق'
  | 'مدقق'
  | 'منقول'
  | 'تم النقل'
  | 'لم تنتقل'
  | 'محدث'
  | 'غير موجودة';

export interface InventoryItem {
  id?: number;
  part_number: string;
  location_code: string;
  old_location?: string;
  moved_at?: string;
  description_en: string;
  description_ar: string;
  translation_review_required?: boolean;
  category: string;
  qty_total: number;
  qty_out: number;
  qty_remaining: number;
  is_moved: number; // 0 or 1
  is_missing?: number; // 0 or 1 (1 = علامة × بخط اليد في الجدول أي غير موجودة)
  remark?: string; // ملاحظات العمود Remark مثل F1, -4, F2
  status: ItemStatus;
  updated_at?: string;
}

export interface LocationSummary {
  location_code: string;
  item_count: number;
  total_qty: number;
  out_qty: number;
  remaining_qty: number;
  unverified_count: number;
  added_count: number;
  moved_count: number;
  missing_count: number;
}
