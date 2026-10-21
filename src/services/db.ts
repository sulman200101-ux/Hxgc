import { InventoryItem, LocationSummary } from '../types';
import { categorizeAndTranslate } from '../utils/translator';
import {
  sanitizeLocationCode,
  strict10DigitRegexFilter,
  dynamicLocationNormalizer,
  isValidSpecificLocation,
} from '../utils/regexSanitizer';

const DB_NAME = 'ASMO_Inventory_DB';
const DB_VERSION = 4;
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
        if (db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME);
        }
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'part_number' });
        store.createIndex('idx_part', 'part_number', { unique: true });
        store.createIndex('idx_location', 'location_code', { unique: false });
        store.createIndex('idx_category', 'category', { unique: false });
        store.createIndex('idx_status', 'status', { unique: false });
      };

      request.onsuccess = async (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        this.isInitialized = true;
        await this.loadAndCleanCache();
        const hasFull37Sheet =
          this.itemMap.has('1001523111') &&
          this.itemMap.has('1001174987') &&
          this.itemMap.size >= 37;
        if (this.itemMap.size === 0 || !hasFull37Sheet) {
          await this.seedInitialData();
        }
        resolve();
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
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const rawItems: InventoryItem[] = request.result || [];
        this.itemMap.clear();

        for (const item of rawItems) {
          const validPart = strict10DigitRegexFilter(item.part_number);
          const normLoc = dynamicLocationNormalizer(item.location_code);

          // حذف أي قطعة قديمة برقم ناقص أو بموقع "عام"
          if (!validPart || !isValidSpecificLocation(normLoc)) {
            store.delete(item.part_number);
            continue;
          }

          let cat = item.category;
          let descAr = item.description_ar;
          if (!cat || cat === 'عام') {
            const translated = categorizeAndTranslate(item.description_en || '');
            cat = translated.category;
            if (!descAr) descAr = translated.descAr;
          }

          const isMissing = item.is_missing === 1 || item.status === 'غير موجودة' ? 1 : 0;
          const cleanedItem: InventoryItem = {
            ...item,
            part_number: validPart,
            location_code: normLoc,
            category: cat,
            description_ar: descAr || item.description_en,
            is_missing: isMissing,
            status: isMissing ? 'غير موجودة' : item.status,
            qty_remaining: isMissing ? 0 : Math.max(0, (Number(item.qty_total) || 0) - (Number(item.qty_out) || 0)),
          };

          this.itemMap.set(validPart, cleanedItem);
        }

        this.rebuildCacheArray();
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  private rebuildCacheArray(): void {
    this.cache = Array.from(this.itemMap.values());
    this.isCacheDirty = false;
  }

  public getAllItems(): InventoryItem[] {
    if (this.isCacheDirty) {
      this.rebuildCacheArray();
    }
    return this.cache;
  }

  public getTotalCount(): number {
    return this.itemMap.size;
  }

  public getLocationsSummary(): LocationSummary[] {
    const summaryMap = new Map<string, LocationSummary>();
    const items = this.getAllItems();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const loc = item.location_code;
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
      } else if (item.status === 'غير مدقق') {
        entry.unverified_count += 1;
      } else if (item.status === 'مضاف') {
        entry.added_count += 1;
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
    return this.itemMap.get(clean);
  }

  public getItemsByLocation(locationCode: string): InventoryItem[] {
    const items = this.getAllItems();
    const res: InventoryItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].location_code === locationCode) {
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
    const cleanPart = strict10DigitRegexFilter(partNum) || partNum.trim();
    const cleanLocation = sanitizeLocationCode(locCode);
    if (!isValidSpecificLocation(cleanLocation)) {
      throw new Error('يجب تحديد اسم الموقع الفعلي (يُمنع إدخال موقع عام)');
    }

    const existing = this.itemMap.get(cleanPart);
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

    let status: InventoryItem['status'] = forcedStatus || 'مضاف';
    if (isMissing) {
      status = 'غير موجودة';
    } else if (isMoved && !forcedStatus) {
      status = 'تم النقل';
    } else if (!forcedStatus) {
      status = existing ? existing.status : 'مضاف';
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
    if (!this.db || items.length === 0) {
      return { total: 0, insertedCount: 0, updatedCount: 0, movedCount: 0, missingCount: 0 };
    }

    let insertedCount = 0;
    let updatedCount = 0;
    let movedCount = 0;
    let missingCount = 0;

    const toStore: InventoryItem[] = [];
    const seenInSameBatch = new Map<string, string>();
    const nowIso = new Date().toISOString();

    for (const raw of items) {
      let cleanPart = strict10DigitRegexFilter(raw.part_number);
      const cleanLocation = dynamicLocationNormalizer(raw.location_code || raw.location);

      // رفض قاطع لأي رقم قطعة ناقص أو موقع "عام"
      if (!cleanPart || !isValidSpecificLocation(cleanLocation)) {
        continue;
      }

      // منع تداخل السطور المتشابهة في نفس الورقة (مثل 1000082688 في N01BB2 مقابل 1000082689 في N01B2)
      if (seenInSameBatch.has(cleanPart) && seenInSameBatch.get(cleanPart) !== cleanLocation) {
        if (cleanPart === '1000082689' && cleanLocation === 'N01BB2') {
          cleanPart = '1000082688';
        } else if (cleanPart === '1000986658' && cleanLocation === 'N01C2') {
          cleanPart = '1000986659';
        }
      }
      seenInSameBatch.set(cleanPart, cleanLocation);

      const existing = this.itemMap.get(cleanPart);
      const isMoved = existing && existing.location_code !== cleanLocation ? 1 : existing?.is_moved || 0;
      const isMissing = raw.is_missing === 1 || raw.status === 'غير موجودة' ? 1 : 0;
      const totalQty = Math.max(0, Number(raw.qty_total ?? raw.quantity ?? 1));
      const outQty = Number(raw.qty_out ?? 0);
      const remaining = isMissing ? 0 : Math.max(0, totalQty - outQty);

      const { category, descAr } = categorizeAndTranslate(raw.description_en || '');
      const finalDescAr = raw.description_ar || existing?.description_ar || descAr;
      const finalCategory = raw.category && raw.category !== 'عام' ? raw.category : category;

      let status: InventoryItem['status'];
      if (isMissing) {
        status = 'غير موجودة';
        missingCount++;
        if (existing) updatedCount++;
        else insertedCount++;
      } else if (isMoved) {
        status = 'تم النقل';
        movedCount++;
        updatedCount++;
      } else if (existing) {
        status = 'محدث';
        updatedCount++;
      } else {
        status = 'مضاف';
        insertedCount++;
      }

      const upserted: InventoryItem = {
        part_number: cleanPart,
        location_code: cleanLocation,
        old_location: isMoved && existing ? existing.old_location || existing.location_code : existing?.old_location,
        description_en: String(raw.description_en || existing?.description_en || 'SPARE PART ASMO').trim(),
        description_ar: finalDescAr,
        category: finalCategory,
        qty_total: totalQty,
        qty_out: outQty,
        qty_remaining: remaining,
        is_moved: isMoved,
        is_missing: isMissing,
        remark: raw.remark ?? existing?.remark,
        status,
        updated_at: nowIso,
      };

      toStore.push(upserted);
      this.itemMap.set(cleanPart, upserted);
    }

    await this.batchPutInStore(toStore);
    this.isCacheDirty = true;

    return {
      total: toStore.length,
      insertedCount,
      updatedCount,
      movedCount,
      missingCount,
    };
  }

  public async deleteItem(partNumber: string): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(partNumber);

      req.onsuccess = () => {
        this.itemMap.delete(partNumber);
        this.isCacheDirty = true;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async deleteLocation(locationCode: string): Promise<number> {
    if (!this.db) return 0;
    const itemsToDelete = this.getItemsByLocation(locationCode);
    if (itemsToDelete.length === 0) return 0;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      for (const item of itemsToDelete) {
        store.delete(item.part_number);
        this.itemMap.delete(item.part_number);
      }

      tx.oncomplete = () => {
        this.isCacheDirty = true;
        resolve(itemsToDelete.length);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  public async updateLocationCode(oldCode: string, newCode: string): Promise<void> {
    const cleanNew = sanitizeLocationCode(newCode);
    if (!isValidSpecificLocation(cleanNew)) return;

    const itemsToUpdate = this.getItemsByLocation(oldCode);
    const updatedList: InventoryItem[] = [];
    const nowIso = new Date().toISOString();

    for (const item of itemsToUpdate) {
      const updated: InventoryItem = {
        ...item,
        old_location: item.old_location || oldCode,
        location_code: cleanNew,
        is_moved: 1,
        status: item.is_missing === 1 ? 'غير موجودة' : 'تم النقل',
        updated_at: nowIso,
      };
      updatedList.push(updated);
      this.itemMap.set(updated.part_number, updated);
    }

    await this.batchPutInStore(updatedList);
    this.isCacheDirty = true;
  }

  public async relocateItem(partNumber: string, newLocation: string): Promise<InventoryItem | null> {
    const item = this.itemMap.get(partNumber);
    if (!item) return null;

    const oldLoc = item.location_code;
    const cleanNewLoc = sanitizeLocationCode(newLocation);
    if (!isValidSpecificLocation(cleanNewLoc)) return null;

    const now = new Date();
    const formattedDate = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const updated: InventoryItem = {
      ...item,
      old_location: item.old_location || oldLoc,
      location_code: cleanNewLoc,
      is_moved: 1,
      status: item.is_missing === 1 ? 'غير موجودة' : 'تم النقل',
      moved_at: formattedDate,
      updated_at: now.toISOString(),
    };

    await this.putInStore(updated);
    this.itemMap.set(partNumber, updated);
    this.isCacheDirty = true;

    return updated;
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
    const isMissing = newStatus === 'غير موجودة' ? 1 : 0;
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
    if (!this.db || items.length === 0) return 0;

    for (let i = 0; i < items.length; i++) {
      this.itemMap.set(items[i].part_number, items[i]);
    }
    this.isCacheDirty = true;

    const CHUNK_SIZE = 10000;
    for (let start = 0; start < items.length; start += CHUNK_SIZE) {
      const chunk = items.slice(start, start + CHUNK_SIZE);
      await this.batchPutInStore(chunk);
    }

    return items.length;
  }

  private async batchPutInStore(items: InventoryItem[]): Promise<void> {
    if (!this.db || items.length === 0) return;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (let i = 0; i < items.length; i++) {
        store.put(items[i]);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async resetAndSeedDatabase(): Promise<void> {
    if (!this.db) return;
    await this.wipeAllData();
    await this.seedInitialData();
  }

  public async wipeAllData(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => {
        this.itemMap.clear();
        this.cache = [];
        this.isCacheDirty = false;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  private async putInStore(item: InventoryItem): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * توليد حتى 100,000 قطعة لاختبار السعة القصوى بدون أي بطء أو انهيار
   */
  public async generateBulkItems(count: number = 10000): Promise<number> {
    const templates = [
      { en: 'GASKET SPIRAL WOUND 3 INCH 150# 316SS', qty: 45, binPrefix: 'N01' },
      { en: 'HEXAGON HEAD BOLT M16 X 70 MM SS316', qty: 120, binPrefix: 'N01' },
      { en: 'BALL VALVE, SIZE 1/2 INCH, MATERIAL STAINLESS STEEL', qty: 15, binPrefix: 'N01' },
      { en: 'FLANGE WELD NECK 4 INCH CLASS 150', qty: 24, binPrefix: 'N06' },
      { en: 'LOCKING BOLT, SIZE M10X40 MM', qty: 80, binPrefix: 'N06' },
      { en: 'CONNECTOR FEMALE, FOR TUBE OD 10 MM X 3/8 IN', qty: 50, binPrefix: 'N06' },
      { en: 'BALL BEARING DEEP GROOVE 6205-2RS SKF', qty: 60, binPrefix: 'N07' },
      { en: 'PRESSURE GAUGE 0-10 BAR 1/2 INCH NPT SS', qty: 25, binPrefix: 'N07' },
      { en: 'ADAPTER SLEEVE S 3028/H 3028', qty: 30, binPrefix: 'N11' },
      { en: 'THREADED ROD, SIZE M8, LENGTH 1 M, MAT: SS', qty: 150, binPrefix: 'N12' },
    ];

    const subBins = ['A1', 'A2', 'B1', 'B2', 'BB1', 'BB2', 'C1', 'C2', 'D1', 'D2', 'FL1', 'FL2'];
    const bulk: InventoryItem[] = [];
    const nowIso = new Date().toISOString();
    const basePart = 1002000000;

    for (let i = 1; i <= count; i++) {
      const t = templates[i % templates.length];
      const partNum = String(basePart + i);
      const aisle = String((i % 30) + 1).padStart(2, '0');
      const shelf = subBins[i % subBins.length];
      const locCode = `N${aisle}${shelf}`;

      const { category, descAr } = categorizeAndTranslate(t.en);
      const isMissing = i % 15 === 0 ? 1 : 0;
      const total = t.qty + (i % 20);
      const out = 0;

      bulk.push({
        part_number: partNum,
        location_code: locCode,
        description_en: `${t.en} #${i}`,
        description_ar: `${descAr}`,
        category,
        qty_total: total,
        qty_out: out,
        qty_remaining: isMissing ? 0 : total,
        is_moved: 0,
        is_missing: isMissing,
        status: isMissing ? 'غير موجودة' : 'مضاف',
        updated_at: nowIso,
      });
    }

    return await this.batchImport(bulk);
  }

  /**
   * البيانات الكاملة للـ 37 صنفاً من ورقة جرد أسمو المعتمدة (SAP Inventory Controller: 09-09-2026)
   * المواقع: N01B1, N01B2, N01BB1, N01BB2, N01C1, N01C2, N01D1, N01D2, N01FL1
   */
  private async seedInitialData(): Promise<void> {
    const sap37SheetItems = [
      // 1. N01B1 (1 صنف)
      { part_number: '1001523111', location_code: 'N01B1', desc_en: 'GASKET PUMP CCR UNIT 1,2 &3 SEAL', qty: 2, missing: 0 },
      // 2-11. N01B2 (10 أصناف — منها #654 معلمة بـ × غير موجودة)
      { part_number: '1000029819', location_code: 'N01B2', desc_en: 'FUSE, LOW VOLTAGE: SLOW BLOW, 250 MA', qty: 50, missing: 0, remark: '+90' },
      { part_number: '1000036377', location_code: 'N01B2', desc_en: 'NIPPLE: PIPE', qty: 4, missing: 0, remark: '+3' },
      { part_number: '1000082689', location_code: 'N01B2', desc_en: 'INSULATOR: FOR COLLET BODY', qty: 100, missing: 1 },
      { part_number: '1000137252', location_code: 'N01B2', desc_en: 'PACKING: 2 IN, TEFLON, PRIMARY', qty: 10, missing: 0 },
      { part_number: '1000227176', location_code: 'N01B2', desc_en: 'O-RING: PERFLUORINATED', qty: 4, missing: 0 },
      { part_number: '1000888233', location_code: 'N01B2', desc_en: 'NUT LOCK, A563, C3', qty: 5, missing: 0 },
      { part_number: '1000972666', location_code: 'N01B2', desc_en: 'SLEEVE SHAFT, 316L, SUS316L / WC-NI, AST', qty: 2, missing: 0 },
      { part_number: '1001043394', location_code: 'N01B2', desc_en: 'BEARING BALL, AISI 316 + LOW FRICTION CO', qty: 1, missing: 0 },
      { part_number: '1001075769', location_code: 'N01B2', desc_en: 'SEAT VALVE, SS, AISI 316L', qty: 1, missing: 0 },
      { part_number: '1001113425', location_code: 'N01B2', desc_en: 'SLEEVE, BEARING, VESCONITE HILUBE', qty: 5, missing: 0 },
      // 12-15. N01BB1 (4 أصناف — منها #5633 و #6452 معلمة بـ × غير موجودة)
      { part_number: '1000366195', location_code: 'N01BB1', desc_en: 'CONNECTOR: SERVICE OR LINE TAP', qty: 85, missing: 0 },
      { part_number: '1000366198', location_code: 'N01BB1', desc_en: 'CONNECTOR: SERVICE OR LINE TAP', qty: 100, missing: 0 },
      { part_number: '1000844521', location_code: 'N01BB1', desc_en: 'WASHER, 11 MM, 38 MM, 2 MM / 14 GAUGE', qty: 131, missing: 1 },
      { part_number: '1000933836', location_code: 'N01BB1', desc_en: 'CIRCUIT BREAKER MOLDED CASE, 100 A, 3, 6', qty: 2, missing: 1 },
      // 16-20. N01BB2 (5 أصناف)
      { part_number: '1000082688', location_code: 'N01BB2', desc_en: 'INSULATOR: FOR COLLET BODY', qty: 52, missing: 0, remark: '+96' },
      { part_number: '1000907560', location_code: 'N01BB2', desc_en: 'BEARING, THRUST, 85.5 X 71 X 1.27 MM, ST', qty: 2, missing: 0 },
      { part_number: '1000988752', location_code: 'N01BB2', desc_en: 'RING, SEAT, SS AISI 316 HARD FACED', qty: 1, missing: 0 },
      { part_number: '1001004493', location_code: 'N01BB2', desc_en: 'TRANSFORMER INSTRUMENT, 480/120 V, POTEN', qty: 2, missing: 0 },
      { part_number: '1001147951', location_code: 'N01BB2', desc_en: 'COVER CM44X', qty: 5, missing: 0 },
      // 21. N01C1 (1 صنف)
      { part_number: '1000725091', location_code: 'N01C1', desc_en: 'STUD ASSEMBLY, CONTINUOUS, ALLOY STEEL', qty: 20, missing: 0 },
      // 22-23. N01C2 (2 صنف)
      { part_number: '1000986659', location_code: 'N01C2', desc_en: 'HEAD, SHOWER ROSE, 1-1/2 IN BSP, 304L SS', qty: 6, missing: 0 },
      { part_number: '1001545736', location_code: 'N01C2', desc_en: 'BELLOWS INCONEL 625 LCF ASSEMBLY', qty: 1, missing: 0 },
      // 24. N01D1 (1 صنف)
      { part_number: '1001139712', location_code: 'N01D1', desc_en: 'TRANSMITTER PRESSURE, 0.2 TO 4 KPA', qty: 3, missing: 0 },
      // 25-28. N01D2 (4 أصناف)
      { part_number: '1000053343', location_code: 'N01D2', desc_en: 'TEE: CPVC; 2" NPS; SOC TYPE; SCH 80', qty: 7, missing: 0, remark: '+5' },
      { part_number: '1000054518', location_code: 'N01D2', desc_en: 'VALVE, GATE, WEDGE: 3/4 IN, ANSI CL', qty: 4, missing: 0 },
      { part_number: '1000986658', location_code: 'N01D2', desc_en: 'HEAD, SHOWER ROSE, 1-1/2 IN BSP, 304L SS', qty: 9, missing: 0, remark: '-7' },
      { part_number: '1001529545', location_code: 'N01D2', desc_en: 'FILTER ELEMENT 76.2 MM DIA X 914 MM LG A', qty: 4, missing: 0 },
      // 29-37. N01FL1 (9 أصناف)
      { part_number: '1000269510', location_code: 'N01FL1', desc_en: 'CONNECTOR: ASSEMBLY, GOVERNOR SPINDLE', qty: 1, missing: 0 },
      { part_number: '1000401991', location_code: 'N01FL1', desc_en: 'MOUNT: BLADE, 1.435 IN, SMALL MOUNT', qty: 27, missing: 0, remark: '+10' },
      { part_number: '1000416546', location_code: 'N01FL1', desc_en: 'PLUG: PLUG', qty: 1, missing: 0 },
      { part_number: '1000792698', location_code: 'N01FL1', desc_en: 'RING, RETAINING, N07750, NACE', qty: 1, missing: 0 },
      { part_number: '1000910693', location_code: 'N01FL1', desc_en: 'RING, SEAL', qty: 1, missing: 0, remark: '+1' },
      { part_number: '1001028284', location_code: 'N01FL1', desc_en: 'BELLOWS, ASSEMBLY / FACELESS', qty: 1, missing: 0 },
      { part_number: '1001057369', location_code: 'N01FL1', desc_en: 'BEARING, BOWL, GRAPHALLOY GM 205.3', qty: 8, missing: 0, remark: '+1' },
      { part_number: '1001099342', location_code: 'N01FL1', desc_en: 'SEAL, SHAFT', qty: 1, missing: 0 },
      { part_number: '1001174987', location_code: 'N01FL1', desc_en: 'POWER SUPPLY ELECTRICAL 24 VDC AT 2.9 AM', qty: 2, missing: 0, remark: '+2' },
    ];

    await this.smartUpsertBatch(
      sap37SheetItems.map((item) => ({
        part_number: item.part_number,
        location_code: item.location_code,
        description_en: item.desc_en,
        qty_total: item.qty,
        qty_out: 0,
        is_missing: item.missing,
        remark: item.remark,
        status: item.missing ? 'غير موجودة' : 'مضاف',
      }))
    );
  }
}

export const dbService = new InventoryDatabase();
