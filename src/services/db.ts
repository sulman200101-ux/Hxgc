import { approvalLines, canonicalDocumentId, interpretMark, validateDocument, type StockDocument } from './documents';
import { authorizeMutation } from './security';
import type { InventoryItem, LocationSummary } from '../types';
import { categorizeAndTranslate } from '../utils/translator';
import {
  sanitizeLocationCode,
  strict10DigitRegexFilter,
  dynamicLocationNormalizer,
  isValidSpecificLocation,
  repair10DigitMaterialCode,
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
  isConsumablePart,
  isConsumableTargetLocation,
  resolveTargetConsumableLocation,
  suggestConsumableItemsToAOrFL,
} from './transferSuggestions';

import { getCandidateApiUrls } from './geminiVisionService';
import { parseSapPipeBatchText, type ParsedSapBatchStats } from '../utils/sapTextParser';

const DB_NAME = 'ASMO_Inventory_DB';
const DB_VERSION = 8;
const STORE_NAME = 'items';
const SYNC_LEDGER_KEY = 'asmo_inventory_sync_ledger_v1';

interface LocalSyncLedger {
  wipedAt: string | null;
  lastServerWipeAt: string | null;
  staticSeedRevision: number;
  staticSeedWiped: boolean;
  deleted: Record<string, string>;
}

function readLocalSyncLedger(): LocalSyncLedger {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { wipedAt: null, lastServerWipeAt: null, staticSeedRevision: 0, staticSeedWiped: false, deleted: {} };
  }
  try {
    const raw = window.localStorage.getItem(SYNC_LEDGER_KEY);
    if (!raw) return { wipedAt: null, lastServerWipeAt: null, staticSeedRevision: 0, staticSeedWiped: false, deleted: {} };
    const parsed = JSON.parse(raw);
    return {
      wipedAt: parsed?.wipedAt ? String(parsed.wipedAt) : null,
      lastServerWipeAt: parsed?.lastServerWipeAt ? String(parsed.lastServerWipeAt) : null,
      staticSeedRevision: Number(parsed?.staticSeedRevision || 0),
      staticSeedWiped: Boolean(parsed?.staticSeedWiped),
      deleted: parsed?.deleted && typeof parsed.deleted === 'object' ? parsed.deleted : {},
    };
  } catch {
    return { wipedAt: null, lastServerWipeAt: null, staticSeedRevision: 0, staticSeedWiped: false, deleted: {} };
  }
}

function writeLocalSyncLedger(ledger: LocalSyncLedger): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SYNC_LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // ignore quota errors
  }
}

async function fetchInventoryEndpoint<T>(
  apiPath: string,
  init?: RequestInit,
  timeoutMs: number = 5000
): Promise<T | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  const urls = getCandidateApiUrls(apiPath);
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (res.ok) {
        return (await res.json()) as T;
      }
    } catch {
      // ignore offline/network errors and try next candidate URL
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const cloneItem = (item: InventoryItem): InventoryItem => ({ ...item });

function notifyDbProgress(detail: {
  active: boolean;
  title?: string;
  stage?: string;
  done?: number;
  total?: number;
  percent?: number;
}): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('asmo-db-progress', { detail }));
  } catch {
    // ignore in non-DOM contexts
  }
}

function hasDuplicateLinesInDoc(doc: StockDocument): boolean {
  const seen = new Set<string>();
  for (const line of doc.lines) {
    const clean = String(line.part_number || '').trim();
    if (!clean) continue;
    if (seen.has(clean)) return true;
    seen.add(clean);
  }
  return false;
}

class InventoryDatabase {
  private db: IDBDatabase | null = null;
  private itemMap: Map<string, InventoryItem> = new Map();
  private cache: InventoryItem[] = [];
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
    const items = await new Promise<InventoryItem[]>((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    const enrichedItems = items.map((item) => {
      if (typeof item.description_en === 'string' && item.description_en.trim()) {
        const needsDescEnrich =
          !item.description_ar?.trim() || item.description_ar === item.description_en;
        const needsCatEnrich = !item.category?.trim();
        if (needsDescEnrich || needsCatEnrich) {
          const suggestion = categorizeAndTranslate(item.description_en);
          const updated = { ...item };
          if (needsDescEnrich && suggestion.descAr && suggestion.descAr !== item.description_en) {
            updated.description_ar = suggestion.descAr;
          }
          if (needsCatEnrich && suggestion.category) {
            updated.category = suggestion.category;
          }
          return updated;
        }
      }
      return item;
    });
    this.itemMap = new Map(enrichedItems.map((item) => [item.part_number, item]));
    this.rebuildCacheArray();
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
          manual_audit_count: 0,
          qain_count: 0,
          consumable_count: 0,
        };
        summaryMap.set(loc, entry);
      }

      entry.item_count += 1;
      entry.total_qty += Number(item.qty_total) || 0;
      entry.out_qty += Number(item.qty_out) || 0;
      entry.remaining_qty += Number(item.qty_remaining) || 0;

      if (item.is_missing === 1 || item.status === 'غير موجودة') {
        entry.missing_count += 1;
      } else if (item.status === 'مدقق' || item.is_manual_audit === 1) {
        entry.added_count += 1;
      } else {
        entry.unverified_count += 1;
      }
      if (item.status === 'منقول' || item.status === 'تم النقل' || item.is_moved === 1) {
        entry.moved_count += 1;
      }
      if (item.is_manual_audit === 1) {
        entry.manual_audit_count = (entry.manual_audit_count || 0) + 1;
      }
      if (item.is_qain === 1) {
        entry.qain_count = (entry.qain_count || 0) + 1;
      }
      if (isConsumablePart(item)) {
        entry.consumable_count = (entry.consumable_count || 0) + 1;
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
      /^\d{8,12}$/.test(q) &&
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
        if (statusFilter === 'مدقق يدوي') {
          if (item.is_manual_audit !== 1) continue;
        } else if (statusFilter === 'قين') {
          if (item.is_qain !== 1) continue;
        } else if (statusFilter === 'استهلاكية') {
          if (!isConsumablePart(item)) continue;
        } else if (statusFilter === 'غير موجودة' || statusFilter === 'مفقود') {
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
        } else if (statusFilter === 'مدقق') {
          if (item.status !== 'مدقق' && item.is_manual_audit !== 1) continue;
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
    remark?: string,
    extraFlags?: {
      is_consumable?: number;
      is_qain?: number;
      qain_note?: string;
      is_manual_audit?: number;
    }
  ): Promise<InventoryItem> {
    const cleanPart = partNum.trim();
    if (!/^\d{8,12}$/.test(cleanPart)) throw new Error('رقم القطعة يجب أن يتكون من 8 إلى 12 رقماً');
    if (!Number.isFinite(qty) || !Number.isFinite(qtyOut) || qty < 0 || qtyOut < 0 || qtyOut > qty) {
      throw new Error('الكمية المصروفة لا يمكن أن تتجاوز الإجمالي');
    }
    const safeQty = Math.round(qty * 1000) / 1000;
    const safeOut = Math.round(qtyOut * 1000) / 1000;
    const cleanLocation = sanitizeLocationCode(locCode) || locCode.trim().toUpperCase();

    const existing = this.itemMap.get(cleanPart);
    const isMoved =
      existing && cleanLocation && existing.location_code && existing.location_code !== cleanLocation
        ? 1
        : existing?.is_moved || 0;
    const isMissing =
      isMissingFlag !== undefined ? isMissingFlag : forcedStatus === 'غير موجودة' ? 1 : 0;
    const remaining = isMissing ? 0 : Math.round(Math.max(0, safeQty - safeOut) * 1000) / 1000;

    const cachedAr = existingAr || existing?.description_ar;
    const { category, descAr } = categorizeAndTranslate(descEn);
    const finalDescAr = cachedAr || descAr;

    const nowIso = new Date().toISOString();
    const isManualAudit =
      extraFlags?.is_manual_audit !== undefined
        ? extraFlags.is_manual_audit
        : existing?.is_manual_audit || 0;
    const isQain =
      extraFlags?.is_qain !== undefined ? extraFlags.is_qain : existing?.is_qain || 0;
    const isConsumable =
      extraFlags?.is_consumable !== undefined
        ? extraFlags.is_consumable
        : existing?.is_consumable !== undefined
        ? existing.is_consumable
        : isConsumablePart({
            description_en: descEn || existing?.description_en || '',
            description_ar: finalDescAr,
            category,
          })
        ? 1
        : 0;

    let status: InventoryItem['status'] = forcedStatus || 'غير مدقق';
    if (isMissing) {
      status = 'غير موجودة';
    } else if (isManualAudit === 1) {
      status = 'مدقق';
    } else if (isMoved && !forcedStatus) {
      status = 'تم النقل';
    } else if (!forcedStatus) {
      status = existing ? existing.status : 'غير مدقق';
    }

    const item: InventoryItem = {
      part_number: cleanPart,
      location_code: cleanLocation,
      old_location:
        isMoved && existing ? existing.old_location || existing.location_code : existing?.old_location,
      description_en: (descEn || existing?.description_en || '').trim(),
      description_ar: finalDescAr,
      category: existing?.category || category,
      qty_total: safeQty,
      qty_out: safeOut,
      qty_remaining: remaining,
      is_moved: isMoved,
      is_missing: isMissing,
      remark: remark ?? existing?.remark,
      is_consumable: isConsumable,
      is_qain: isQain,
      qain_note: extraFlags?.qain_note !== undefined ? extraFlags.qain_note : existing?.qain_note,
      qain_marked_at: isQain ? existing?.qain_marked_at || nowIso : undefined,
      is_manual_audit: isManualAudit,
      manual_audited_at: isManualAudit ? existing?.manual_audited_at || nowIso : undefined,
      status,
      updated_at: nowIso,
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
    for (const raw of items) {
      if (!raw || (!raw.location_code && !raw.location)) {
        throw new Error('بيانات القراءة غير مكتملة؛ يجب اعتماد المستند بعد مراجعة الموقع والكمية');
      }
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
      if (!/^\d{8,12}$/.test(cleanPart)) continue;
      const cleanLoc =
        sanitizeLocationCode(String(raw.location_code || raw.location || '')) ||
        String(raw.location_code || raw.location || '').trim().toUpperCase();
      const existing = this.itemMap.get(cleanPart);
      const isMoved =
        existing && cleanLoc && existing.location_code && existing.location_code !== cleanLoc
          ? 1
          : existing?.is_moved || 0;
      const isMissing = raw.is_missing === 1 || raw.status === 'غير موجودة' ? 1 : 0;
      const total = Number.isFinite(raw.qty_total) && raw.qty_total >= 0 ? Math.round(raw.qty_total * 1000) / 1000 : 0;
      const out = isMissing
        ? 0
        : Number.isFinite(raw.qty_out) && raw.qty_out >= 0
        ? Math.min(total, Math.round(raw.qty_out * 1000) / 1000)
        : 0;
      const remaining = isMissing ? 0 : Math.round(Math.max(0, total - out) * 1000) / 1000;
      const descEn = String(raw.description_en || existing?.description_en || '').trim();
      const { category, descAr } = categorizeAndTranslate(descEn);

      if (existing) {
        updatedCount++;
        if (existing.location_code !== cleanLoc) movedCount++;
      } else {
        insertedCount++;
      }
      if (isMissing) missingCount++;

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
          old_location: isMoved && existing ? existing.location_code : existing?.old_location,
          description_en: descEn,
          description_ar: raw.description_ar || existing?.description_ar || descAr,
          category: raw.category || existing?.category || category,
          qty_total: total,
          qty_out: out,
          qty_remaining: remaining,
          is_moved: isMoved,
          is_missing: isMissing,
          remark: raw.remark ?? existing?.remark,
          status: isMissing ? 'غير موجودة' : raw.status || 'غير مدقق',
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
    const now = new Date().toISOString();
    const isManualAudit = newStatus === 'مدقق' ? 1 : newStatus === 'غير مدقق' ? 0 : item.is_manual_audit || 0;
    const updated: InventoryItem = {
      ...item,
      status: newStatus,
      is_missing: isMissing,
      is_manual_audit: isManualAudit,
      manual_audited_at: isManualAudit ? item.manual_audited_at || now : undefined,
      audit_meaning: isManualAudit ? 'مدقق يدوي بواسطة المستخدم ✓' : item.audit_meaning,
      qty_remaining: isMissing ? 0 : Math.max(0, item.qty_total - item.qty_out),
      updated_at: now,
    };
    await this.putInStore(updated);
    this.itemMap.set(partNumber, updated);
    this.isCacheDirty = true;
  }

  /**
   * تبديل حالة "مدقق يدوي ✓" التي يضعها المستخدم أثناء التدقيق الميداني على القطع
   */
  public async toggleManualAudit(partNumber: string, forceValue?: boolean): Promise<InventoryItem | null> {
    const item = this.itemMap.get(partNumber);
    if (!item) return null;
    const nextAudit = forceValue !== undefined ? (forceValue ? 1 : 0) : item.is_manual_audit === 1 ? 0 : 1;
    const now = new Date().toISOString();
    const updated: InventoryItem = {
      ...item,
      is_manual_audit: nextAudit,
      manual_audited_at: nextAudit === 1 ? now : undefined,
      is_missing: nextAudit === 1 ? 0 : item.is_missing,
      status: nextAudit === 1 ? 'مدقق' : 'غير مدقق',
      mark_symbol: nextAudit === 1 ? '✓' : null,
      audit_meaning: nextAudit === 1 ? 'مدقق يدوي بواسطة المستخدم ✓' : null,
      qty_remaining: nextAudit === 1 ? Math.max(0, item.qty_total - item.qty_out) : item.qty_remaining,
      updated_at: now,
    };
    await this.putInStore(updated);
    this.itemMap.set(partNumber, updated);
    this.isCacheDirty = true;
    return cloneItem(updated);
  }

  /**
   * وضع أو إزالة علامة "قين" على القطعة وإضافتها لقائمة قين
   */
  public async toggleQainMark(
    partNumber: string,
    forceValue?: boolean,
    note?: string
  ): Promise<InventoryItem | null> {
    const item = this.itemMap.get(partNumber);
    if (!item) return null;
    const nextQain = forceValue !== undefined ? (forceValue ? 1 : 0) : item.is_qain === 1 ? 0 : 1;
    const now = new Date().toISOString();
    const updated: InventoryItem = {
      ...item,
      is_qain: nextQain,
      qain_marked_at: nextQain === 1 ? item.qain_marked_at || now : undefined,
      qain_note: note !== undefined ? note : nextQain === 1 ? item.qain_note : undefined,
      updated_at: now,
    };
    await this.putInStore(updated);
    this.itemMap.set(partNumber, updated);
    this.isCacheDirty = true;
    return cloneItem(updated);
  }

  public async updateQainNote(partNumber: string, note: string): Promise<InventoryItem | null> {
    const item = this.itemMap.get(partNumber);
    if (!item) return null;
    const now = new Date().toISOString();
    const updated: InventoryItem = {
      ...item,
      is_qain: 1,
      qain_marked_at: item.qain_marked_at || now,
      qain_note: note.trim(),
      updated_at: now,
    };
    await this.putInStore(updated);
    this.itemMap.set(partNumber, updated);
    this.isCacheDirty = true;
    return cloneItem(updated);
  }

  /**
   * تحديد أو إلغاء تحديد القطعة كـ "قطعة استهلاكية (A / FL)"
   */
  public async toggleConsumableMark(partNumber: string, forceValue?: boolean): Promise<InventoryItem | null> {
    const item = this.itemMap.get(partNumber);
    if (!item) return null;
    const currentlyConsumable = isConsumablePart(item);
    const nextVal = forceValue !== undefined ? (forceValue ? 1 : 0) : currentlyConsumable ? 0 : 1;
    const now = new Date().toISOString();
    const updated: InventoryItem = {
      ...item,
      is_consumable: nextVal,
      updated_at: now,
    };
    await this.putInStore(updated);
    this.itemMap.set(partNumber, updated);
    this.isCacheDirty = true;
    return cloneItem(updated);
  }

  /**
   * البحث التلقائي الشامل عن جميع القطع الاستهلاكية في المخزون ووضع علامة (استهلاكية ✓) عليها
   */
  public async markAllDetectedConsumableItems(): Promise<{ totalConsumables: number; newlyMarked: number }> {
    const allItems = this.ensureInternalCache();
    notifyDbProgress({
      active: true,
      title: 'جارٍ فحص المخزون وتحديد القطع الاستهلاكية (A / FL)...',
      stage: `فحص ${allItems.length.toLocaleString()} قطعة في قاعدة البيانات...`,
      done: 0,
      total: Math.max(1, allItems.length),
      percent: 20,
    });
    const now = new Date().toISOString();
    const toUpdate: InventoryItem[] = [];
    let totalConsumables = 0;

    for (const item of allItems) {
      if (isConsumablePart(item)) {
        totalConsumables++;
        if (item.is_consumable !== 1) {
          toUpdate.push({
            ...item,
            is_consumable: 1,
            updated_at: now,
          });
        }
      }
    }

    if (toUpdate.length > 0) {
      await this.commitChanges(toUpdate, []);
    } else {
      notifyDbProgress({
        active: false,
        title: `اكتمل فحص القطع الاستهلاكية (${totalConsumables} قطعة استهلاكية) ✓`,
        done: allItems.length,
        total: Math.max(1, allItems.length),
        percent: 100,
      });
    }

    return { totalConsumables, newlyMarked: toUpdate.length };
  }

  /**
   * وضع أو إزالة علامة (استهلاكية ✓) لمجموعة من القطع دفعة واحدة بعد البحث عنها
   */
  public async markMultipleAsConsumable(partNumbers: string[], isConsumableVal: boolean = true): Promise<number> {
    const now = new Date().toISOString();
    const toUpdate: InventoryItem[] = [];
    const targetFlag = isConsumableVal ? 1 : 0;

    for (const partNum of partNumbers) {
      const item = this.itemMap.get(partNum);
      if (item && item.is_consumable !== targetFlag) {
        toUpdate.push({
          ...item,
          is_consumable: targetFlag,
          updated_at: now,
        });
      }
    }

    if (toUpdate.length > 0) {
      await this.commitChanges(toUpdate, []);
    }

    return toUpdate.length;
  }

  public getQainItems(): InventoryItem[] {
    return this.ensureInternalCache()
      .filter((i) => i.is_qain === 1)
      .map(cloneItem);
  }

  public getConsumableItems(): InventoryItem[] {
    return this.ensureInternalCache()
      .filter((i) => isConsumablePart(i))
      .map(cloneItem);
  }

  public getManualAuditedItems(): InventoryItem[] {
    return this.ensureInternalCache()
      .filter((i) => i.is_manual_audit === 1)
      .map(cloneItem);
  }

  public async relocateAllConsumableItemsToAOrFL(targetOverride?: string): Promise<InventoryItem[]> {
    const allItems = this.ensureInternalCache();
    const suggestions = suggestConsumableItemsToAOrFL(allItems);
    if (suggestions.length === 0) return [];

    const docId = `CONSUMABLE-AFL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const lines = suggestions.map((sug) => {
      const destBin =
        targetOverride && isValidSpecificLocation(targetOverride)
          ? sanitizeLocationCode(targetOverride) || targetOverride.trim().toUpperCase()
          : sug.to;
      return {
        old_location: sug.from,
        part_number: sug.partNumber,
        quantity: sug.quantity,
        location: destBin,
        description_en: sug.descriptionEn,
        description_ar: sug.descriptionAr,
        check: '',
        remark: sug.reason,
        reviewed: true,
      };
    });

    await this.submitDocument({
      id: docId,
      kind: 'transfer',
      requester: 'نظام توجيه القطع الاستهلاكية إلى مواقع A / FL',
      reason: `نقل وتجميع القطع الاستهلاكية (${suggestions.length} قطعة) إلى أرفف الصرف السريع (A / FL)`,
      lines,
      status: 'pending',
      createdAt: '',
    });

    await this.approveDocument(docId);

    return suggestions
      .map((s) => this.getItemByPartNumber(s.partNumber))
      .filter((i): i is InventoryItem => Boolean(i));
  }

  public async batchImport(items: InventoryItem[]): Promise<number> {
    if (!this.db || items.length === 0) return 0;

    await this.batchPutInStore(items);

    return items.length;
  }

  private async batchPutInStore(items: InventoryItem[]): Promise<void> {
    await this.commitChanges(items, []);
  }

  public async importSapBatchText(rawText: string): Promise<{
    total: number;
    stats: ParsedSapBatchStats;
  }> {
    const nowIso = new Date().toISOString();
    const { items, stats } = parseSapPipeBatchText(rawText, { nowIso });
    if (items.length > 0 && this.db) {
      await this.commitChanges(items, []);
    }
    return { total: items.length, stats };
  }

  public async seedFromExternalStoreIfNeeded(): Promise<number> {
    if (!this.db) return 0;
    if (typeof window === 'undefined' || typeof fetch !== 'function') return 0;

    const ledger = readLocalSyncLedger();

    const candidateAssets = ['./inventory-store.json', '/inventory-store.json'];
    for (const assetUrl of candidateAssets) {
      try {
        const assetRes = await fetch(assetUrl, { cache: 'no-store' });
        if (!assetRes.ok) continue;
        const staticData: any = await assetRes.json();
        const assetRevision = Number(staticData?.revision || 1);

        const rawList: InventoryItem[] = Array.isArray(staticData?.items)
          ? staticData.items
          : Object.values(staticData?.items || {});

        // إذا تم إصدار نسخة أحدث من قاعدة البيانات الخارجية (revision أعلى)، نلغي أي حظر مسح قديم ونعتمد النسخة الجديدة
        if (assetRevision > ledger.staticSeedRevision && !staticData?.wipedAt && rawList.length > 0) {
          ledger.staticSeedWiped = false;
          ledger.wipedAt = null;
          ledger.deleted = {};
        }

        if (ledger.staticSeedWiped && ledger.staticSeedRevision >= assetRevision) {
          return 0;
        }

        const isDbEmpty = this.itemMap.size === 0;
        if (ledger.staticSeedRevision >= assetRevision && !isDbEmpty) {
          return 0;
        }

        const staticTombstones: Record<string, string> =
          staticData?.tombstones && typeof staticData.tombstones === 'object'
            ? staticData.tombstones
            : {};

        const toDelete: string[] = [];
        for (const [pn, tombAt] of Object.entries(staticTombstones)) {
          const localItem = this.itemMap.get(pn);
          if (localItem && (!localItem.updated_at || String(tombAt) >= localItem.updated_at)) {
            toDelete.push(pn);
          }
        }
        const deleteSet = new Set(toDelete);

        const toSeed: InventoryItem[] = [];
        for (const sItem of rawList) {
          const pn = String(sItem?.part_number || '').trim();
          if (!/^\d{8,12}$/.test(pn)) continue;
          const sTime = String(sItem?.updated_at || '');
          const localTomb = ledger.deleted[pn];
          if (localTomb && (!sTime || sTime < localTomb)) continue;
          const remoteTomb = staticTombstones[pn];
          if (remoteTomb && (!sTime || sTime < String(remoteTomb))) continue;

          const localItem = this.itemMap.get(pn);
          if (!localItem) {
            toSeed.push({ ...sItem, part_number: pn });
          } else if (
            assetRevision > ledger.staticSeedRevision ||
            (sTime && (!localItem.updated_at || sTime > localItem.updated_at))
          ) {
            deleteSet.delete(pn);
            toSeed.push({ ...sItem, part_number: pn });
          }
        }

        const finalDeletes = Array.from(deleteSet);
        if (toSeed.length > 0 || finalDeletes.length > 0) {
          await this.commitChanges(toSeed, finalDeletes, false, { skipRemoteSync: true });
        }

        ledger.staticSeedRevision = assetRevision;
        writeLocalSyncLedger(ledger);
        return toSeed.length;
      } catch {
        // try next asset path
      }
    }
    return 0;
  }

  public async syncWithRemoteStore(): Promise<{ synced: boolean; applied: number; removed: number }> {
    if (!this.db) return { synced: false, applied: 0, removed: 0 };

    const ledger = readLocalSyncLedger();

    const remote = await fetchInventoryEndpoint<{
      ok: boolean;
      revision?: number;
      wipedAt: string | null;
      items: InventoryItem[];
      tombstones: Record<string, string>;
    }>('/api/inventory/state', { method: 'GET' }, 4500);

    // في وضع APK بدون اتصال أو النسخة المستقلة dist/، أو إذا كان الخادم فارغاً بدون مسح، نعتمد على القاعدة الخارجية ./inventory-store.json
    if (
      !remote ||
      !remote.ok ||
      !Array.isArray(remote.items) ||
      (remote.items.length === 0 && !remote.wipedAt)
    ) {
      const seededCount = await this.seedFromExternalStoreIfNeeded();
      return { synced: true, applied: seededCount, removed: 0 };
    }

    let ledgerDirty = false;
    const remoteRevision = Number(remote.revision || 0);
    if (remoteRevision > ledger.staticSeedRevision && !remote.wipedAt && remote.items.length > 0) {
      ledger.staticSeedWiped = false;
      ledger.wipedAt = null;
      ledger.deleted = {};
      ledger.staticSeedRevision = remoteRevision;
      ledgerDirty = true;
    }

    const toUpsert: InventoryItem[] = [];
    const toDelete: string[] = [];

    // 1. Apply remote wipe timestamp if newer than local items
    if (remote.wipedAt && remote.wipedAt !== ledger.lastServerWipeAt) {
      for (const localItem of this.itemMap.values()) {
        if (!localItem.updated_at || localItem.updated_at < remote.wipedAt) {
          toDelete.push(localItem.part_number);
        }
      }
      ledger.lastServerWipeAt = remote.wipedAt;
      ledgerDirty = true;
    }

    // 2. Apply remote tombstones against older local items
    if (remote.tombstones && typeof remote.tombstones === 'object') {
      for (const [pn, tombAt] of Object.entries(remote.tombstones)) {
        const localItem = this.itemMap.get(pn);
        if (localItem && (!localItem.updated_at || tombAt >= localItem.updated_at)) {
          if (!toDelete.includes(pn)) toDelete.push(pn);
        }
      }
    }

    const deleteSet = new Set(toDelete);

    // 3. Apply remote items respecting local wipe/tombstones
    for (const sItem of remote.items) {
      if (!sItem || !/^\d{8,12}$/.test(String(sItem.part_number || '').trim())) continue;
      const pn = sItem.part_number.trim();
      const sTime = sItem.updated_at || '';

      if (ledger.wipedAt && (!sTime || sTime < ledger.wipedAt)) continue;
      const localTombAt = ledger.deleted[pn];
      if (localTombAt && (!sTime || sTime < localTombAt)) continue;

      const localItem = this.itemMap.get(pn);
      if (!localItem || deleteSet.has(pn)) {
        toUpsert.push(sItem);
        deleteSet.delete(pn);
      } else if (sTime && (!localItem.updated_at || sTime > localItem.updated_at)) {
        toUpsert.push(sItem);
      }
    }

    const finalDeletes = Array.from(deleteSet);

    if (toUpsert.length > 0 || finalDeletes.length > 0) {
      await this.commitChanges(toUpsert, finalDeletes, false, { skipRemoteSync: true });
    }

    // 4. Push local tombstones or offline items that server doesn't yet reflect
    const remoteMap = new Map(remote.items.map((it) => [it.part_number, it]));
    const pendingDeletesToPush: string[] = [];
    for (const [pn, tombAt] of Object.entries(ledger.deleted)) {
      const sItem = remoteMap.get(pn);
      if (sItem && (!sItem.updated_at || tombAt >= sItem.updated_at)) {
        pendingDeletesToPush.push(pn);
      }
    }
    if (pendingDeletesToPush.length > 0) {
      fetchInventoryEndpoint('/api/inventory/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partNumbers: pendingDeletesToPush }),
      }).catch(() => {});
    }

    const pendingUpsertsToPush: InventoryItem[] = [];
    for (const localItem of this.itemMap.values()) {
      const lTime = localItem.updated_at || '';
      if (remote.wipedAt && (!lTime || lTime < remote.wipedAt)) continue;
      const rTomb = remote.tombstones?.[localItem.part_number];
      if (rTomb && (!lTime || lTime < rTomb)) continue;
      const sItem = remoteMap.get(localItem.part_number);
      if (!sItem || (lTime && (!sItem.updated_at || lTime > sItem.updated_at))) {
        pendingUpsertsToPush.push(localItem);
      }
    }
    if (pendingUpsertsToPush.length > 0) {
      fetchInventoryEndpoint('/api/inventory/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: pendingUpsertsToPush }),
      }).catch(() => {});
    }

    if (ledgerDirty) {
      writeLocalSyncLedger(ledger);
    }

    return { synced: true, applied: toUpsert.length, removed: finalDeletes.length };
  }

  private pushSyncDelta(items: InventoryItem[], deletes: string[], clear: boolean): void {
    const nowIso = new Date().toISOString();
    const ledger = readLocalSyncLedger();

    if (clear) {
      ledger.wipedAt = nowIso;
      ledger.staticSeedWiped = true;
      ledger.deleted = {};
      writeLocalSyncLedger(ledger);
      fetchInventoryEndpoint('/api/inventory/wipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wipedAt: nowIso }),
      }).catch(() => {});
      return;
    }

    let ledgerChanged = false;
    if (items.length > 0) {
      for (const item of items) {
        if (ledger.deleted[item.part_number]) {
          delete ledger.deleted[item.part_number];
          ledgerChanged = true;
        }
      }
      fetchInventoryEndpoint('/api/inventory/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      }).catch(() => {});
    }

    if (deletes.length > 0) {
      for (const pn of deletes) {
        ledger.deleted[pn] = nowIso;
      }
      ledgerChanged = true;
      fetchInventoryEndpoint('/api/inventory/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partNumbers: deletes, deletedAt: nowIso }),
      }).catch(() => {});
    }

    if (ledgerChanged) {
      writeLocalSyncLedger(ledger);
    }
  }

  private async commitChanges(
    items: InventoryItem[],
    deletes: string[],
    clear = false,
    syncOptions?: { skipRemoteSync?: boolean }
  ): Promise<void> {
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    const isMassiveBatch = items.length > 250;
    const totalOps = Math.max(1, items.length + deletes.length + (clear ? 1 : 0));
    if (totalOps > 1 || clear) {
      notifyDbProgress({
        active: true,
        title: clear
          ? 'جارٍ مسح وتصفير سجلات المخزون في قاعدة البيانات...'
          : `جارٍ تحديث وحفظ ${items.length.toLocaleString()} قطعة في قاعدة البيانات...`,
        stage: 'بدء المعاملة وحفظ التغييرات في IndexedDB...',
        done: 0,
        total: totalOps,
        percent: 15,
      });
    }

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
          if (i % 50 === 0 || i === items.length - 1) {
            notifyDbProgress({
              active: true,
              title: 'جارٍ حفظ الدفعة الكبيرة في قاعدة البيانات...',
              stage: `كتابة السجل ${(i + 1).toLocaleString()} من ${items.length.toLocaleString()}`,
              done: i + 1,
              total: totalOps,
            });
          }
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
        let processedCount = 0;
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
            processedCount++;
            if (totalOps > 1 && (processedCount % 10 === 0 || processedCount === totalOps)) {
              notifyDbProgress({
                active: true,
                title: 'جارٍ تحديث بيانات المخزون في قاعدة البيانات...',
                stage: `معالجة السجل ${processedCount.toLocaleString()} من ${totalOps.toLocaleString()}`,
                done: processedCount,
                total: totalOps,
              });
            }
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
    if (!syncOptions?.skipRemoteSync) {
      this.pushSyncDelta(items, deletes, clear);
    }
    if (totalOps > 1 || clear) {
      notifyDbProgress({
        active: false,
        title: 'اكتمل تحديث قاعدة بيانات المخزون بنجاح ✓',
        stage: `تم حفظ وفهرسة ${items.length.toLocaleString()} سجل في المخزون.`,
        done: totalOps,
        total: totalOps,
        percent: 100,
      });
    }
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
    notifyDbProgress({
      active: true,
      title: `جارٍ تسجيل ${input.length} مستند في قاعدة البيانات...`,
      stage: 'التحقق من السطور وحفظ المستندات...',
      done: 0,
      total: input.length,
      percent: 25,
    });
    const ids = new Set<string>();
    const documents = input.map((doc, docIdx) => {
      let baseId = canonicalDocumentId(doc.id || `SHEET-${Date.now()}-${docIdx + 1}`);
      if (ids.has(baseId) && doc.id && doc.id.startsWith('SHEET-')) {
        baseId = `${baseId}-${docIdx + 1}`;
      } else if (ids.has(baseId)) {
        throw new Error('مستند مكرر في نفس الدفعة');
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
              ? Math.round(line.quantity * 1000) / 1000
              : 0;
          return {
            ...line,
            part_number: cleanPart,
            location: cleanLoc,
            quantity: safeQty,
            description_en: (line.description_en || '').trim(),
            reviewed: Boolean(line.reviewed),
            old_location: line.old_location || (cleanPart ? this.itemMap.get(cleanPart)?.location_code : undefined),
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
      const store = tx.objectStore('documents');
      let index = 0;
      const putNext = () => {
        if (index >= documents.length) return;
        const doc = documents[index++];
        const checkReq = store.get(doc.id);
        checkReq.onsuccess = () => {
          if (checkReq.result) {
            tx.abort();
            return;
          }
          store.put(doc);
          notifyDbProgress({
            active: true,
            title: `جارٍ حفظ المستندات في قاعدة البيانات (${index}/${documents.length})...`,
            stage: `حفظ المستند ${doc.id}`,
            done: index,
            total: documents.length,
          });
          putNext();
        };
      };
      putNext();
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(new Error('تعذر حفظ الدفعة في قاعدة البيانات المحلية'));
    });
    notifyDbProgress({
      active: false,
      title: 'تم حفظ المستندات في قاعدة البيانات بنجاح ✓',
      done: documents.length,
      total: documents.length,
      percent: 100,
    });
  }

  public async approveDocument(id: string): Promise<void> {
    await this.approveDocuments([id]);
  }

  public async approveDocuments(ids: string[]): Promise<void> {
    const cleanIds = Array.from(new Set(ids.map((id) => canonicalDocumentId(id)).filter(Boolean)));
    if (!cleanIds.length) throw new Error('قائمة المستندات فارغة');
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');

    notifyDbProgress({
      active: true,
      title: `جارٍ اعتماد وتحديث المخزون (${cleanIds.length} مستند)...`,
      stage: 'التحقق من الصلاحيات وتحديث أرصدة القطع والمواقع...',
      done: 0,
      total: cleanIds.length,
      percent: 15,
    });

    const preloadedDocs = await new Promise<StockDocument[]>((resolve, reject) => {
      const tx = this.db!.transaction('documents', 'readonly');
      const store = tx.objectStore('documents');
      const list: StockDocument[] = [];
      let idx = 0;
      const next = () => {
        if (idx >= cleanIds.length) return;
        const req = store.get(cleanIds[idx++]);
        req.onsuccess = () => {
          if (req.result) list.push(req.result);
          next();
        };
      };
      next();
      tx.oncomplete = () => resolve(list);
      tx.onabort = () => reject(tx.error);
    });

    if (preloadedDocs.length !== cleanIds.length) {
      notifyDbProgress({ active: false });
      throw new Error('أحد المستندات غير موجود');
    }
    for (const doc of preloadedDocs) {
      if (doc.status === 'approved') {
        notifyDbProgress({ active: false });
        throw new Error('تم اعتماد هذا المستند مسبقاً');
      }
      if (doc.duplicateResolution === 'sum' && hasDuplicateLinesInDoc(doc)) {
        await authorizeMutation('اعتماد جمع السطور المكررة لنفس رقم القطعة');
        break;
      }
    }

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
            if (!doc || doc.status === 'approved') {
              fail(new Error('المستند غير صالح للاعتماد'));
              return;
            }
            validateDocument(doc);
            const plannedLines = approvalLines(doc);
            notifyDbProgress({
              active: true,
              title: `جارٍ تحديث المخزون في قاعدة البيانات (ورقة ${documentIndex + 1} من ${cleanIds.length})...`,
              stage: `دمج وتحديث ${plannedLines.length} سطر من المستند ${id}`,
              done: documentIndex + 1,
              total: cleanIds.length,
            });
            const processLine = (lineIndex: number) => {
              if (lineIndex >= plannedLines.length) {
                const approved: StockDocument = {
                  ...doc,
                  status: 'approved',
                  executedAt: new Date().toISOString(),
                  approvedBy: 'local-supervisor',
                };
                docs.put(approved);
                audit.add({
                  at: approved.executedAt,
                  actor: approved.approvedBy,
                  action: 'approve-document',
                  documentId: id,
                  batchId: doc.batchId,
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
      processDocument(0);
      tx.oncomplete = () => resolve();
      tx.onabort = () => {
        notifyDbProgress({ active: false });
        reject(failure || tx.error || new Error('تعذر الاعتماد والحفظ في المخزون'));
      };
    });
    await this.loadAndCleanCache();
    const touchedParts = new Set<string>();
    for (const doc of preloadedDocs) {
      for (const line of doc.lines) {
        if (line.part_number) touchedParts.add(line.part_number);
      }
    }
    const touchedItems = Array.from(touchedParts)
      .map((pn) => this.itemMap.get(pn))
      .filter((it): it is InventoryItem => Boolean(it));
    if (touchedItems.length > 0) {
      this.pushSyncDelta(touchedItems, [], false);
    }
    notifyDbProgress({
      active: false,
      title: 'اكتمل تحديث قاعدة بيانات المخزون واعتماد المستندات ✓',
      stage: `تم تحديث وفهرسة ${cleanIds.length} مستند في المخزون بنجاح.`,
      done: cleanIds.length,
      total: cleanIds.length,
      percent: 100,
    });
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
      Number.isFinite(line.quantity) && line.quantity >= 0 ? Math.round(line.quantity * 1000) / 1000 : 0;

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
      const isMoved = before && before.location_code !== safeLoc ? 1 : before?.is_moved || 0;
      after = before
        ? {
            ...before,
            old_location: isMoved ? before.location_code : before.old_location,
            location_code: safeLoc,
            is_moved: isMoved,
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
      let base = before || fresh();
      const isMoved = before && before.location_code !== safeLoc ? 1 : base.is_moved || 0;
      const oldLoc =
        before && before.location_code !== safeLoc ? before.location_code : base.old_location;

      if (before && doc.duplicateResolution === 'sum') {
        base = {
          ...before,
          qty_total: before.qty_total + safeLineQty,
          qty_remaining: before.qty_remaining + safeLineQty,
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
        old_location: oldLoc,
        location_code: safeLoc,
        is_moved: isMoved || marks.mark_symbol === 'F' ? 1 : 0,
        status: base.is_manual_audit === 1 && !isMissing ? 'مدقق' : marks.status,
        is_missing: isMissing,
        remark: cleanRemark,
        mark_symbol: line.mark_symbol ?? marks.mark_symbol,
        audit_meaning: line.audit_meaning ?? marks.audit_meaning,
        qty_total: safeTotal,
        qty_out: nextOut,
        qty_remaining: nextRemaining,
        is_consumable:
          base.is_consumable !== undefined
            ? base.is_consumable
            : isConsumablePart({
                description_en: base.description_en,
                description_ar: base.description_ar,
                category: base.category,
              })
            ? 1
            : 0,
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
    await authorizeMutation('استعادة نسخة احتياطية (دمج دون حذف)');
    if (!this.db) throw new Error('قاعدة البيانات غير جاهزة');
    const data = JSON.parse(text);
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
          (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
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
    notifyDbProgress({
      active: true,
      title: `جارٍ استعادة ودمج ${data.items.length.toLocaleString()} قطعة في قاعدة البيانات...`,
      stage: 'التحقق من السجلات ودمجها دون حذف...',
      done: 0,
      total: Math.max(1, data.items.length),
      percent: 20,
    });
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
    if (data.items.length > 0) {
      this.pushSyncDelta(data.items, [], false);
    }
    notifyDbProgress({
      active: false,
      title: `تمت استعادة ودمج ${data.items.length.toLocaleString()} قطعة بنجاح ✓`,
      done: data.items.length,
      total: Math.max(1, data.items.length),
      percent: 100,
    });
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
    this.pushSyncDelta([], [], true);
  }

  private async putInStore(item: InventoryItem): Promise<void> {
    await this.commitChanges([item], []);
  }
}

export const dbService = new InventoryDatabase();
