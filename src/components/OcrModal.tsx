import React, { useState } from 'react';
import { ImageSourcePicker } from './ImageSourcePicker';
import { BatchDocumentsPanel } from './BatchDocumentsPanel';
function CaptureFlow({ onClose, onRefresh, kind = 'inventory' }: { onClose: () => void; onRefresh: () => void; kind?: 'inventory' | 'issue' | 'receipt' }) {
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  return <div role="dialog" aria-modal="true" aria-label="قراءة ورقة الجرد" className="fixed inset-0 z-50 bg-black/90 overflow-y-auto p-3" dir="rtl">
    <div className="max-w-3xl mx-auto bg-[#241712] rounded-xl p-4">
      <header className="flex justify-between items-center"><h2 className="font-bold text-lg">{kind === 'issue' ? 'تصوير ورقة الصرف' : kind === 'receipt' ? 'إدخال مخزون' : 'قراءة أوراق الجرد'}</h2><button onClick={onClose} className="p-3 bg-stone-800 rounded" aria-label="إغلاق قارئ الجرد">إغلاق</button></header>
      {!files.length ? <><p className="py-3">التقط ورقة بالكاميرا، أو اختر ورقة واحدة أو عدة أوراق من الألبوم.</p><ImageSourcePicker autoCamera={kind === 'issue'} onImages={setFiles} onError={setMessage} /></> :
        <BatchDocumentsPanel initialKind={kind} compact initialImages={files} defaultOpen autoRead onChanged={onRefresh} />}
      <p role="status">{message}</p>
    </div>
  </div>;
}
export function OcrModal({ isOpen, onClose, onRefresh, kind = 'inventory' }: { isOpen: boolean; onClose: () => void; onRefresh: () => void; kind?: 'inventory' | 'issue' | 'receipt' }) {
  return isOpen ? <CaptureFlow kind={kind} onClose={onClose} onRefresh={onRefresh} /> : null;
}
