import React, { useEffect, useState } from 'react';
import {
  Package,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Download,
  UploadCloud,
  ExternalLink,
  Smartphone,
} from 'lucide-react';
import { getCandidateApiUrls } from '../services/geminiVisionService';

interface WorkflowRunItem {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  headSha: string;
}

interface ReleaseInfo {
  tagName: string;
  name: string;
  publishedAt: string;
  htmlUrl: string;
  assets: Array<{
    name: string;
    sizeMb: string;
    downloadUrl: string;
  }>;
}

export function RepositoryBuildPanel({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const [selectedRepo, setSelectedRepo] = useState('sulman200101-ux/Hxgc');
  const [ghToken, setGhToken] = useState('');
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [runs, setRuns] = useState<WorkflowRunItem[]>([]);
  const [latestRelease, setLatestRelease] = useState<ReleaseInfo | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const fetchBuildStatus = async (repoName = selectedRepo) => {
    setLoadingStatus(true);
    try {
      const urls = getCandidateApiUrls(
        `/api/github/repo-build-status?repo=${encodeURIComponent(repoName)}`
      );
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = await res.json();
          if (data) {
            setRuns(Array.isArray(data.runs) ? data.runs : []);
            setLatestRelease(data.latestRelease || null);
            break;
          }
        } catch {
          // try next candidate
        }
      }
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    void fetchBuildStatus(selectedRepo);
  }, [selectedRepo]);

  const handlePushAndBuild = async () => {
    setPushing(true);
    setStatusMsg('جارٍ رفع ملفات التطبيق إلى المستودع وتشغيل بناء الـ APK...');
    setIsSuccess(false);
    try {
      const urls = getCandidateApiUrls('/api/github/push-and-build');
      let handled = false;
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repo: selectedRepo.trim(),
              token: ghToken.trim(),
            }),
          });
          const data = await res.json();
          handled = true;
          if (data.ok) {
            setIsSuccess(true);
            setStatusMsg(data.message);
            setTimeout(() => {
              void fetchBuildStatus(selectedRepo);
            }, 2500);
          } else {
            setIsSuccess(false);
            setStatusMsg(data.message || 'تعذر الدفع إلى المستودع.');
          }
          break;
        } catch {
          // try next
        }
      }
      if (!handled) {
        setStatusMsg('تعذر الاتصال بالخادم لتنفيذ عملية الرفع والبناء.');
      }
    } finally {
      setPushing(false);
    }
  };

  return (
    <details
      open={defaultOpen}
      dir="rtl"
      className="m-4 p-4 border border-teal-600/70 rounded-2xl bg-gradient-to-br from-[#122224] via-[#181B1E] to-[#1E1410] shadow-xl space-y-3"
    >
      <summary className="font-black text-teal-300 cursor-pointer flex items-center justify-between gap-2 text-sm sm:text-base">
        <span className="inline-flex items-center gap-2">
          <Package className="w-5 h-5 text-teal-400" />
          <span>📦 البناء في المستودع (GitHub Actions) وتحميل تطبيق الهاتف APK</span>
        </span>
        <span className="text-[11px] px-2.5 py-0.5 rounded-lg bg-teal-900/80 text-teal-200 border border-teal-500/50 font-mono">
          v3.4.0 / Build 37
        </span>
      </summary>

      <p className="text-xs text-neutral-300 leading-relaxed">
        تم إعداد ملفات البناء في المستودع (<code className="text-amber-300 font-mono">.github/workflows/build-apk.yml</code> و{' '}
        <code className="text-amber-300 font-mono">ci.yml</code>) على Node.js 22 LTS وJava JDK 21 مع التوقيع الدائم الموحد (
        <code className="text-teal-300 font-mono">asmo-signing.keystore</code>) ليتم بناء ملف{' '}
        <code className="text-emerald-300 font-mono">asmo-inventory-v3.4.0.apk</code> تلقائياً فور حفظ أو رفع التحديثات إلى المستودع.
      </p>

      {/* اختيار المستودع وفحص حالة البناء */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => setSelectedRepo('gslyman395-spec/Ashamy')}
          className={`px-3 py-1.5 rounded-xl text-xs font-black border cursor-pointer transition-all ${
            selectedRepo === 'gslyman395-spec/Ashamy'
              ? 'bg-teal-600 text-white border-teal-300 shadow'
              : 'bg-stone-900 text-neutral-300 border-stone-700 hover:bg-stone-800'
          }`}
        >
          مستودع gslyman395-spec/Ashamy
        </button>

        <button
          type="button"
          onClick={() => setSelectedRepo('sulman200101-ux/Hxgc')}
          className={`px-3 py-1.5 rounded-xl text-xs font-black border cursor-pointer transition-all ${
            selectedRepo === 'sulman200101-ux/Hxgc'
              ? 'bg-teal-600 text-white border-teal-300 shadow'
              : 'bg-stone-900 text-neutral-300 border-stone-700 hover:bg-stone-800'
          }`}
        >
          مستودع sulman200101-ux/Hxgc
        </button>

        <button
          type="button"
          disabled={loadingStatus}
          onClick={() => fetchBuildStatus(selectedRepo)}
          className="px-3 py-1.5 rounded-xl bg-amber-800/80 hover:bg-amber-700 text-amber-100 text-xs font-bold flex items-center gap-1.5 border border-amber-500/50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />
          <span>تحديث حالة البناء في المستودع</span>
        </button>

        <a
          href="/api/download-apk"
          download="asmo-inventory-v3.4.0.apk"
          className="px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-black flex items-center gap-1.5 border border-emerald-400 shadow cursor-pointer"
        >
          <Smartphone className="w-4 h-4" />
          <span>تنزيل تطبيق الهاتف المباشر (APK v3.4.0)</span>
        </a>
      </div>

      {/* حالة آخر عمليات البناء في المستودع المختار */}
      <div className="bg-black/40 border border-stone-700/80 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-extrabold text-amber-200">
            حالة GitHub Actions في المستودع ({selectedRepo}):
          </span>
          <a
            href={`https://github.com/${selectedRepo}/actions`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-teal-300 hover:underline inline-flex items-center gap-1 font-bold"
          >
            <span>فتح صفحة Actions في المستودع</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {runs.length === 0 ? (
          <p className="text-xs text-neutral-400">
            {loadingStatus
              ? 'جارٍ فحص سجل البناء في المستودع...'
              : 'لا توجد عمليات بناء حديثة في هذا المستودع أو لم يتم رفع ملفات التطبيق إليه بعد.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {runs.map((run) => {
              const isOk = run.conclusion === 'success';
              const isRunning = run.status === 'in_progress' || run.status === 'queued';
              return (
                <a
                  key={run.id}
                  href={run.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs transition-all ${
                    isOk
                      ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-100'
                      : isRunning
                      ? 'bg-amber-950/60 border-amber-500/60 text-amber-100'
                      : 'bg-red-950/60 border-red-600/60 text-red-100'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-bold truncate">{run.name}</div>
                    <div className="text-[10px] opacity-80 font-mono">
                      Commit: {run.headSha} • {new Date(run.createdAt).toLocaleString('ar-SA')}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black shrink-0 bg-black/40">
                    {isOk ? 'ناجح ✓' : isRunning ? 'قيد البناء ⏳' : run.conclusion || run.status}
                  </span>
                </a>
              );
            })}
          </div>
        )}

        {latestRelease && latestRelease.assets.length > 0 && (
          <div className="pt-2 border-t border-stone-800 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-emerald-300">
              آخر إصدار APK جاهز في المستودع: {latestRelease.tagName}
            </span>
            <div className="flex flex-wrap gap-2">
              {latestRelease.assets.slice(0, 2).map((asset) => (
                <a
                  key={asset.name}
                  href={asset.downloadUrl}
                  className="px-3 py-1 rounded-lg bg-emerald-800/90 hover:bg-emerald-700 text-white text-[11px] font-bold inline-flex items-center gap-1 border border-emerald-400/50"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {asset.name} ({asset.sizeMb} MB)
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* رفع ملفات التطبيق وتشغيل البناء في المستودع مباشرة */}
      <div className="bg-stone-900/90 border border-amber-700/50 rounded-xl p-3 space-y-2.5">
        <div className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
          <UploadCloud className="w-4 h-4 text-amber-400" />
          <span>رفع ملفات التطبيق وتشغيل البناء التلقائي في المستودع ({selectedRepo})</span>
        </div>
        <p className="text-[11px] text-neutral-300">
          يمكنك الحفظ والمزامنة مباشرة عبر زر <strong>GitHub</strong> في أعلى نافذة AI Studio، أو إدخال رمز الوصول الشخصي (GitHub Token بصلاحية <code className="font-mono text-amber-300">repo</code> و<code className="font-mono text-amber-300">workflow</code>) للرفع الفوري ومسح الملفات القديمة وتشغيل بناء الـ APK في المستودع:
        </p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
            placeholder="اسم المستودع مثل gslyman395-spec/Ashamy"
            className="bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-xs font-mono text-white sm:w-64"
          />
          <input
            type="password"
            value={ghToken}
            onChange={(e) => setGhToken(e.target.value)}
            placeholder="رمز GitHub Token (اختياري للدفع المباشر ghp_...)"
            className="bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-xs font-mono text-white flex-1"
          />
          <button
            type="button"
            disabled={pushing}
            onClick={handlePushAndBuild}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-700 hover:from-teal-500 hover:to-emerald-600 text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer shadow-md shrink-0"
          >
            {pushing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <UploadCloud className="w-4 h-4" />
            )}
            <span>رفع وتشغيل البناء في المستودع الآن</span>
          </button>
        </div>

        {statusMsg && (
          <div
            className={`p-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${
              isSuccess
                ? 'bg-emerald-950/90 border-emerald-500/70 text-emerald-200'
                : 'bg-amber-950/90 border-amber-500/70 text-amber-200'
            }`}
          >
            {isSuccess ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span>{statusMsg}</span>
          </div>
        )}
      </div>
    </details>
  );
}
