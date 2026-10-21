import { InventoryItem, LocationSummary } from '../types';
import { categorizeAndTranslate } from '../utils/translator';
import {
  sanitizeLocationCode,
  strict10DigitRegexFilter,
  dynamicLocationNormalizer,
  isValidSpecificLocation,
} from '../utils/regexSanitizer';

const DB_NAME = 'ASMO_Inventory_DB';
const DB_VERSION = 3;
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
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'part_number' });
          store.createIndex('idx_part', 'part_number', { unique: true });
          store.createIndex('idx_location', 'location_code', { unique: false });
          store.createIndex('idx_category', 'category', { unique: false });
          store.createIndex('idx_status', 'status', { unique: false });
        }
      };

      request.onsuccess = async (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        this.isInitialized = true;
        await this.loadAndCleanCache();
        const hasSapItems = this.itemMap.has('1001023714') && this.itemMap.has('1001122026');
        if (this.itemMap.size === 0 || !hasSapItems) {
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
   * مثل موقع "عام" أو أرقام التسلسل القصيرة (8428, 8429, P-8841)
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

          // حذف أي قطعة قديمة برقم ناقص (مثل 8428 أو P-8841) أو بموقع "عام"
          if (!validPart || !isValidSpecificLocation(normLoc)) {
            store.delete(item.part_number);
            continue;
          }

          // تصحيح التصنيف إذا كان مسجلاً قديماً بكلمة "عام"
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
   * يدعم البحث بـ: رقم القطعة (10 أرقام) | اسم/وصف القطعة (عربي أو إنجليزي) | اسم الموقع (Storage Bin)
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

    // إذا كان البحث برقم قطعة دقيق من 10 أرقام بدون فلاتر إضافية، استرجاع فوري O(1)
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
   * حفظ دفعة كاملة من الورقة الممسوحة في معاملة واحدة سريعة (Single Transaction Batch Upsert)
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
    const nowIso = new Date().toISOString();

    for (const raw of items) {
      const cleanPart = strict10DigitRegexFilter(raw.part_number);
      const cleanLocation = dynamicLocationNormalizer(raw.location_code || raw.location);

      // رفض قاطع لأي رقم قطعة ناقص أو موقع "عام"
      if (!cleanPart || !isValidSpecificLocation(cleanLocation)) {
        continue;
      }

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
   * استيراد دفعات ضخمة بسرعة فائقة (حتى 100,000 قطعة) باستخدام Map O(1) ومعاملات مجزأة
   */
  public async batchImport(items: InventoryItem[]): Promise<number> {
    if (!this.db || items.length === 0) return 0;

    for (let i = 0; i < items.length; i++) {
      this.itemMap.set(items[i].part_number, items[i]);
    }
    this.isCacheDirty = true;

    // تقسيم الحفظ في IndexedDB إلى دفعات من 10,000 سجل لمنع تجميد المتصفح أو انهيار الذاكرة
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
      { en: 'GASKET SPIRAL WOUND 3 INCH 150# 316SS', qty: 45, binPrefix: 'N11' },
      { en: 'HEXAGON HEAD BOLT M16 X 70 MM SS316', qty: 120, binPrefix: 'N11' },
      { en: 'BALL VALVE, SIZE 1/2 INCH, MATERIAL STAINLESS STEEL', qty: 15, binPrefix: 'N12' },
      { en: 'FLANGE WELD NECK 4 INCH CLASS 150', qty: 24, binPrefix: 'N06' },
      { en: 'LOCKING BOLT, SIZE M10X40 MM', qty: 80, binPrefix: 'N06' },
      { en: 'CONNECTOR FEMALE, FOR TUBE OD 10 MM X 3/8 IN', qty: 50, binPrefix: 'N06' },
      { en: 'BALL BEARING DEEP GROOVE 6205-2RS SKF', qty: 60, binPrefix: 'N07' },
      { en: 'PRESSURE GAUGE 0-10 BAR 1/2 INCH NPT SS', qty: 25, binPrefix: 'N07' },
      { en: 'ADAPTER SLEEVE S 3028/H 3028', qty: 30, binPrefix: 'N08' },
      { en: 'THREADED ROD, SIZE M8, LENGTH 1 M, MAT: SS', qty: 150, binPrefix: 'N12' },
    ];

    const subBins = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'FL1', 'FL2'];
    const bulk: InventoryItem[] = [];
    const nowIso = new Date().toISOString();
    const basePart = 1002000000;

    for (let i = 1; i <= count; i++) {
      const t = templates[i % templates.length];
      // رقم قطعة صارم من 10 أرقام يبدأ بـ 100
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
   * البيانات الأساسية المعتمدة من أوراق جرد أسمو (SAP Inventory Controller)
   * تشمل المواقع الحقيقية وأرقام الـ 10 خانات والقطع المعلمة بـ (× غير موجودة)
   */
  private async seedInitialData(): Promise<void> {
    const sapSheetItems = [
      // الورقة الأولى (مواقع N11C2 إلى N12A2)
      { part_number: '1001023714', location_code: 'N11C2', desc_en: 'GASKET, SIZE 10 INCH, RATING 150 LB, SPIRAL WOUND', qty: 6, missing: 0, remark: 'F1' },
      { part_number: '1000995878', location_code: 'N11D1', desc_en: 'BOLT HEX, SIZE M16 X 70 MM, MAT: SS316', qty: 16, missing: 0, remark: 'F1' },
      { part_number: '1000238028', location_code: 'N11D2', desc_en: 'BALL VALVE, SIZE 1/2 INCH, MATERIAL STAINLESS STEEL', qty: 1, missing: 1 },
      { part_number: '1000998169', location_code: 'N11FL1', desc_en: 'FLANGE WELD NECK, SIZE 4 INCH, CLASS 150', qty: 4, missing: 0, remark: 'F1' },
      { part_number: '1001410488', location_code: 'N11FL2', desc_en: 'GASKET SPIRAL WOUND 3 INCH 150# 316SS', qty: 12, missing: 0, remark: 'F1' },
      { part_number: '1000428939', location_code: 'N12A1', desc_en: 'ELBOW 90 DEGREE, SIZE 25 MM, MATERIAL PVC', qty: 2, missing: 1 },
      { part_number: '1001483307', location_code: 'N12A2', desc_en: 'THREADED ROD, SIZE M8, LENGTH 1 M, MAT: SS', qty: 120, missing: 0, remark: 'F1' },

      // الورقة الثانية (مواقع N06BB2 إلى N07A1)
      { part_number: '1001151526', location_code: 'N06BB2', desc_en: 'HEXAGON HEAD BOLT M12X50 SS304', qty: 1, missing: 0, remark: 'F1' },
      { part_number: '1001122026', location_code: 'N06C', desc_en: 'PLUG, SIZE 4 IN, THREAD TYPE NPT', qty: 4, missing: 1 },
      { part_number: '1001105195', location_code: 'N06C1', desc_en: 'LOCKING BOLT, SIZE M10X40 MM', qty: 20, missing: 1 },
      { part_number: '1001271386', location_code: 'N06C1', desc_en: 'HEXAGON HEAD BOLT M24X90 SS304L WITH NUT', qty: 4, missing: 1 },
      { part_number: '1001300419', location_code: 'N06C1', desc_en: '3155966 COVER PLATE, DN100 P250', qty: 2, missing: 1 },
      { part_number: '1001300421', location_code: 'N06C1', desc_en: '4649065 INTERMEDIATE PIECE COMPLETE', qty: 11, missing: 1 },
      { part_number: '1001432506', location_code: 'N06C1', desc_en: 'HEX NUT M14, MAT: SS 304L', qty: 8, missing: 1 },
      { part_number: '1000105390', location_code: 'N06C2', desc_en: 'CONNECTOR FEMALE, FOR TUBE OD 10 MM X 3/8 IN', qty: 4, missing: 1 },
      { part_number: '1000191681', location_code: 'N06C2', desc_en: 'ELBOW 90 DEGREE, SIZE 2 INCH, MATERIAL GALVANIZED', qty: 2, missing: 1 },
      { part_number: '1000201020', location_code: 'N06C2', desc_en: 'BOLT EXPANSION, HILTI ANCHOR SIZE M12X110', qty: 20, missing: 1 },
      { part_number: '1000215308', location_code: 'N06C2', desc_en: 'VALVE BALL, SS, FOR 16 MM OD TUBE, SWAGELOK', qty: 2, missing: 1 },
      { part_number: '1000218037', location_code: 'N06C2', desc_en: '3 WAY BALL VALVE, SIZE 3/4 INCH, MATERIAL SS', qty: 1, missing: 1 },
      { part_number: '1001357143', location_code: 'N06D2', desc_en: 'BALL BEARING DEEP GROOVE 6205-2RS', qty: 16, missing: 0, remark: '-4' },
      { part_number: '1001122021', location_code: 'N06FL1', desc_en: 'GATE VALVE 2 INCH CLASS 150 FLANGED', qty: 1, missing: 0, remark: 'F1' },
      { part_number: '1000836858', location_code: 'N06FL2', desc_en: '4662228 ADAPTER SLEEVE S 3028/H 3028', qty: 10, missing: 1 },
      { part_number: '1000836863', location_code: 'N06FL2', desc_en: 'WASHER LOCK MB 28 FOR BEARING ADAPTER', qty: 10, missing: 0, remark: 'F1' },
      { part_number: '1001362709', location_code: 'N07A1', desc_en: 'PRESSURE GAUGE 0-10 BAR 1/2 INCH NPT SS', qty: 8, missing: 0, remark: 'F2' },
    ];

    await this.smartUpsertBatch(
      sapSheetItems.map((item) => ({
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
