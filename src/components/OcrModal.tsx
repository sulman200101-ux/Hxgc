import React from 'react';
import { StockDocumentsPanel } from './StockDocumentsPanel';
export function OcrModal({ isOpen, onClose, onRefresh }: { isOpen: boolean; onClose: () => void; onRefresh: () => void }) {
  if (!isOpen) return null;
  return <div role="dialog" aria-modal="true" aria-label="قراءة ورقة الجرد" className="fixed inset-0 z-50 bg-black/90 overflow-y-auto p-3" dir="rtl">
    <div className="max-w-3xl mx-auto bg-[#241712] rounded-xl py-4">
      <header className="px-4 flex justify-between items-center"><h2 className="font-bold text-lg">قراءة ورقة الجرد ومراجعتها</h2><button onClick={onClose} className="p-3 bg-stone-800 rounded" aria-label="إغلاق قارئ الجرد">إغلاق</button></header>
      <p className="px-4 text-sm text-amber-200">المحرك يعمل داخل الجهاز. راجع الأرقام والكميات مقابل الأصل؛ الحفظ للمراجعة والاعتماد منفصلان.</p>
      <StockDocumentsPanel onRefresh={onRefresh} initialKind="inventory" compact />
    </div>
  </div>;
}
