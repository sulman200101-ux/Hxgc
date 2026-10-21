import React, { useState } from 'react';
import { FLUTTER_DART_CODE } from '../utils/flutterCode';
import { Copy, Check, Download, Code2, Sparkles } from 'lucide-react';

export const FlutterCodeViewer: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(FLUTTER_DART_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([FLUTTER_DART_CODE], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'main.dart';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-[#2C1E18] rounded-2xl border border-[#432d24] shadow-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-5 bg-[#231713] border-b border-[#3D271F] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              كود Flutter / Dart الكامل القابل للتشغيل المباشر
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Single File • sqflite
              </span>
            </h2>
            <p className="text-xs text-neutral-400">
              يتضمن قاعدة بيانات SQLite مع الفهرسة على part_number و location_code للأداء العالي (7,000+ قطعة)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="px-3.5 py-1.5 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-amber-200 border border-[#543A2F] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'تم النسخ بنجاح' : 'نسخ الكود'}</span>
          </button>

          <button
            onClick={handleDownload}
            className="px-3.5 py-1.5 rounded-xl bg-[#3A271F] hover:bg-[#4D342A] text-white border border-[#543A2F] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تحميل main.dart</span>
          </button>
        </div>
      </div>

      {/* Code Container */}
      <div className="relative">
        <pre className="p-4 sm:p-6 text-xs text-neutral-200 bg-[#170E0B] overflow-x-auto font-mono max-h-[70vh] leading-relaxed scrollbar-thin" dir="ltr">
          <code>{FLUTTER_DART_CODE}</code>
        </pre>
      </div>
    </div>
  );
};
