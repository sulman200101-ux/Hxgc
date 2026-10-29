import type { InventoryItem } from '../types';

export interface TransferSuggestion {
  partNumber: string;
  from: string;
  to: string;
  quantity: number;
  family: string;
  reason: string;
}

export interface SwapEvictionStep {
  partNumber: string;
  descriptionAr: string;
  descriptionEn: string;
  currentFamily: string;
  quantity: number;
  fromBin: string;
  evictToBin: string;
  reason: string;
}

export interface SwapConsolidationStep {
  partNumber: string;
  descriptionAr: string;
  descriptionEn: string;
  family: string;
  quantity: number;
  fromBin: string;
  toBin: string;
  reason: string;
}

export interface SimilaritySwapPlan {
  id: string;
  family: string;
  familyAr: string;
  zone: string;
  targetBin: string;
  adjacentBins: string[];
  existingMatchingInTarget: InventoryItem[];
  evictions: SwapEvictionStep[];
  consolidations: SwapConsolidationStep[];
  totalPartsToMove: number;
  totalUnitsToMove: number;
  summaryReason: string;
}

const FAMILY_ARABIC_NAMES: Record<string, string> = {
  'BOLT': 'مسامير ربط (BOLT)',
  'NUT': 'صواميل تثبيت (NUT)',
  'WASHER': 'وردات وحلقات (WASHER)',
  'SCREW': 'براغي (SCREW)',
  'GASKET': 'أوجه إحكام وجازكيت (GASKET)',
  'O-RING': 'حلقات أورينج مانعة للتسرب (O-RING)',
  'BEARING': 'رولمان بلي ومحامل (BEARING)',
  'VALVE': 'صمامات ومحابس (VALVE)',
  'FILTER': 'فلاتر وعناصر ترشيح (FILTER)',
  'LAMP': 'إضاءة ومصابيح (LAMP)',
  'FUSE': 'مصهرات وفيوزات حماية (FUSE)',
  'SEAL': 'موانع تسرب (SEAL)',
  'FLANGE': 'فلنجات أنابيب (FLANGE)',
  'CABLE': 'كابلات وروابط كابلات (CABLE)',
  'RING': 'حلقات تآكل وتثبيت (RING WEAR / RETAINING)',
  'SLEEVE': 'جلب أعمدة دوران (SLEEVE SHAFT)',
  'SPACER': 'فواصل معدنية (SPACER)',
  'BUSHING': 'جلب سن وتوجيه (BUSHING)',
  'SPRING': 'يايات وسوست (SPRING)',
  'CONNECTOR': 'وصلات وكونكتورات (CONNECTOR)',
  'INSULATOR': 'عوازل كهربائية وحرارية (INSULATOR)',
  'REGULATOR': 'منظمات ضغط وتدفق (REGULATOR)',
  'IGNITER': 'مشعلات شرارة (IGNITER)',
  'RETAINER': 'حوافظ ومثبتات (RETAINER)',
};

const zone = (location: string) =>
  (location || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z]\d{2})/)?.[1];

export function detectTechnicalFamily(item: InventoryItem): string | undefined {
  const text = (item.description_en || '').toUpperCase();
  const primary = text.match(
    /\b(BOLT|NUT|WASHER|SCREW|GASKET|O-RING|BEARING|VALVE|FILTER|LAMP|FUSE|SEAL|FLANGE|CABLE)\b/
  )?.[1];
  if (primary) return primary;
  return text.match(
    /\b(SLEEVE|SPACER|RING|BUSHING|SPRING|CONNECTOR|INSULATOR|REGULATOR|IGNITER|RETAINER)\b/
  )?.[1];
}

function family(item: InventoryItem): string | undefined {
  return (item.description_en || '')
    .toUpperCase()
    .match(/\b(BOLT|NUT|WASHER|SCREW|GASKET|O-RING|BEARING|VALVE|FILTER|LAMP|FUSE|SEAL|FLANGE|CABLE)\b/)?.[1];
}

export function suggestTransfers(
  items: InventoryItem[],
  pendingParts: Set<string> = new Set(),
  limit = 200
): TransferSuggestion[] {
  const eligible = items.filter(
    (item) => item.qty_remaining > 0 && item.is_missing !== 1 && zone(item.location_code) && family(item)
  );
  const groups = new Map<string, Map<string, number>>();
  for (const item of eligible) {
    const key = `${zone(item.location_code)}:${family(item)}`;
    const bins = groups.get(key) || new Map<string, number>();
    bins.set(item.location_code, (bins.get(item.location_code) || 0) + 1);
    groups.set(key, bins);
  }
  const targets = new Map<string, [string, number]>();
  for (const [key, bins] of groups) {
    targets.set(
      key,
      Array.from(bins).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    );
  }
  const result: TransferSuggestion[] = [];
  for (const item of eligible) {
    if (pendingParts.has(item.part_number)) continue;
    const technicalFamily = family(item)!;
    const key = `${zone(item.location_code)}:${technicalFamily}`;
    const bins = groups.get(key)!;
    const target = targets.get(key)!;
    if (target[0] === item.location_code || target[1] <= bins.get(item.location_code)!) continue;
    result.push({
      partNumber: item.part_number,
      from: item.location_code,
      to: target[0],
      quantity: item.qty_remaining,
      family: technicalFamily,
      reason: `تجميع عائلة ${technicalFamily} مع ${target[1]} قطع أخرى في المنطقة ${zone(item.location_code)}. القرب مقترح بحسب ترميز الموقع ويحتاج تحققًا ميدانيًا.`,
    });
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * حساب درجة التقارب المكاني بين موقعين في المستودع (كلما قل الرقم زاد التقارب)
 * مثال: N11D1 و N11D2 متجاوران تماماً (مسافة 1)، N11C2 و N11D1 في نفس الممر N11 (مسافة 2)
 */
export function computeBinProximityScore(binA: string, binB: string): number {
  const cleanA = (binA || '').trim().toUpperCase();
  const cleanB = (binB || '').trim().toUpperCase();
  if (cleanA === cleanB) return 0;

  const parse = (code: string) => {
    const m = code.match(/^([A-Z])(\d{2})([A-Z]{1,2})(\d+)$/);
    if (!m) return null;
    return {
      sector: m[1],
      aisle: parseInt(m[2], 10),
      shelfGroup: m[3],
      level: parseInt(m[4], 10),
    };
  };

  const a = parse(cleanA);
  const b = parse(cleanB);
  if (!a || !b) {
    return cleanA.slice(0, 3) === cleanB.slice(0, 3) ? 5 : 50;
  }

  const sectorDiff = a.sector === b.sector ? 0 : 100;
  const aisleDiff = Math.abs(a.aisle - b.aisle) * 10;
  const shelfDiff =
    a.shelfGroup === b.shelfGroup
      ? 0
      : Math.abs(a.shelfGroup.charCodeAt(0) - b.shelfGroup.charCodeAt(0)) * 2;
  const levelDiff = Math.abs(a.level - b.level);

  return sectorDiff + aisleDiff + shelfDiff + levelDiff;
}

/**
 * اقتراح أقرب المواقع المتجاورة لموقع معين (Proximate Storage Bins)
 */
export function getAdjacentStorageBins(targetBin: string, allBins: string[], maxCount = 4): string[] {
  const cleanTarget = (targetBin || '').trim().toUpperCase();
  const candidates = new Set<string>(allBins.map((b) => b.trim().toUpperCase()).filter(Boolean));

  // توليد المواقع الشقيقة في نفس الرف/الممر حتى لو كانت فارغة حالياً
  const m = cleanTarget.match(/^([A-Z]\d{2})([A-Z]{1,2})(\d+)$/);
  if (m) {
    const prefix = m[1];
    const shelf = m[2];
    const level = parseInt(m[3], 10);
    candidates.add(`${prefix}${shelf}${level === 1 ? 2 : 1}`);
    for (const adjShelf of ['A', 'B', 'BB', 'C', 'D', 'FL']) {
      candidates.add(`${prefix}${adjShelf}1`);
      candidates.add(`${prefix}${adjShelf}2`);
    }
  }

  candidates.delete(cleanTarget);
  return Array.from(candidates)
    .sort((a, b) => computeBinProximityScore(cleanTarget, a) - computeBinProximityScore(cleanTarget, b) || a.localeCompare(b))
    .slice(0, maxCount);
}

/**
 * بناء خطة متكاملة لتجميع المتشابهات وإخراج القطع غير المتشابهة من الموقع الفعلي واستبدالها بالمتشابهات
 */
export function buildSimilaritySwapPlans(
  items: InventoryItem[],
  pendingParts: Set<string> = new Set(),
  groupScope: 'zone' | 'warehouse' = 'warehouse'
): SimilaritySwapPlan[] {
  const available = items.filter((item) => item.qty_remaining > 0 && item.is_missing !== 1);
  const allBins = Array.from(new Set(available.map((i) => i.location_code.trim().toUpperCase()).filter(Boolean)));
  const itemsByBin = new Map<string, InventoryItem[]>();

  for (const item of available) {
    const bin = item.location_code.trim().toUpperCase();
    const list = itemsByBin.get(bin) || [];
    list.push(item);
    itemsByBin.set(bin, list);
  }

  // تجميع الأصناف المتشابهة حسب العائلة الفنية (مع إمكانية التجميع على مستوى المستودع أو المنطقة)
  const familyGroups = new Map<string, InventoryItem[]>();
  for (const item of available) {
    const fam = detectTechnicalFamily(item);
    const z = zone(item.location_code);
    if (!fam || !z) continue;
    const key = groupScope === 'zone' ? `${z}:${fam}` : `ALL:${fam}`;
    const list = familyGroups.get(key) || [];
    list.push(item);
    familyGroups.set(key, list);
  }

  const plans: SimilaritySwapPlan[] = [];

  for (const [key, groupItems] of familyGroups.entries()) {
    const [, fam] = key.split(':');
    const binsCount = new Map<string, number>();
    for (const item of groupItems) {
      const b = item.location_code.trim().toUpperCase();
      binsCount.set(b, (binsCount.get(b) || 0) + 1);
    }

    // نحتاج على الأقل موقعين مختلفين لنفس العائلة الفنية لاقتراح خطة التجميع والتبديل
    if (binsCount.size < 2) continue;

    // اختيار الموقع الفعلي الأمثل (الذي يضم أكبر عدد من المتشابهات، أو الأقل إشغالاً بغير المتشابهات)
    const sortedBins = Array.from(binsCount.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const occA = (itemsByBin.get(a[0]) || []).length - a[1];
      const occB = (itemsByBin.get(b[0]) || []).length - b[1];
      return occA - occB || a[0].localeCompare(b[0]);
    });

    const targetBin = sortedBins[0][0];
    const targetZone = zone(targetBin) || 'N01';
    const adjacentBins = getAdjacentStorageBins(targetBin, allBins, 4);

    // 1. القطع المتشابهة الموجودة مسبقاً في الموقع المستهدف
    const existingMatchingInTarget = (itemsByBin.get(targetBin) || []).filter(
      (i) => detectTechnicalFamily(i) === fam
    );

    // 2. القطع المتشابهة المتناثرة في مواقع أخرى والتي سيتم نقلها إلى الموقع الفعلي المستهدف
    const scatteredMatching = groupItems.filter(
      (i) => i.location_code.trim().toUpperCase() !== targetBin && !pendingParts.has(i.part_number)
    );
    if (scatteredMatching.length === 0) continue;

    // المواقع التي ستفرغ جزئياً أو كلياً بعد سحب المتشابهات منها (مرتبة حسب القرب من الموقع المستهدف)
    const vacatedSourceBins = Array.from(
      new Set(scatteredMatching.map((i) => i.location_code.trim().toUpperCase()))
    ).sort((a, b) => computeBinProximityScore(targetBin, a) - computeBinProximityScore(targetBin, b));

    // 3. القطع غير المتشابهة الموجودة حالياً في الموقع الفعلي المستهدف (لإخراجها واستبدالها بالمتشابهات)
    const nonMatchingInTarget = (itemsByBin.get(targetBin) || []).filter(
      (i) => detectTechnicalFamily(i) !== fam && !pendingParts.has(i.part_number)
    );

    const evictions: SwapEvictionStep[] = nonMatchingInTarget.map((occupant, idx) => {
      const fallbackBin =
        vacatedSourceBins[idx % vacatedSourceBins.length] ||
        adjacentBins[0] ||
        `${targetZone}B2`;
      const occFamily = detectTechnicalFamily(occupant) || occupant.category || 'متنوع';
      return {
        partNumber: occupant.part_number,
        descriptionAr: occupant.description_ar,
        descriptionEn: occupant.description_en,
        currentFamily: occFamily,
        quantity: occupant.qty_remaining,
        fromBin: targetBin,
        evictToBin: fallbackBin,
        reason: `إخراج صنف غير متشابه (${occFamily}) من الموقع الفعلي ${targetBin} ونقله إلى الموقع المتقارب البديل ${fallbackBin} لإفساح المجال لتجميع عائلة ${fam}`,
      };
    });

    const consolidations: SwapConsolidationStep[] = scatteredMatching.map((simItem) => ({
      partNumber: simItem.part_number,
      descriptionAr: simItem.description_ar,
      descriptionEn: simItem.description_en,
      family: fam,
      quantity: simItem.qty_remaining,
      fromBin: simItem.location_code.trim().toUpperCase(),
      toBin: targetBin,
      reason: `إدخال وتجميع الصنف المتشابه (${fam}) من ${simItem.location_code} إلى الموقع الفعلي الموحد ${targetBin} بجوار ${existingMatchingInTarget.length} أصناف مطابقة`,
    }));

    const totalPartsToMove = evictions.length + consolidations.length;
    const totalUnitsToMove =
      evictions.reduce((acc, e) => acc + e.quantity, 0) +
      consolidations.reduce((acc, c) => acc + c.quantity, 0);

    plans.push({
      id: `PLAN-${fam}-${targetBin}`,
      family: fam,
      familyAr: FAMILY_ARABIC_NAMES[fam] || `عائلة ${fam}`,
      zone: targetZone,
      targetBin,
      adjacentBins,
      existingMatchingInTarget,
      evictions,
      consolidations,
      totalPartsToMove,
      totalUnitsToMove,
      summaryReason:
        evictions.length > 0
          ? `خطة تبديل وتجميع في ${targetBin}: إخراج ${evictions.length} قطعة غير متشابهة إلى (${Array.from(new Set(evictions.map((e) => e.evictToBin))).join('، ')}) وإدخال ${consolidations.length} قطعة متشابهة من عائلة ${fam} ليصبح إجمالي المتشابهات في الموقع ${existingMatchingInTarget.length + consolidations.length} قطع.`
          : `خطة تجميع مباشر في ${targetBin}: الموقع خالٍ من التعارضات، يتم نقل ${consolidations.length} قطعة متشابهة من عائلة ${fam} لتنضم إلى ${existingMatchingInTarget.length} قطع موجودة في ${targetBin}.`,
    });
  }

  return plans.sort(
    (a, b) =>
      b.consolidations.length + b.existingMatchingInTarget.length -
      (a.consolidations.length + a.existingMatchingInTarget.length)
  );
}
