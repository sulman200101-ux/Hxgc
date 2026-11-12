import { ImageSourcePicker } from './ImageSourcePicker';
import React, { useEffect, useState, useRef } from 'react';
import { dbService } from '../services/db';
import { interpretMark, auditSheetCompleteness, type DocumentLine, type StockDocument } from '../services/documents';
import { processOcrFromImage } from '../services/localOcr';
import { readImageBatch } from '../services/batchOcr';
import { isConsumableDescription } from '../utils/translator';
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
    stage: string;
  }>({
    active: false,
    sheetIndex: 0,
    totalSheets: 0,
    sheetName: '',
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
          processOcrFromImage(image, (stage) => {
            setReadingProgress((prev) => ({
              ...prev,
              active: true,
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
            stage: 'جارٍ قراءة الورقة كاملة واستخراج بيانات الجدول بأعلى دقة بمساعدة جمني...',
          });
          setMessage('');
        },
        (result) => {
          if (result.state === 'error') {
            patch(result.key, { state: 'error', message: result.message });
            return;
          }
          const mappedLines: DocumentLine[] = result.rows.map((row) => {
            // لا تُعتمد إشارة (✓) أو (F) تلقائياً كـ "مدقق" أو "منقول" من قراءة الورقة إلا إذا دققها أو نقلها المستخدم بنفسه
            const sym =
              row.is_missing === 1 || row.mark_symbol === 'X'
                ? 'X'
                : row.mark_symbol === 'N' || (row.remark && /^[-N]/i.test(row.remark))
                ? 'N'
                : '';
            const marks = interpretMark(sym, row.remark || '');
            const descEn =
              row.description_en &&
              row.description_en !== 'غير محدد' &&
              row.description_en !== 'SPARE PART ASMO'
                ? row.description_en
                : '';
            const isConsumable =
              row.is_consumable === 1 || isConsumableDescription(descEn, row.category) ? 1 : 0;

            return {
              part_number: row.part_number || '',
              quantity:
                Number.isFinite(row.qty_total) && row.qty_total >= 0
                  ? row.qty_total
                  : 0,
              location: row.location_code || '',
              description_en: descEn,
              description_ar: row.description_ar || '',
              check: marks.mark_symbol || '',
              remark: marks.shortage > 0 ? `-${marks.shortage}` : '',
              mark_symbol: marks.mark_symbol,
              audit_meaning: row.audit_meaning || marks.audit_meaning,
              is_consumable: isConsumable,
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
            reason: 'حفظ تلقائي فوري بعد انتهاء القراءة (تبقى غير مدققة وغير منقولة حتى تدققها أو تنقلها بنفسك)',
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
          `✅ اكتملت القراءة وتم حفظ جميع السطور تلقائياً في المخزون (${totalAutoSaved} سطراً من ${newlyReadSheets.length} ورقة) بحالة "غير مدقق" و"لم تنتقل" حتى تدققها أو تنقلها بنفسك.`
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

      {readingProgress.active && (
        <div
          role="status"
          aria-live="polite"
          aria-label="مؤشر قراءة الورقة المباشر"
          className="mt-3 mb-3 p-4 rounded-2xl bg-amber-950/90 border-2 border-amber-400 shadow-lg flex items-center gap-3"
        >
          <Loader2 className="w-7 h-7 text-amber-300 animate-spin shrink-0" />
          <div>
            <p className="text-xs sm:text-sm font-extrabold text-white">
              جارٍ قراءة الورقة {readingProgress.sheetIndex} من {readingProgress.totalSheets}:{' '}
              <span className="text-amber-300 font-mono text-xs">
                {readingProgress.sheetName}
              </span>
            </p>
            <p className="text-[11px] text-amber-200 font-bold mt-0.5">
              {readingProgress.stage || 'يتم استخراج البيانات من الصورة الكاملة...'}
            </p>
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
            onImages={(files) => {
              const added: Sheet[] = files.map((original, idx) => ({
                key: crypto.randomUUID(),
                id: `SHEET-${Date.now().toString().slice(-5)}-${sheets.length + idx + 1}`,
                original,
                lines: [],
                state: 'waiting' as const,
                message: '',
              }));
              const nextSheets = [...sheets, ...added];
              setSheets(nextSheets);
              void readPending(nextSheets);
            }}
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

        {reviewedSheets.map((sheet, sheetIndex) => {
          const verifiedCount = sheet.lines.filter((l) => l.check === '✓').length;
          const unverifiedCount = sheet.lines.filter((l) => l.check === '').length;
          const missingCount = sheet.lines.filter((l) => l.check === 'X').length;
          const consumableCount = sheet.lines.filter(
            (l) => l.is_consumable === 1 || isConsumableDescription(l.description_en)
          ).length;
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
                <div className="flex items-center gap-1.5 font-bold text-amber-300 flex-wrap">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    {sheet.original.name} ({completeness.extractedRowCount} سطر | صافي:{' '}
                    {completeness.netUniquePartsCount} | مدقق يدوياً ✓: {verifiedCount} | غير مدقق:{' '}
                    {unverifiedCount} | غير موجود ×: {missingCount}
                    {consumableCount > 0 ? ` | 🔄 استهلاكية (A/FL): ${consumableCount}` : ''})
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
                  {completeness.incompleteLines.length > 0 && (
                    <p className="text-red-200">
                      • سطور تحتاج استكمال ({completeness.incompleteLines.length}):{' '}
                      {completeness.incompleteLines.map((r) => `${r.part_number} (${r.issues.join('، ')})`).join(' | ')}
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
                  const lineIsConsumable =
                    line.is_consumable === 1 || isConsumableDescription(line.description_en);
                  return (
                    <div
                      key={index}
                      className="border border-stone-800 py-1.5 px-2 rounded-lg bg-stone-900/50 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          placeholder="رقم القطعة"
                          pattern="[0-9]{10}"
                          className="bg-stone-800 px-1.5 py-1 w-28 rounded font-mono text-amber-300"
                          value={line.part_number}
                          onChange={(e) =>
                            patchLine(sheet.key, index, {
                              part_number: e.target.value,
                            })
                          }
                          title="رقم القطعة"
                        />
                        <input
                          placeholder="الموقع"
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
                          placeholder="الكمية"
                          type="number"
                          min="0"
                          step="1"
                          className="bg-stone-800 px-1.5 py-1 w-16 rounded font-mono text-white"
                          value={Number.isFinite(line.quantity) && line.quantity >= 0 ? line.quantity : ''}
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
                          onChange={(e) => {
                            const val = e.target.value;
                            const marks = interpretMark(val, line.remark);
                            patchLine(sheet.key, index, {
                              check: val,
                              mark_symbol: marks.mark_symbol,
                              audit_meaning: marks.audit_meaning,
                            });
                          }}
                        >
                          <option value="">غير مدقق (افتراضي)</option>
                          <option value="✓">✓ مدقق (دققته بنفسي)</option>
                          <option value="X">X (القطع غير موجودة)</option>
                          <option value="N">N (ناقص العدد)</option>
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
                        {lineIsConsumable && (
                          <span className="px-1.5 py-0.5 rounded bg-cyan-950/90 text-cyan-200 border border-cyan-500/50 font-black text-[10px]">
                            🔄 استهلاكية (⬅ A/FL)
                          </span>
                        )}
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
                const preparedDocs: StockDocument[] = reviewedSheets.map((sheet, idx) => {
                  const firstByPart = new Map<string, { location: string; check: string }>();
                  const normalizedLines = sheet.lines.map((l) => {
                    const cleanPart = (l.part_number || '').trim();
                    const safeQty = Number.isFinite(l.quantity) && l.quantity >= 0 ? Math.floor(l.quantity) : 0;
                    const safeLoc = (l.location || '').trim().toUpperCase();
                    const safeDescEn = (l.description_en || '').trim();
                    const existingFirst = cleanPart ? firstByPart.get(cleanPart) : undefined;
                    if (!existingFirst) {
                      if (cleanPart) {
                        firstByPart.set(cleanPart, { location: safeLoc, check: l.check });
                      }
                      return {
                        ...l,
                        part_number: cleanPart,
                        quantity: safeQty,
                        location: safeLoc,
                        description_en: safeDescEn,
                        reviewed: true,
                      };
                    }
                    return {
                      ...l,
                      part_number: cleanPart,
                      quantity: safeQty,
                      location: existingFirst.location || safeLoc,
                      check: existingFirst.check || l.check,
                      description_en: safeDescEn,
                      reviewed: true,
                    };
                  });
                  return {
                    id:
                      sheet.id.trim() ||
                      `SHEET-${Date.now().toString().slice(-5)}-${idx + 1}`,
                    duplicateResolution:
                      sheet.sumDuplicates || hasDuplicatePartNumbers(normalizedLines)
                        ? 'sum'
                        : undefined,
                    batchId,
                    kind,
                    requester: requester || 'المستخدم المحلي',
                    reason: 'حفظ واعتماد كامل سطور الورقة في المخزون',
                    lines: normalizedLines,
                    original: sheet.original,
                    status: 'pending',
                    createdAt: '',
                  };
                });
                await dbService.submitDocuments(preparedDocs);
                await dbService.approveDocuments(preparedDocs.map((d) => d.id));
                await refresh();
                onChanged();
                const totalRowsSaved = preparedDocs.reduce((acc, d) => acc + d.lines.length, 0);
                setMessage(
                  `تم حفظ واعتماد جميع السطور (${totalRowsSaved} سطراً من ${preparedDocs.length} ورقة) في المخزون بنجاح.`
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
