// Run with Node 24+, Chromium, and Playwright available via PLAYWRIGHT_MODULE or npm.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../', import.meta.url);
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.end('<html><body>Safety tests</body></html>'); return; }
    if (!/^\/src\/[a-zA-Z/]+$/.test(req.url)) { res.writeHead(404).end(); return; }
    const source = await readFile(new URL('.' + req.url + '.ts', root), 'utf8');
    res.setHeader('Content-Type', 'text/javascript');
    res.end(stripTypeScriptTypes(source));
  } catch (error) { res.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const results = await page.evaluate(async () => {
    const passed = [];
    const check = (ok, label) => { if (!ok) throw new Error(label); passed.push(label); };
    const legacy = { part_number: '1000000001', location_code: 'N01B1', description_en: 'BOLT M16', description_ar: 'مسمار M16', category: 'BOLT', qty_total: 10, qty_out: 2, qty_remaining: 8, is_moved: 0, status: 'غير مدقق' };
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('ASMO_Inventory_DB', 6);
      req.onupgradeneeded = () => {
        const docs = req.result.createObjectStore('documents', { keyPath: 'id' });
        docs.createIndex('originalHash', 'originalHash', { unique: true });
        req.result.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
        const store = req.result.createObjectStore('items', { keyPath: 'part_number' });
        store.put(legacy);
        store.put({ ...legacy, part_number: 'legacy-invalid', location_code: 'عام' });
      };
      req.onsuccess = () => { req.result.close(); resolve(); }; req.onerror = () => reject(req.error);
    });
    const { dbService: db } = await import('/src/services/db');
    await db.init();
    check(db.getTotalCount() === 2, 'upgrade preserves all records and does not seed sample data');
    check(JSON.stringify(db.getItemByPartNumber(legacy.part_number)) === JSON.stringify(legacy), 'upgrade preserves quantities, descriptions and location verbatim');
    check(!!db.getItemByPartNumber('legacy-invalid'), 'legacy invalid record remains available for review');
    const snapshot = db.getAllItems(); snapshot[0].qty_total = 999;
    check(db.getItemByPartNumber(legacy.part_number).qty_total === 10, 'returned data cannot mutate cache');
    let rejected = false;
    try { await db.smartUpsertBatch([{ part_number: '1000000001', quantity: 999 }]); } catch { rejected = true; }
    check(rejected && db.getItemByPartNumber(legacy.part_number).qty_total === 10, 'uncertain OCR cannot change stock');
    const { strict10DigitRegexFilter } = await import('/src/utils/regexSanitizer');
    check(strict10DigitRegexFilter('1000000001') === '1000000001' && strict10DigitRegexFilter('100000001') === null && strict10DigitRegexFilter('11000000001') === null && strict10DigitRegexFilter('1O00000001') === null, 'only exact ten digit identifiers accepted without OCR guessing');
    const { categorizeAndTranslate } = await import('/src/utils/translator');
    const translated = categorizeAndTranslate('BOLT M16 X 70 MM SS316');
    check(translated.descAr.includes('M16') && translated.descAr.includes('70') && translated.descAr.includes('SS316') && /[\u0600-\u06ff]/.test(translated.descAr), 'technical translation retains dimensions and specifications');
    const { suggestTechnicalTranslation, preserveTechnicalSpecifications } = await import('/src/services/partTranslation');
    const suggestion = suggestTechnicalTranslation('BOLT M16 X 70 MM SS316');
    check(suggestion.original === 'BOLT M16 X 70 MM SS316' && suggestion.needsReview && suggestion.arabic.includes('M16'), 'translation suggestion preserves original name separately');
    check(preserveTechnicalSpecifications('BOLT M16 SS316', 'مسمار').includes('M16 SS316'), 'model output cannot silently drop original technical codes');
    const { pinSecurity } = await import('/src/services/security');
    await pinSecurity.setup('2468');
    check(!localStorage.getItem('asmo_pin_verifier_v1').includes('2468'), 'PIN is not stored as plaintext');
    check(await pinSecurity.verify('2468') && !await pinSecurity.verify('1357'), 'PIN accepts correct and rejects incorrect value');
    await pinSecurity.change('2468', '8642');
    check(!await pinSecurity.verify('2468') && await pinSecurity.verify('8642'), 'PIN change invalidates old PIN');
    let approve = false;
    window.addEventListener('asmo-authorize-request', () => window.dispatchEvent(new CustomEvent('asmo-authorize-result', { detail: approve })));
    rejected = false; try { await db.deleteItem(legacy.part_number); } catch { rejected = true; }
    check(rejected && !!db.getItemByPartNumber(legacy.part_number), 'rejected authorization prevents deletion');
    approve = true;
    rejected = false;
    try { await db.insertOrUpdateItem(legacy.part_number, 'N01B1', 'BOLT M16', 1, 2); } catch { rejected = true; }
    check(rejected, 'negative remaining stock rejected');
    await db.insertOrUpdateItem(legacy.part_number, 'N01B1', 'BOLT M16', 10, 10);
    check(!!db.getItemByPartNumber(legacy.part_number) && db.getItemByPartNumber(legacy.part_number).qty_remaining === 0, 'zero stock record preserved');
    let backup = JSON.parse(await db.exportBackup());
    check(backup.audit.length === 1 && backup.audit[0].before.qty_out === 2 && backup.audit[0].after.qty_out === 10, 'committed change has durable before and after audit');
    await db.wipeAllData();
    backup = JSON.parse(await db.exportBackup());
    check(backup.items.length === 0 && backup.audit.length === 2 && backup.audit[1].before.length === 2, 'wipe preserves audit and recoverable before images');
    const restore = JSON.stringify({ format: 'asmo-backup-v1', items: [legacy] });
    await db.restoreBackup(restore);
    check(db.getTotalCount() === 1 && db.getItemByPartNumber(legacy.part_number).qty_remaining === 8, 'valid backup restores original inventory');
    rejected = false;
    try { await db.restoreBackup(JSON.stringify({ format: 'asmo-backup-v1', items: [legacy, { ...legacy, qty_out: 100 }] })); } catch { rejected = true; }
    check(rejected && db.getTotalCount() === 1, 'invalid backup rejected before writes');
    const { interpretMark } = await import('/src/services/documents');
    check(interpretMark('', '').status === 'غير مدقق' && interpretMark('✓', '').status === 'مدقق' && interpretMark('X', '').status === 'غير موجودة', 'blank, check and cross have distinct meanings');
    check(interpretMark('', '-4').shortage === 4 && interpretMark('', 'F4').excludedIncrease, 'shortages and excluded F increases parsed separately');
    const line = { part_number: legacy.part_number, quantity: 3, location: 'N01B1', description_en: 'BOLT M16', description_ar: 'مسمار M16', check: '', remark: '', reviewed: true };
    const doc = { id: 'ISSUE-1', kind: 'issue', requester: 'tester', reason: '', lines: [line], status: 'pending', createdAt: '' };
    const original = new Blob(['original'], { type: 'image/png' });
    await db.submitDocument({ ...doc, original });
    const changedLine = { ...line, part_number: '1000000099', location: ' n01b1 ' };
    await db.submitDocument({ ...doc, kind: 'receipt', id: 'CHANGED-PART', lines: [changedLine], original });
    check((await db.getDocuments()).length === 2, 'same image with a changed part number is accepted after v6 migration');
    check((await db.getDocuments()).find(d => d.id === 'CHANGED-PART').lines[0].location === 'N01B1', 'new document location is normalized');
    check(db.getItemByPartNumber(legacy.part_number).qty_remaining === 8, 'document submission does not change stock');
    await db.approveDocument(doc.id);
    check(db.getItemByPartNumber(legacy.part_number).qty_remaining === 5, 'issue deducts only approved quantity');
    rejected = false; try { await db.approveDocument(doc.id); } catch { rejected = true; }
    check(rejected && db.getItemByPartNumber(legacy.part_number).qty_remaining === 5, 'approved document cannot be applied twice');
    rejected = false; try { await db.submitDocument(doc); } catch { rejected = true; }
    check(rejected, 'duplicate document ID rejected');
    await db.submitDocument({ ...doc, id: 'OVERDRAW', lines: [{ ...line, quantity: 6 }] });
    rejected = false; try { await db.approveDocument('OVERDRAW'); } catch { rejected = true; }
    check(rejected && db.getItemByPartNumber(legacy.part_number).qty_remaining === 5 && (await db.getDocuments()).find(d => d.id === 'OVERDRAW').status === 'pending', 'overdraw atomically rolls back approval and stock');
    await db.submitDocument({ ...doc, id: 'MOVE-1', kind: 'transfer', reason: 'grouping', lines: [{ ...line, quantity: 5, location: 'N02A1' }] });
    check(db.getItemByPartNumber(legacy.part_number).location_code === 'N01B1', 'pending transfer cannot change actual location');
    await db.approveDocument('MOVE-1');
    check(db.getItemByPartNumber(legacy.part_number).location_code === 'N02A1', 'supervisor approval executes transfer');
    await db.submitDocument({ ...doc, id: 'RECEIPT-1', kind: 'receipt', lines: [{ ...line, quantity: 2, location: 'N02A1' }] });
    await db.approveDocument('RECEIPT-1');
    check(db.getItemByPartNumber(legacy.part_number).qty_remaining === 7, 'receipt adds only received quantity');
    await db.submitDocument({ ...doc, id: 'COUNT-SHORT', kind: 'inventory', lines: [{ ...line, quantity: 7, location: 'N02A1', remark: '- 1' }] });
    await db.approveDocument('COUNT-SHORT');
    check(db.getItemByPartNumber(legacy.part_number).qty_remaining === 6, 'approved spaced -1 shortage decrements stock by one');
    rejected = false; try { await db.approveDocument('COUNT-SHORT'); } catch { rejected = true; }
    check(rejected && db.getItemByPartNumber(legacy.part_number).qty_remaining === 6, 'shortage cannot be deducted twice');
    await db.submitDocument({ ...doc, id: 'COUNT-F', kind: 'inventory', lines: [{ ...line, quantity: 999, location: 'N02A1', remark: 'F4' }] });
    await db.approveDocument('COUNT-F');
    check(db.getItemByPartNumber(legacy.part_number).qty_remaining === 6, 'F4 is excluded from stock updates');
    await db.submitDocument({ ...doc, id: 'COUNT-OVER', kind: 'inventory', lines: [{ ...line, location: 'N02A1', remark: '-7' }] });
    rejected = false; try { await db.approveDocument('COUNT-OVER'); } catch { rejected = true; }
    check(rejected && db.getItemByPartNumber(legacy.part_number).qty_remaining === 6, 'shortage greater than available stock rejected');
    await db.approveDocument('CHANGED-PART');
    check(db.getAllItems().filter(item => item.part_number === '1000000099').length === 1, 'changed part number creates one distinct inventory record');
    await db.submitDocument({ ...doc, kind: 'receipt', id: 'EXISTING-PART', lines: [{ ...changedLine, location: ' N01B1 ' }], original });
    await db.approveDocument('EXISTING-PART');
    check(db.getAllItems().filter(item => item.part_number === '1000000099').length === 1 && db.getItemByPartNumber('1000000099').qty_remaining === 6, 'receipt updates existing part without duplicating its record');
    check(db.getLocationsSummary().filter(location => location.location_code === 'N01B1').length === 1, 'multiple parts share one location card without duplicate locations');
    rejected = false;
    try { await db.submitDocument({ ...doc, id: 'DUPLICATE-ROWS', lines: [line, line] }); } catch { rejected = true; }
    check(rejected, 'repeated part rows in the same document are rejected');
    const portable = JSON.parse(await db.exportBackup());
    check(portable.documents.find(d => d.id === 'ISSUE-1').original.bytes.length === 8, 'portable backup retains original document bytes');
    await db.restoreBackup(JSON.stringify(portable));
    rejected = false; try { await db.approveDocument(doc.id); } catch { rejected = true; }
    check(rejected, 'restoration preserves document replay protection');
    const batchPart = '1000000888';
    const batchLine = { ...line, part_number: batchPart, quantity: 4, location: 'N01B1' };
    const sheet = (id, extra = {}) => ({ ...doc, kind: 'receipt', id, batchId: 'BATCH-TEST', lines: [batchLine], original, ...extra });
    const countBeforeBatch = (await db.getDocuments()).length;
    rejected = false;
    try { await db.submitDocuments([sheet('NEW-DRAFT'), sheet(doc.id)]); } catch { rejected = true; }
    check(rejected && (await db.getDocuments()).length === countBeforeBatch, 'duplicate document rejects entire batch save without partial drafts');
    await db.submitDocuments([sheet('BATCH-1'), sheet('BATCH-2', { lines: [{ ...batchLine, quantity: 6 }] })]);
    check(!db.getItemByPartNumber(batchPart), 'saving a batch retains originals but does not change stock');
    await db.approveDocuments(['BATCH-1', 'BATCH-2']);
    check(db.getItemByPartNumber(batchPart).qty_remaining === 10 && db.getAllItems().filter(item => item.part_number === batchPart).length === 1, 'shared part across batch sheets accumulates approved receipts without lost updates or duplicate records');
    check((await db.getDocuments()).filter(document => document.batchId === 'BATCH-TEST').every(document => document.status === 'approved' && document.original.size === original.size), 'batch preserves every original and approval');
    rejected = false; try { await db.approveDocuments(['BATCH-1', 'BATCH-2']); } catch { rejected = true; }
    check(rejected && db.getItemByPartNumber(batchPart).qty_remaining === 10, 'batch replay cannot repeat stock changes');
    await db.submitDocuments([sheet('BATCH-ISSUE-1', { kind: 'issue', lines: [{ ...batchLine, quantity: 7 }] }), sheet('BATCH-ISSUE-2', { kind: 'issue', lines: [{ ...batchLine, quantity: 7 }] })]);
    const auditBeforeFailedBatch = JSON.parse(await db.exportBackup()).audit.length;
    rejected = false;
    try { await db.approveDocuments(['BATCH-ISSUE-1', 'BATCH-ISSUE-2']); } catch { rejected = true; }
    check(rejected && db.getItemByPartNumber(batchPart).qty_remaining === 10 && (await db.getDocuments()).filter(document => document.id.startsWith('BATCH-ISSUE')).every(document => document.status === 'pending'), 'cumulative batch overdraw rolls back every stock change and approval');
    check(JSON.parse(await db.exportBackup()).audit.length === auditBeforeFailedBatch, 'failed batch leaves no misleading audit events');
    await db.submitDocument(sheet('COUNT-NEW', { kind: 'inventory', lines: [{ ...batchLine, part_number: '1000000889', quantity: 11, check: '' }] }));
    await db.approveDocument('COUNT-NEW');
    check(db.getItemByPartNumber('1000000889').qty_remaining === 11 && db.getItemByPartNumber('1000000889').status === 'غير مدقق', 'reviewed initial inventory creates new part without pretending a blank check was verified');
    await db.submitDocument(sheet('COUNT-EXISTING', { kind: 'inventory', lines: [{ ...batchLine, quantity: 999, check: '✓' }] }));
    await db.approveDocument('COUNT-EXISTING');
    check(db.getItemByPartNumber(batchPart).qty_remaining === 10 && db.getAllItems().filter(item => item.part_number === batchPart).length === 1, 'inventory rescan does not duplicate existing part or replace book quantity');
    const { readImageBatch } = await import('/src/services/batchOcr');
    const queueResults = []; const started = []; let active = 0; let peakActive = 0;
    await readImageBatch([{ key: '1', original: new Blob(['ok']) }, { key: '2', original: new Blob(['bad']) }, { key: '3', original: new Blob(['ok']) }], async image => {
      active++; peakActive = Math.max(peakActive, active);
      try { if (await image.text() === 'bad') throw new Error('blurred sheet'); return [{ part_number: batchPart }]; }
      finally { active--; }
    }, key => started.push(key), result => queueResults.push(result));
    check(started.join(',') === '1,2,3' && peakActive === 1, 'batch reader handles all images sequentially');
    check(queueResults.map(result => result.state).join(',') === 'review,error,review', 'failed OCR sheet does not discard or stop the rest of the batch');
    const repeatedPart = '1000428938';
    const repeatedRows = [3,6].map(quantity => ({ ...line, part_number: repeatedPart, location: 'N12A2', quantity }));
    await db.submitDocument({ ...doc, id: 'APPROVE-BOTH', kind: 'receipt', duplicateResolution: 'sum', lines: repeatedRows });
    check(!db.getItemByPartNumber(repeatedPart), 'duplicate quantity request does not alter stock before supervisor approval');
    approve = false;
    rejected = false; try { await db.approveDocument('APPROVE-BOTH'); } catch { rejected = true; }
    check(rejected && !db.getItemByPartNumber(repeatedPart), 'supervisor rejection prevents combining duplicate quantities');
    approve = true;
    await db.approveDocument('APPROVE-BOTH');
    check(db.getItemByPartNumber(repeatedPart).qty_remaining === 9 && db.getAllItems().filter(item => item.part_number === repeatedPart).length === 1, 'approved repeated rows sum 3 plus 6 into one inventory record');
    check((await db.getDocuments()).find(document => document.id === 'APPROVE-BOTH').lines.length === 2, 'both original rows remain stored after quantity approval');
    rejected = false; try { await db.approveDocument('APPROVE-BOTH'); } catch { rejected = true; }
    check(rejected && db.getItemByPartNumber(repeatedPart).qty_remaining === 9, 'approved duplicate receipt cannot be applied twice');
    await db.submitDocument({ ...doc, id: 'COUNT-BOTH', kind: 'inventory', duplicateResolution: 'sum', lines: repeatedRows });
    await db.approveDocument('COUNT-BOTH');
    check(db.getItemByPartNumber(repeatedPart).qty_remaining === 18 && db.getAllItems().filter(item => item.part_number === repeatedPart).length === 1, 'approved additional duplicate rows add to existing stock while retaining one part record');
    rejected = false;
    try { await db.submitDocument({ ...doc, id: 'MIXED-LOCATIONS', kind: 'inventory', duplicateResolution: 'sum', lines: [repeatedRows[0], { ...repeatedRows[1], location: 'N12A3' }] }); } catch { rejected = true; }
    check(rejected, 'combining duplicate rows across conflicting locations requires review');
    const { suggestTransfers } = await import('/src/services/transferSuggestions');
    const candidate = { ...legacy, part_number: '1000000901', description_en: 'BOLT M16', location_code: 'N01B1', qty_remaining: 8 };
    const neighbors = [{ ...candidate, part_number: '1000000902', location_code: 'N01B2' }, { ...candidate, part_number: '1000000903', location_code: 'N01B2' }];
    const proposed = suggestTransfers([candidate, ...neighbors, { ...candidate, part_number: '1000000904', location_code: 'N02B1' }, { ...candidate, part_number: '1000000905', description_en: 'NUT M16', location_code: 'N01B3' }]);
    check(proposed.length === 1 && proposed[0].partNumber === candidate.part_number && proposed[0].to === 'N01B2', 'suggestions group a technical family inside the same coded zone without merging distinct parts');
    check(suggestTransfers([candidate,...neighbors], new Set([candidate.part_number])).length === 0, 'pending transfer requests suppress repeated suggestions');
    check(suggestTransfers([{...candidate,qty_remaining:0},...neighbors]).length === 0 && suggestTransfers([{...candidate,is_missing:1},...neighbors]).length === 0, 'missing and exhausted stock are excluded from transfer proposals');
    check(candidate.location_code === 'N01B1', 'generating suggestions never changes stored or source locations');
    await db.submitDocument({ ...doc, id: 'STALE-MOVE-1', kind: 'transfer', reason:'grouping', lines:[{...batchLine,quantity:10,location:'N01B2'}] });
    await db.submitDocument({ ...doc, id: 'STALE-MOVE-2', kind: 'transfer', reason:'grouping', lines:[{...batchLine,quantity:10,location:'N01B3'}] });
    await db.approveDocument('STALE-MOVE-1');
    rejected = false; try { await db.approveDocument('STALE-MOVE-2'); } catch { rejected = true; }
    check(rejected && db.getItemByPartNumber(batchPart).location_code === 'N01B2', 'a stale proposal cannot move stock again after its original location changes');
    const { canonicalDocumentId } = await import('/src/services/documents');
    check(canonicalDocumentId(' doc ١ ') === 'DOC1', 'document ID normalization prevents case, spacing and Arabic digit variants');
    const { SOUND_PATTERNS } = await import('/src/utils/operationSounds');
    check(new Set(Object.values(SOUND_PATTERNS).map(pattern => pattern.join(','))).size === 3, 'duplicate, issued and uncertain alerts have distinct tone patterns');
    const patterns = [];
    window.AudioContext = class {
      currentTime = 0; state = 'running'; destination = {};
      createOscillator() { const oscillator = { frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() { patterns.push(oscillator.frequency.value); } }; return oscillator; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    };
    const { playOperationSound } = await import('/src/utils/operationSounds');
    for (const kind of ['duplicate', 'issued', 'uncertain']) playOperationSound(kind);
    check(patterns.join(',') === Object.values(SOUND_PATTERNS).flat().join(','), 'audio playback schedules the expected oscillator tones');
    for (let i = 0; i < 5; i++) await pinSecurity.verify('0000');
    rejected = false; try { await pinSecurity.verify('8642'); } catch { rejected = true; }
    check(rejected, 'repeated PIN failures trigger temporary lockout');
    return passed;
  });
  // Isolated v7-to-v8 upgrade: enrich legacy names without modifying operational fields.
  const upgradeContext = await browser.newContext();
  const upgradePage = await upgradeContext.newPage();
  await upgradePage.goto(`http://127.0.0.1:${server.address().port}`);
  const upgradeResults = await upgradePage.evaluate(async () => {
    const passed = [];
    const check = (ok, label) => { if (!ok) throw new Error(label); passed.push(label); };
    const old = { part_number: '1000000456', location_code: 'N03A1', description_en: 'BOLT M16 SS316', description_ar: '', category: '', qty_total: 21, qty_out: 3, qty_remaining: 18, is_moved: 1, status: 'تم النقل', remark: '-1', old_location: 'N01A1', updated_at: '2025-01-01T00:00:00.000Z' };
    const custom = { ...old, part_number: '1000000457', description_ar: 'اسم عربي اختاره المستخدم', category: 'تصنيف خاص' };
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('ASMO_Inventory_DB', 7);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('items', { keyPath: 'part_number' }).put(old);
        req.transaction.objectStore('items').put(custom);
        req.result.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
        req.result.createObjectStore('documents', { keyPath: 'id' }).put({ id: 'OLD-APPROVED', status: 'approved', kind: 'issue', lines: [], requester: 'legacy', reason: '', createdAt: '2025-01-01' });
      };
      req.onsuccess = () => { req.result.close(); resolve(); }; req.onerror = () => reject(req.error);
    });
    const { dbService: db } = await import('/src/services/db');
    await db.init();
    const after = db.getItemByPartNumber(old.part_number);
    check(db.getTotalCount() === 2, 'v8 migration retains every existing part');
    check(after.description_ar.includes('مسمار') && after.description_ar.includes('M16') && after.description_ar.includes('SS316') && after.translation_review_required, 'existing untranslated stock receives technical Arabic suggestions with specifications');
    check(['part_number','location_code','description_en','qty_total','qty_out','qty_remaining','is_moved','status','remark','old_location','updated_at'].every(field => after[field] === old[field]), 'enrichment preserves stock balances, locations, status, remarks and original name');
    check(db.getItemByPartNumber(custom.part_number).description_ar === custom.description_ar && db.getItemByPartNumber(custom.part_number).category === custom.category, 'custom existing translations and categories are retained');
    check((await db.getDocuments()).find(doc => doc.id === 'OLD-APPROVED').status === 'approved', 'upgrade retains approval history and document replay protection');
    const backup = JSON.parse(await db.exportBackup());
    check(backup.audit.length === 1 && backup.audit[0].action === 'enrich-descriptions' && backup.audit[0].before.description_ar === '', 'legacy enrichment is audited with recoverable original values');
    await db.init();
    check(JSON.parse(await db.exportBackup()).audit.length === 1, 'reinitialization does not reapply migration or alter balances');
    return passed;
  });
  results.push(...upgradeResults);
  await upgradeContext.close();
  assert.ok(results.length >= 16);
  results.forEach(label => console.log('PASS', label));
  console.log(`${results.length} browser checks passed`);
} finally { await browser.close(); server.close(); }
