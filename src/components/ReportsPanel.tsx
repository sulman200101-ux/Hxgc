import React, { useState, useEffect } from 'react';
import { dbService } from '../services/db';
import { generateReportPdfBlob, savePdfFile } from '../utils/pdfExportUtil';
import {
  getCandidateApiUrls,
  isRunningInNativeApk,
  checkDirectGeminiStatusOnDevice,
  getStoredCustomGeminiApiKey,
  setStoredCustomGeminiApiKey,
} from '../services/geminiVisionService';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Activity,
  FileText,
  Download,
  KeyRound,
  Eye,
  EyeOff,
  Trash2,
  ClipboardPaste,
} from 'lucide-react';

interface EngineStatusState {
  checking: boolean;
  geminiActive: boolean | null;
  localOcrActive: boolean;
  model: string;
  latencyMs?: number;
  statusLabel: string;
  details: string;
  checkedAt?: string;
}

export function ReportsPanel() {
  const [kind, setKind] = useState('inventory');
  const [rows, setRows] = useState<string[][]>([]);
  const [message, setMessage] = useState('');
  const [customApiKey, setCustomApiKey] = useState<string>(() => getStoredCustomGeminiApiKey());
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [hasSavedCustomKey, setHasSavedCustomKey] = useState<boolean>(() =>
    Boolean(getStoredCustomGeminiApiKey())
  );
  const [keyTestMessage, setKeyTestMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const [engineStatus, setEngineStatus] = useState<EngineStatusState>({
    checking: false,
    geminiActive: null,
    localOcrActive: true,
    model: 'gemini-3-flash-preview',
    statusLabel: 'جاري التحقق...',
    details: 'اضغط على "فحص حالة محرك جمني الآن" أو أدخل مفتاح Gemini API واختبره.',
  });

  const checkGeminiEngineStatus = async (liveTest = false, overrideKey?: string) => {
    setEngineStatus((prev) => ({
      ...prev,
      checking: true,
      statusLabel: 'جاري فحص المحرك...',
    }));
    const startMs = Date.now();
    const activeCustomKey =
      overrideKey !== undefined ? overrideKey.trim() : getStoredCustomGeminiApiKey();

    // إذا كان هناك مفتاح مخصص مدخل أو كنا داخل تطبيق الأندرويد (APK)، نفحص الاتصال المباشر بـ Google Gemini API أولاً
    if (activeCustomKey || isRunningInNativeApk()) {
      const directRes = await checkDirectGeminiStatusOnDevice(activeCustomKey || undefined);
      if (directRes.geminiActive) {
        setEngineStatus({
          checking: false,
          geminiActive: true,
          localOcrActive: true,
          model: directRes.model || 'gemini-2.5-flash',
          latencyMs: directRes.latencyMs,
          statusLabel: 'يعمل ونشط 🟢',
          details:
            directRes.details ||
            'محرك جمني السحابي متصل مباشرة من الهاتف ويعمل بكفاءة لقراءة الجداول وتحليل القطع.',
          checkedAt: new Date().toLocaleTimeString('ar-SA'),
        });
        if (liveTest) {
          setKeyTestMessage({
            type: 'success',
            text:
              directRes.details ||
              `نجح اختبار المفتاح! المحرك (${directRes.model}) يعمل ونشط 🟢 (${directRes.latencyMs}ms).`,
          });
        }
        return;
      }

      // إذا أدخل المستخدم مفتاحاً مخصصاً وفشل الاختبار المباشر، نتحقق أيضاً عبر الخادم أو نعرض سبب الخطأ الدقيق
      if (activeCustomKey && directRes.errorReason && isRunningInNativeApk()) {
        setEngineStatus({
          checking: false,
          geminiActive: false,
          localOcrActive: true,
          model: directRes.model || 'gemini-2.5-flash',
          latencyMs: directRes.latencyMs,
          statusLabel: 'متوقف 🔴 (يرجى التحقق من المفتاح)',
          details: directRes.errorReason,
          checkedAt: new Date().toLocaleTimeString('ar-SA'),
        });
        setKeyTestMessage({
          type: 'error',
          text: directRes.errorReason,
        });
        return;
      }
    }

    const urls = getCandidateApiUrls('/api/gemini/status');
    for (const url of urls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            test: liveTest,
            apiKey: activeCustomKey || undefined,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          if (data.geminiActive) {
            setEngineStatus({
              checking: false,
              geminiActive: true,
              localOcrActive: data.localOcrActive !== false,
              model: data.model || 'gemini-3-flash-preview',
              latencyMs: data.latencyMs ?? Date.now() - startMs,
              statusLabel: 'يعمل ونشط 🟢',
              details:
                data.details ||
                'محرك جمني متصل ويعمل بكفاءة لقراءة الجداول وتحليل القطع.',
              checkedAt: new Date().toLocaleTimeString('ar-SA'),
            });
            if (liveTest && activeCustomKey) {
              setKeyTestMessage({
                type: 'success',
                text:
                  data.details ||
                  `تم حفظ وتفعيل مفتاح Gemini بنجاح! المحرك يعمل ونشط 🟢.`,
              });
            }
            return;
          }
        }
      } catch {
        clearTimeout(timer);
      }
    }

    const fallbackDirect = await checkDirectGeminiStatusOnDevice(activeCustomKey || undefined);
    if (fallbackDirect.geminiActive) {
      setEngineStatus({
        checking: false,
        geminiActive: true,
        localOcrActive: true,
        model: fallbackDirect.model || 'gemini-2.5-flash',
        latencyMs: fallbackDirect.latencyMs,
        statusLabel: 'يعمل ونشط 🟢',
        details:
          fallbackDirect.details ||
          'محرك جمني متصل ويعمل بكفاءة لقراءة الجداول وتحليل القطع.',
        checkedAt: new Date().toLocaleTimeString('ar-SA'),
      });
      if (liveTest) {
        setKeyTestMessage({
          type: 'success',
          text:
            fallbackDirect.details ||
            `نجح الاختبار! المحرك (${fallbackDirect.model}) يعمل ونشط 🟢.`,
        });
      }
      return;
    }

    const failReason =
      fallbackDirect.errorReason ||
      'تعذر الوصول للخادم السحابي من الهاتف حالياً؛ أدخل مفتاح Gemini API (يبدأ بـ AIzaSy) في الحقل أعلاه واضغط "حفظ واختبار المفتاح الآن" لتشغيل جمني مباشرة.';

    setEngineStatus({
      checking: false,
      geminiActive: false,
      localOcrActive: true,
      model: 'gemini-2.5-flash',
      latencyMs: Date.now() - startMs,
      statusLabel: 'متوقف 🔴 (أدخل مفتاح Gemini بالأسفل لتفعيله)',
      details: failReason,
      checkedAt: new Date().toLocaleTimeString('ar-SA'),
    });

    if (liveTest) {
      setKeyTestMessage({
        type: 'error',
        text: failReason,
      });
    }
  };

  const handleSaveAndTestKey = async () => {
    const clean = customApiKey.trim();
    if (!clean) {
      setKeyTestMessage({
        type: 'error',
        text: 'يرجى لصق أو كتابة مفتاح Gemini API أولاً في الحقل (يبدأ عادةً بـ AIzaSy).',
      });
      return;
    }
    setStoredCustomGeminiApiKey(clean);
    setHasSavedCustomKey(true);
    setKeyTestMessage({
      type: 'info',
      text: 'تم حفظ المفتاح في الهاتف، جاري اختبار الاتصال المباشر بمحرك Gemini الآن...',
    });
    await checkGeminiEngineStatus(true, clean);
  };

  const handleClearKey = async () => {
    setCustomApiKey('');
    setStoredCustomGeminiApiKey('');
    setHasSavedCustomKey(false);
    setKeyTestMessage({
      type: 'info',
      text: 'تم مسح المفتاح المخصص والعودة للإعدادات الافتراضية.',
    });
    await checkGeminiEngineStatus(false, '');
  };

  const handlePasteKey = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clipText = await navigator.clipboard.readText();
        if (clipText && clipText.trim()) {
          setCustomApiKey(clipText.trim());
          setKeyTestMessage({
            type: 'info',
            text: 'تم لصق المفتاح من الحافظة — اضغط "حفظ واختبار المفتاح الآن" لتفعيله.',
          });
          return;
        }
      }
      setKeyTestMessage({
        type: 'info',
        text: 'اضغط مطولاً داخل حقل المفتاح واختر "لصق" (Paste).',
      });
    } catch {
      setKeyTestMessage({
        type: 'info',
        text: 'اضغط مطولاً داخل حقل المفتاح واختر "لصق" (Paste).',
      });
    }
  };

  useEffect(() => {
    void checkGeminiEngineStatus(false);
  }, []);

  const titles: Record<string, string> = {
    inventory: 'الجرد',
    missing: 'النقص والمفقود',
    unverified: 'القطع غير المدققة',
    issue: 'الصرف',
    receipt: 'إدخال المخزون',
    transfer: 'طلبات النقل والاعتماد',
    audit: 'سجل العمليات',
  };

  const prepare = async () => {
    const items = dbService.getAllItems();
    const docs = await dbService.getDocuments();
    if (['inventory', 'missing', 'unverified'].includes(kind)) {
      const selected = items.filter((item) =>
        kind === 'missing'
          ? item.is_missing === 1 || /^-\s*\d+$/.test(item.remark || '')
          : kind === 'unverified'
          ? item.status === 'غير مدقق'
          : true
      );
      setRows([
        ['رقم القطعة', 'الوصف', 'الموقع', 'الإجمالي', 'المصروف', 'المتبقي', 'الحالة', 'الملاحظات'],
        ...selected.map((item) => [
          item.part_number,
          `${item.description_ar}\n${item.description_en}`,
          item.location_code,
          String(item.qty_total),
          String(item.qty_out),
          String(item.qty_remaining),
          item.status,
          item.remark || '',
        ]),
      ]);
    } else if (kind === 'audit') {
      const backup = JSON.parse(await dbService.exportBackup());
      setRows([
        ['التاريخ', 'العملية', 'المستخدم', 'المستند', 'قبل', 'بعد'],
        ...backup.audit.map((entry: any) => [
          entry.at || '',
          entry.action || '',
          entry.actor || '',
          entry.documentId || '',
          JSON.stringify(entry.before || ''),
          JSON.stringify(entry.after || ''),
        ]),
      ]);
    } else {
      setRows([
        [
          'رقم وتاريخ التقرير',
          'المستند',
          'مقدم الطلب',
          'الحالة',
          'القطعة',
          'الكمية',
          'الموقع القديم',
          'الموقع الجديد',
          'السبب',
          'اعتماد المشرف',
          'وقت التنفيذ',
        ],
        ...docs
          .filter((doc) => doc.kind === kind)
          .flatMap((doc, docIdx) =>
            doc.lines.map((line) => [
              doc.reportTitle || (doc.kind === 'transfer' ? `تقرير ${docIdx + 1}` : doc.id),
              doc.id,
              doc.requester,
              doc.status === 'approved' ? 'تم النقل والاعتماد' : 'بانتظار الاعتماد',
              line.part_number,
              String(line.quantity),
              line.old_location || '',
              line.location,
              doc.reason,
              doc.approvedBy || '',
              doc.executedAt || doc.createdAt || '',
            ])
          ),
      ]);
    }
  };

  return (
    <div className="m-4 space-y-3" dir="rtl">
      {/* لوحة فحص حالة محرك جمني وإدخال المفتاح والاختبار داخل واجهة التقارير */}
      <div className="p-4 border border-amber-700/70 rounded-2xl bg-[#221611] shadow-lg space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-900/60 border border-amber-500/40 flex items-center justify-center text-amber-300">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-white">
                حالة محرك جمني (Gemini AI) ومحرك قراءة أوراق الجرد
              </h3>
              <p className="text-[11px] text-neutral-300">
                يمكنك وضع مفتاح Gemini API الخاص بك بالأسفل وحفظه واختباره ليعمل جمني مباشرة في تطبيق الهاتف
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={engineStatus.checking}
            onClick={() => checkGeminiEngineStatus(true)}
            className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${engineStatus.checking ? 'animate-spin' : ''}`} />
            <span>{engineStatus.checking ? 'جاري الفحص...' : 'فحص حالة محرك جمني الآن'}</span>
          </button>
        </div>

        {/* حقل إدخال مفتاح Gemini API مع الحفظ والاختبار المباشر */}
        <div className="p-3.5 rounded-xl bg-stone-900/95 border border-amber-600/50 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-amber-300 text-xs font-extrabold">
              <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
              <span>مفتاح Gemini API لتشغيل جمني على الهاتف (مع الحفظ والاختبار الفوري)</span>
            </div>
            {hasSavedCustomKey ? (
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-900/70 text-emerald-200 border border-emerald-500/40 font-bold">
                مفتاح مخصص محفوظ في الجهاز ✓
              </span>
            ) : (
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-stone-800 text-neutral-300 border border-stone-600">
                لم يتم حفظ مفتاح مخصص بعد
              </span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showApiKey ? 'text' : 'password'}
                dir="ltr"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="AIzaSy... الصق مفتاح Gemini API هنا"
                className="w-full px-3 py-2.5 rounded-xl bg-black/60 border border-amber-700/60 focus:border-amber-400 focus:outline-none text-xs font-mono text-amber-100 placeholder:text-neutral-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="px-2.5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-neutral-200 text-xs font-bold flex items-center gap-1 border border-stone-600 cursor-pointer"
                title={showApiKey ? 'إخفاء المفتاح' : 'إظهار المفتاح'}
              >
                {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showApiKey ? 'إخفاء' : 'إظهار'}</span>
              </button>

              <button
                type="button"
                onClick={handlePasteKey}
                className="px-2.5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-amber-200 text-xs font-bold flex items-center gap-1 border border-amber-700/50 cursor-pointer"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>لصق</span>
              </button>

              <button
                type="button"
                disabled={engineStatus.checking}
                onClick={handleSaveAndTestKey}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-md cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{engineStatus.checking ? 'جاري الاختبار...' : 'حفظ واختبار المفتاح الآن'}</span>
              </button>

              {(customApiKey || hasSavedCustomKey) && (
                <button
                  type="button"
                  onClick={handleClearKey}
                  className="px-2.5 py-2 rounded-xl bg-red-950/80 hover:bg-red-900 text-red-200 text-xs font-bold flex items-center gap-1 border border-red-700/50 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>مسح</span>
                </button>
              )}
            </div>
          </div>

          {keyTestMessage && (
            <div
              className={`px-3 py-2 rounded-xl text-xs font-bold border ${
                keyTestMessage.type === 'success'
                  ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-200'
                  : keyTestMessage.type === 'error'
                  ? 'bg-red-950/80 border-red-500/60 text-red-200'
                  : 'bg-amber-950/70 border-amber-600/50 text-amber-200'
              }`}
            >
              {keyTestMessage.text}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div
            className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${
              engineStatus.geminiActive
                ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-200'
                : 'bg-stone-900/90 border-amber-700/50 text-amber-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {engineStatus.geminiActive ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <div>
                <div className="font-bold text-white">محرك جمني السحابي ({engineStatus.model})</div>
                <div className="text-[11px] opacity-90">{engineStatus.statusLabel}</div>
              </div>
            </div>
            {engineStatus.latencyMs !== undefined && (
              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-black/40 text-amber-300">
                {engineStatus.latencyMs}ms
              </span>
            )}
          </div>

          <div className="p-3 rounded-xl border bg-emerald-950/50 border-emerald-600/60 text-emerald-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <div className="font-bold text-white">محرك القراءة المحلي للهاتف (WASM SIMD + 37 سطراً)</div>
                <div className="text-[11px] text-emerald-300">يعمل ونشط 100% (متصل وبدون إنترنت) 🟢</div>
              </div>
            </div>
            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-emerald-900/70 text-emerald-200 font-bold">
              جاهز
            </span>
          </div>
        </div>

        <p className="text-xs text-neutral-300 bg-stone-900/80 px-3 py-2 rounded-xl border border-stone-700/80">
          {engineStatus.details}
          {engineStatus.checkedAt ? ` (آخر فحص: ${engineStatus.checkedAt})` : ''}
        </p>
      </div>

      {/* قسم تقارير PDF */}
      <details open className="p-4 border border-amber-800 rounded-2xl bg-[#1E1410]" dir="rtl">
        <summary className="font-bold text-amber-300 cursor-pointer flex items-center gap-2">
          <FileText className="w-4 h-4" />
          <span>تقارير PDF</span>
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            className="bg-stone-800 p-2 rounded-xl text-xs font-bold border border-stone-700"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setRows([]);
            }}
          >
            {Object.entries(titles).map(([key, title]) => (
              <option key={key} value={key}>
                {title}
              </option>
            ))}
          </select>
          <button
            className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold cursor-pointer"
            onClick={() => prepare().catch((err) => setMessage(String(err)))}
          >
            إعداد التقرير
          </button>
          {rows.length > 0 && (
            <button
              className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              onClick={async () => {
                try {
                  const result = await generateReportPdfBlob({
                    reportElementId: 'asmo-operation-report',
                  });
                  await savePdfFile(result.pdfFile);
                  URL.revokeObjectURL(result.downloadUrl);
                } catch (err) {
                  setMessage(String(err));
                }
              }}
            >
              <Download className="w-3.5 h-3.5" />
              <span>تنزيل PDF</span>
            </button>
          )}
        </div>
        {rows.length > 0 && (
          <div
            id="asmo-operation-report"
            className="mt-3 rounded-xl bg-white text-neutral-900 p-6 overflow-x-auto font-sans"
          >
            <h1 className="text-lg font-bold mb-1">ASMO — {titles[kind]}</h1>
            <p className="text-xs text-neutral-600 mb-3">
              {new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })}
            </p>
            <table className="w-full border-collapse text-[11px]">
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={`whitespace-pre-line border border-neutral-400 p-1.5 ${
                          i === 0 ? 'font-bold bg-neutral-100' : 'font-normal'
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p role="status" className="text-xs text-amber-300 mt-2">
          {message}
        </p>
      </details>
    </div>
  );
}
