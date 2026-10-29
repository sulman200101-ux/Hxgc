import { approvalLines, canonicalDocumentId, interpretMark, validateDocument, type StockDocument } from './documents';
import { authorizeMutation } from './security';
import type { InventoryItem, LocationSummary } from '../types';
import { categorizeAndTranslate } from '../utils/translator';
import {
  sanitizeLocationCode,
  strict10DigitRegexFilter,
  dynamicLocationNormalizer,
  isValidSpecificLocation,
} from '../utils/regexSanitizer';

const DB_NAME = 'ASMO_Inventory_DB';
const DB_VERSION = 8;
const STORE_NAME = 'items';

class InventoryDatabase {
  private db: IDBDatabase | null = null;
  private itemMap: Map<string, InventoryItem> = new Map();
  private cache: InventoryItem[] = [];
  private isCacheDirty = true;
  private isInitialized = false;

  public async init(): Promise<void> {
    if (this.isInitialized && this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? request.transaction!.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: 'part_number' });
        for (const [name, key, unique] of [
          ['idx_part', 'part_number', true], ['idx_location', 'location_code', false],
          ['idx_category', 'category', false], ['idx_status', 'status', false],
        ] as const) {
          if (!store.indexNames.contains(name)) store.createIndex(name, key, { unique });
        }
        const documents = db.objectStoreNames.contains('documents') ? request.transaction!.objectStore('documents') : db.createObjectStore('documents', { keyPath: 'id' });
        // Images are evidence, not record identity. Changed part numbers must remain saveable.
        if (documents.indexNames.contains('originalHash')) documents.deleteIndex('originalHash');
        if (!db.objectStoreNames.contains('audit')) db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });

        // Enrich existing records in the upgrade transaction without changing stock or originals.
        const audit = request.transaction!.objectStore('audit');
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const before = cursor.value as InventoryItem;
          const after = { ...before };
          if (typeof before.description_en === 'string' && before.description_en.trim()) {
            const suggestion = categorizeAndTranslate(before.description_en);
            if ((!before.description_ar?.trim() || before.description_ar === before.description_en)
              && suggestion.descAr !== before.description_en) {
              after.description_ar = suggestion.descAr;
              after.translation_review_required = true;
            }
            if (!before.category?.trim() || before.category === 'عام') after.category = suggestion.category;
          }
          if (JSON.stringify(after) !== JSON.stringify(before)) {
            cursor.update(after);
            audit.add({ at: new Date().toISOString(), actor: 'system-migration-v8', action: 'enrich-descriptions', before, after });
          }
          cursor.continue();
        };

      };

      request.onsuccess = async (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        this.db.onversionchange = () => { this.db?.close(); this.db = null; this.isInitialized = false; };
        try {
          await this.loadAndCleanCache();
          this.isInitialized = true;
          resolve();
        } catch (error) { reject(error); }
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event);
        reject(request.error);
      };
    });
  }

  /**
   * تحميل البيانات في الفهرس السريع (O(1) Map) وتنظيف أي بيانات قديمة تالفة
   */
  private async loadAndCleanCache(): Promise<void> {
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    const items = await new Promise<InventoryItem[]>((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    // Enrich existing records with the latest industrial Arabic dictionary while preserving quantities and status
    const enrichedItems = items.map((item) => {
      if (typeof item.description_en === 'string' && item.description_en.trim()) {
        const suggestion = categorizeAndTranslate(item.description_en);
        const updated = { ...item };
        if (suggestion.descAr && suggestion.descAr !== item.description_en) {
          updated.description_ar = suggestion.descAr;
        }
        if (suggestion.category && (!item.category || item.category === 'عام' || item.category === 'قطع ميكانيكية متنوعة')) {
          updated.category = suggestion.category;
        }
        return updated;
      }
      return item;
    });
    this.itemMap = new Map(enrichedItems.map((item) => [item.part_number, item]));
    this.rebuildCacheArray();
  }

  private rebuildCacheArray(): void {
    this.cache = Array.from(this.itemMap.values());
    this.isCacheDirty = false;
  }

  public getAllItems(): InventoryItem[] {
    if (this.isCacheDirty) {
      this.rebuildCacheArray();
    }
    return structuredClone(this.cache);
  }

  public getTotalCount(): number {
    return this.itemMap.size;
  }

  public getLocationsSummary(): LocationSummary[] {
    const summaryMap = new Map<string, LocationSummary>();
    const items = this.getAllItems();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const loc = sanitizeLocationCode(item.location_code) || item.location_code.trim().toUpperCase();
      if (!loc || loc === 'عام') continue;

      let entry = summaryMap.get(loc);
      if (!entry) {
        entry = {
          location_code: loc,
          item_count: 0,
          total_qty: 0,
          out_qty: 0,
          remaining_qty: 0,
          unverified_count: 0,
          added_count: 0,
          moved_count: 0,
          missing_count: 0,
        };
        summaryMap.set(loc, entry);
      }

      entry.item_count += 1;
      entry.total_qty += Number(item.qty_total) || 0;
      entry.out_qty += Number(item.qty_out) || 0;
      entry.remaining_qty += Number(item.qty_remaining) || 0;

      if (item.is_missing === 1 || item.status === 'غير موجودة') {
        entry.missing_count += 1;
      } else if (item.status === 'مدقق') {
        entry.added_count += 1;
      } else {
        entry.unverified_count += 1;
      }
      if (item.status === 'منقول' || item.status === 'تم النقل' || item.is_moved === 1) {
        entry.moved_count += 1;
      }
    }

    return Array.from(summaryMap.values()).sort((a, b) =>
      a.location_code.localeCompare(b.location_code, undefined, { numeric: true, sensitivity: 'base' })
    );
  }

  public getItemByPartNumber(partNumber: string): InventoryItem | undefined {
    const clean = String(partNumber || '').trim();
    return structuredClone(this.itemMap.get(clean));
  }

  public getItemsByLocation(locationCode: string): InventoryItem[] {
    const items = this.getAllItems();
    const res: InventoryItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if ((sanitizeLocationCode(items[i].location_code) || items[i].location_code.trim().toUpperCase()) === (sanitizeLocationCode(locationCode) || locationCode.trim().toUpperCase())) {
        res.push(items[i]);
      }
    }
    return res;
  }

  public getItemsByCategory(categoryName: string): InventoryItem[] {
    const cat = categoryName.trim().toLowerCase();
    const items = this.getAllItems();
    const res: InventoryItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const itemCat = (items[i].category || '').toLowerCase();
      if (itemCat === cat || itemCat.includes(cat) || cat.includes(itemCat)) {
        res.push(items[i]);
      }
    }
    return res;
  }

  public getCategoryGroups(): Array<{
    category: string;
    count: number;
    total_qty: number;
    remaining_qty: number;
    missing_count: number;
    locations_count: number;
    locations: string[];
  }> {
    const map = new Map<
      string,
      {
        count: number;
        total_qty: number;
        remaining_qty: number;
        missing_count: number;
        locations: Set<string>;
      }
    >();

    const items = this.getAllItems();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const cat = item.category || 'قطع ميكانيكية متنوعة';
      let entry = map.get(cat);
      if (!entry) {
        entry = {
          count: 0,
          total_qty: 0,
          remaining_qty: 0,
          missing_count: 0,
          locations: new Set<string>(),
        };
        map.set(cat, entry);
      }
      entry.count += 1;
      entry.total_qty += Number(item.qty_total) || 0;
      entry.remaining_qty += Number(item.qty_remaining) || 0;
      if (item.is_missing === 1 || item.status === 'غير موجودة') {
        entry.missing_count += 1;
      }
      if (item.location_code) {
        entry.locations.add(item.location_code);
      }
    }

    return Array.from(map.entries())
      .map(([cat, data]) => ({
        category: cat,
        count: data.count,
        total_qty: data.total_qty,
        remaining_qty: data.remaining_qty,
        missing_count: data.missing_count,
        locations_count: data.locations.size,
        locations: Array.from(data.locations),
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * بحث فائق السرعة يدعم 100,000 قطعة في أجزاء من الثانية
   */
  public searchItems(
    query: string,
    categoryFilter?: string,
    statusFilter?: string,
    searchField: 'all' | 'part' | 'name' | 'location' = 'all'
  ): InventoryItem[] {
    const q = query.trim().toLowerCase();
    const items = this.getAllItems();

    if (!q && (!categoryFilter || categoryFilter === 'الكل') && (!statusFilter || statusFilter === 'الكل')) {
      return items;
    }

    if (q.length === 10 && /^\d{10}$/.test(q) && (!categoryFilter || categoryFilter === 'الكل') && (!statusFilter || statusFilter === 'الكل')) {
      const exact = this.itemMap.get(q);
      if (exact) return [exact];
    }

    const results: InventoryItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (categoryFilter && categoryFilter !== 'الكل' && item.category !== categoryFilter) {
        continue;
      }

      if (statusFilter && statusFilter !== 'الكل') {
        if (statusFilter === 'غير موجودة') {
          if (item.status !== 'غير موجودة' && item.is_missing !== 1) continue;
        } else if (statusFilter === 'تم النقل') {
          if (item.status !== 'تم النقل' && item.status !== 'منقول' && item.is_moved !== 1) continue;
        } else if (statusFilter === 'لم تنتقل') {
          if (item.is_moved === 1 || item.status === 'تم النقل' || item.status === 'منقول') continue;
        } else if (item.status !== statusFilter) {
          continue;
        }
      }

      if (!q) {
        results.push(item);
        continue;
      }

      if (searchField === 'part') {
        if (item.part_number.toLowerCase().includes(q)) results.push(item);
      } else if (searchField === 'location') {
        if (item.location_code.toLowerCase().includes(q)) results.push(item);
      } else if (searchField === 'name') {
        if (
          (item.description_ar && item.description_ar.toLowerCase().includes(q)) ||
          (item.description_en && item.description_en.toLowerCase().includes(q)) ||
          (item.category && item.category.toLowerCase().includes(q))
        ) {
          results.push(item);
        }
      } else {
        if (
          item.part_number.toLowerCase().includes(q) ||
          item.location_code.toLowerCase().includes(q) ||
          (item.description_ar && item.description_ar.toLowerCase().includes(q)) ||
          (item.description_en && item.description_en.toLowerCase().includes(q)) ||
          (item.category && item.category.toLowerCase().includes(q))
        ) {
          results.push(item);
        }
      }
    }

    return results;
  }

  public async insertOrUpdateItem(
    partNum: string,
    locCode: string,
    descEn: string,
    qty: number,
    qtyOut: number = 0,
    forcedStatus?: InventoryItem['status'],
    existingAr?: string,
    isMissingFlag?: number,
    remark?: string
  ): Promise<InventoryItem> {
    await authorizeMutation('insertOrUpdateItem');
    const cleanPart = partNum.trim();
    if (!/^\d{10}$/.test(cleanPart)) throw new Error('رقم القطعة يجب أن يكون عشرة أرقام');
    if (![qty, qtyOut].every(v => Number.isSafeInteger(v) && v >= 0) || qtyOut > qty) throw new Error('كمية غير صالحة أو رصيد سالب');
    const cleanLocation = sanitizeLocationCode(locCode);
    if (!isValidSpecificLocation(cleanLocation)) {
      throw new Error('يجب تحديد اسم الموقع الفعلي (يُمنع إدخال موقع عام)');
    }

    const existing = this.itemMap.get(cleanPart);
    if (existing && existing.location_code !== cleanLocation) throw new Error('استخدم طلب نقل مستقل لتغيير الموقع');
    const isMoved = existing && existing.location_code !== cleanLocation ? 1 : existing?.is_moved || 0;
    const isMissing =
      isMissingFlag !== undefined
        ? isMissingFlag
        : forcedStatus === 'غير موجودة'
        ? 1
        : 0;
    const remaining = isMissing ? 0 : Math.max(0, qty - qtyOut);

    const cachedAr = existingAr || existing?.description_ar;
    const { category, descAr } = categorizeAndTranslate(descEn);
    const finalDescAr = cachedAr || descAr;

    let status: InventoryItem['status'] = forcedStatus || 'غير مدقق';
    if (isMissing) {
      status = 'غير موجودة';
    } else if (isMoved && !forcedStatus) {
      status = 'تم النقل';
    } else if (!forcedStatus) {
      status = existing ? existing.status : 'غير مدقق';
    }

    const item: InventoryItem = {
      part_number: cleanPart,
      location_code: cleanLocation,
      old_location: isMoved && existing ? existing.old_location || existing.location_code : existing?.old_location,
      description_en: (descEn || existing?.description_en || 'SPARE PART ASMO').trim(),
      description_ar: finalDescAr,
      category: category,
      qty_total: qty,
      qty_out: qtyOut,
      qty_remaining: remaining,
      is_moved: isMoved,
      is_missing: isMissing,
      remark: remark ?? existing?.remark,
      status,
      updated_at: new Date().toISOString(),
    };

    await this.putInStore(item);
    this.itemMap.set(item.part_number, item);
    this.isCacheDirty = true;

    return item;
  }

  /**
   * حفظ دفعة كاملة من الورقة الممسوحة (مثل 37 صنفاً) في معاملة واحدة سريعة
   */
  public async smartUpsertBatch(items: any[]): Promise<{
    total: number;
    insertedCount: number;
    updatedCount: number;
    movedCount: number;
    missingCount: number;
  }> {
    throw new Error('حفظ OCR معطل مؤقتًا: يلزم مراجعة موثقة لكل سطر؛ لم يتغير المخزون');
  }

  public async deleteItem(partNumber: string): Promise<void> {
    await authorizeMutation('حذف قطعة');
    await this.commitChanges([], [partNumber]);
  }

  public async deleteLocation(locationCode: string): Promise<number> {
    await authorizeMutation('حذف موقع');
    const items = this.getItemsByLocation(locationCode);
    await this.commitChanges([], items.map(item => item.part_number));
    return items.length;
  }

  public async updateLocationCode(oldCode: string, newCode: string): Promise<void> {
    const items = this.getItemsByLocation(oldCode);
    if (!items.length) return;
    const id = 'MOVE-' + crypto.randomUUID();
    await this.submitDocument({ id, kind: 'transfer', requester: 'local-operator', reason: 'طلب تغيير موقع من الواجهة',
      lines: items.map(item => ({ old_location: item.location_code, part_number: item.part_number, quantity: item.qty_remaining, location: newCode,
        description_en: item.description_en, description_ar: item.description_ar, check: '', remark: '', reviewed: true })),
      status: 'pending', createdAt: '' });
    await this.approveDocument(id);
  }

  public async relocateItem(partNumber: string, newLocation: string): Promise<InventoryItem | null> {
    const item = this.getItemByPartNumber(partNumber);
    if (!item) return null;
    const cleanNewLoc = sanitizeLocationCode(newLocation) || newLocation.trim().toUpperCase();
    if (!isValidSpecificLocation(cleanNewLoc)) {
      throw new Error('يرجى إدخال اسم موقع جديد صالح ومحدد');
    }
    if (cleanNewLoc === item.location_code) {
      return item;
    }
    if (item.qty_remaining > 0 && item.is_missing !== 1) {
      const id = 'MOVE-' + crypto.randomUUID();
      await this.submitDocument({
        id,
        kind: 'transfer',
        requester: 'local-operator',
        reason: `نقل القطعة من ${item.location_code} إلى ${cleanNewLoc}`,
        lines: [
          {
            old_location: item.location_code,
            part_number: partNumber,
            quantity: item.qty_remaining,
            location: cleanNewLoc,
            description_en: item.description_en,
            description_ar: item.description_ar,
            check: '',
            remark: '',
            reviewed: true,
          },
        ],
        status: 'pending',
        createdAt: '',
      });
      await this.approveDocument(id);
    } else {
      await authorizeMutation('اعتماد نقل موقع قطعة بواسطة المشرف');
      const now = new Date().toISOString();
      const updated: InventoryItem = {
        ...item,
        old_location: item.location_code,
        location_code: cleanNewLoc,
        is_moved: 1,
        status: 'تم النقل',
        moved_at: now,
        updated_at: now,
      };
      await this.putInStore(updated);
      this.itemMap.set(partNumber, updated);
      this.isCacheDirty = true;
    }
    return this.getItemByPartNumber(partNumber) || null;
  }

  public getMovedItems(): InventoryItem[] {
    return this.getAllItems().filter(
      (i) => i.is_moved === 1 || i.status === 'تم النقل' || i.status === 'منقول'
    );
  }

  public getMissingItems(): InventoryItem[] {
    return this.getAllItems().filter(
      (i) => i.is_missing === 1 || i.status === 'غير موجودة'
    );
  }

  public async markStatus(partNumber: string, newStatus: InventoryItem['status']): Promise<void> {
    const item = this.itemMap.get(partNumber);
    if (!item) return;
    const wasMissing = item.is_missing === 1 || item.status === 'غير موجودة';
    const willBeMissing = newStatus === 'غير موجودة';
    if (wasMissing || willBeMissing) {
      await authorizeMutation('تغيير حالة توفر القطعة بواسطة المشرف');
    }
    const isMissing = willBeMissing ? 1 : 0;
    const updated: InventoryItem = {
      ...item,
      status: newStatus,
      is_missing: isMissing,
      qty_remaining: isMissing ? 0 : Math.max(0, item.qty_total - item.qty_out),
      updated_at: new Date().toISOString(),
    };
    await this.putInStore(updated);
    this.itemMap.set(partNumber, updated);
    this.isCacheDirty = true;
  }

  /**
   * استيراد دفعات ضخمة بسرعة فائقة (حتى 100,000 قطعة)
   */
  public async batchImport(items: InventoryItem[]): Promise<number> {
    await authorizeMutation('batchImport');
    if (!this.db || items.length === 0) return 0;

    await this.batchPutInStore(items);

    return items.length;
  }

  private async batchPutInStore(items: InventoryItem[]): Promise<void> {
    await this.commitChanges(items, []);
  }

  private async commitChanges(items: InventoryItem[], deletes: string[], clear = false): Promise<void> {
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME, 'audit'], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const audit = tx.objectStore('audit');
      const at = new Date().toISOString();
      const record = (key: string, after?: InventoryItem) => {
        const read = store.get(key);
        read.onsuccess = () => {
          audit.add({ at, actor: 'local-supervisor', action: after ? 'save' : 'delete', before: read.result, after });
          if (after) store.put(after); else store.delete(key);
        };
      };
      if (clear) {
        const read = store.getAll();
        read.onsuccess = () => { audit.add({ at, actor: 'local-supervisor', action: 'wipe', before: read.result }); store.clear(); };
      } else {
        items.forEach(item => record(item.part_number, item));
        deletes.forEach(key => record(key));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('أُلغيت المعاملة'));
    });
    await this.loadAndCleanCache();
  }

  public async getDocuments(): Promise<StockDocument[]> {
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('documents', 'readonly');
      const req = tx.objectStore('documents').getAll();
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error);
    });
  }

  public async submitDocument(doc: StockDocument): Promise<void> {
    await this.submitDocuments([doc]);
  }

  public async submitDocuments(input: StockDocument[]): Promise<void> {
    if (!input.length) throw new Error('لا توجد أوراق للحفظ');
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    const ids = new Set<string>();
    const documents = input.map(doc => {
      const normalized = { ...doc, id: canonicalDocumentId(doc.id), lines: doc.lines.map(line => ({ ...line,
        part_number: line.part_number.trim(), location: sanitizeLocationCode(line.location),
        old_location: this.itemMap.get(line.part_number.trim())?.location_code,
      })) };
      validateDocument(normalized);
      if (ids.has(normalized.id)) throw new Error('رقم مستند مكرر داخل الدفعة؛ لم تُحفظ أي ورقة');
      ids.add(normalized.id);
      return structuredClone({ ...normalized, status: 'pending' as const, createdAt: new Date().toISOString(), executedAt: undefined, approvedBy: undefined });
    });
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction('documents', 'readwrite');
      for (const doc of documents) tx.objectStore('documents').add(doc);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error(tx.error?.name === 'ConstraintError' ? 'تم حفظها مسبقًا؛ لم تُحفظ الدفعة ولم يتغير المخزون' : 'تعذر حفظ الدفعة؛ لم يتغير المخزون'));
    });
  }

  public async approveDocument(id: string): Promise<void> {
    await this.approveDocuments([id]);
  }

  public async approveDocuments(ids: string[]): Promise<void> {
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error('قائمة المستندات فارغة أو مكررة');
    await authorizeMutation(ids.length > 1 ? 'اعتماد دفعة أوراق كاملة بواسطة المشرف' : 'اعتماد مستند بواسطة المشرف');
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(['documents', STORE_NAME, 'audit'], 'readwrite');
      const docs = tx.objectStore('documents');
      const store = tx.objectStore(STORE_NAME);
      const audit = tx.objectStore('audit');
      let failure: Error | undefined;
      const fail = (error: unknown) => { failure = error instanceof Error ? error : new Error(String(error)); tx.abort(); };
      // Read each line after the preceding write, including shared parts across different sheets.
      const processDocument = (documentIndex: number) => {
        if (documentIndex >= ids.length) return;
        const id = ids[documentIndex];
        const req = docs.get(id);
        req.onsuccess = () => {
          try {
            const doc: StockDocument | undefined = req.result;
            if (!doc || doc.status !== 'pending') throw new Error('المستند غير متاح أو سبق اعتماده: ' + id);
            validateDocument(doc);
            const plannedLines = approvalLines(doc);
            const processLine = (lineIndex: number) => {
              if (lineIndex >= plannedLines.length) {
                const approved = { ...doc, status: 'approved', executedAt: new Date().toISOString(), approvedBy: 'local-supervisor' };
                docs.put(approved);
                audit.add({ at: approved.executedAt, actor: approved.approvedBy, action: 'approve-document', documentId: id, batchId: doc.batchId });
                processDocument(documentIndex + 1);
                return;
              }
              const line = plannedLines[lineIndex];
              const read = store.get(line.part_number);
              read.onsuccess = () => {
                try {
                  const before: InventoryItem | undefined = read.result;
                  const after = this.applyDocumentLine(doc, line, before);
                  if (after) {
                    store.put(after);
                    audit.add({ at: after.updated_at, actor: 'local-supervisor', action: doc.kind, documentId: id, batchId: doc.batchId, before, after });
                  }
                  processLine(lineIndex + 1);
                } catch (error) { fail(error); }
              };
            };
            processLine(0);
          } catch (error) { fail(error); }
        };
      };
      processDocument(0);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure || tx.error || new Error('تعذر الاعتماد؛ لم تتغير أي ورقة من الدفعة'));
    });
    await this.loadAndCleanCache();
  }

  private applyDocumentLine(doc: StockDocument, line: StockDocument['lines'][number], before?: InventoryItem): InventoryItem | undefined {
    const now = new Date().toISOString();
    const marks = interpretMark(line.check, line.remark);
    const { category, descAr } = categorizeAndTranslate(line.description_en);
    let after: InventoryItem;
    // If the item already exists in inventory, an F remark (Found extra) is excluded from replacing book stock.
    // If the item does not exist yet (!before), create it with its printed sheet quantity and preserve the F remark.
    if (doc.kind === 'inventory' && marks.excludedIncrease && before) return;
    if ((doc.kind === 'issue' || doc.kind === 'transfer') && !before) throw new Error('رقم غير موجود: ' + line.part_number);
    const fresh = (): InventoryItem => {
      if (!isValidSpecificLocation(line.location)) throw new Error('موقع غير صالح');
      return { part_number: line.part_number, location_code: line.location, description_en: line.description_en,
        description_ar: line.description_ar || descAr, category, qty_total: line.quantity, qty_out: 0,
        qty_remaining: line.quantity, is_moved: 0, is_missing: 0, status: 'غير مدقق' };
    };
    if (doc.kind === 'receipt') {
      if (!isValidSpecificLocation(line.location)) throw new Error('موقع غير صالح');
      if (before && before.location_code !== line.location) throw new Error('إضافة لموقع مختلف تستلزم طلب نقل مستقل');
      after = before ? { ...before, qty_total: before.qty_total + line.quantity, qty_remaining: before.qty_remaining + line.quantity } : fresh();
    } else if (doc.kind === 'issue') {
      if (line.quantity > before!.qty_remaining || before!.is_missing === 1) throw new Error('الكمية تتجاوز الرصيد المتاح');
      after = { ...before!, qty_out: before!.qty_out + line.quantity, qty_remaining: before!.qty_remaining - line.quantity };
    } else if (doc.kind === 'transfer') {
      if (line.old_location && line.old_location !== before!.location_code) throw new Error('تغير الموقع منذ إنشاء الطلب؛ أنشئ طلب نقل محدثًا');
      if (line.quantity !== before!.qty_remaining || !isValidSpecificLocation(line.location)) throw new Error('هذا الإصدار يدعم نقل كامل الرصيد المتاح فقط إلى موقع صالح');
      after = { ...before!, old_location: before!.location_code, location_code: line.location, is_moved: 1, status: 'تم النقل', moved_at: now };
    } else {
      let base = before || fresh();
      if (before && doc.duplicateResolution === 'sum' && doc.lines.filter(row => row.part_number === line.part_number).length > 1) {
        // Explicit supervisor-approved additional stock; retain issued history and source rows.
        base = { ...before, qty_total: before.qty_total + line.quantity, qty_remaining: before.qty_remaining + line.quantity };
      }
      if (line.location !== base.location_code) throw new Error('تغيير الموقع يستلزم طلب نقل');
      if (marks.shortage > base.qty_remaining) throw new Error('النقص يتجاوز المتاح');
      const isMissing = marks.status === 'غير موجودة' ? 1 : 0;
      const nextOut = base.qty_out + marks.shortage;
      const nextRemaining = isMissing ? 0 : base.qty_remaining - marks.shortage;
      const cleanRemark = marks.shortage > 0 ? `-${marks.shortage}` : marks.excludedIncrease ? '' : line.remark;
      // Existing book stock is never replaced by an inventory OCR quantity; increases (F / +) are permanently excluded.
      after = { ...base, status: marks.status, is_missing: isMissing, remark: cleanRemark,
        qty_out: nextOut, qty_remaining: nextRemaining };
    }
    if (![after.qty_total, after.qty_out, after.qty_remaining].every(v => Number.isSafeInteger(v) && v >= 0)
      || after.qty_remaining > after.qty_total - after.qty_out) throw new Error('كمية غير صالحة');
    after.updated_at = now;
    return after;
  }

  public getAvailableItems(): InventoryItem[] {
    return this.getAllItems().filter(item => item.qty_remaining > 0 && item.is_missing !== 1);
  }

  public async exportBackup(): Promise<string> {
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    const snapshot = await new Promise<{ items: InventoryItem[]; audit: unknown[]; documents: StockDocument[] }>((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME, 'audit', 'documents'], 'readonly');
      const items = tx.objectStore(STORE_NAME).getAll();
      const audit = tx.objectStore('audit').getAll();
      const docs = tx.objectStore('documents').getAll();
      tx.oncomplete = () => resolve({ items: items.result, audit: audit.result, documents: docs.result });
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    const documents = await Promise.all(snapshot.documents.map(async doc => ({
      ...doc, original: doc.original ? { type: doc.original.type, bytes: Array.from(new Uint8Array(await doc.original.arrayBuffer())) } : undefined,
    })));
    return JSON.stringify({ format: 'asmo-backup-v1', createdAt: new Date().toISOString(), ...snapshot, documents });
  }

  public async restoreBackup(text: string): Promise<void> {
    await authorizeMutation('استعادة نسخة احتياطية (دمج دون حذف)');
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    const data = JSON.parse(text);
    if (data.format !== 'asmo-backup-v1' || !Array.isArray(data.items)) throw new Error('نسخة غير صالحة');
    const keys = new Set<string>();
    for (const item of data.items) {
      if (!item || typeof item.part_number !== 'string' || !item.part_number.trim() || item.part_number.length > 128 || keys.has(item.part_number)
        || ![item.qty_total, item.qty_out, item.qty_remaining].every(v => Number.isSafeInteger(v) && v >= 0)
        || item.qty_out > item.qty_total || item.qty_remaining > item.qty_total - item.qty_out
        || typeof item.location_code !== 'string' || typeof item.description_en !== 'string'
        || typeof item.description_ar !== 'string' || typeof item.category !== 'string') throw new Error('سجل غير صالح في النسخة؛ لم تُطبق الاستعادة');
      keys.add(item.part_number);
    }
    const documents: StockDocument[] = await Promise.all((data.documents || []).map(async (doc: any) => {
      validateDocument(doc);
      if (!['pending', 'approved'].includes(doc.status)) throw new Error('حالة مستند غير صالحة');
      const original = doc.original ? new Blob([new Uint8Array(doc.original.bytes)], { type: doc.original.type }) : undefined;
      return { ...doc, original, originalHash: undefined };
    }));
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME, 'audit', 'documents'], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const audit = tx.objectStore('audit');
      for (const item of data.items) {
        const req = store.get(item.part_number);
        req.onsuccess = () => { audit.add({ at: new Date().toISOString(), actor: 'local-supervisor', action: 'restore', before: req.result, after: item }); store.put(item); };
      }
      // Preserve existing document IDs, especially approvals, to prevent replay after restoration.
      const docs = tx.objectStore('documents');
      for (const doc of documents) { const req = docs.get(doc.id); req.onsuccess = () => { if (!req.result) docs.add(doc); }; }
      audit.add({ at: new Date().toISOString(), actor: 'local-supervisor', action: 'restore-archive', archivedAudit: data.audit || [] });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    await this.loadAndCleanCache();
  }

  public async resetAndSeedDatabase(): Promise<void> {
    if (!this.db) return;
    await this.fullProgramWipe();
  }

  public async wipeAllData(): Promise<void> {
    await authorizeMutation('مسح المخزون مع إبقاء سجل التدقيق');
    await this.commitChanges([], [], true);
  }

  /**
   * مسح شامل لكافة بيانات البرنامج (الأصناف، المواقع، أوراق الجرد، طلبات النقل، والسجلات)
   * بعد طلب اعتماد المشرف، بحيث يعود البرنامج فارغاً بالكامل (0 قطعة و 0 مستند).
   */
  public async fullProgramWipe(): Promise<void> {
    await authorizeMutation('اعتماد المسح الشامل لكافة بيانات البرنامج والمستندات');
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME, 'documents', 'audit'], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore('documents').clear();
      tx.objectStore('audit').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('أُلغيت عملية المسح الشامل'));
    });
    this.itemMap.clear();
    this.cache = [];
    this.isCacheDirty = false;
  }

  private async putInStore(item: InventoryItem): Promise<void> {
    await this.commitChanges([item], []);
  }
}

export const dbService = new InventoryDatabase();
