import React from 'react';
import { GeminiVisionError } from '../services/geminiVisionService';
import { AlertTriangle, RotateCw, SunMedium, Crop, X, RefreshCw } from 'lucide-react';

interface OcrErrorDialogProps {
  error: GeminiVisionError | null;
  onClose: () => void;
  onRetry: () => void;
  onRotate?: () => void;
}

export const OcrErrorDialog: React.FC<OcrErrorDialogProps> = ({
  error,
  onClose,
  onRetry,
  onRotate,
}) => {
  if (!error) return null;

  const getErrorIcon = () => {
    switch (error.errorNum) {
      case 101:
        return <SunMedium className="w-8 h-8 text-amber-400" />;
      case 102:
        return <RotateCw className="w-8 h-8 text-red-400" />;
      case 103:
        return <Crop className="w-8 h-8 text-orange-400" />;
      default:
        return <AlertTriangle className="w-8 h-8 text-red-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[#231713] border-2 border-red-500/50 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col text-right">
        {/* Header */}
        <div className="p-4 bg-[#1B110E] border-b border-[#3E2820] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-red-950/60 border border-red-500/40 flex items-center justify-center">
              {getErrorIcon()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-red-900/60 text-red-300 font-mono font-bold text-xs border border-red-700/60">
                  كود الخطأ: {error.errorNum}
                </span>
                <span className="text-[11px] text-neutral-400 font-mono">
                  {error.errorCode}
                </span>
              </div>
              <h3 className="text-base font-black text-white mt-1">
                {error.title}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#2E1E18] text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          <div className="bg-[#19110D] p-3.5 rounded-xl border border-[#3E2820] space-y-2">
            <div>
              <span className="text-neutral-400 font-bold block mb-0.5">السبب:</span>
              <p className="text-neutral-200 text-xs leading-relaxed font-semibold">
                {error.reason}
              </p>
            </div>

            <div className="pt-2 border-t border-[#2F1D16]">
              <span className="text-neutral-400 font-bold block mb-0.5">الرسالة التوجيهية:</span>
              <p className="text-amber-300 text-xs font-bold leading-relaxed">
                "{error.message}"
              </p>
            </div>
          </div>

          <div className="bg-red-950/20 border border-red-900/40 p-3 rounded-xl text-neutral-300 space-y-1">
            <span className="text-red-300 font-bold block">إجراء مقترح لحل المشكلة:</span>
            <p className="text-[11px] text-neutral-300">
              {error.actionHint}
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-[#1B110E] border-t border-[#3E2820] flex items-center justify-between gap-2">
          {error.errorNum === 102 && onRotate && (
            <button
              onClick={() => {
                onClose();
                onRotate();
              }}
              className="px-3 py-2 rounded-xl bg-[#3D271F] hover:bg-[#52352B] text-amber-300 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer border border-[#613E32]"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>تدوير 90° وإعادة المحاولة</span>
            </button>
          )}

          <button
            onClick={() => {
              onClose();
              onRetry();
            }}
            className="flex-1 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-lg shadow-amber-950/40"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة التقاط الصورة</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#2E1E18] hover:bg-[#3D2820] text-neutral-300 font-bold text-xs transition-colors cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
