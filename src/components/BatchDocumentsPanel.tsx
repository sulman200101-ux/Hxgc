import { ImageSourcePicker } from './ImageSourcePicker';
import React, { useEffect, useState, useRef } from 'react';
import { dbService } from '../services/db';
import { interpretMark, auditSheetCompleteness, type DocumentLine, type StockDocument } from '../services/documents';
import { processOcrFromImage } from '../services/localOcr';
import { readImageBatch } from '../services/batchOcr';
import { prepareAudio, playOperationSound } from '../utils/operationSounds';
import { CheckSquare, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

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
    initialImages.map((original, idx) => ({
      key: crypto.randomUUID(),
      id: `SHEET-${Date.now().toString().slice(-5)}-${idx + 1}`,
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
    const newlyReadSheets: StockDocument[] = [];
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
          setMessage('');
        },
        (result) => {
          if (result.state === 'error') {
            patch(result.key, { state: 'error', message: result.message });
            return;
          }
          const mappedLines: DocumentLine[] = result.rows.map((row) => {
            const marks = interpretMark('', row.remark || '');
            return {
              part_number: row.part_number,
              quantity: row.qty_total > 0 ? row.qty_total : 1,
              location: row.location_code || 'N01A1',
              description_en: row.description_en || 'SPARE PART ASMO',
              description_ar: row.description_ar || '',
              check: row.is_missing === 1 ? 'X' : '',
              remark: marks.shortage > 0 ? `-${marks.shortage}` : row.remark || '',
              reviewed: true,
            };
          });
          const sheetId =
            (targetSheets || sheets).find((s) => s.key === result.key)?.id.trim() ||
            `SHEET-${Date.now().toString().slice(-5)}-${Math.floor(Math.random() * 90 + 10)}`;
          patch(result.key, {
            state: 'review',
            id: sheetId,
            expectedRowCount: mappedLines.length,
            sumDuplicates: hasDuplicatePartNumbers(mappedLines) ? true : undefined,
            lines: mappedLines,
          });
          newlyReadSheets.push({
            id: `${sheetId}-${Date.now().toString().slice(-4)}`,
            duplicateResolution: hasDuplicatePartNumbers(mappedLines) ? 'sum' : undefined,
            batchId: 'AUTO-' + crypto.randomUUID(),
            kind,
            requester: requester || 'المستخدم المحلي',
            reason: 'حفظ تلقائي فوري بعد انتهاء القراءة',
            lines: mappedLines,
            original: (targetSheets || sheets).find((s) => s.key === result.key)?.original,
            status: 'pending',
            createdAt: '',
          });
        }
      );

      if (newlyReadSheets.length > 0) {
        await dbService.submitDocuments(newlyReadSheets);
        await dbService.approveDocuments(newlyReadSheets.map((d) => d.id));
        await refresh();
        onChanged();
        const totalAutoSaved = newlyReadSheets.reduce((acc, d) => acc + d.lines.length, 0);
        playOperationSound('issued');
        setMessage(
          `✅ اكتملت القراءة وتم حفظ واعتماد جميع السطور تلقائياً في المخزون (${totalAutoSaved} سطراً من ${newlyReadSheets.length} ورقة). يمكنك أيضاً تعديل أي سطر أدناه وإعادة الحفظ فوراً.`
        );
      } else {
        playOperationSound('uncertain');
        setMessage('اكتملت قراءة الأوراق. راجع النتائج أدناه.');
      }
    } catch (err) {
      setMessage(String(err));
      playOperationSound('uncertain');
    } finally {
      setReadingProgress((prev) => ({ ...prev, active: false }));
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
  const reviewedSheets = sheets.filter((s) => s.state === 'review');
  const errorSheets = sheets.filter((s) => s.state === 'error');
  const hasWaitingOrError = sheets.some((s) => s.state === 'waiting' || s.state === 'error');

  return (
    <details
      open={defaultOpen || undefined}
      className="border border-amber-600/80 rounded-xl p-3 bg-[#1E1410]/90"
      dir="rtl"
    >
      <summary className="font-bold cursor-pointer text-amber-300 text-sm">
        قراءة وحفظ عدة أوراق دفعة واحدة
      </summary>

      {/* شريط حالة القراءة الحية المبسط والواضح */}
      {readingProgress.active && (
        <div
          role="region"
          aria-label="مؤشر قراءة الورقة المباشر"
          className="mt-3 mb-3 p-3.5 rounded-2xl bg-amber-950/90 border-2 border-amber-400 shadow-lg space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-5 h-5 text-amber-300 animate-spin shrink-0" />
              <div>
                <p className="text-xs sm:text-sm font-extrabold text-white">
                  جارٍ قراءة الورقة {readingProgress.sheetIndex} من {readingProgress.totalSheets}:{' '}
                  <span className="text-amber-300 font-mono text-xs">
                    {readingProgress.sheetName}
                  </span>
                </p>
                <p className="text-[11px] text-amber-200 font-bold mt-0.5">
                  {readingProgress.stage || 'يتم استخراج أرقام القطع والمواقع والكميات بدقة...'}
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-xl bg-amber-500 text-stone-950 font-extrabold font-mono text-xs">
              {readingProgress.percent}%
            </span>
          </div>
          <div className="w-full h-2.5 bg-stone-900 rounded-full overflow-hidden border border-amber-500/40">
            <div
              className="h-full bg-gradient-to-l from-emerald-400 via-amber-400 to-amber-600 transition-all duration-200"
              style={{ width: `${Math.max(10, readingProgress.percent)}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-3 mt-2">
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
                ...files.map((original, idx) => ({
                  key: crypto.randomUUID(),
                  id: `SHEET-${Date.now().toString().slice(-5)}-${current.length + idx + 1}`,
                  original,
                  lines: [],
                  state: 'waiting' as const,
                  message: '',
                })),
              ])
            }
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 bg-stone-900/80 p-2.5 rounded-xl border border-stone-700 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              الأوراق: <strong className="text-white">{sheets.length}</strong>
            </span>
            <span>
              تمت قراءتها:{' '}
              <strong className="text-emerald-400">{reviewedSheets.length}</strong>
            </span>
            <span>
              إجمالي الأصناف المستخرجة:{' '}
              <strong className="text-amber-300 font-mono">{totalExtractedLines}</strong>
            </span>
            {errorSheets.length > 0 && (
              <span>
                أخطاء: <strong className="text-red-400">{errorSheets.length}</strong>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {reviewedSheets.filter((s) => s.lines.length > 0).length > 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={markAllSheetsReviewed}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold rounded-lg cursor-pointer flex items-center gap-1"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>تأكيد مراجعة الكل ({totalExtractedLines} سطر) ✓</span>
              </button>
            )}
            {hasWaitingOrError && !readingProgress.active && (
              <button
                type="button"
                className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white font-bold rounded-lg cursor-pointer"
                disabled={busy}
                onClick={() => readPending()}
              >
                قراءة الأوراق المنتظرة
              </button>
            )}
          </div>
        </div>

        {/* عرض رسائل الخطأ للأوراق التي تعذرت قراءتها فقط دون إظهار صناديق الأوراق المنتظرة */}
        {errorSheets.map((sheet) => (
          <div
            key={sheet.key}
            className="p-2.5 rounded-xl bg-red-950/70 border border-red-600/70 flex items-center justify-between gap-2 text-xs text-red-200"
          >
            <span>
              ⚠️ {sheet.original.name}: {sheet.message || 'تعذرت قراءة الورقة'}
            </span>
            <button
              type="button"
              onClick={() =>
                setSheets((current) => current.filter((candidate) => candidate.key !== sheet.key))
              }
              className="px-2.5 py-1 rounded bg-red-900 hover:bg-red-800 text-white font-bold cursor-pointer shrink-0"
            >
              إزالة
            </button>
          </div>
        ))}

        {/* عرض الأوراق التي تمت قراءتها فقط بشكل مختصر ونظيف */}
        {reviewedSheets.map((sheet, sheetIndex) => {
          const verifiedCount = sheet.lines.filter((l) => l.check === '✓').length;
          const unverifiedCount = sheet.lines.filter((l) => l.check === '').length;
          const missingCount = sheet.lines.filter((l) => l.check === 'X').length;
          const completeness = auditSheetCompleteness(sheet.lines, {
            expectedRows: sheet.expectedRowCount ?? sheet.lines.length,
          });
          const hasShortageAlert =
            completeness.missingFromOcrCount > 0 ||
            completeness.incompleteLines.length > 0 ||
            completeness.shortageLines.length > 0 ||
            completeness.missingMarkLines.length > 0;

          return (
            <div
              key={sheet.key}
              className="border border-stone-700 rounded-xl p-2.5 bg-[#160F0C] space-y-2"
              data-sheet-index={sheetIndex}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-amber-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    {sheet.original.name} ({completeness.extractedRowCount} سطر | صافي:{' '}
                    {completeness.netUniquePartsCount} | مدقق ✓: {verifiedCount} | غير مدقق:{' '}
                    {unverifiedCount} | غير موجود ×: {missingCount})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSheets((current) =>
                      current.filter((candidate) => candidate.key !== sheet.key)
                    )
                  }
                  className="text-[11px] text-red-400 hover:text-red-300 font-bold cursor-pointer"
                >
                  حذف الورقة
                </button>
              </div>

              {hasShortageAlert && (
                <div
                  role="alert"
                  className="p-2.5 rounded-xl bg-red-950/85 border border-red-500 text-red-100 text-xs space-y-1"
                >
                  <div className="flex items-center gap-1.5 font-bold text-red-200">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>تنبيه نقص أو ملاحظات في الورقة:</span>
                  </div>
                  {completeness.missingMarkLines.length > 0 && (
                    <p className="text-red-200">
                      • غير موجودة × ({completeness.missingMarkLines.length} سطر):{' '}
                      {completeness.missingMarkLines.map((r) => r.part_number).join('، ')}
                    </p>
                  )}
                  {completeness.shortageLines.length > 0 && (
                    <p className="text-amber-200">
                      • نقص بالكمية ({completeness.shortageLines.length} سطر):{' '}
                      {completeness.shortageLines
                        .map((r) => `${r.part_number} (-${r.shortage})`)
                        .join('، ')}
                    </p>
                  )}
                </div>
              )}

              <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                {sheet.lines.map((line, index) => {
                  const isRepairedRow = Boolean(line.description_ar?.startsWith('⚠️'));
                  return (
                  <div
                    key={index}
                    className={`border py-1.5 px-2 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs ${
                      isRepairedRow
                        ? 'border-amber-500/80 bg-amber-950/40'
                        : 'border-stone-800 bg-stone-900/50'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-mono text-neutral-400 w-5 text-center">
                        {index + 1}
                      </span>
                      <input
                        required
                        pattern="[0-9]{10}"
                        className={`px-1.5 py-1 w-28 rounded font-mono ${
                          isRepairedRow
                            ? 'bg-amber-900/60 text-amber-200 border border-amber-400/60'
                            : 'bg-stone-800 text-amber-300'
                        }`}
                        value={line.part_number}
                        onChange={(e) =>
                          patchLine(sheet.key, index, {
                            part_number: e.target.value,
                          })
                        }
                        title="رقم القطعة"
                      />
                      <input
                        required
                        className="bg-stone-800 px-1.5 py-1 w-20 rounded font-mono text-emerald-300"
                        value={line.location}
                        onChange={(e) =>
                          patchLine(sheet.key, index, {
                            location: e.target.value,
                          })
                        }
                        title="الموقع"
                      />
                      <input
                        required
                        type="number"
                        min="0"
                        step="1"
                        className="bg-stone-800 px-1.5 py-1 w-16 rounded font-mono text-white"
                        value={Number.isFinite(line.quantity) ? line.quantity : ''}
                        onChange={(e) =>
                          patchLine(sheet.key, index, {
                            quantity: e.target.value === '' ? Number.NaN : Number(e.target.value),
                          })
                        }
                        title="الكمية"
                      />
                      <select
                        className="bg-stone-800 px-1.5 py-1 rounded text-xs"
                        value={line.check}
                        onChange={(e) =>
                          patchLine(sheet.key, index, {
                            check: e.target.value,
                          })
                        }
                      >
                        <option value="">غير مدققة</option>
                        <option value="✓">✓</option>
                        <option value="X">X</option>
                      </select>
                      <input
                        placeholder="ناقص -N"
                        className="bg-stone-800 px-1.5 py-1 w-16 rounded font-mono text-amber-300"
                        value={line.remark}
                        onChange={(e) =>
                          patchLine(sheet.key, index, {
                            remark: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-neutral-300">
                      <span className="truncate max-w-[180px]">{line.description_ar || line.description_en}</span>
                      <button
                        type="button"
                        className="px-1.5 py-0.5 rounded bg-red-950/60 text-red-300 hover:bg-red-900 cursor-pointer"
                        onClick={() =>
                          patch(sheet.key, {
                            lines: sheet.lines.filter((_, i) => i !== index),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {totalExtractedLines > 0 && (
          <button
            type="button"
            disabled={busy || !reviewedSheets.length}
            onClick={async () => {
              prepareAudio();
              setBusy(true);
              try {
                const batchId = 'BATCH-' + crypto.randomUUID();
                const preparedDocs: StockDocument[] = reviewedSheets.map((sheet, idx) => ({
                  id: `SHEET-${Date.now().toString().slice(-6)}-${idx + 1}`,
                  duplicateResolution:
                    sheet.sumDuplicates || hasDuplicatePartNumbers(sheet.lines)
                      ? 'sum'
                      : undefined,
                  batchId,
                  kind,
                  requester: requester || 'المستخدم المحلي',
                  reason: 'حفظ واعتماد كامل سطور الورقة في المخزون',
                  lines: sheet.lines.map((l) => ({
                    ...l,
                    quantity: Number.isFinite(l.quantity) && l.quantity >= 0 ? Math.round(l.quantity) : 1,
                    location: (l.location || 'N01A1').trim().toUpperCase() || 'N01A1',
                    description_en: (l.description_en || 'SPARE PART ASMO').trim() || 'SPARE PART ASMO',
                    reviewed: true,
                  })),
                  original: sheet.original,
                  status: 'pending',
                  createdAt: '',
                }));
                await dbService.submitDocuments(preparedDocs);
                await dbService.approveDocuments(preparedDocs.map((d) => d.id));
                await refresh();
                onChanged();
                playOperationSound('issued');
                const totalRowsSaved = preparedDocs.reduce((acc, d) => acc + d.lines.length, 0);
                setMessage(
                  `✅ تم حفظ واعتماد جميع السطور (${totalRowsSaved} سطراً من ${preparedDocs.length} ورقة) في المخزون بنجاح بدون رقم سري.`
                );
                setSheets([]);
              } catch (err) {
                setMessage((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-black px-5 py-2.5 rounded-xl w-full cursor-pointer shadow-lg text-sm"
          >
            حفظ واعتماد جميع السطور في المخزون فوراً ({totalExtractedLines} سطر) ✓
          </button>
        )}
      </div>

      {message && (
        <p role="status" className="text-amber-300 font-bold text-xs mt-2">
          {message}
        </p>
      )}

      {!compact &&
        Array.from(batches, ([batchId, docs]) => {
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
