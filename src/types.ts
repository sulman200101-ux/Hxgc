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
  | 'غير موجودة'
  | 'غير موجود'
  | 'ناقص العدد';

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
  mark_symbol?: '✓' | 'X' | 'F' | 'N' | null;
  audit_meaning?: string | null;
  unit_price?: number; // السعر التقديري أو الفعلي للقطعة بالريال
  is_consumable?: number; // 0 or 1 (1 = قطعة استهلاكية توجه إلى مواقع A / FL)
  is_qain?: number; // 0 or 1 (1 = قطعة عليها علامة "قين" ضمن قائمة قين)
  qain_note?: string; // ملاحظة خاصة بقطعة قين
  qain_marked_at?: string; // تاريخ وضع علامة قين
  is_manual_audit?: number; // 0 or 1 (1 = مدقق يدوي وضعه المستخدم أثناء التدقيق الميداني)
  manual_audited_at?: string; // تاريخ ووقت التدقيق اليدوي
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
  manual_audit_count?: number;
  qain_count?: number;
  consumable_count?: number;
}
