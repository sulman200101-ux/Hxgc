import React, { useState } from 'react';
import { ImageSourcePicker } from './ImageSourcePicker';
import { BatchDocumentsPanel } from './BatchDocumentsPanel';
import { RotateCcw, CheckCircle2, ScanLine } from 'lucide-react';
export { captureAndProcessImage } from '../services/cameraService';

function CaptureFlow({
  onClose,
  onRefresh,
  kind = 'inventory',
}: {
  onClose: () => void;
  onRefresh: () => void;
  kind?: 'inventory' | 'issue' | 'receipt';
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState('');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="قراءة ورقة الجرد"
      className="fixed inset-0 z-50 bg-black/90 overflow-y-auto p-3"
      dir="rtl"
    >
      <div className="max-w-4xl mx-auto bg-[#241712] rounded-2xl p-4 border border-amber-800/40 shadow-2xl space-y-3">
        <header className="flex justify-between items-center border-b border-[#3D271F] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-900/60 border border-amber-500/40 flex items-center justify-center shrink-0">
              <ScanLine className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-white">
                {kind === 'issue'
                  ? 'تصوير ورقة الصرف'
                  : kind === 'receipt'
                  ? 'إدخال مخزون'
                  : 'قارئ أوراق الجرد المبسط (قراءة كاملة بدقة 100%)'}
              </h2>
              <p className="text-xs text-neutral-300">
                يستخرج جميع سطور الورقة بالكامل مع اعتماد علامة الناقص (-N) لإنقاص العدد واستبعاد الزيادة نهائياً
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {files.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setFiles([]);
                  setMessage('');
                }}
                className="px-3 py-2 bg-stone-800 hover:bg-stone-700 text-amber-200 rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>قراءة ورقة جديدة</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-stone-800 hover:bg-stone-700 rounded-xl font-bold text-xs cursor-pointer"
              aria-label="إغلاق قارئ الجرد"
            >
              إغلاق
            </button>
          </div>
        </header>

        {/* خطوات القراءة المبسطة */}
        <div className="grid grid-cols-3 gap-2 text-center text-xs bg-stone-900/80 p-2.5 rounded-xl border border-stone-700/80">
          <div className={`p-2 rounded-lg font-bold ${!files.length ? 'bg-amber-800/70 text-white border border-amber-400/50' : 'text-emerald-400'}`}>
            1. اختيار أو تصوير الورقة
          </div>
          <div className={`p-2 rounded-lg font-bold ${files.length ? 'bg-amber-800/70 text-white border border-amber-400/50' : 'text-neutral-400'}`}>
            2. القراءة التلقائية لكامل السطور
          </div>
          <div className="p-2 rounded-lg font-bold text-neutral-300">
            3. تأكيد المراجعة والاعتماد
          </div>
        </div>

        {!files.length ? (
          <div className="space-y-4 py-4 px-3 bg-stone-900/50 rounded-2xl border border-stone-800 text-center">
            <p className="text-sm font-bold text-neutral-100">
              اختر طريقة إدخال ورقة الجرد ليبدأ النظام بقراءتها فوراً أمامك خطوة بخطوة:
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <ImageSourcePicker
                autoCamera={kind === 'issue'}
                onImages={setFiles}
                onError={setMessage}
              />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-neutral-400 pt-2">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> قراءة جميع السطور في ورقة الجرد بالكامل
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> اعتماد علامة الناقص (-N) لإنقاص العدد واستبعاد الزيادة نهائياً
              </span>
            </div>
          </div>
        ) : (
          <BatchDocumentsPanel
            initialKind={kind}
            compact
            initialImages={files}
            defaultOpen
            autoRead
            onChanged={onRefresh}
          />
        )}
        {message && (
          <p role="status" className="text-amber-300 text-xs font-bold">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

export function OcrModal({
  isOpen,
  onClose,
  onRefresh,
  kind = 'inventory',
}: {
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
  kind?: 'inventory' | 'issue' | 'receipt';
}) {
  return isOpen ? <CaptureFlow kind={kind} onClose={onClose} onRefresh={onRefresh} /> : null;
}
