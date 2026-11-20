import React, { useEffect, useState, useRef } from 'react';
import { Database, CheckCircle2, RefreshCw } from 'lucide-react';

export interface DbProgressEventDetail {
  active: boolean;
  title?: string;
  stage?: string;
  done?: number;
  total?: number;
  percent?: number;
}

export function emitDbProgress(detail: DbProgressEventDetail): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent<DbProgressEventDetail>('asmo-db-progress', { detail }));
  } catch {
    // ignore in non-DOM environments
  }
}

export function DatabaseProgressBar() {
  const [progress, setProgress] = useState<{
    visible: boolean;
    completed: boolean;
    title: string;
    stage: string;
    done: number;
    total: number;
    percent: number;
  }>({
    visible: false,
    completed: false,
    title: 'جارٍ معالجة وتحديث قاعدة البيانات...',
    stage: '',
    done: 0,
    total: 100,
    percent: 0,
  });

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleProgress = (event: Event) => {
      const detail = (event as CustomEvent<DbProgressEventDetail>).detail;
      if (!detail) return;

      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      if (detail.active) {
        const total = Math.max(1, detail.total ?? 100);
        const done = Math.min(total, Math.max(0, detail.done ?? 0));
        const computedPercent =
          detail.percent !== undefined
            ? Math.min(100, Math.max(0, Math.round(detail.percent)))
            : Math.min(100, Math.max(5, Math.round((done / total) * 100)));

        setProgress({
          visible: true,
          completed: false,
          title: detail.title || 'جارٍ معالجة وتحديث البيانات في قاعدة البيانات...',
          stage: detail.stage || `تمت معالجة ${done.toLocaleString()} من ${total.toLocaleString()} سجل`,
          done,
          total,
          percent: computedPercent,
        });
      } else {
        setProgress((prev) => {
          if (!prev.visible) return prev;
          return {
            ...prev,
            completed: true,
            percent: 100,
            done: prev.total,
            title: detail.title || 'اكتمل تحديث قاعدة بيانات المخزون بنجاح',
            stage: detail.stage || 'تم حفظ وفهرسة كافة البيانات في المخزون.',
          };
        });

        hideTimerRef.current = setTimeout(() => {
          setProgress((prev) => ({ ...prev, visible: false, completed: false }));
          hideTimerRef.current = null;
        }, 900);
      }
    };

    window.addEventListener('asmo-db-progress', handleProgress);
    return () => {
      window.removeEventListener('asmo-db-progress', handleProgress);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!progress.visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="شريط تقدم معالجة قاعدة البيانات"
      dir="rtl"
      className="sticky top-[62px] z-40 mx-auto max-w-7xl px-3 sm:px-6 pt-2 transition-all duration-200"
    >
      <div
        className={`rounded-2xl border p-3.5 shadow-2xl backdrop-blur-md transition-colors ${
          progress.completed
            ? 'bg-emerald-950/95 border-emerald-500/80 text-emerald-100'
            : 'bg-[#261812]/95 border-amber-500/80 text-amber-100'
        }`}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                progress.completed
                  ? 'bg-emerald-900/70 border-emerald-400/60 text-emerald-300'
                  : 'bg-amber-900/70 border-amber-400/60 text-amber-300'
              }`}
            >
              {progress.completed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
              ) : (
                <RefreshCw className="w-4 h-4 text-amber-300 animate-spin" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 opacity-80 shrink-0" />
                <p className="text-xs sm:text-sm font-extrabold text-white truncate">
                  {progress.title}
                </p>
              </div>
              {progress.stage && (
                <p className="text-[11px] text-neutral-300 truncate mt-0.5">{progress.stage}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
            {progress.total > 1 && (
              <span className="text-[11px] text-neutral-300 hidden sm:inline">
                {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
              </span>
            )}
            <span
              className={`px-2.5 py-1 rounded-lg text-xs font-black border ${
                progress.completed
                  ? 'bg-emerald-900 text-emerald-200 border-emerald-500/60'
                  : 'bg-amber-900/90 text-amber-200 border-amber-500/60'
              }`}
            >
              {progress.percent}%
            </span>
          </div>
        </div>

        {/* شريط التقدم المرئي */}
        <div className="w-full h-2.5 bg-black/60 rounded-full overflow-hidden border border-white/10">
          <div
            className={`h-full transition-all duration-200 rounded-full ${
              progress.completed
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                : 'bg-gradient-to-r from-amber-600 via-orange-500 to-yellow-400'
            }`}
            style={{ width: `${Math.max(4, Math.min(100, progress.percent))}%` }}
          />
        </div>
        <progress
          className="sr-only"
          max={Math.max(progress.total, 1)}
          value={progress.done}
        />
      </div>
    </div>
  );
}
