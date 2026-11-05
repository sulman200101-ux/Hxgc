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
import {
  isHeavyPart,
  isDLocation,
  isCLocation,
  isHeavyDutyDOrCLocation,
  resolveTargetDLocation,
  estimatePartSizeProfile,
  suggestHeavyItemsToLocationD,
  buildHighValueConsolidationPlans,
  MAX_ITEMS_PER_SHELF,
} from './transferSuggestions';

const DB_NAME = 'ASMO_Inventory_DB';
const DB_VERSION = 8;
const STORE_NAME = 'items';

const cloneItem = (item: InventoryItem): InventoryItem => ({ ...item });

export function formatTransferReportTitle(reportNumber: number, isoDate?: string): string {
  const d = isoDate ? new Date(isoDate) : new Date();
  const safeDate = Number.isNaN(d.getTime()) ? new Date() : d;
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, '0');
  const day = String(safeDate.getDate()).padStart(2, '0');
  const timeStr = safeDate.toLocaleTimeString('ar-SA', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `تقرير ${reportNumber} بتاريخ ${year}/${month}/${day} (${timeStr})`;
}

class InventoryDatabase {
  private db: IDBDatabase | null = null;
  private itemMap: Map<string, InventoryItem> = new Map();
  private cache: InventoryItem[] = [];
  private transferReportsCache: StockDocument[] = [];
  private locationsSummaryCache: LocationSummary[] | null = null;
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
          ['idx_part', 'part_number', true],
          ['idx_location', 'location_code', false],
          ['idx_category', 'category', false],
          ['idx_status', 'status', false],
        ] as const) {
          if (!store.indexNames.contains(name)) store.createIndex(name, key, { unique });
        }
        const documents = db.objectStoreNames.contains('documents')
          ? request.transaction!.objectStore('documents')
          : db.createObjectStore('documents', { keyPath: 'id' });
        if (documents.indexNames.contains('originalHash')) documents.deleteIndex('originalHash');
        if (!db.objectStoreNames.contains('audit'))
          db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });

        const audit = request.transaction!.objectStore('audit');
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const before = cursor.value as InventoryItem;
          const after = { ...before };
          if (typeof before.description_en === 'string' && before.description_en.trim()) {
            const suggestion = categorizeAndTranslate(before.description_en);
            if (
              (!before.description_ar?.trim() || before.description_ar === before.description_en) &&
              suggestion.descAr !== before.description_en
            ) {
              after.description_ar = suggestion.descAr;
              after.translation_review_required = true;
            }
            if (!before.category?.trim() || before.category === 'عام')
              after.category = suggestion.category;
          }
          if (JSON.stringify(after) !== JSON.stringify(before)) {
            cursor.update(after);
            audit.add({
              at: new Date().toISOString(),
              actor: 'system-migration-v8',
              action: 'enrich-descriptions',
              before,
              after,
            });
          }
          cursor.continue();
        };
      };

      request.onsuccess = async (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
          this.isInitialized = false;
        };
        try {
          await this.loadAndCleanCache();
          this.isInitialized = true;
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event);
        reject(request.error);
      };
    });
  }

  private async loadAndCleanCache(): Promise<void> {
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    const { items, docs } = await new Promise<{ items: InventoryItem[]; docs: StockDocument[] }>(
      (resolve, reject) => {
        const tx = this.db!.transaction([STORE_NAME, 'documents'], 'readonly');
        const itemsReq = tx.objectStore(STORE_NAME).getAll();
        const docsReq = tx.objectStore('documents').getAll();
        tx.oncomplete = () =>
          resolve({ items: itemsReq.result || [], docs: docsReq.result || [] });
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      }
    );

    const approvedTransferDocs = docs
      .filter((d) => d && d.kind === 'transfer' && d.status === 'approved')
      .sort((a, b) =>
        String(a.executedAt || a.createdAt || '').localeCompare(
          String(b.executedAt || b.createdAt || '')
        )
      );

    // الأرقام التي قام المستخدم بنقلها فعلياً عبر تقارير النقل المعتمدة فقط
    const userTransferredParts = new Set<string>();
    for (const tDoc of approvedTransferDocs) {
      for (const line of tDoc.lines || []) {
        const p = String(line.part_number || '').trim();
        if (p) userTransferredParts.add(p);
      }
    }

    const itemsToCleanInDb: InventoryItem[] = [];
    const enrichedItems = items.map((item) => {
      let updated = { ...item };
      let changed = false;

      // إلغاء أي حالة "منقول / تم النقل" لم تنتج عن عملية نقل فعلية من قِبل المستخدم
      if (
        (updated.is_moved === 1 || updated.status === 'تم النقل' || updated.status === 'منقول') &&
        !userTransferredParts.has(updated.part_number)
      ) {
        updated.is_moved = 0;
        updated.status = updated.is_missing === 1 ? 'غير موجودة' : 'مدقق';
        updated.old_location = undefined;
        updated.moved_at = undefined;
        changed = true;
      }

      if (typeof updated.description_en === 'string' && updated.description_en.trim()) {
        const needsDescEnrich =
          !updated.description_ar?.trim() || updated.description_ar === updated.description_en;
        const needsCatEnrich =
          !updated.category?.trim() ||
          updated.category === 'عام' ||
          updated.category === 'قطع ميكانيكية متنوعة';
        if (needsDescEnrich || needsCatEnrich) {
          const suggestion = categorizeAndTranslate(updated.description_en);
          if (needsDescEnrich && suggestion.descAr && suggestion.descAr !== updated.description_en) {
            updated.description_ar = suggestion.descAr;
          }
          if (needsCatEnrich && suggestion.category) {
            updated.category = suggestion.category;
          }
        }
      }

      if (changed) {
        itemsToCleanInDb.push(updated);
      }
      return updated;
    });

    if (itemsToCleanInDb.length > 0 && this.db) {
      await new Promise<void>((resolve) => {
        const tx = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const cleaned of itemsToCleanInDb) {
          store.put(cleaned);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    }

    this.itemMap = new Map(enrichedItems.map((item) => [item.part_number, item]));

    // بناء وترقيم سجل تقارير النقل المحفوظة (تقرير 1 بتاريخ ...، تقرير 2 بتاريخ ...)
    const docsToUpdate: StockDocument[] = [];
    this.transferReportsCache = approvedTransferDocs.map((doc, idx) => {
      const reportNumber = idx + 1;
      const dateIso = doc.executedAt || doc.createdAt || new Date().toISOString();
      const reportTitle = formatTransferReportTitle(reportNumber, dateIso);
      const snapshot =
        doc.transferredItemsSnapshot && doc.transferredItemsSnapshot.length > 0
          ? doc.transferredItemsSnapshot
          : (doc.lines || []).map((line) => {
              const currentItem = this.itemMap.get(String(line.part_number || '').trim());
              return {
                part_number: line.part_number,
                location_code: line.location || currentItem?.location_code || '',
                old_location: line.old_location || currentItem?.old_location || '',
                description_en: line.description_en || currentItem?.description_en || '',
                description_ar: line.description_ar || currentItem?.description_ar || '',
                category: currentItem?.category || '',
                qty_total: currentItem?.qty_total ?? line.quantity ?? 0,
                qty_out: currentItem?.qty_out ?? 0,
                qty_remaining: currentItem?.qty_remaining ?? line.quantity ?? 0,
                is_moved: 1,
                is_missing: 0,
                status: 'تم النقل',
                moved_at: dateIso,
                remark: line.remark || doc.reason || '',
              };
            });

      const enrichedDoc: StockDocument = {
        ...doc,
        reportNumber,
        reportTitle,
        transferredItemsSnapshot: snapshot,
      };
      if (
        doc.reportNumber !== reportNumber ||
        doc.reportTitle !== reportTitle ||
        !doc.transferredItemsSnapshot?.length
      ) {
        docsToUpdate.push(enrichedDoc);
      }
      return enrichedDoc;
    });

    if (docsToUpdate.length > 0 && this.db) {
      await new Promise<void>((resolve) => {
        const tx = this.db!.transaction('documents', 'readwrite');
        const docStore = tx.objectStore('documents');
        for (const d of docsToUpdate) {
          docStore.put(d);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    }

    this.rebuildCacheArray();
  }

  public getTransferReports(): StockDocument[] {
    return this.transferReportsCache.map((d) => ({
      ...d,
      lines: d.lines.map((l) => ({ ...l })),
      transferredItemsSnapshot: d.transferredItemsSnapshot?.map((s) => ({ ...s })),
    }));
  }

  private rebuildCacheArray(): void {
    this.cache = Array.from(this.itemMap.values());
    this.locationsSummaryCache = null;
    this.isCacheDirty = false;
  }

  private ensureInternalCache(): InventoryItem[] {
    if (this.isCacheDirty) {
      this.rebuildCacheArray();
    }
    return this.cache;
  }

  public getAllItems(): InventoryItem[] {
    const internal = this.ensureInternalCache();
    return internal.map(cloneItem);
  }

  public getTotalCount(): number {
    return this.itemMap.size;
  }

  public getLocationsSummary(): LocationSummary[] {
    if (!this.isCacheDirty && this.locationsSummaryCache) {
      return this.locationsSummaryCache.map((s) => ({ ...s }));
    }

    const summaryMap = new Map<string, LocationSummary>();
    const items = this.ensureInternalCache();

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

    const sorted = Array.from(summaryMap.values()).sort((a, b) =>
      a.location_code.localeCompare(b.location_code, undefined, { numeric: true, sensitivity: 'base' })
    );
    this.locationsSummaryCache = sorted;
    return sorted.map((s) => ({ ...s }));
  }

  public getItemByPartNumber(partNumber: string): InventoryItem | undefined {
    const clean = String(partNumber || '').trim();
    const found = this.itemMap.get(clean);
    return found ? cloneItem(found) : undefined;
  }

  public getItemsByLocation(locationCode: string): InventoryItem[] {
    const targetLoc = sanitizeLocationCode(locationCode) || locationCode.trim().toUpperCase();
    const items = this.ensureInternalCache();
    const res: InventoryItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const itemLoc =
        sanitizeLocationCode(items[i].location_code) || items[i].location_code.trim().toUpperCase();
      if (itemLoc === targetLoc) {
        res.push(cloneItem(items[i]));
      }
    }
    return res;
  }

  public getItemsByCategory(categoryName: string): InventoryItem[] {
    const cat = categoryName.trim().toLowerCase();
    const items = this.ensureInternalCache();
    const res: InventoryItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const itemCat = (items[i].category || '').toLowerCase();
      if (itemCat === cat || itemCat.includes(cat) || cat.includes(itemCat)) {
        res.push(cloneItem(items[i]));
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

    const items = this.ensureInternalCache();
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

  public searchItems(
    query: string,
    categoryFilter?: string,
    statusFilter?: string,
    searchField: 'all' | 'part' | 'name' | 'location' = 'all'
  ): InventoryItem[] {
    const q = query.trim().toLowerCase();
    const items = this.ensureInternalCache();

    if (
      !q &&
      (!categoryFilter || categoryFilter === 'الكل') &&
      (!statusFilter || statusFilter === 'الكل')
    ) {
      return items.map(cloneItem);
    }

    if (
      q.length === 10 &&
      /^\d{10}$/.test(q) &&
      (!categoryFilter || categoryFilter === 'الكل') &&
      (!statusFilter || statusFilter === 'الكل')
    ) {
      const exact = this.itemMap.get(q);
      if (exact) return [cloneItem(exact)];
    }

    const results: InventoryItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (categoryFilter && categoryFilter !== 'الكل' && item.category !== categoryFilter) {
        continue;
      }

      if (statusFilter && statusFilter !== 'الكل') {
        if (statusFilter === 'غير موجودة' || statusFilter === 'مفقود') {
          if (item.status !== 'غير موجودة' && item.status !== 'مفقود' && item.is_missing !== 1)
            continue;
        } else if (statusFilter === 'مضاف' || statusFilter === 'موجود') {
          if (item.status === 'غير موجودة' || item.status === 'مفقود' || item.is_missing === 1)
            continue;
        } else if (statusFilter === 'تم النقل') {
          if (item.status !== 'تم النقل' && item.status !== 'منقول' && item.is_moved !== 1)
            continue;
        } else if (statusFilter === 'لم تنتقل') {
          if (item.is_moved === 1 || item.status === 'تم النقل' || item.status === 'منقول')
            continue;
        } else if (item.status !== statusFilter) {
          continue;
        }
      }

      if (!q) {
        results.push(cloneItem(item));
        continue;
      }

      if (searchField === 'part') {
        if (item.part_number.toLowerCase().includes(q)) results.push(cloneItem(item));
      } else if (searchField === 'location') {
        if (item.location_code.toLowerCase().includes(q)) results.push(cloneItem(item));
      } else if (searchField === 'name') {
        if (
          (item.description_ar && item.description_ar.toLowerCase().includes(q)) ||
          (item.description_en && item.description_en.toLowerCase().includes(q)) ||
          (item.category && item.category.toLowerCase().includes(q))
        ) {
          results.push(cloneItem(item));
        }
      } else {
        if (
          item.part_number.toLowerCase().includes(q) ||
          item.location_code.toLowerCase().includes(q) ||
          (item.description_ar && item.description_ar.toLowerCase().includes(q)) ||
          (item.description_en && item.description_en.toLowerCase().includes(q)) ||
          (item.category && item.category.toLowerCase().includes(q))
        ) {
          results.push(cloneItem(item));
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
    const cleanPart = partNum.trim();
    if (!/^\d{10}$/.test(cleanPart)) throw new Error('رقم القطعة يجب أن يكون عشرة أرقام');
    const safeQty = Number.isFinite(qty) && qty >= 0 ? Math.round(qty) : 0;
    const safeOut = Number.isFinite(qtyOut) && qtyOut >= 0 ? Math.min(safeQty, Math.round(qtyOut)) : 0;
    const cleanLocation = sanitizeLocationCode(locCode) || locCode.trim().toUpperCase();

    const existing = this.itemMap.get(cleanPart);
    // لا تُسجل القطعة كـ "منقول" إلا إذا تم تحديد حالتها صراحةً أو نقلها عبر أمر نقل من المستخدم
    const isExplicitlyMoved =
      forcedStatus === 'تم النقل' || forcedStatus === 'منقول';
    const isMoved = isExplicitlyMoved ? 1 : existing?.is_moved || 0;
    const isMissing =
      isMissingFlag !== undefined ? isMissingFlag : forcedStatus === 'غير موجودة' ? 1 : 0;
    const remaining = isMissing ? 0 : Math.max(0, safeQty - safeOut);

    const cachedAr = existingAr || existing?.description_ar;
    const { category, descAr } = categorizeAndTranslate(descEn);
    const finalDescAr = cachedAr || descAr;

    let status: InventoryItem['status'] = forcedStatus || 'غير مدقق';
    if (isMissing) {
      status = 'غير موجودة';
    } else if (!forcedStatus) {
      status = existing ? existing.status : 'غير مدقق';
    }

    const item: InventoryItem = {
      part_number: cleanPart,
      location_code: cleanLocation,
      old_location: existing?.old_location,
      description_en: (descEn || existing?.description_en || '').trim(),
      description_ar: finalDescAr,
      category: category,
      qty_total: safeQty,
      qty_out: safeOut,
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

    return cloneItem(item);
  }

  public async smartUpsertBatch(items: any[]): Promise<{
    total: number;
    insertedCount: number;
    updatedCount: number;
    movedCount: number;
    missingCount: number;
  }> {
    if (!this.db || !items || items.length === 0) {
      return { total: 0, insertedCount: 0, updatedCount: 0, movedCount: 0, missingCount: 0 };
    }
    const now = new Date().toISOString();
    let insertedCount = 0;
    let updatedCount = 0;
    let movedCount = 0;
    let missingCount = 0;
    const toSave: InventoryItem[] = [];

    const batchMap = new Map<string, InventoryItem>();
    for (const raw of items) {
      if (!raw) continue;
      const cleanPart = String(raw.part_number || '').trim();
      if (!/^\d{10}$/.test(cleanPart)) continue;
      const cleanLoc =
        sanitizeLocationCode(String(raw.location_code || raw.location || '')) ||
        String(raw.location_code || raw.location || '').trim().toUpperCase();
      const existing = this.itemMap.get(cleanPart);
      // قراءة أوراق الجرد لا تسجل القطع كمنقولة أبداً؛ النقل يُسجل فقط عند النقل الفعلي من قِبل المستخدم
      const isMoved = existing?.is_moved || 0;
      const isMissing = raw.is_missing === 1 || raw.status === 'غير موجودة' ? 1 : 0;
      const total = Number.isFinite(raw.qty_total) && raw.qty_total >= 0 ? Math.round(raw.qty_total) : 0;
      const out = isMissing
        ? 0
        : Number.isFinite(raw.qty_out) && raw.qty_out >= 0
        ? Math.min(total, Math.round(raw.qty_out))
        : 0;
      const remaining = isMissing ? 0 : Math.max(0, total - out);
      const descEn = String(raw.description_en || existing?.description_en || '').trim();
      const { category, descAr } = categorizeAndTranslate(descEn);

      if (existing) {
        updatedCount++;
      } else {
        insertedCount++;
      }
      if (isMissing) missingCount++;

      const safeRawStatus =
        raw.status === 'تم النقل' || raw.status === 'منقول'
          ? isMoved
            ? 'تم النقل'
            : 'مدقق'
          : raw.status || 'غير مدقق';

      const prevInBatch = batchMap.get(cleanPart);
      if (prevInBatch) {
        const combinedTotal = prevInBatch.qty_total + total;
        const combinedOut = isMissing ? 0 : Math.min(combinedTotal, prevInBatch.qty_out + out);
        batchMap.set(cleanPart, {
          ...prevInBatch,
          qty_total: combinedTotal,
          qty_out: combinedOut,
          qty_remaining: isMissing ? 0 : Math.max(0, combinedTotal - combinedOut),
        });
      } else {
        batchMap.set(cleanPart, {
          part_number: cleanPart,
          location_code: cleanLoc,
          old_location: existing?.old_location,
          description_en: descEn,
          description_ar: raw.description_ar || existing?.description_ar || descAr,
          category: raw.category || existing?.category || category,
          qty_total: total,
          qty_out: out,
          qty_remaining: remaining,
          is_moved: isMoved,
          is_missing: isMissing,
          remark: raw.remark ?? existing?.remark,
          status: isMissing ? 'غير موجودة' : safeRawStatus,
          moved_at: existing?.moved_at,
          updated_at: now,
        });
      }
    }
    toSave.push(...batchMap.values());

    if (toSave.length > 0) {
      await this.commitChanges(toSave, []);
    }

    return {
      total: toSave.length,
      insertedCount,
      updatedCount,
      movedCount,
      missingCount,
    };
  }

  public async deleteItem(partNumber: string): Promise<void> {
    await authorizeMutation('حذف قطعة');
    await this.commitChanges([], [partNumber]);
  }

  public async deleteLocation(locationCode: string): Promise<number> {
    await authorizeMutation('حذف موقع');
    const items = this.getItemsByLocation(locationCode);
    await this.commitChanges(
      [],
      items.map((item) => item.part_number)
    );
    return items.length;
  }

  public async updateLocationCode(oldCode: string, newCode: string): Promise<void> {
    const items = this.getItemsByLocation(oldCode);
    if (!items.length) return;
    const id = 'MOVE-' + crypto.randomUUID();
    await this.submitDocument({
      id,
      kind: 'transfer',
      requester: 'local-operator',
      reason: 'طلب تغيير موقع من الواجهة',
      lines: items.map((item) => ({
        old_location: item.location_code,
        part_number: item.part_number,
        quantity: item.qty_remaining,
        location: newCode,
        description_en: item.description_en,
        description_ar: item.description_ar,
        check: '',
        remark: '',
        reviewed: true,
      })),
      status: 'pending',
      createdAt: '',
    });
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
    const id = 'MOVE-' + crypto.randomUUID();
    await this.submitDocument({
      id,
      kind: 'transfer',
      requester: 'المستخدم المحلي',
      reason: `نقل القطعة (${partNumber}) من ${item.location_code || 'السابق'} إلى ${cleanNewLoc}`,
      lines: [
        {
          old_location: item.location_code,
          part_number: partNumber,
          quantity: Math.max(0, item.qty_remaining || item.qty_total || 0),
          location: cleanNewLoc,
          description_en: item.description_en,
          description_ar: item.description_ar,
          check: '',
          remark: `نقل من ${item.location_code || 'السابق'} إلى ${cleanNewLoc}`,
          reviewed: true,
        },
      ],
      status: 'pending',
      createdAt: '',
    });
    await this.approveDocument(id);
    return this.getItemByPartNumber(partNumber) || null;
  }

  public async relocateAllHeavyItemsToLocationD(targetDBinOverride?: string): Promise<InventoryItem[]> {
    const allItems = this.ensureInternalCache();
    const suggestions = suggestHeavyItemsToLocationD(allItems);
    const sugMap = new Map<string, string>();
    for (const sug of suggestions) {
      sugMap.set(sug.partNumber, sug.to);
    }

    const heavyToMove = allItems.filter(
      (item) =>
        item.qty_remaining > 0 &&
        item.is_missing !== 1 &&
        isHeavyPart(item) &&
        (targetDBinOverride ? !isDLocation(item.location_code) : !isHeavyDutyDOrCLocation(item.location_code))
    );

    if (heavyToMove.length === 0) {
      return [];
    }

    const docId = `HEAVY-TO-DC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const lines = heavyToMove.map((item) => {
      const destBin =
        targetDBinOverride && isValidSpecificLocation(targetDBinOverride)
          ? sanitizeLocationCode(targetDBinOverride) || targetDBinOverride.trim().toUpperCase()
          : sugMap.get(item.part_number) || resolveTargetDLocation(item.location_code);
      const sizeProf = estimatePartSizeProfile(item);
      const labelDC = isCLocation(destBin) ? 'موقع C' : 'موقع D';
      return {
        old_location: item.location_code,
        part_number: item.part_number,
        quantity: item.qty_remaining,
        location: destBin,
        description_en: item.description_en,
        description_ar: item.description_ar,
        check: '',
        remark: `نقل قطعة ثقيلة جداً (${sizeProf.dimensionsLabel}) إلى ${labelDC} (بحد ${MAX_ITEMS_PER_SHELF} صنف للرف)`,
        reviewed: true,
      };
    });

    await this.submitDocument({
      id: docId,
      kind: 'transfer',
      requester: 'نظام توجيه القطع الثقيلة جداً إلى الموقعين D و C',
      reason: `نقل وتجميع القطع الثقيلة جداً (${heavyToMove.length} قطعة) إلى مواقع الثقيلة المعتمدة (D و C) بحد أقصى ${MAX_ITEMS_PER_SHELF} صنفاً لكل رف`,
      lines,
      status: 'pending',
      createdAt: '',
    });

    await this.approveDocument(docId);

    return heavyToMove
      .map((item) => this.getItemByPartNumber(item.part_number))
      .filter((i): i is InventoryItem => Boolean(i));
  }

  public async relocateTopExpensiveItemsToShelf(targetShelfOverride?: string): Promise<InventoryItem[]> {
    const allItems = this.ensureInternalCache();
    const plans = buildHighValueConsolidationPlans(allItems, new Set(), targetShelfOverride);
    if (plans.length === 0) return [];

    const primaryPlan = plans[0];
    const targetBin =
      targetShelfOverride && isValidSpecificLocation(targetShelfOverride)
        ? sanitizeLocationCode(targetShelfOverride) || targetShelfOverride.trim().toUpperCase()
        : primaryPlan.targetBin;

    const lines = [
      ...primaryPlan.evictions
        .filter((ev) => ev.fromBin !== ev.evictToBin)
        .map((ev) => ({
          old_location: ev.fromBin,
          part_number: ev.partNumber,
          quantity: ev.quantity,
          location: ev.evictToBin,
          description_en: ev.descriptionEn,
          description_ar: ev.descriptionAr,
          check: '',
          remark: ev.reason,
          reviewed: true,
        })),
      ...primaryPlan.items
        .slice(0, MAX_ITEMS_PER_SHELF)
        .filter((entry) => entry.fromBin !== targetBin)
        .map((entry) => ({
          old_location: entry.fromBin,
          part_number: entry.item.part_number,
          quantity: entry.item.qty_remaining,
          location: targetBin,
          description_en: entry.item.description_en,
          description_ar: entry.item.description_ar,
          check: '',
          remark: `تجميع القطع الأغلى سعراً (${entry.sizeProfile.priceLabelAr}) في الرف (${targetBin}) — بحد أقصى ${MAX_ITEMS_PER_SHELF} صنف فقط`,
          reviewed: true,
        })),
    ];

    if (lines.length === 0) {
      return primaryPlan.items
        .slice(0, MAX_ITEMS_PER_SHELF)
        .map((e) => this.getItemByPartNumber(e.item.part_number))
        .filter((i): i is InventoryItem => Boolean(i));
    }

    const docId = `EXPENSIVE-15-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await this.submitDocument({
      id: docId,
      kind: 'transfer',
      requester: 'نظام تجميع القطع الأغلى سعراً (15 صنف للرف)',
      reason: primaryPlan.summaryReason,
      lines,
      status: 'pending',
      createdAt: '',
    });

    await this.approveDocument(docId);

    return primaryPlan.items
      .slice(0, MAX_ITEMS_PER_SHELF)
      .map((e) => this.getItemByPartNumber(e.item.part_number))
      .filter((i): i is InventoryItem => Boolean(i));
  }

  public getMovedItems(): InventoryItem[] {
    return this.ensureInternalCache()
      .filter((i) => i.is_moved === 1 || i.status === 'تم النقل' || i.status === 'منقول')
      .map(cloneItem);
  }

  public getMissingItems(): InventoryItem[] {
    return this.ensureInternalCache()
      .filter((i) => i.is_missing === 1 || i.status === 'غير موجودة')
      .map(cloneItem);
  }

  public async markStatus(partNumber: string, newStatus: InventoryItem['status']): Promise<void> {
    const item = this.itemMap.get(partNumber);
    if (!item) return;
    const willBeMissing = newStatus === 'غير موجودة';
    const isMissing = willBeMissing ? 1 : 0;
    const isMoved = newStatus === 'تم النقل' || newStatus === 'منقول' ? 1 : 0;
    const updated: InventoryItem = {
      ...item,
      status: newStatus,
      is_moved: isMoved,
      is_missing: isMissing,
      qty_remaining: isMissing ? 0 : Math.max(0, item.qty_total - item.qty_out),
      updated_at: new Date().toISOString(),
    };
    await this.putInStore(updated);
    this.itemMap.set(partNumber, updated);
    this.isCacheDirty = true;
  }

  public async batchImport(items: InventoryItem[]): Promise<number> {
    if (!this.db || items.length === 0) return 0;

    await this.batchPutInStore(items);

    return items.length;
  }

  private async batchPutInStore(items: InventoryItem[]): Promise<void> {
    await this.commitChanges(items, []);
  }

  private async commitChanges(
    items: InventoryItem[],
    deletes: string[],
    clear = false
  ): Promise<void> {
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    const isMassiveBatch = items.length > 250;

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME, 'audit'], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const audit = tx.objectStore('audit');
      const at = new Date().toISOString();

      if (clear) {
        const read = store.getAll();
        read.onsuccess = () => {
          audit.add({ at, actor: 'local-supervisor', action: 'wipe', before: read.result });
          store.clear();
        };
      } else if (isMassiveBatch) {
        for (let i = 0; i < items.length; i++) {
          store.put(items[i]);
        }
        for (let i = 0; i < deletes.length; i++) {
          store.delete(deletes[i]);
        }
        audit.add({
          at,
          actor: 'local-supervisor',
          action: 'bulk-save',
          count: items.length,
          deletedCount: deletes.length,
        });
      } else {
        const record = (key: string, after?: InventoryItem) => {
          const read = store.get(key);
          read.onsuccess = () => {
            audit.add({
              at,
              actor: 'local-supervisor',
              action: after ? 'save' : 'delete',
              before: read.result,
              after,
            });
            if (after) store.put(after);
            else store.delete(key);
          };
        };
        items.forEach((item) => record(item.part_number, item));
        deletes.forEach((key) => record(key));
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
    const documents = input.map((doc, docIdx) => {
      let baseId = canonicalDocumentId(doc.id || `SHEET-${Date.now()}-${docIdx + 1}`);
      if (ids.has(baseId)) {
        baseId = `${baseId}-${docIdx + 1}`;
      }
      ids.add(baseId);
      const normalized: StockDocument = {
        ...doc,
        id: baseId,
        requester: (doc.requester || 'المستخدم المحلي').trim() || 'المستخدم المحلي',
        lines: doc.lines.map((line) => {
          const cleanPart = String(line.part_number || '').trim();
          const cleanLoc =
            sanitizeLocationCode(line.location) ||
            String(line.location || '').trim().toUpperCase();
          const safeQty =
            Number.isFinite(line.quantity) && line.quantity >= 0
              ? Math.round(line.quantity)
              : 0;
          return {
            ...line,
            part_number: cleanPart,
            location: cleanLoc,
            quantity: safeQty,
            description_en: (line.description_en || '').trim(),
            reviewed: true,
            old_location: cleanPart ? this.itemMap.get(cleanPart)?.location_code : undefined,
          };
        }),
      };
      validateDocument(normalized);
      return structuredClone({
        ...normalized,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
        executedAt: undefined,
        approvedBy: undefined,
      });
    });
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction('documents', 'readwrite');
      for (const doc of documents) tx.objectStore('documents').put(doc);
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(new Error('تعذر حفظ الدفعة في قاعدة البيانات المحلية'));
    });
  }

  public async approveDocument(id: string): Promise<void> {
    await this.approveDocuments([id]);
  }

  public async approveDocuments(ids: string[]): Promise<void> {
    const cleanIds = Array.from(new Set(ids.map((id) => canonicalDocumentId(id)).filter(Boolean)));
    if (!cleanIds.length) throw new Error('قائمة المستندات فارغة');
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    let nextTransferReportNumber = this.transferReportsCache.length + 1;

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(['documents', STORE_NAME, 'audit'], 'readwrite');
      const docs = tx.objectStore('documents');
      const store = tx.objectStore(STORE_NAME);
      const audit = tx.objectStore('audit');
      let failure: Error | undefined;
      const fail = (error: unknown) => {
        failure = error instanceof Error ? error : new Error(String(error));
        tx.abort();
      };
      const processDocument = (documentIndex: number) => {
        if (documentIndex >= cleanIds.length) return;
        const id = cleanIds[documentIndex];
        const req = docs.get(id);
        req.onsuccess = () => {
          try {
            const doc: StockDocument | undefined = req.result;
            if (!doc) {
              processDocument(documentIndex + 1);
              return;
            }
            if (doc.status === 'approved') {
              processDocument(documentIndex + 1);
              return;
            }
            validateDocument(doc);
            const plannedLines = approvalLines(doc);
            const movedSnapshotsForReport: NonNullable<StockDocument['transferredItemsSnapshot']> = [];

            const processLine = (lineIndex: number) => {
              if (lineIndex >= plannedLines.length) {
                const executedAt = new Date().toISOString();
                const isTransfer = doc.kind === 'transfer';
                const reportNum = isTransfer ? nextTransferReportNumber++ : undefined;
                const reportTitle =
                  isTransfer && reportNum
                    ? formatTransferReportTitle(reportNum, executedAt)
                    : undefined;

                const approved: StockDocument = {
                  ...doc,
                  status: 'approved',
                  executedAt,
                  approvedBy: 'local-supervisor',
                  reportNumber: reportNum,
                  reportTitle,
                  transferredItemsSnapshot: isTransfer ? movedSnapshotsForReport : undefined,
                };
                docs.put(approved);
                audit.add({
                  at: approved.executedAt,
                  actor: approved.approvedBy,
                  action: 'approve-document',
                  documentId: id,
                  batchId: doc.batchId,
                  reportNumber: reportNum,
                  reportTitle,
                });
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
                    if (doc.kind === 'transfer') {
                      movedSnapshotsForReport.push({
                        part_number: after.part_number,
                        location_code: after.location_code,
                        old_location: after.old_location || before?.location_code || line.old_location || '',
                        description_en: after.description_en,
                        description_ar: after.description_ar,
                        category: after.category,
                        qty_total: after.qty_total,
                        qty_out: after.qty_out,
                        qty_remaining: after.qty_remaining,
                        is_moved: 1,
                        is_missing: after.is_missing || 0,
                        status: 'تم النقل',
                        moved_at: after.moved_at || executedTimeFallback(),
                        remark: line.remark || doc.reason || '',
                      });
                    }
                    audit.add({
                      at: after.updated_at,
                      actor: 'local-supervisor',
                      action: doc.kind,
                      documentId: id,
                      batchId: doc.batchId,
                      before,
                      after,
                    });
                  }
                  processLine(lineIndex + 1);
                } catch (error) {
                  fail(error);
                }
              };
            };
            processLine(0);
          } catch (error) {
            fail(error);
          }
        };
      };
      const executedTimeFallback = () => new Date().toISOString();
      processDocument(0);
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(failure || tx.error || new Error('تعذر الاعتماد والحفظ في المخزون'));
    });
    await this.loadAndCleanCache();
  }

  private applyDocumentLine(
    doc: StockDocument,
    line: StockDocument['lines'][number],
    before?: InventoryItem
  ): InventoryItem | undefined {
    const now = new Date().toISOString();
    const marks = interpretMark(line.check, line.remark);
    const safeDescEn = (line.description_en || before?.description_en || '').trim();
    const { category, descAr } = categorizeAndTranslate(safeDescEn);
    const safeLoc =
      sanitizeLocationCode(line.location) ||
      line.location.trim().toUpperCase() ||
      before?.location_code ||
      '';
    const safeLineQty =
      Number.isFinite(line.quantity) && line.quantity >= 0 ? Math.round(line.quantity) : 0;

    if (doc.kind === 'inventory' && marks.excludedIncrease && before) return;

    const fresh = (): InventoryItem => ({
      part_number: line.part_number,
      location_code: safeLoc,
      description_en: safeDescEn,
      description_ar: line.description_ar || descAr,
      category,
      qty_total: safeLineQty,
      qty_out: 0,
      qty_remaining: safeLineQty,
      is_moved: 0,
      is_missing: 0,
      status: 'غير مدقق',
    });

    let after: InventoryItem;
    if (doc.kind === 'receipt') {
      // إدخال المخزون لا يسجل القطعة كمنقولة
      after = before
        ? {
            ...before,
            location_code: safeLoc,
            is_moved: before.is_moved || 0,
            qty_total: before.qty_total + safeLineQty,
            qty_remaining: before.qty_remaining + safeLineQty,
          }
        : fresh();
    } else if (doc.kind === 'issue') {
      if (!before) return undefined;
      const issueQty = Math.min(before.qty_remaining, safeLineQty);
      after = {
        ...before,
        qty_out: before.qty_out + issueQty,
        qty_remaining: Math.max(0, before.qty_remaining - issueQty),
      };
    } else if (doc.kind === 'transfer') {
      // حصراً عند تنفيذ عملية نقل من قِبل المستخدم تُسجل القطعة كمنقولة
      if (!before) return undefined;
      after = {
        ...before,
        old_location: before.location_code,
        location_code: safeLoc,
        is_moved: 1,
        status: 'تم النقل',
        moved_at: now,
      };
    } else {
      // أوراق الجرد (inventory): لا تسجل أي قطعة كمنقولة أبداً؛ تحافظ فقط على حالة النقل السابقة إن كانت منقولة فعلياً من المستخدم
      let base = before || fresh();
      const previouslyMovedByUser = before?.is_moved === 1 ? 1 : 0;

      if (
        before &&
        doc.duplicateResolution === 'sum' &&
        doc.lines.filter((row) => row.part_number === line.part_number).length > 1
      ) {
        base = {
          ...before,
          qty_total: Math.max(before.qty_total, safeLineQty),
          qty_remaining: Math.max(before.qty_remaining, safeLineQty),
        };
      } else if (before && safeLineQty > 0) {
        base = {
          ...before,
          qty_total: safeLineQty,
        };
      }

      const isMissing = marks.status === 'غير موجودة' ? 1 : 0;
      const safeTotal = Math.max(0, base.qty_total);
      const nextOut = isMissing
        ? 0
        : marks.shortage > 0
        ? Math.min(safeTotal, marks.shortage)
        : Math.min(safeTotal, base.qty_out);
      const nextRemaining = isMissing ? 0 : Math.max(0, safeTotal - nextOut);
      const cleanRemark =
        marks.shortage > 0
          ? `-${marks.shortage}`
          : marks.excludedIncrease
          ? ''
          : line.remark;

      after = {
        ...base,
        old_location: previouslyMovedByUser ? base.old_location : undefined,
        location_code: safeLoc,
        is_moved: previouslyMovedByUser,
        status: isMissing ? 'غير موجودة' : previouslyMovedByUser ? 'تم النقل' : marks.status,
        is_missing: isMissing,
        remark: cleanRemark,
        mark_symbol: line.mark_symbol ?? marks.mark_symbol,
        audit_meaning: line.audit_meaning ?? marks.audit_meaning,
        qty_total: safeTotal,
        qty_out: nextOut,
        qty_remaining: nextRemaining,
      };
    }
    after.updated_at = now;
    return after;
  }

  public getAvailableItems(): InventoryItem[] {
    return this.ensureInternalCache()
      .filter((item) => item.qty_remaining > 0 && item.is_missing !== 1)
      .map(cloneItem);
  }

  public async exportBackup(): Promise<string> {
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    const snapshot = await new Promise<{
      items: InventoryItem[];
      audit: unknown[];
      documents: StockDocument[];
    }>((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME, 'audit', 'documents'], 'readonly');
      const items = tx.objectStore(STORE_NAME).getAll();
      const audit = tx.objectStore('audit').getAll();
      const docs = tx.objectStore('documents').getAll();
      tx.oncomplete = () =>
        resolve({ items: items.result, audit: audit.result, documents: docs.result });
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    const documents = await Promise.all(
      snapshot.documents.map(async (doc) => ({
        ...doc,
        original: doc.original
          ? {
              type: doc.original.type,
              bytes: Array.from(new Uint8Array(await doc.original.arrayBuffer())),
            }
          : undefined,
      }))
    );
    return JSON.stringify({
      format: 'asmo-backup-v1',
      createdAt: new Date().toISOString(),
      ...snapshot,
      documents,
    });
  }

  public async restoreBackup(text: string): Promise<void> {
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    const trimmed = (text || '').replace(/^\ufeff/, '').trim();
    if (!trimmed) throw new Error('الملف فارغ');

    // دعم استيراد ملفات CSV المصدرة من زر (مشاركة Excel 📊) أو من جدول التقارير
    if (!trimmed.startsWith('{')) {
      const csvLines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const parsedCsvItems: any[] = [];
      for (const line of csvLines) {
        const cols = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
        const partCandidate = cols.find((c) => /^\d{10}$/.test(c));
        if (!partCandidate) continue;
        const partIdx = cols.indexOf(partCandidate);
        const locCandidate =
          cols.find(
            (c, i) => i !== partIdx && /^[A-Z]{1,3}\d{0,3}[A-Z0-9-]*$/i.test(c) && !/^\d+$/.test(c)
          ) || cols[1] || '';
        const qtyCandidate =
          cols.find((c, i) => i !== partIdx && /^\d{1,6}$/.test(c)) || cols[2] || '0';
        const descCandidate =
          cols
            .filter(
              (c, i) =>
                i !== partIdx &&
                c !== locCandidate &&
                c !== qtyCandidate &&
                c.length > 2
            )
            .join(' ') || cols[3] || '';
        parsedCsvItems.push({
          part_number: partCandidate,
          location_code: locCandidate.toUpperCase(),
          qty_total: Number(qtyCandidate) || 0,
          description_en: descCandidate,
          status: 'مدقق',
        });
      }
      if (!parsedCsvItems.length) {
        throw new Error('لم يتم العثور على أرقام قطع صالحة (10 أرقام) في الملف');
      }
      await this.smartUpsertBatch(parsedCsvItems);
      return;
    }

    const data = JSON.parse(trimmed);
    if (data.format !== 'asmo-backup-v1' || !Array.isArray(data.items))
      throw new Error('نسخة غير صالحة');
    const keys = new Set<string>();
    for (const item of data.items) {
      if (
        !item ||
        typeof item.part_number !== 'string' ||
        !item.part_number.trim() ||
        item.part_number.length > 128 ||
        keys.has(item.part_number) ||
        ![item.qty_total, item.qty_out, item.qty_remaining].every(
          (v) => Number.isSafeInteger(v) && v >= 0
        ) ||
        item.qty_out > item.qty_total ||
        item.qty_remaining > item.qty_total - item.qty_out ||
        typeof item.location_code !== 'string' ||
        typeof item.description_en !== 'string' ||
        typeof item.description_ar !== 'string' ||
        typeof item.category !== 'string'
      )
        throw new Error('سجل غير صالح في النسخة؛ لم تُطبق الاستعادة');
      keys.add(item.part_number);
    }
    const documents: StockDocument[] = await Promise.all(
      (data.documents || []).map(async (doc: any) => {
        validateDocument(doc);
        if (!['pending', 'approved'].includes(doc.status))
          throw new Error('حالة مستند غير صالحة');
        const original = doc.original
          ? new Blob([new Uint8Array(doc.original.bytes)], { type: doc.original.type })
          : undefined;
        return { ...doc, original, originalHash: undefined };
      })
    );
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME, 'audit', 'documents'], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const audit = tx.objectStore('audit');
      for (const item of data.items) {
        const req = store.get(item.part_number);
        req.onsuccess = () => {
          audit.add({
            at: new Date().toISOString(),
            actor: 'local-supervisor',
            action: 'restore',
            before: req.result,
            after: item,
          });
          store.put(item);
        };
      }
      const docs = tx.objectStore('documents');
      for (const doc of documents) {
        const req = docs.get(doc.id);
        req.onsuccess = () => {
          if (!req.result) docs.add(doc);
        };
      }
      audit.add({
        at: new Date().toISOString(),
        actor: 'local-supervisor',
        action: 'restore-archive',
        archivedAudit: data.audit || [],
      });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
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
    this.locationsSummaryCache = null;
    this.isCacheDirty = false;
  }

  private async putInStore(item: InventoryItem): Promise<void> {
    await this.commitChanges([item], []);
  }
}

export const dbService = new InventoryDatabase();
