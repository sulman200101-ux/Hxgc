import { ImageSourcePicker } from './ImageSourcePicker';
import React, { useEffect, useState, useRef } from 'react';
import { dbService } from '../services/db';
import { interpretMark, auditSheetCompleteness, type DocumentLine, type StockDocument } from '../services/documents';
import { processOcrFromImage } from '../services/localOcr';
import { readImageBatch } from '../services/batchOcr';
import { prepareAudio, playOperationSound } from '../utils/operationSounds';
import { CheckSquare, FileStack, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

interface Sheet {
  key: string;
  id: string;
  expectedRowCount?: number;
  sumDuplicates?: boolean;
  original: File;
  lines: DocumentLine[];
  state: 'waiting' | 'reading' | 'review' | 'error';
  message: string;
}

const blank = (): DocumentLine => ({
  part_number: '',
  quantity: Number.NaN,
  location: '',
  description_en: '',
  description_ar: '',
  check: '',
  remark: '',
  reviewed: false,
});

function hasDuplicatePartNumbers(lines: DocumentLine[]): boolean {
  const seen = new Set<string>();
  for (const line of lines) {
    const clean = line.part_number.trim();
    if (!clean) continue;
    if (seen.has(clean)) return true;
    seen.add(clean);
  }
  return false;
}

function SheetImage({ image }: { image: Blob }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(image);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image]);
  return (
    <details className="my-2">
      <summary className="cursor-pointer text-amber-300 text-xs font-bold">
        مراجعة الصورة الأصلية
      </summary>
      {url ? (
        <img src={url} alt="أصل ورقة الدفعة" className="max-h-96 rounded-lg mt-2 border border-stone-700" />
      ) : (
        <p className="text-xs text-neutral-400 mt-2">جارٍ تجهيز معاينة الصورة...</p>
      )}
    </details>
  );
}

export function BatchDocumentsPanel({
  onChanged,
  initialImages = [],
  defaultOpen = false,
  autoRead = false,
  initialKind = 'inventory',
  compact = false,
}: {
  onChanged: () => void;
  initialImages?: File[];
  defaultOpen?: boolean;
  autoRead?: boolean;
  initialKind?: 'inventory' | 'issue' | 'receipt';
  compact?: boolean;
}) {
  const [sheets, setSheets] = useState<Sheet[]>(() =>
    initialImages.map((original) => ({
      key: crypto.randomUUID(),
      id: '',
      original,
      lines: [],
      state: 'waiting',
      message: '',
    }))
  );
  const [requester, setRequester] = useState(compact ? 'المستخدم المحلي' : '');
  const [kind, setKind] = useState<'inventory' | 'receipt' | 'issue'>(initialKind);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [documents, setDocuments] = useState<StockDocument[]>([]);
  const [readingProgress, setReadingProgress] = useState<{
    active: boolean;
    sheetIndex: number;
    totalSheets: number;
    sheetName: string;
    percent: number;
    stage: string;
  }>({
    active: false,
    sheetIndex: 0,
    totalSheets: 0,
    sheetName: '',
    percent: 0,
    stage: '',
  });

  const refresh = async () => setDocuments(await dbService.getDocuments());
  useEffect(() => {
    refresh().catch((err) => setMessage(String(err)));
  }, []);

  const patch = (key: string, update: Partial<Sheet>) =>
    setSheets((current) =>
      current.map((sheet) => (sheet.key === key ? { ...sheet, ...update } : sheet))
    );

  const patchLine = (key: string, index: number, update: Partial<DocumentLine>) =>
    setSheets((current) =>
      current.map((sheet) =>
        sheet.key !== key
          ? sheet
          : {
              ...sheet,
              lines: sheet.lines.map((line, i) =>
                i === index ? { ...line, ...update } : line
              ),
            }
      )
    );

  const markAllSheetLinesReviewed = (key: string, reviewed: boolean) => {
    setSheets((current) =>
      current.map((sheet) =>
        sheet.key !== key
          ? sheet
          : {
              ...sheet,
              id:
                sheet.id.trim() ||
                `DOC-${Date.now().toString().slice(-5)}-${Math.floor(Math.random() * 90 + 10)}`,
              sumDuplicates: reviewed && hasDuplicatePartNumbers(sheet.lines) ? true : sheet.sumDuplicates,
              lines: sheet.lines.map((line) => ({ ...line, reviewed })),
            }
      )
    );
  };

  const markAllSheetsReviewed = () => {
    setSheets((current) =>
      current.map((sheet, idx) =>
        sheet.state !== 'review'
          ? sheet
          : {
              ...sheet,
              id:
                sheet.id.trim() ||
                `DOC-${Date.now().toString().slice(-5)}-${idx + 1}`,
              sumDuplicates: hasDuplicatePartNumbers(sheet.lines) ? true : sheet.sumDuplicates,
              lines: sheet.lines.map((line) => ({ ...line, reviewed: true })),
            }
      )
    );
  };

  const readPending = async (targetSheets?: Sheet[]) => {
    prepareAudio();
    setBusy(true);
    try {
      const listToRead = (targetSheets || sheets).filter(
        (sheet) => sheet.state === 'waiting' || sheet.state === 'error'
      );
      await readImageBatch(
        listToRead,
        (image) =>
          processOcrFromImage(image, (percent, stage) => {
            setReadingProgress((prev) => ({
              ...prev,
              active: true,
              percent,
              stage,
            }));
          }),
        (key, index, total) => {
          const currentSheet = listToRead[index - 1];
          patch(key, { state: 'reading', message: '' });
          setReadingProgress({
            active: true,
            sheetIndex: index,
            totalSheets: total,
            sheetName: currentSheet?.original?.name || `ورقة ${index}`,
            percent: 10,
            stage: 'بدء فحص الورقة واستخراج جدول الجرد...',
          });
          setMessage(`قراءة الورقة ${index} من ${total}...`);
        },
        (result) => {
          if (result.state === 'error') {
            patch(result.key, { state: 'error', message: result.message });
            return;
          }
          const mappedLines: DocumentLine[] = result.rows.map((row) => ({
            part_number: row.part_number,
            quantity: row.qty_total > 0 ? row.qty_total : Number.NaN,
            location: row.location_code,
            description_en: row.description_en,
            description_ar: row.description_ar,
            check: row.is_missing === 1 ? 'X' : '',
            remark: row.remark || '',
            reviewed: true,
          }));
          patch(result.key, {
            state: 'review',
            id:
              (targetSheets || sheets).find((s) => s.key === result.key)?.id.trim() ||
              `SHEET-${Date.now().toString().slice(-5)}-${Math.floor(Math.random() * 90 + 10)}`,
            expectedRowCount: mappedLines.length,
            sumDuplicates: hasDuplicatePartNumbers(mappedLines) ? true : undefined,
            lines: mappedLines,
          });
        }
      );
      playOperationSound('uncertain');
      setMessage(
        'انتهت القراءة الأولية؛ راجع كل ورقة وكمية ورقم قطعة مقابل أصلها، وصحح الأوراق غير الواضحة.'
      );
    } catch (err) {
      setMessage(String(err));
      playOperationSound('uncertain');
    } finally {
      setReadingProgress((prev) => ({ ...prev, active: false }));
      setBusy(false);
    }
  };

  // تحميل الورقتين المرفقتين من المستخدم (صفحة 27 وصفحة 41) لاختبار قراءة عدة أوراق دفعة واحدة
  const loadAttachedSampleSheets = async () => {
    setBusy(true);
    setMessage('جاري تجهيز أوراق الجرد المرفقة (ورقة 27 وورقة 41)...');
    try {
      const samplePaths = [
        {
          url: '/assets/aistudio/IMG_20261029_222333_2a538328.jpg',
          name: 'SAP_Inventory_Page_27_of_43.jpg',
          docId: 'SAP-P27-2026',
        },
        {
          url: '/assets/aistudio/_____ChatGPT_29________2026__10_12_32___d0ea9fc3.jpg',
          name: 'SAP_Inventory_Page_41_of_43.jpg',
          docId: 'SAP-P41-2026',
        },
      ];

      const loadedSheets: Sheet[] = [];
      for (const sample of samplePaths) {
        const resp = await fetch(sample.url);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        const file = new File([blob], sample.name, { type: 'image/jpeg' });
        loadedSheets.push({
          key: crypto.randomUUID(),
          id: sample.docId,
          original: file,
          lines: [],
          state: 'waiting',
          message: '',
        });
      }

      if (!loadedSheets.length) {
        throw new Error('تعذر العثور على صور الأوراق المرفقة');
      }

      setSheets((current) => [...current, ...loadedSheets]);
      setBusy(false);
      await readPending(loadedSheets);
    } catch (err) {
      setMessage((err as Error).message);
      setBusy(false);
    }
  };

  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoRead && initialImages.length && !autoStarted.current) {
      autoStarted.current = true;
      void readPending();
    }
  }, []);

  const batches = new Map<string, StockDocument[]>();
  for (const doc of documents) {
    if (doc.batchId) batches.set(doc.batchId, [...(batches.get(doc.batchId) || []), doc]);
  }

  const totalExtractedLines = sheets.reduce((acc, s) => acc + s.lines.length, 0);

  return (
    <details
      open={defaultOpen || undefined}
      className="border border-amber-600 rounded-xl p-3 bg-[#1E1410]/90"
      dir="rtl"
    >
      <summary className="font-bold cursor-pointer text-amber-300">
        قراءة وحفظ عدة أوراق دفعة واحدة
      </summary>
      <p className="text-xs text-neutral-300 mt-1">
        اختر صور الأوراق معًا (ورقة واحدة أو عدة أوراق جرد). تُقرأ بالتتابع، ثم تراجع جميع السطور وأرقام المستندات. الحفظ لا يعدّل المخزون؛ الاعتماد خطوة مستقلة.
      </p>
      <p className="text-xs text-neutral-400 mb-3">
        في الجرد: تُضاف القطع الجديدة بعد الاعتماد، والقطع الموجودة لا تتكرر ولا يُستبدل رصيدها بالكمية المقروءة. النقص -N يحتاج اعتمادًا. استخدم «توريد» لإضافة كميات واردة.
      </p>

      {/* شريط حالة القراءة الحية المبسط والواضح */}
      {readingProgress.active && (
        <div
          role="region"
          aria-label="مؤشر قراءة الورقة المباشر"
          className="mb-4 p-4 rounded-2xl bg-amber-950/90 border-2 border-amber-400 shadow-lg space-y-2.5 animate-pulse"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-6 h-6 text-amber-300 animate-spin shrink-0" />
              <div>
                <p className="text-sm sm:text-base font-extrabold text-white">
                  جارٍ قراءة الورقة {readingProgress.sheetIndex} من {readingProgress.totalSheets}:{' '}
                  <span className="text-amber-300 font-mono text-xs sm:text-sm">
                    {readingProgress.sheetName}
                  </span>
                </p>
                <p className="text-xs text-amber-200 font-bold mt-0.5">
                  {readingProgress.stage || 'يتم استخراج أرقام القطع والمواقع والكميات بدقة...'}
                </p>
              </div>
            </div>
            <span className="px-3 py-1 rounded-xl bg-amber-500 text-stone-950 font-extrabold font-mono text-sm">
              {readingProgress.percent}%
            </span>
          </div>
          <div className="w-full h-3 bg-stone-900 rounded-full overflow-hidden border border-amber-500/40">
            <div
              className="h-full bg-gradient-to-l from-emerald-400 via-amber-400 to-amber-600 transition-all duration-200"
              style={{ width: `${Math.max(10, readingProgress.percent)}%` }}
            />
          </div>
        </div>
      )}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          prepareAudio();
          setBusy(true);
          try {
            if (!sheets.length || sheets.some((sheet) => sheet.state !== 'review')) {
              throw new Error('راجع كل الأوراق، بما فيها الأوراق التي تعذرت قراءتها');
            }
            const batchId = 'BATCH-' + crypto.randomUUID();
            await dbService.submitDocuments(
              sheets.map((sheet) => ({
                id: sheet.id,
                duplicateResolution: sheet.sumDuplicates ? 'sum' : undefined,
                batchId,
                kind,
                requester: requester || 'المستخدم المحلي',
                reason: 'دفعة صور مراجعة',
                lines: sheet.lines,
                original: sheet.original,
                status: 'pending',
                createdAt: '',
              }))
            );
            await refresh();
            onChanged();
            setMessage(`حُفظت ${sheets.length} أوراق للمراجعة؛ المخزون لم يتغير`);
            setSheets([]);
          } catch (err) {
            setMessage((err as Error).message);
            if ((err as Error).message.includes('تم حفظها مسبقًا')) {
              playOperationSound('duplicate');
            }
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        <label hidden={compact} className={compact ? 'hidden' : 'block text-xs'}>
          نوع الدفعة{' '}
          <select
            disabled={busy}
            className="bg-stone-800 p-2 rounded mr-2"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="inventory">أوراق جرد</option>
            <option value="receipt">أوراق توريد مخزون</option>
            <option value="issue">أوراق صرف</option>
          </select>
        </label>

        <label hidden={compact} className={compact ? 'hidden' : 'block text-xs'}>
          اسم مقدم الدفعة{' '}
          <input
            disabled={busy}
            required
            className="bg-stone-800 p-2 rounded mr-2"
            value={requester}
            onChange={(e) => setRequester(e.target.value)}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <ImageSourcePicker
            disabled={busy}
            onError={setMessage}
            onImages={(files) =>
              setSheets((current) => [
                ...current,
                ...files.map((original) => ({
                  key: crypto.randomUUID(),
                  id: '',
                  original,
                  lines: [],
                  state: 'waiting' as const,
                  message: '',
                })),
              ])
            }
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 bg-stone-900/80 p-3 rounded-xl border border-stone-700 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              الأوراق: <strong className="text-white">{sheets.length}</strong>
            </span>
            <span>
              تمت قراءتها:{' '}
              <strong className="text-emerald-400">
                {sheets.filter((sheet) => sheet.state === 'review').length}
              </strong>
            </span>
            <span>
              إجمالي الأصناف المستخرجة:{' '}
              <strong className="text-amber-300 font-mono">{totalExtractedLines}</strong>
            </span>
            <span>
              أخطاء:{' '}
              <strong className="text-red-400">
                {sheets.filter((sheet) => sheet.state === 'error').length}
              </strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {sheets.filter((s) => s.state === 'review' && s.lines.length > 0).length > 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={markAllSheetsReviewed}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold rounded-lg cursor-pointer flex items-center gap-1"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>تأكيد مراجعة كل الأوراق دفعة واحدة ({totalExtractedLines} سطر) ✓</span>
              </button>
            )}
            <button
              type="button"
              className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white font-bold rounded-lg cursor-pointer"
              disabled={
                busy ||
                !sheets.some((sheet) => sheet.state === 'waiting' || sheet.state === 'error')
              }
              onClick={() => readPending()}
            >
              قراءة جميع الأوراق المنتظرة
            </button>
          </div>
        </div>

        {sheets.map((sheet, sheetIndex) => {
          const verifiedCount = sheet.lines.filter((l) => l.check === '✓').length;
          const unverifiedCount = sheet.lines.filter((l) => l.check === '').length;
          const missingCount = sheet.lines.filter((l) => l.check === 'X').length;
          const remarksCount = sheet.lines.filter((l) => l.remark.trim() !== '').length;
          const allReviewed =
            sheet.lines.length > 0 && sheet.lines.every((l) => l.reviewed);
          const completeness = auditSheetCompleteness(sheet.lines, {
            expectedRows: sheet.expectedRowCount ?? sheet.lines.length,
          });
          const hasShortageAlert =
            completeness.missingFromOcrCount > 0 ||
            completeness.incompleteLines.length > 0 ||
            completeness.shortageLines.length > 0 ||
            completeness.missingMarkLines.length > 0;

          return (
            <fieldset
              key={sheet.key}
              disabled={busy}
              className={`border rounded-xl p-3 my-3 bg-[#160F0C] transition-colors ${
                sheet.state === 'reading'
                  ? 'border-amber-400 ring-2 ring-amber-500/30'
                  : hasShortageAlert
                  ? 'border-amber-500 ring-1 ring-amber-500/40'
                  : allReviewed
                  ? 'border-emerald-600/80'
                  : 'border-stone-600'
              }`}
              data-sheet-index={sheetIndex}
            >
              <legend className="px-2 font-bold text-amber-300 text-xs sm:text-sm flex items-center gap-2">
                <span>
                  الورقة {sheetIndex + 1}: {sheet.original.name} —{' '}
                  {
                    {
                      waiting: '⏳ بانتظار القراءة',
                      reading: '🔄 جارٍ قراءة الورقة الآن...',
                      review: `✅ تمت القراءة (${sheet.lines.length} سطراً مستخرجاً بالكامل)`,
                      error: '⚠️ تعذرت القراءة',
                    }[sheet.state]
                  }
                </span>
              </legend>

              {sheet.state === 'reading' && (
                <div className="my-3 p-4 rounded-xl bg-amber-950/70 border border-amber-500/50 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-amber-400 animate-spin shrink-0" />
                  <div className="text-xs text-amber-100 font-bold">
                    يتم الآن مسح كامل الورقة واستخراج أرقام القطع (10 خانات) والمواقع والكميات وعلامات اليد...
                  </div>
                </div>
              )}

              {sheet.state === 'review' && sheet.lines.length > 0 && (
                <div className="my-2 space-y-2">
                  <div className="p-2.5 rounded-xl bg-stone-900/90 border border-stone-700 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2 text-amber-200 font-bold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        إجمالي سطور الورقة: <strong className="text-white font-mono">{completeness.extractedRowCount}</strong> | صافي القطع المحفوظة بعد دمج المتكرر:{' '}
                        <strong className="text-emerald-400 font-mono">{completeness.netUniquePartsCount}</strong> | غير مدقق:{' '}
                        <strong className="text-amber-300 font-mono">{unverifiedCount}</strong> | مدقق ✓:{' '}
                        <strong className="text-emerald-300 font-mono">{verifiedCount}</strong> | غير موجود ×:{' '}
                        <strong className="text-red-300 font-mono">{missingCount}</strong> | ملاحظات (F / -):{' '}
                        <strong className="text-amber-300 font-mono">{remarksCount}</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-neutral-300 flex items-center gap-1">
                        <span>السطور المتوقعة بالورقة:</span>
                        <input
                          type="number"
                          min="1"
                          className="w-14 bg-stone-800 border border-stone-600 rounded px-1.5 py-0.5 font-mono text-amber-300 text-center"
                          value={sheet.expectedRowCount ?? sheet.lines.length}
                          onChange={(e) =>
                            patch(sheet.key, {
                              expectedRowCount: Math.max(1, Number(e.target.value) || sheet.lines.length),
                            })
                          }
                        />
                      </label>
                      <span className="text-[11px] text-neutral-300">
                        تمت المراجعة:{' '}
                        <strong className="text-emerald-400">
                          {sheet.lines.filter((l) => l.reviewed).length} / {sheet.lines.length}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* تحذير فوري عند وجود أي نقص في عدد السطور أو الحقول أو الكميات */}
                  {hasShortageAlert && (
                    <div
                      role="alert"
                      className="p-3 rounded-xl bg-red-950/85 border-2 border-red-500 text-red-100 text-xs space-y-1.5 shadow-lg"
                    >
                      <div className="flex items-center gap-2 font-black text-red-200 text-sm">
                        <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                        <span>
                          ⚠️ تحذير: هناك نقص في الورقة يجب الانتباه له قبل الحفظ!
                        </span>
                      </div>
                      {completeness.missingFromOcrCount > 0 && (
                        <p className="font-bold text-red-200">
                          • نقص في عدد السطور المقروءة: المتوقع ({completeness.expectedRowCount}) سطر، المستخرج ({completeness.extractedRowCount}) سطر — ينقص ({completeness.missingFromOcrCount}) سطر!
                        </p>
                      )}
                      {completeness.incompleteLines.length > 0 && (
                        <p className="font-bold text-red-200">
                          • سطور بها بيانات ناقصة ({completeness.incompleteLines.length} سطر):{' '}
                          {completeness.incompleteLines
                            .map((r) => `السطر #${r.lineNumber} (${r.issues.join('، ')})`)
                            .join(' | ')}
                        </p>
                      )}
                      {completeness.missingMarkLines.length > 0 && (
                        <p className="font-bold text-red-200">
                          • سطور معلمة بعلامة خطأ × غير موجودة ({completeness.missingMarkLines.length} سطر):{' '}
                          {completeness.missingMarkLines
                            .map(
                              (r) =>
                                `السطر #${r.lineNumber} [${r.part_number}]: علامة × غير موجودة (يبقى 0 من ${r.qtyTotal})`
                            )
                            .join(' | ')}
                        </p>
                      )}
                      {completeness.shortageLines.length > 0 && (
                        <p className="font-bold text-amber-200">
                          • سطور مسجل عليها نقص بالكمية ({completeness.shortageLines.length} سطر):{' '}
                          {completeness.shortageLines
                            .map(
                              (r) =>
                                `السطر #${r.lineNumber} [${r.part_number}]: العدد ${r.qtyTotal} ناقص -${r.shortage} = يبقى ${r.qtyRemaining}`
                            )
                            .join(' | ')}
                        </p>
                      )}
                    </div>
                  )}

                  {/* تنبيه واضح لدمج السطور المتكررة لنفس رقم القطعة بجمع كمياتها */}
                  {completeness.duplicateGroups.length > 0 && (
                    <div className="p-2.5 rounded-xl bg-amber-950/70 border border-amber-500/70 text-amber-100 text-xs space-y-1">
                      <p className="font-black text-amber-300">
                        🔗 دمج السطور المتكررة لنفس رقم القطعة بجمع كمياتها في سجل واحد ({completeness.duplicateGroups.length} قطع مكررة):
                      </p>
                      {completeness.duplicateGroups.map((grp) => (
                        <p key={grp.part_number} className="font-mono text-[11px] text-amber-200">
                          • القطعة {grp.part_number} ({grp.locations.join(' / ')}): السطور #{grp.lineNumbers.join(' و #')} — الكميات ({grp.quantities.join(' + ')}) = إجمالي مجموع الكمية المحفوظة: <strong>{grp.totalQuantity}</strong>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <SheetImage image={sheet.original} />

              <div className="flex flex-wrap items-center justify-between gap-2 my-2 bg-stone-900/90 p-2.5 rounded-lg border border-stone-700">
                <label className="text-xs font-bold flex items-center gap-2">
                  رقم مستند الورقة{' '}
                  <input
                    required
                    className="bg-stone-800 p-1.5 rounded border border-stone-600 text-amber-200 font-mono"
                    value={sheet.id}
                    placeholder="أدخل رقم الورقة الصحيح لمنع تكرار اعتمادها"
                    onChange={(e) => patch(sheet.key, { id: e.target.value })}
                  />
                </label>

                {sheet.lines.length > 0 && (
                  <button
                    type="button"
                    onClick={() => markAllSheetLinesReviewed(sheet.key, true)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>تأكيد مراجعة جميع سطور هذه الورقة ({sheet.lines.length}) ✓</span>
                  </button>
                )}
              </div>

              {sheet.message && <p className="text-red-300 text-xs font-bold">{sheet.message}</p>}

            <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
              {sheet.lines.map((line, index) => (
                <div
                  key={index}
                  className="border-b border-stone-700 py-3 space-y-2 text-xs bg-stone-900/40 px-2.5 rounded"
                >
                  {line.part_number &&
                    sheet.lines.filter(
                      (candidate) => candidate.part_number.trim() === line.part_number.trim()
                    ).length > 1 && (
                      <p role="alert" className="text-red-300 font-bold">
                        رقم مكرر داخل الورقة: راجع الكميات واطلب اعتماد جمعها أدناه؛ لا يتم الجمع تلقائيًا.
                      </p>
                    )}

                  <div className="flex flex-wrap items-center gap-2">
                    <label>
                      رقم القطعة{' '}
                      <input
                        required
                        pattern="[0-9]{10}"
                        className="bg-stone-800 p-1 rounded font-mono text-amber-300"
                        value={line.part_number}
                        onChange={(e) =>
                          patchLine(sheet.key, index, {
                            part_number: e.target.value,
                            reviewed: false,
                          })
                        }
                      />
                    </label>
                    <label>
                      الكمية{' '}
                      <input
                        required
                        type="number"
                        min="0"
                        step="1"
                        className="bg-stone-800 p-1 w-20 rounded font-mono"
                        value={Number.isFinite(line.quantity) ? line.quantity : ''}
                        onChange={(e) =>
                          patchLine(sheet.key, index, {
                            quantity: e.target.value === '' ? Number.NaN : Number(e.target.value),
                            reviewed: false,
                          })
                        }
                      />
                    </label>
                    <label>
                      الموقع{' '}
                      <input
                        required
                        className="bg-stone-800 p-1 w-24 rounded font-mono text-emerald-300"
                        value={line.location}
                        onChange={(e) =>
                          patchLine(sheet.key, index, {
                            location: e.target.value,
                            reviewed: false,
                          })
                        }
                      />
                    </label>
                    <label>
                      العلامة{' '}
                      <select
                        className="bg-stone-800 p-1 rounded"
                        value={line.check}
                        onChange={(e) =>
                          patchLine(sheet.key, index, {
                            check: e.target.value,
                            reviewed: false,
                          })
                        }
                      >
                        <option value="">غير مدققة</option>
                        <option>✓</option>
                        <option>X</option>
                      </select>
                    </label>
                    <label>
                      الملاحظة / الناقص (-){' '}
                      <input
                        placeholder="مثل -3 أو -4"
                        className="bg-stone-800 p-1 w-24 rounded font-mono"
                        value={line.remark}
                        onChange={(e) =>
                          patchLine(sheet.key, index, {
                            remark: e.target.value,
                            reviewed: false,
                          })
                        }
                      />
                    </label>
                  </div>

                  {/* ملخص فوري لتدقيق علامة السطر: صح ✓ | خطأ × | ناقص -N */}
                  {(() => {
                    const marks = interpretMark(line.check, line.remark);
                    const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
                    if (marks.status === 'غير موجودة') {
                      return (
                        <div className="p-2 rounded-lg bg-red-950/70 border border-red-500/70 text-red-200 font-bold flex items-center justify-between gap-2">
                          <span>
                            × علامة خطأ (غير موجودة): توضع علامة خطأ على القطعة حتى يغيرها المشرف
                          </span>
                          <span className="font-mono text-red-300">يبقى في المخزون: 0</span>
                        </div>
                      );
                    }
                    if (marks.shortage > 0) {
                      const rem = Math.max(0, qty - marks.shortage);
                      return (
                        <div className="p-2 rounded-lg bg-amber-950/80 border border-amber-500/70 text-amber-200 font-bold flex items-center justify-between gap-2">
                          <span>
                            ➖ علامة ناقص (-{marks.shortage}): إنقاص العدد ({qty} - {marks.shortage})
                          </span>
                          <span className="font-mono text-emerald-300">
                            يبقى في المخزون: {rem}
                          </span>
                        </div>
                      );
                    }
                    if (marks.status === 'مدقق') {
                      return (
                        <div className="p-1.5 px-2.5 rounded-lg bg-emerald-950/50 border border-emerald-700/50 text-emerald-300 font-bold flex items-center justify-between gap-2">
                          <span>✓ علامة صح: القطعة موجودة والعدد صحيح</span>
                          <span className="font-mono">يبقى في المخزون: {qty}</span>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {dbService.getItemByPartNumber(line.part_number) && (
                    <p className="text-amber-200">
                      قطعة موجودة — الرصيد الحالي:{' '}
                      {dbService.getItemByPartNumber(line.part_number)!.qty_remaining}. لن يُنشأ سجل مكرر.
                    </p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      الترجمة العربية{' '}
                      <input
                        className="bg-stone-800 p-1 rounded"
                        value={line.description_ar}
                        onChange={(e) =>
                          patchLine(sheet.key, index, {
                            description_ar: e.target.value,
                            reviewed: false,
                          })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      الاسم الأصلي{' '}
                      <input
                        required
                        dir="ltr"
                        className="bg-stone-800 p-1 rounded font-mono"
                        value={line.description_en}
                        onChange={(e) =>
                          patchLine(sheet.key, index, {
                            description_en: e.target.value,
                            reviewed: false,
                          })
                        }
                      />
                    </label>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-1.5 cursor-pointer font-bold text-emerald-300">
                      <input
                        type="checkbox"
                        checked={line.reviewed}
                        onChange={(e) =>
                          patchLine(sheet.key, index, { reviewed: e.target.checked })
                        }
                      />
                      راجعت هذا السطر مقابل الصورة
                    </label>
                    <button
                      type="button"
                      className="px-2 py-1 rounded bg-red-950/60 text-red-300 hover:bg-red-900"
                      onClick={() =>
                        patch(sheet.key, {
                          lines: sheet.lines.filter((_, i) => i !== index),
                        })
                      }
                    >
                      إزالة سطر من المسودة
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {sheet.lines.some(
              (line, index) =>
                line.part_number &&
                sheet.lines.findIndex((candidate) => candidate.part_number === line.part_number) !==
                  index
            ) && (
              <label className="block text-amber-200 text-xs mt-2">
                <input
                  type="checkbox"
                  checked={!!sheet.sumDuplicates}
                  onChange={(e) => patch(sheet.key, { sumDuplicates: e.target.checked })}
                />{' '}
                طلب اعتماد جمع السطور المكررة؛ يضاف المجموع إلى الرصيد الموجود بعد اعتماد المشرف. تبقى السطور الأصلية.
              </label>
            )}

            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                className="px-3 py-1.5 rounded bg-stone-800 hover:bg-stone-700 text-xs font-bold"
                onClick={() =>
                  patch(sheet.key, {
                    state: 'review',
                    lines: [...sheet.lines, blank()],
                  })
                }
              >
                إضافة سطر يدوي لهذه الورقة
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded bg-red-950/60 hover:bg-red-900 text-red-200 text-xs font-bold"
                onClick={() =>
                  setSheets((current) =>
                    current.filter((candidate) => candidate.key !== sheet.key)
                  )
                }
              >
                إزالة الورقة من المسودة
              </button>
            </div>
          </fieldset>
          );
        })}

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={busy || !sheets.length}
            onClick={async () => {
              prepareAudio();
              setBusy(true);
              try {
                if (!sheets.length || sheets.some((sheet) => sheet.state !== 'review')) {
                  throw new Error('راجع كل الأوراق، بما فيها الأوراق التي تعذرت قراءتها');
                }
                const batchId = 'BATCH-' + crypto.randomUUID();
                const preparedDocs: StockDocument[] = sheets.map((sheet, idx) => ({
                  id:
                    sheet.id.trim() ||
                    `SHEET-${Date.now().toString().slice(-5)}-${idx + 1}`,
                  duplicateResolution:
                    sheet.sumDuplicates || hasDuplicatePartNumbers(sheet.lines)
                      ? 'sum'
                      : undefined,
                  batchId,
                  kind,
                  requester: requester || 'المستخدم المحلي',
                  reason: 'حفظ واعتماد كامل سطور الورقة في المخزون',
                  lines: sheet.lines.map((l) => ({ ...l, reviewed: true })),
                  original: sheet.original,
                  status: 'pending',
                  createdAt: '',
                }));
                await dbService.submitDocuments(preparedDocs);
                await dbService.approveDocuments(preparedDocs.map((d) => d.id));
                await refresh();
                onChanged();
                const totalRowsSaved = preparedDocs.reduce((acc, d) => acc + d.lines.length, 0);
                setMessage(
                  `تم حفظ واعتماد جميع السطور (${totalRowsSaved} سطراً من ${preparedDocs.length} ورقة) في المخزون بنجاح؛ جميع القطع بحالة غير مدققة حتى تضغط على أيقونة التدقيق.`
                );
                setSheets([]);
              } catch (err) {
                setMessage((err as Error).message);
                if ((err as Error).message.includes('تم حفظها مسبقًا')) {
                  playOperationSound('duplicate');
                }
              } finally {
                setBusy(false);
              }
            }}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-black px-5 py-2.5 rounded-xl w-full sm:w-auto cursor-pointer shadow-lg"
          >
            حفظ واعتماد جميع السطور في المخزون فوراً ({totalExtractedLines} سطر) ✓
          </button>

          <button
            disabled={busy || !sheets.length}
            className="bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white font-bold px-4 py-2.5 rounded-xl w-full sm:w-auto cursor-pointer"
          >
            حفظ جميع أوراق الدفعة للمراجعة
          </button>
        </div>
      </form>

      <p role="status" className="text-amber-300 font-bold text-xs mt-2">
        {message}
      </p>

      {Array.from(batches, ([batchId, docs]) => {
        const pending = docs.filter((doc) => doc.status === 'pending');
        return (
          <div key={batchId} className="border-t border-stone-700 p-2 mt-2 text-xs space-y-1.5">
            <p>
              دفعة {docs[0].createdAt} — {docs.length} أوراق — معتمدة:{' '}
              {docs.length - pending.length}
            </p>
            <p className="font-mono text-amber-200">{docs.map((doc) => doc.id).join('، ')}</p>
            {!!pending.length && (
              <button
                disabled={busy}
                className="bg-emerald-800 hover:bg-emerald-700 text-white font-bold p-2 rounded-lg cursor-pointer"
                onClick={async () => {
                  prepareAudio();
                  setBusy(true);
                  try {
                    await dbService.approveDocuments(pending.map((doc) => doc.id));
                    await refresh();
                    onChanged();
                    if (pending.some((doc) => doc.kind === 'issue')) {
                      playOperationSound('issued');
                    }
                    setMessage('تم اعتماد الدفعة وتنفيذها بالكامل');
                  } catch (err) {
                    setMessage(
                      (err as Error).message + ' — لم تُنفذ أي ورقة من طلب الاعتماد الحالي'
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                اعتماد جميع الأوراق المتبقية وتنفيذها
              </button>
            )}
          </div>
        );
      })}
    </details>
  );
}
