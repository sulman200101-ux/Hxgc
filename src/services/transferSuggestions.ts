import type { InventoryItem } from '../types';
import { categorizeAndTranslate } from '../utils/translator';
import { getCandidateApiUrls } from './geminiVisionService';

/**
 * الحد الأقصى الصارم لعدد الأصناف في كل رف (15 صنفاً فقط لكل رف)
 */
export const MAX_ITEMS_PER_SHELF = 15;

export interface PartSizeProfile {
  sizeScore: number; // 1 (أصغر/أخف) إلى 100 (أكبر/أثقل)
  sizeCategory: 'كبير / ثقيل' | 'متوسط الحجم' | 'صغير / خفيف';
  mmValues: number[]; // كافة القياسات المستخرجة بالمليمتر (ملم)
  primaryMm: number; // المقاس الرئيسي بالمليمتر (ملم) للفرز والمطابقة
  mmLabel: string; // نص المقاس بالمليمتر (مثل: 100 × 215 ملم أو 80.5 ملم)
  dimensionsLabel: string; // ملخص الأبعاد والمقاس بالملم
  targetHeavyLocation: string; // موقع D أو C المعتمد للقطع الثقيلة جداً
  estimatedPriceSar: number; // السعر التقديري للقطعة الواحدة بالريال السعودي
  totalValueSar: number; // القيمة التقديرية الإجمالية للكمية المتبقية
  priceCategory: 'أغلى سعراً / قيمة عالية' | 'متوسط السعر' | 'سعر اقتصادي';
  priceLabelAr: string; // نص السعر التقديري للعرض
}

export interface GeminiPartAnalysis {
  part_number: string;
  description_en: string;
  description_ar: string;
  dimensions_calculation_ar: string;
  material_ar: string;
  estimated_weight_kg: number;
  total_weight_kg: number;
  weight_label_ar: string;
  estimated_price_sar: number;
  total_value_sar: number;
  price_label_ar: string;
  price_category: 'أغلى سعراً / قيمة عالية' | 'متوسط السعر' | 'سعر اقتصادي';
  size_category: 'كبير / ثقيل' | 'متوسط الحجم' | 'صغير / خفيف';
  current_bin: string;
  recommended_shelf_code: 'D' | 'C' | 'A' | 'B' | 'BB' | 'FL';
  recommended_bin: string;
  placement_reason_ar: string;
  source: 'gemini-ai' | 'engineering-engine';
}

export interface TransferSuggestion {
  partNumber: string;
  from: string;
  to: string;
  quantity: number;
  family: string;
  categoryAr: string;
  sizeCategory: 'كبير / ثقيل' | 'متوسط الحجم' | 'صغير / خفيف';
  mmLabel: string;
  estimatedPriceSar: number;
  totalValueSar: number;
  priceLabelAr: string;
  reason: string;
  isHeavyToD?: boolean;
  isHeavyToC?: boolean;
  isHighValueConsolidation?: boolean;
}

export interface SwapEvictionStep {
  partNumber: string;
  descriptionAr: string;
  descriptionEn: string;
  currentFamily: string;
  categoryAr: string;
  quantity: number;
  fromBin: string;
  evictToBin: string;
  sizeProfile: PartSizeProfile;
  reason: string;
}

export interface SwapConsolidationStep {
  partNumber: string;
  descriptionAr: string;
  descriptionEn: string;
  family: string;
  categoryAr: string;
  quantity: number;
  fromBin: string;
  toBin: string;
  sizeProfile: PartSizeProfile;
  reason: string;
}

export interface SimilaritySubGroup {
  key: string;
  sizeCategory: 'كبير / ثقيل' | 'متوسط الحجم' | 'صغير / خفيف';
  mmRangeLabel: string;
  primaryMm: number;
  count: number;
  totalQty: number;
  partNumbers: string[];
}

export interface ShelfBatchAllocation {
  shelfBin: string;
  batchIndex: number;
  itemsCount: number;
  maxCapacity: number;
  items: Array<{
    item: InventoryItem;
    sizeProfile: PartSizeProfile;
  }>;
}

export interface SimilaritySwapPlan {
  id: string;
  family: string;
  familyAr: string;
  categoryAr: string;
  zone: string;
  targetBin: string;
  recommendedBin: string;
  maxItemsPerShelf: number;
  shelfBatches: ShelfBatchAllocation[];
  groupSizeCategory: 'كبير / ثقيل' | 'متوسط الحجم' | 'صغير / خفيف';
  groupMmSummary: string;
  groupTotalValueSar: number;
  subGroupsBySizeAndMm: SimilaritySubGroup[];
  adjacentBins: string[];
  existingMatchingInTarget: InventoryItem[];
  evictions: SwapEvictionStep[];
  consolidations: SwapConsolidationStep[];
  allGroupItemsSortedBySize: Array<{
    item: InventoryItem;
    sizeProfile: PartSizeProfile;
  }>;
  totalPartsToMove: number;
  totalUnitsToMove: number;
  summaryReason: string;
}

export interface HighValueShelfPlan {
  id: string;
  shelfIndex: number;
  targetBin: string;
  maxItemsLimit: number;
  itemsCount: number;
  totalUnits: number;
  minUnitPriceSar: number;
  maxUnitPriceSar: number;
  totalShelfValueSar: number;
  items: Array<{
    item: InventoryItem;
    sizeProfile: PartSizeProfile;
    fromBin: string;
    toBin: string;
    alreadyInShelf: boolean;
  }>;
  evictions: SwapEvictionStep[];
  summaryReason: string;
}

const SIZE_PROFILE_CACHE = new Map<string, PartSizeProfile>();

export function isDLocation(locationCode: string | null | undefined): boolean {
  const clean = (locationCode || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!clean) return false;
  if (clean === 'D' || /^D\d*$/.test(clean)) return true;
  if (clean === 'D04D') return false;
  return /^[A-Z]\d{2}D\d*$/.test(clean);
}

export function isCLocation(locationCode: string | null | undefined): boolean {
  const clean = (locationCode || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!clean) return false;
  if (clean === 'C006' || clean === 'C008') return false;
  if (clean === 'C' || /^C\d+$/.test(clean)) return true;
  return /^[A-Z]\d{2}C\d*$/.test(clean);
}

export function isHeavyDutyDOrCLocation(locationCode: string | null | undefined): boolean {
  return isDLocation(locationCode) || isCLocation(locationCode);
}

export function getHeavyCandidateShelvesForLocation(
  currentLocation: string,
  allBins: string[] = [],
  preferC = false
): string[] {
  const clean = (currentLocation || '').trim().toUpperCase().replace(/\s+/g, '');
  const zonePrefix = clean.match(/^([A-Z]\d{2})/)?.[1];
  const candidates: string[] = [];

  const pushUnique = (bin: string) => {
    const u = bin.trim().toUpperCase();
    if (u && !candidates.includes(u)) candidates.push(u);
  };

  if (zonePrefix) {
    const orderedCodes = preferC
      ? [`${zonePrefix}C1`, `${zonePrefix}C2`, `${zonePrefix}D1`, `${zonePrefix}D2`]
      : [`${zonePrefix}D1`, `${zonePrefix}D2`, `${zonePrefix}C1`, `${zonePrefix}C2`];
    for (const c of orderedCodes) pushUnique(c);
  }

  for (const b of allBins) {
    if (isDLocation(b) || isCLocation(b)) pushUnique(b);
  }

  for (const fallback of preferC ? ['C1', 'C2', 'D1', 'D2'] : ['D1', 'D2', 'C1', 'C2', 'N11D1', 'N11C1']) {
    pushUnique(fallback);
  }

  return candidates;
}

export function resolveTargetDLocation(
  currentLocation: string,
  allBins: string[] = [],
  shelfOccupancy?: Map<string, number>,
  preferC = false
): string {
  const clean = (currentLocation || '').trim().toUpperCase().replace(/\s+/g, '');
  if (isDLocation(clean) || isCLocation(clean)) {
    const currentCount = shelfOccupancy?.get(clean) ?? 0;
    if (currentCount <= MAX_ITEMS_PER_SHELF) return clean;
  }

  const candidates = getHeavyCandidateShelvesForLocation(clean, allBins, preferC);
  if (shelfOccupancy) {
    for (const cand of candidates) {
      const count = shelfOccupancy.get(cand) ?? 0;
      if (count < MAX_ITEMS_PER_SHELF) {
        return cand;
      }
    }
  }

  if (clean && (isDLocation(clean) || isCLocation(clean))) return clean;
  const zonePrefix = clean.match(/^([A-Z]\d{2})/)?.[1];
  if (zonePrefix) {
    const existingZoneDBin = allBins
      .map((b) => b.trim().toUpperCase())
      .find((b) => b.startsWith(`${zonePrefix}D`));
    if (existingZoneDBin && (!shelfOccupancy || (shelfOccupancy.get(existingZoneDBin) ?? 0) < MAX_ITEMS_PER_SHELF)) {
      return existingZoneDBin;
    }
    const existingZoneCBin = allBins
      .map((b) => b.trim().toUpperCase())
      .find((b) => b.startsWith(`${zonePrefix}C`));
    if (existingZoneCBin && (!shelfOccupancy || (shelfOccupancy.get(existingZoneCBin) ?? 0) < MAX_ITEMS_PER_SHELF)) {
      return existingZoneCBin;
    }
    return preferC ? `${zonePrefix}C1` : `${zonePrefix}D1`;
  }

  const anyExistingDBin = allBins.map((b) => b.trim().toUpperCase()).find((b) => isDLocation(b));
  return anyExistingDBin || (preferC ? 'N11C1' : 'N11D1');
}

function parseInchToMm(rawInch: string): number | null {
  const clean = rawInch.trim();
  if (clean.includes('/')) {
    const parts = clean.split('/');
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    if (!isNaN(num) && !isNaN(den) && den > 0) {
      return Math.round((num / den) * 25.4 * 10) / 10;
    }
    return null;
  }
  let val = parseFloat(clean);
  if (!isNaN(val) && val > 0) {
    if (val >= 1000 && val <= 9999) val = val / 1000;
    else if (val >= 100 && val <= 999) val = val / 100;
    return Math.round(val * 25.4 * 10) / 10;
  }
  return null;
}

export function estimatePartUnitPriceSar(descUpper: string, primaryMm: number, sizeScore: number): number {
  let basePrice = 180;

  if (
    descUpper.includes('PUMP') ||
    descUpper.includes('COMPRESSOR') ||
    descUpper.includes('TURBINE') ||
    descUpper.includes('GEARBOX') ||
    descUpper.includes('ACTUATOR') ||
    descUpper.includes('TRANSFORMER')
  ) {
    basePrice = 5400;
  } else if (
    descUpper.includes('TRANSMITTER') ||
    descUpper.includes('FLOWMETER') ||
    descUpper.includes('MODULE, CPU') ||
    descUpper.includes('MODULE,CPU') ||
    descUpper.includes('PLUNGER PUMP')
  ) {
    basePrice = 4200;
  } else if (
    descUpper.includes('CONTACTOR MOTOR') ||
    descUpper.includes('CONTACTOR, 3 POLE') ||
    descUpper.includes('CONTACTOR')
  ) {
    if (descUpper.includes('250 A') || descUpper.includes('250A') || descUpper.includes('1000 A')) {
      basePrice = 3850;
    } else if (descUpper.includes('160 A') || descUpper.includes('160A') || descUpper.includes('690 VAC')) {
      basePrice = 2950;
    } else {
      basePrice = 1450;
    }
  } else if (descUpper.includes('CIRCUIT BREAKER') || descUpper.includes('BREAKER')) {
    if (descUpper.includes('125 A') || descUpper.includes('125A') || descUpper.includes('250A')) {
      basePrice = 2650;
    } else {
      basePrice = 980;
    }
  } else if (
    descUpper.includes('MECHANICAL SEAL') ||
    descUpper.includes('FACE MECHANICAL SEAL') ||
    descUpper.includes('LABYRINTH') ||
    descUpper.includes('VALVE')
  ) {
    basePrice = 2400;
  } else if (
    descUpper.includes('RING WEAR') ||
    descUpper.includes('WEAR RING') ||
    descUpper.includes('SPINDLE') ||
    descUpper.includes('SLEEVE, SHAFT') ||
    descUpper.includes('SLEEVE SHAFT') ||
    descUpper.includes('SEAT, SEAL') ||
    descUpper.includes('SEAT SEAL')
  ) {
    basePrice = 1650;
  } else if (descUpper.includes('BEARING')) {
    if (descUpper.includes('JOURNAL') || descUpper.includes('MAIN') || descUpper.includes('STELLITE')) {
      basePrice = 2150;
    } else if (descUpper.includes('THRUST') || descUpper.includes('ROLLER')) {
      basePrice = 1280;
    } else {
      basePrice = 690;
    }
  } else if (
    descUpper.includes('RELAY, BUCHHOLZ') ||
    descUpper.includes('RELAY. BUCHHOLZ') ||
    descUpper.includes('RELAY PROTECTION') ||
    descUpper.includes('DETECTOR RESISTANCE') ||
    descUpper.includes('SENSOR, HORN')
  ) {
    basePrice = 1520;
  } else if (
    descUpper.includes('COUPLING') ||
    descUpper.includes('REGULATOR') ||
    descUpper.includes('POWER SUPPLY') ||
    descUpper.includes('AMMETER') ||
    descUpper.includes('METER')
  ) {
    basePrice = 920;
  } else if (descUpper.includes('KIT')) {
    basePrice = 740;
  } else if (descUpper.includes('SPRING')) {
    basePrice = descUpper.includes('INCONEL') || descUpper.includes('ACTUATOR') ? 1180 : 420;
  } else if (
    descUpper.includes('SWITCH') ||
    descUpper.includes('LIGHT, PILOT') ||
    descUpper.includes('BOX, ELECTRICAL') ||
    descUpper.includes('PACKING RING') ||
    descUpper.includes('PIN, ADAPTER')
  ) {
    basePrice = 360;
  } else if (descUpper.includes('GASKET')) {
    basePrice = descUpper.includes('SPIRAL') || descUpper.includes('GRAPHITE') ? 260 : 120;
  } else if (descUpper.includes('O-RING') || descUpper.includes('ORING')) {
    basePrice = descUpper.includes('VITON GLT') || descUpper.includes('FEPM') ? 165 : 75;
  } else if (
    descUpper.includes('SHIM') ||
    descUpper.includes('WASHER') ||
    descUpper.includes('BOLT') ||
    descUpper.includes('NUT') ||
    descUpper.includes('SCREW') ||
    descUpper.includes('TIE') ||
    descUpper.includes('EARPLUG') ||
    descUpper.includes('GLOVES')
  ) {
    basePrice = 45;
  }

  let alloyMultiplier = 1.0;
  if (descUpper.includes('INCONEL 718') || descUpper.includes('INCONEL')) {
    alloyMultiplier = 1.65;
  } else if (descUpper.includes('STELLITE')) {
    alloyMultiplier = 1.55;
  } else if (descUpper.includes('HVOF') || descUpper.includes('TUNGSTEN')) {
    alloyMultiplier = 1.7;
  } else if (descUpper.includes('PEEK+ELGILOY') || descUpper.includes('ELGILOY')) {
    alloyMultiplier = 1.45;
  } else if (descUpper.includes('316L') || descUpper.includes('316') || descUpper.includes('BRONZE') || descUpper.includes('C93700')) {
    alloyMultiplier = 1.2;
  }

  const mmFactor = primaryMm >= 200 ? 1.28 : primaryMm >= 100 ? 1.14 : 1.0;
  const sizeFactor = sizeScore >= 75 ? 1.2 : sizeScore >= 65 ? 1.1 : 1.0;

  return Math.max(15, Math.round((basePrice * alloyMultiplier * mmFactor * sizeFactor) / 5) * 5);
}

export function estimatePartSizeProfile(item: InventoryItem): PartSizeProfile {
  const desc: string = String(item.description_en || (item as any).description || '').trim().toUpperCase();
  const loc: string = String(item.location_code || (item as any).location || '').trim().toUpperCase();
  const qtyRem = Math.max(1, Number(item.qty_remaining ?? item.qty_total ?? 1));
  const cacheKey = `${desc}|${loc}|${qtyRem}`;
  const cached = SIZE_PROFILE_CACHE.get(cacheKey);
  if (cached) return cached;

  let score = 45;
  const mmValues: number[] = [];
  const extraSpecs: string[] = [];

  const mmRangeMatches = Array.from(desc.matchAll(/(\d+(?:\.\d+)?)\s*(?:X|-|TO)\s*(\d+(?:\.\d+)?)\s*MM\b/g));
  for (const m of mmRangeMatches) {
    const v1 = parseFloat(m[1]);
    const v2 = parseFloat(m[2]);
    if (!isNaN(v1) && v1 > 0) mmValues.push(v1);
    if (!isNaN(v2) && v2 > 0) mmValues.push(v2);
  }

  const mmMatches = Array.from(desc.matchAll(/(\d+(?:\.\d+)?)\s*MM\b/g));
  for (const m of mmMatches) {
    const val = parseFloat(m[1]);
    if (!isNaN(val) && val > 0 && !mmValues.includes(val)) {
      mmValues.push(val);
    }
  }

  const threadMatch = desc.match(/\bM(\d+(?:\.\d+)?)(?:\s*X\s*(\d+(?:\.\d+)?))?\b/);
  if (threadMatch) {
    const mDia = parseFloat(threadMatch[1]);
    const mLen = threadMatch[2] ? parseFloat(threadMatch[2]) : NaN;
    if (!isNaN(mDia) && mDia > 0 && !mmValues.includes(mDia)) {
      mmValues.push(mDia);
    }
    if (!isNaN(mLen) && mLen > 0 && !mmValues.includes(mLen)) {
      mmValues.push(mLen);
    }
    extraSpecs.push(threadMatch[0].replace(/\s+/g, ''));
    if (mDia >= 24) score += 25;
  }

  const sqInMatch = desc.match(/(\d+(?:\.\d+)?)\s*SQ\s*IN\b/);
  if (sqInMatch) {
    const sqVal = parseFloat(sqInMatch[1]);
    if (!isNaN(sqVal) && sqVal > 0) {
      const eqMm = Math.round(Math.sqrt(sqVal) * 25.4);
      if (!mmValues.includes(eqMm)) mmValues.push(eqMm);
      extraSpecs.push(`${sqVal} SQ IN`);
      score += Math.min(35, sqVal * 0.6);
    }
  }

  const inMatches = Array.from(desc.matchAll(/\b(\d+(?:\/\d+|\.\d+)?)\s*(?:IN|INCH|NPS|")\b/g));
  for (const m of inMatches) {
    const mmFromIn = parseInchToMm(m[1]);
    if (mmFromIn !== null) {
      if (!mmValues.some((existing) => Math.abs(existing - mmFromIn) <= 1.5)) {
        mmValues.push(mmFromIn);
      }
      if (!m[1].includes('/')) {
        const inVal = parseFloat(m[1]);
        if (inVal >= 2) score += 22;
      }
    }
  }

  if (mmValues.length === 0) {
    const dimXMatch = desc.match(/\b(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)\b/);
    if (dimXMatch) {
      const d1 = parseFloat(dimXMatch[1]);
      const d2 = parseFloat(dimXMatch[2]);
      if (!isNaN(d1) && d1 > 0 && d1 < 2000) mmValues.push(d1);
      if (!isNaN(d2) && d2 > 0 && d2 < 2000 && d2 !== d1) mmValues.push(d2);
    }
  }

  const kgMatch = desc.match(/\b(\d+(?:\.\d+)?)\s*KG\b/);
  if (kgMatch) {
    const kgs = parseFloat(kgMatch[1]);
    extraSpecs.push(`${kgs} كجم`);
    if (kgs >= 15) score += 35;
    else if (kgs >= 5) score += 20;
  }

  const ampMatch = desc.match(/\b(\d+)\s*A\b/);
  if (ampMatch) {
    const amps = parseInt(ampMatch[1], 10);
    extraSpecs.push(`${amps}A`);
    if (amps >= 200) score += 35;
    else if (amps >= 50) score += 15;
  }

  const maxMm = mmValues.length > 0 ? Math.max(...mmValues) : 0;
  const primaryMm = maxMm;

  if (maxMm >= 180 && !desc.includes('TIE, CABLE') && !desc.includes('GLOVES')) {
    score += 32;
  } else if (maxMm >= 80 && !desc.includes('TIE, CABLE') && !desc.includes('GLOVES') && !desc.includes('IGNITER')) {
    score += 18;
  } else if (maxMm > 0 && maxMm <= 25) {
    score -= 15;
  }

  const isLightSealOrFastener =
    desc.startsWith('O-RING') ||
    desc.startsWith('KIT') ||
    desc.startsWith('REPAIR KIT') ||
    desc.includes('GRADUATED') ||
    desc.startsWith('GASKET') ||
    desc.startsWith('PACKING') ||
    desc.startsWith('TIE, CABLE') ||
    desc.startsWith('TIE CABLE') ||
    desc.startsWith('FUSE') ||
    desc.startsWith('PIN:') ||
    desc.startsWith('RELAY') ||
    desc.startsWith('SCREW') ||
    desc.startsWith('CAP: PROTECTIVE') ||
    desc.startsWith('GLOVES') ||
    desc.startsWith('IGNITER') ||
    desc.startsWith('SENSOR') ||
    desc.startsWith('SPRING');

  if (isLightSealOrFastener) {
    score -= 22;
  } else if (
    desc.includes('VALVE') ||
    desc.includes('ACTUATOR') ||
    desc.includes('CASING') ||
    desc.includes('IMPELLER') ||
    desc.includes('SLEEVE SHAFT') ||
    desc.includes('BEARING, JOURNAL') ||
    desc.includes('MAIN BEARING') ||
    desc.includes('BEARING ROLLER') ||
    desc.includes('2X7315') ||
    desc.includes('STUD ASSEMBLY') ||
    desc.includes('CONTACTOR') ||
    desc.includes('AIR BLOWER') ||
    desc.includes('RING WEAR') ||
    desc.includes('WEAR RING') ||
    desc.includes('BUSHING PUMP') ||
    desc.includes('FLANGE WELD NECK') ||
    desc.includes('GATE VALVE') ||
    desc.includes('PUMP') ||
    desc.includes('MOTOR') ||
    desc.includes('TRANSFORMER') ||
    desc.includes('GEARBOX') ||
    desc.includes('COMPRESSOR') ||
    desc.includes('TURBINE') ||
    desc.includes('CYLINDER') ||
    desc.includes('HEAVY')
  ) {
    score += 24;
  } else if (
    desc.includes('BUSHING') ||
    desc.includes('SLEEVE') ||
    desc.includes('POWER SUPPLY') ||
    desc.includes('REGULATOR') ||
    desc.includes('LABYRINTH') ||
    desc.includes('RETAINER') ||
    desc.includes('CAP, BEARING') ||
    desc.includes('SUPPORT: RIGID CONDUIT') ||
    desc.includes('FLANGE')
  ) {
    score += 6;
  } else if (
    desc.includes('O-RING') ||
    desc.includes('TIE, CABLE') ||
    desc.includes('TIE CABLE') ||
    desc.includes('FUSE') ||
    desc.includes('GASKET') ||
    desc.includes('PACKING') ||
    desc.includes('PIN:') ||
    desc.includes('RELAY') ||
    desc.includes('SCREW') ||
    desc.includes('CAP: PROTECTIVE')
  ) {
    score -= 22;
  }

  const finalScore = Math.max(5, Math.min(99, Math.round(score)));
  const uniqueMm = Array.from(new Set(mmValues.map((v) => Math.round(v * 10) / 10)));
  const mmLabel =
    uniqueMm.length > 0
      ? `${uniqueMm.slice(0, 3).join(' × ')} ملم`
      : extraSpecs.length > 0
      ? extraSpecs.join(' — ')
      : 'مقاس قياسي';

  const dimensionsLabel =
    uniqueMm.length > 0 && extraSpecs.length > 0
      ? `${mmLabel} (${extraSpecs[0]})`
      : mmLabel;

  const sizeCategory: 'كبير / ثقيل' | 'متوسط الحجم' | 'صغير / خفيف' =
    finalScore >= 65 ? 'كبير / ثقيل' : finalScore >= 38 ? 'متوسط الحجم' : 'صغير / خفيف';

  const targetHeavyLocation = resolveTargetDLocation(loc, [], undefined, finalScore >= 65 && finalScore < 72);

  const estimatedPriceSar = estimatePartUnitPriceSar(desc, primaryMm, finalScore);
  const totalValueSar = estimatedPriceSar * qtyRem;
  const priceCategory: 'أغلى سعراً / قيمة عالية' | 'متوسط السعر' | 'سعر اقتصادي' =
    estimatedPriceSar >= 1200
      ? 'أغلى سعراً / قيمة عالية'
      : estimatedPriceSar >= 300
      ? 'متوسط السعر'
      : 'سعر اقتصادي';
  const priceLabelAr = `${estimatedPriceSar.toLocaleString()} ر.س للقطعة (الإجمالي ${totalValueSar.toLocaleString()} ر.س)`;

  const profile: PartSizeProfile = {
    sizeScore: finalScore,
    sizeCategory,
    mmValues: uniqueMm,
    primaryMm,
    mmLabel,
    dimensionsLabel,
    targetHeavyLocation,
    estimatedPriceSar,
    totalValueSar,
    priceCategory,
    priceLabelAr,
  };

  SIZE_PROFILE_CACHE.set(cacheKey, profile);
  return profile;
}

export function isHeavyPart(item: InventoryItem): boolean {
  return estimatePartSizeProfile(item).sizeCategory === 'كبير / ثقيل';
}

export function isHighValuePart(item: InventoryItem): boolean {
  return estimatePartSizeProfile(item).priceCategory === 'أغلى سعراً / قيمة عالية';
}

const FAMILY_ARABIC_NAMES: Record<string, string> = {
  'BOLT': 'مسامير ربط وستد (BOLT / STUD)',
  'NUT': 'صواميل تثبيت (NUT)',
  'WASHER': 'وردات وحلقات تثبيت (WASHER / PIN)',
  'SCREW': 'براغي ومسامير غطاء (SCREW)',
  'GASKET': 'أوجه إحكام وجازكيت (GASKET)',
  'O-RING': 'حلقات أورينج مانعة للتسرب (O-RING)',
  'BEARING': 'رولمان بلي ومحامل وأغطيتها (BEARING)',
  'VALVE': 'صمامات ومحابس ومشغلاتها (VALVE)',
  'FILTER': 'فلاتر ومنظمات ترشيح (FILTER / REGULATOR)',
  'LAMP': 'إضاءة ومصابيح (LAMP)',
  'FUSE': 'مصهرات وفيوزات وقواطع (FUSE / RELAY)',
  'SEAL': 'موانع تسرب ولابيرنث (SEAL / LABYRINTH)',
  'PACKING': 'حشوات إحكام صمامات ومضخات (PACKING)',
  'FLANGE': 'فلنجات ووصلات أنابيب (FLANGE / ADAPTER)',
  'CABLE': 'كابلات وحوامل مواسير (CABLE / CONDUIT)',
  'RING': 'حلقات تآكل وحلقات تثبيت ومقاعد (RING WEAR / THROTTLE)',
  'SLEEVE': 'جلب أعمدة دوران وفواصل (SLEEVE SHAFT / SPACER)',
  'SPACER': 'فواصل معدنية دقيقة (SPACER)',
  'BUSHING': 'جلب مضخات ومنافخ هواء (BUSHING PUMP)',
  'SPRING': 'يايات ونوابض صمامات (SPRING)',
  'CONNECTOR': 'وصلات ومهايئات ربط (CONNECTOR / ADAPTER)',
  'INSULATOR': 'عوازل ووحدات طاقة وقياس (POWER / METER)',
  'REGULATOR': 'منظمات ضغط وتدفق (REGULATOR)',
  'IGNITER': 'مشعلات شرارة (IGNITER)',
  'RETAINER': 'حوافظ ومثبتات موانع التسرب (RETAINER)',
};

const zone = (location: string) =>
  (location || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z]\d{2})/)?.[1] ||
  (isDLocation(location) ? 'D' : isCLocation(location) ? 'C' : undefined);

export function detectTechnicalFamily(item: InventoryItem): string | undefined {
  const text = (item.description_en || (item as any).description || '').toUpperCase();
  if (text.includes('RING WEAR') || text.includes('RING,') || text.includes('WEAR RING')) {
    return 'RING';
  }
  if (text.includes('SLEEVE')) return 'SLEEVE';
  if (text.includes('BUSHING')) return 'BUSHING';
  if (text.includes('RETAINER')) return 'RETAINER';
  if (text.includes('LABYRINTH') || text.includes('SEAL')) return 'SEAL';
  if (text.includes('PACKING')) return 'PACKING';
  if (text.includes('BEARING')) return 'BEARING';
  if (text.includes('VALVE') || text.includes('ACTUATOR')) return 'VALVE';
  if (text.includes('GASKET')) return 'GASKET';
  if (text.includes('O-RING')) return 'O-RING';
  if (text.includes('STUD') || text.includes('BOLT')) return 'BOLT';
  if (text.includes('SCREW')) return 'SCREW';
  if (text.includes('WASHER') || text.includes('PIN:')) return 'WASHER';
  if (text.includes('FUSE') || text.includes('RELAY')) return 'FUSE';
  if (
    text.includes('POWER SUPPLY') ||
    text.includes('AMMETER') ||
    text.includes('INSULATOR') ||
    text.includes('CONTACTOR')
  ) {
    return 'INSULATOR';
  }
  if (text.includes('CABLE') || text.includes('CONDUIT')) return 'CABLE';
  if (text.includes('REGULATOR') || text.includes('FILTER')) return 'FILTER';
  if (text.includes('SPRING')) return 'SPRING';
  if (text.includes('ADAPTER') || text.includes('CONNECTOR')) return 'CONNECTOR';

  const primary = text.match(
    /\b(BOLT|NUT|WASHER|SCREW|GASKET|O-RING|BEARING|VALVE|FILTER|LAMP|FUSE|SEAL|FLANGE|CABLE)\b/
  )?.[1];
  if (primary) return primary;
  return text.match(
    /\b(SLEEVE|SPACER|RING|BUSHING|SPRING|CONNECTOR|INSULATOR|REGULATOR|IGNITER|RETAINER)\b/
  )?.[1];
}

function family(item: InventoryItem): string | undefined {
  return detectTechnicalFamily(item);
}

export function suggestHeavyItemsToLocationD(
  _items: InventoryItem[],
  _pendingParts: Set<string> = new Set()
): TransferSuggestion[] {
  // تم استبعاد خطة النقل للقطع الثقيلة بناءً على طلب المستخدم وجعل خطة النقل مخصصة للقطع الاستهلاكية فقط
  return [];
}

export function buildHighValueConsolidationPlans(
  items: InventoryItem[],
  pendingParts: Set<string> = new Set(),
  customTargetBin?: string
): HighValueShelfPlan[] {
  const available = items.filter(
    (item) =>
      item.qty_remaining > 0 &&
      item.is_missing !== 1 &&
      isConsumablePart(item) &&
      !pendingParts.has(item.part_number)
  );
  if (available.length === 0) return [];

  const allBins = Array.from(
    new Set(available.map((i) => i.location_code.trim().toUpperCase()).filter(Boolean))
  );

  const enriched = available
    .map((item) => ({
      item,
      sizeProfile: estimatePartSizeProfile(item),
    }))
    .sort(
      (a, b) =>
        b.sizeProfile.estimatedPriceSar - a.sizeProfile.estimatedPriceSar ||
        b.sizeProfile.totalValueSar - a.sizeProfile.totalValueSar
    );

  const selectedPool = enriched.slice(0, Math.min(MAX_ITEMS_PER_SHELF * 2, enriched.length));
  const top15 = selectedPool.slice(0, MAX_ITEMS_PER_SHELF);
  const binFreq = new Map<string, number>();
  for (const entry of top15) {
    const b = entry.item.location_code.trim().toUpperCase();
    if (b && isConsumableTargetLocation(b)) binFreq.set(b, (binFreq.get(b) || 0) + 1);
  }
  const bestExistingBin =
    Array.from(binFreq.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    allBins.find((b) => isConsumableTargetLocation(b)) ||
    'N11A1';

  const primaryZone = zone(bestExistingBin) || 'N11';
  const defaultShelves = [
    customTargetBin?.trim().toUpperCase() || bestExistingBin,
    `${primaryZone}FL1`,
    `${primaryZone}A2`,
    `${primaryZone}FL2`,
  ];

  const plans: HighValueShelfPlan[] = [];
  const totalBatches = Math.min(2, Math.ceil(selectedPool.length / MAX_ITEMS_PER_SHELF));

  for (let bIdx = 0; bIdx < totalBatches; bIdx++) {
    const slice = selectedPool.slice(
      bIdx * MAX_ITEMS_PER_SHELF,
      (bIdx + 1) * MAX_ITEMS_PER_SHELF
    );
    if (slice.length === 0) continue;

    const targetBin = defaultShelves[bIdx] || `${primaryZone}A${bIdx + 1}`;
    const prices = slice.map((s) => s.sizeProfile.estimatedPriceSar);
    const totalShelfValueSar = slice.reduce((acc, s) => acc + s.sizeProfile.totalValueSar, 0);
    const totalUnits = slice.reduce((acc, s) => acc + s.item.qty_remaining, 0);

    plans.push({
      id: `CONSUMABLE-SHELF-${bIdx + 1}-${targetBin}`,
      shelfIndex: bIdx + 1,
      targetBin,
      maxItemsLimit: MAX_ITEMS_PER_SHELF,
      itemsCount: slice.length,
      totalUnits,
      minUnitPriceSar: Math.min(...prices),
      maxUnitPriceSar: Math.max(...prices),
      totalShelfValueSar,
      items: slice.map(({ item, sizeProfile }) => {
        const fromBin = item.location_code.trim().toUpperCase();
        return {
          item,
          sizeProfile,
          fromBin,
          toBin: targetBin,
          alreadyInShelf: fromBin === targetBin,
        };
      }),
      evictions: [],
      summaryReason: `خطة نقل وتجميع القطع الاستهلاكية (دفعة الرف #${bIdx + 1}: ${slice.length}/${MAX_ITEMS_PER_SHELF} صنف) في رف الاستهلاكية (${targetBin}).`,
    });
  }

  return plans;
}

export function suggestTransfers(
  items: InventoryItem[],
  pendingParts: Set<string> = new Set(),
  limit = 200
): TransferSuggestion[] {
  // خطة النقل مخصصة للقطع الاستهلاكية فقط (توجيه إلى A / FL أو تجميع الاستهلاكية معاً)
  const eligible = items.filter(
    (item) =>
      item.qty_remaining > 0 &&
      item.is_missing !== 1 &&
      isConsumablePart(item) &&
      !pendingParts.has(item.part_number)
  );

  const result: TransferSuggestion[] = [];

  for (const item of eligible) {
    if (isConsumableTargetLocation(item.location_code)) continue;
    const technicalFamily = family(item) || 'CONSUMABLE';
    const sizeProf = estimatePartSizeProfile(item);
    const catAr = item.category || FAMILY_ARABIC_NAMES[technicalFamily] || 'قطعة استهلاكية';
    const preferFL = /FILTER|HOSE|BELT|GASKET|فلتر|خرطوم|سير|جازكيت/i.test(
      `${item.description_en} ${item.description_ar}`
    );
    const targetBin = resolveTargetConsumableLocation(item.location_code, preferFL);
    if (targetBin === item.location_code) continue;

    result.push({
      partNumber: item.part_number,
      from: item.location_code,
      to: targetBin,
      quantity: item.qty_remaining,
      family: technicalFamily,
      categoryAr: catAr,
      sizeCategory: sizeProf.sizeCategory,
      mmLabel: sizeProf.mmLabel,
      estimatedPriceSar: sizeProf.estimatedPriceSar,
      totalValueSar: sizeProf.totalValueSar,
      priceLabelAr: sizeProf.priceLabelAr,
      reason: `نقل قطعة استهلاكية (${item.description_ar || technicalFamily} — المقاس: ${sizeProf.mmLabel}) من ${item.location_code} إلى رف القطع الاستهلاكية (${targetBin}) لسهولة الصرف اليومي.`,
    });
    if (result.length >= limit) break;
  }

  return result;
}

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
  const groupDiff = a.shelfGroup === b.shelfGroup ? 0 : 3;
  const levelDiff = Math.abs(a.level - b.level);

  return sectorDiff + aisleDiff + groupDiff + levelDiff;
}

export function getAdjacentStorageBins(targetBin: string, allBins: string[], maxCount = 6): string[] {
  const cleanTarget = (targetBin || '').trim().toUpperCase();
  const candidates = new Set<string>(allBins.map((b) => b.trim().toUpperCase()).filter(Boolean));

  const m = cleanTarget.match(/^([A-Z]\d{2})([A-Z]{1,2})(\d+)$/);
  if (m) {
    const prefix = m[1];
    const shelf = m[2];
    const level = parseInt(m[3], 10);
    candidates.add(`${prefix}D1`);
    candidates.add(`${prefix}D2`);
    candidates.add(`${prefix}C1`);
    candidates.add(`${prefix}C2`);
    candidates.add(`${prefix}${shelf}${level === 1 ? 2 : 1}`);
    for (const adjShelf of ['D', 'C', 'A', 'B', 'BB', 'FL']) {
      candidates.add(`${prefix}${adjShelf}1`);
      candidates.add(`${prefix}${adjShelf}2`);
    }
  } else {
    candidates.add('N11D1');
    candidates.add('N11C1');
    candidates.add('N16D1');
    candidates.add('D1');
    candidates.add('C1');
  }

  candidates.delete(cleanTarget);
  return Array.from(candidates)
    .sort((a, b) => computeBinProximityScore(cleanTarget, a) - computeBinProximityScore(cleanTarget, b) || a.localeCompare(b))
    .slice(0, maxCount);
}

function getMmBucketLabel(primaryMm: number, mmLabel: string): string {
  if (primaryMm <= 0) return mmLabel !== 'مقاس قياسي' ? mmLabel : 'مقاس قياسي (بدون ملم)';
  if (primaryMm < 20) return `${primaryMm} ملم (دقيق < 20 ملم)`;
  if (primaryMm <= 60) return `${primaryMm} ملم (متوسط 20–60 ملم)`;
  if (primaryMm <= 150) return `${primaryMm} ملم (كبير 61–150 ملم)`;
  return `${primaryMm} ملم (ثقيل > 150 ملم)`;
}

export function buildSimilaritySwapPlans(
  items: InventoryItem[],
  pendingParts: Set<string> = new Set(),
  groupScope: 'zone' | 'warehouse' = 'warehouse'
): SimilaritySwapPlan[] {
  // خطة النقل والتجميع مخصصة للقطع الاستهلاكية فقط (مع استبعاد خطة النقل للثقيلة)
  const available = items.filter(
    (item) => item.qty_remaining > 0 && item.is_missing !== 1 && isConsumablePart(item)
  );
  const allBins = Array.from(new Set(available.map((i) => i.location_code.trim().toUpperCase()).filter(Boolean)));
  const itemsByBin = new Map<string, InventoryItem[]>();

  for (let i = 0; i < available.length; i++) {
    const item = available[i];
    const bin = item.location_code.trim().toUpperCase();
    let list = itemsByBin.get(bin);
    if (!list) {
      list = [];
      itemsByBin.set(bin, list);
    }
    list.push(item);
  }

  const familyGroups = new Map<string, InventoryItem[]>();
  for (let i = 0; i < available.length; i++) {
    const item = available[i];
    const fam = detectTechnicalFamily(item) || 'CONSUMABLE';
    const z = zone(item.location_code) || 'N11';
    const key = groupScope === 'zone' ? `${z}:${fam}` : `ALL:${fam}`;
    let list = familyGroups.get(key);
    if (!list) {
      list = [];
      familyGroups.set(key, list);
    }
    list.push(item);
  }

  const plans: SimilaritySwapPlan[] = [];

  for (const [key, groupItems] of familyGroups.entries()) {
    const [, fam] = key.split(':');

    const allGroupItemsSortedBySize = groupItems
      .map((item) => ({
        item,
        sizeProfile: estimatePartSizeProfile(item),
      }))
      .sort((a, b) => {
        if (b.sizeProfile.primaryMm !== a.sizeProfile.primaryMm) {
          return b.sizeProfile.primaryMm - a.sizeProfile.primaryMm;
        }
        return b.sizeProfile.estimatedPriceSar - a.sizeProfile.estimatedPriceSar;
      });

    const subGroupMap = new Map<string, SimilaritySubGroup>();
    const allMmValues: number[] = [];
    let groupTotalValueSar = 0;

    for (const entry of allGroupItemsSortedBySize) {
      const { item, sizeProfile } = entry;
      groupTotalValueSar += sizeProfile.totalValueSar;
      if (sizeProfile.primaryMm > 0) allMmValues.push(sizeProfile.primaryMm);
      const bucketLabel = getMmBucketLabel(sizeProfile.primaryMm, sizeProfile.mmLabel);
      const sgKey = `${sizeProfile.sizeCategory}|${sizeProfile.mmLabel}`;
      const existing = subGroupMap.get(sgKey);
      if (existing) {
        existing.count += 1;
        existing.totalQty += item.qty_remaining;
        existing.partNumbers.push(item.part_number);
      } else {
        subGroupMap.set(sgKey, {
          key: sgKey,
          sizeCategory: sizeProfile.sizeCategory,
          mmRangeLabel: sizeProfile.mmLabel !== 'مقاس قياسي' ? sizeProfile.mmLabel : bucketLabel,
          primaryMm: sizeProfile.primaryMm,
          count: 1,
          totalQty: item.qty_remaining,
          partNumbers: [item.part_number],
        });
      }
    }

    const subGroupsBySizeAndMm = Array.from(subGroupMap.values()).sort(
      (a, b) => b.count - a.count || b.primaryMm - a.primaryMm
    );

    const groupMmSummary =
      allMmValues.length > 0
        ? Math.min(...allMmValues) === Math.max(...allMmValues)
          ? `${Math.max(...allMmValues)} ملم`
          : `${Math.min(...allMmValues)} ملم – ${Math.max(...allMmValues)} ملم`
        : 'مقاسات قياسية للقطع الاستهلاكية';

    const groupSizeCategory: 'كبير / ثقيل' | 'متوسط الحجم' | 'صغير / خفيف' = 'صغير / خفيف';

    const binsCount = new Map<string, number>();
    for (let i = 0; i < groupItems.length; i++) {
      const b = groupItems[i].location_code.trim().toUpperCase();
      binsCount.set(b, (binsCount.get(b) || 0) + 1);
    }

    const sortedBins = Array.from(binsCount.entries()).sort((a, b) => {
      const isConsA = isConsumableTargetLocation(a[0]) ? 1 : 0;
      const isConsB = isConsumableTargetLocation(b[0]) ? 1 : 0;
      if (isConsA !== isConsB) return isConsB - isConsA;
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });

    const primaryBin = sortedBins[0]?.[0] || 'N11A1';
    const targetZone = zone(primaryBin) || 'N11';
    const preferFL = fam === 'FILTER' || fam === 'GASKET' || fam === 'PACKING';

    const targetBin = isConsumableTargetLocation(primaryBin)
      ? primaryBin
      : resolveTargetConsumableLocation(primaryBin, preferFL);

    const recommendedBin = targetBin;
    const adjacentBins = [
      `${targetZone}A1`,
      `${targetZone}FL1`,
      `${targetZone}A2`,
      `${targetZone}FL2`,
      ...getAdjacentStorageBins(targetBin, allBins, 4),
    ].filter((b, idx, arr) => b !== targetBin && arr.indexOf(b) === idx);

    const candidateShelvesForBatches = [targetBin, ...adjacentBins];

    const shelfBatches: ShelfBatchAllocation[] = [];
    for (let start = 0, bIdx = 0; start < allGroupItemsSortedBySize.length; start += MAX_ITEMS_PER_SHELF, bIdx++) {
      const batchSlice = allGroupItemsSortedBySize.slice(start, start + MAX_ITEMS_PER_SHELF);
      const assignedBin = candidateShelvesForBatches[bIdx] || `${targetZone}A${(bIdx % 2) + 1}`;
      shelfBatches.push({
        shelfBin: assignedBin,
        batchIndex: bIdx + 1,
        itemsCount: batchSlice.length,
        maxCapacity: MAX_ITEMS_PER_SHELF,
        items: batchSlice,
      });
    }

    const existingMatchingInTarget = (itemsByBin.get(targetBin) || [])
      .filter((i) => (detectTechnicalFamily(i) || 'CONSUMABLE') === fam)
      .slice(0, MAX_ITEMS_PER_SHELF);

    const scatteredMatching = allGroupItemsSortedBySize
      .map((x) => x.item)
      .filter(
        (i) => i.location_code.trim().toUpperCase() !== targetBin && !pendingParts.has(i.part_number)
      );

    if (scatteredMatching.length === 0 && binsCount.size < 2) continue;

    const categoryAr = groupItems[0]?.category || FAMILY_ARABIC_NAMES[fam] || `قطع استهلاكية (${fam})`;

    const evictions: SwapEvictionStep[] = [];
    const consolidations: SwapConsolidationStep[] = [];

    for (const batch of shelfBatches) {
      for (const { item: simItem, sizeProfile: sizeProf } of batch.items) {
        const fromBin = simItem.location_code.trim().toUpperCase();
        if (fromBin === batch.shelfBin || pendingParts.has(simItem.part_number)) continue;
        consolidations.push({
          partNumber: simItem.part_number,
          descriptionAr: simItem.description_ar,
          descriptionEn: simItem.description_en,
          family: fam,
          categoryAr: simItem.category || categoryAr,
          quantity: simItem.qty_remaining,
          fromBin,
          toBin: batch.shelfBin,
          sizeProfile: sizeProf,
          reason: `نقل وتجميع قطعة استهلاكية (${fam} — المقاس: ${sizeProf.mmLabel}) من ${fromBin} إلى رف الاستهلاكية ${batch.shelfBin} (دفعة #${batch.batchIndex}: ${batch.itemsCount}/${MAX_ITEMS_PER_SHELF} صنف)`,
        });
      }
    }

    const totalPartsToMove = consolidations.length;
    const totalUnitsToMove = consolidations.reduce((acc, c) => acc + c.quantity, 0);

    plans.push({
      id: `PLAN-${fam}-${targetBin}`,
      family: fam,
      familyAr: FAMILY_ARABIC_NAMES[fam] || `قطع استهلاكية (${fam})`,
      categoryAr,
      zone: targetZone,
      targetBin,
      recommendedBin,
      maxItemsPerShelf: MAX_ITEMS_PER_SHELF,
      shelfBatches,
      groupSizeCategory,
      groupMmSummary,
      groupTotalValueSar,
      subGroupsBySizeAndMm,
      adjacentBins,
      existingMatchingInTarget,
      evictions,
      consolidations,
      allGroupItemsSortedBySize,
      totalPartsToMove,
      totalUnitsToMove,
      summaryReason: `خطة نقل وتجميع القطع الاستهلاكية (${FAMILY_ARABIC_NAMES[fam] || fam} | المقاسات: ${groupMmSummary}) إلى أرفف الاستهلاكية (${shelfBatches.map((b) => `${b.shelfBin}: ${b.itemsCount}/${MAX_ITEMS_PER_SHELF} صنف`).join(' ، ')}).`,
    });
  }

  return plans.sort((a, b) => b.allGroupItemsSortedBySize.length - a.allGroupItemsSortedBySize.length);
}

function detectMaterialArabic(descUpper: string): string {
  if (descUpper.includes('INCONEL 718') || descUpper.includes('INCONEL')) return 'سبيكة إنكونيل مقاومة للحرارة (Inconel 718)';
  if (descUpper.includes('STELLITE')) return 'سبيكة ستالايت صلبة (Stellite Gr.6)';
  if (descUpper.includes('PEEK+ELGILOY') || descUpper.includes('ELGILOY')) return 'بوليمر PEEK + سبيكة إيلجيلوي';
  if (descUpper.includes('316L') || descUpper.includes('316')) return 'ستانلس ستيل مقاوم للصدأ (SS 316/316L)';
  if (descUpper.includes('304')) return 'ستانلس ستيل (SS 304)';
  if (descUpper.includes('410') || descUpper.includes('4140') || descUpper.includes('1040') || descUpper.includes('1045')) return 'صلب سبائكي مقسى (Alloy Steel)';
  if (descUpper.includes('BRONZE') || descUpper.includes('C93700')) return 'برونز صناعي (Bronze)';
  if (descUpper.includes('CARBON STEEL')) return 'صلب كربوني (Carbon Steel)';
  if (descUpper.includes('GRAPHITE') || descUpper.includes('CARBOGRAPHITE')) return 'جرافيت كربوني حراري (Graphite)';
  if (descUpper.includes('VITON') || descUpper.includes('FKM') || descUpper.includes('FEPM')) return 'مطاط فيتون حراري (Viton / FKM)';
  if (descUpper.includes('PTFE') || descUpper.includes('TEFLON')) return 'تفلون صناعي (PTFE)';
  if (descUpper.includes('NITRILE') || descUpper.includes('NBR') || descUpper.includes('RUBBER') || descUpper.includes('EPDM')) return 'مطاط صناعي مانع للتسرب';
  if (descUpper.includes('PLASTIC') || descUpper.includes('CPVC') || descUpper.includes('NYLON')) return 'بوليمر بلاستيك هندسي';
  return 'معدن صناعي قياسي';
}

export function computeLocalPartEngineeringAnalysis(
  item: Partial<InventoryItem> & { part_number: string; description_en: string; location_code?: string }
): GeminiPartAnalysis {
  const fullItem: InventoryItem = {
    part_number: item.part_number || '1000000000',
    location_code: (item.location_code || 'N11A1').trim().toUpperCase(),
    description_en: item.description_en || 'SPARE PART ASMO',
    description_ar: item.description_ar || '',
    category: item.category || 'عام',
    qty_total: item.qty_total ?? item.qty_remaining ?? 1,
    qty_out: item.qty_out ?? 0,
    qty_remaining: Math.max(1, item.qty_remaining ?? item.qty_total ?? 1),
    is_moved: item.is_moved ?? 0,
    status: item.status || 'غير مدقق',
    is_consumable: item.is_consumable,
  };

  const sizeProf = estimatePartSizeProfile(fullItem);
  const { descAr } = categorizeAndTranslate(fullItem.description_en);
  const finalDescAr = fullItem.description_ar && /[\u0600-\u06FF]/.test(fullItem.description_ar) ? fullItem.description_ar : descAr;
  const descUpper = fullItem.description_en.toUpperCase();
  const materialAr = detectMaterialArabic(descUpper);

  const unitWeightKg =
    sizeProf.sizeCategory === 'كبير / ثقيل'
      ? Math.round((8 + (sizeProf.sizeScore - 60) * 0.45) * 10) / 10
      : sizeProf.sizeCategory === 'متوسط الحجم'
      ? Math.round((1.2 + (sizeProf.sizeScore - 35) * 0.14) * 10) / 10
      : Math.round(Math.max(0.05, sizeProf.sizeScore * 0.02) * 100) / 100;
  const totalWeightKg = Math.round(unitWeightKg * fullItem.qty_remaining * 10) / 10;

  const zonePrefix = zone(fullItem.location_code) || 'N11';
  const consumable = isConsumablePart(fullItem);
  const preferFL = /FILTER|HOSE|BELT|GASKET|فلتر|خرطوم|سير|جازكيت/i.test(`${fullItem.description_en} ${finalDescAr}`);
  const recommendedShelfCode: 'D' | 'C' | 'A' | 'B' | 'BB' | 'FL' = consumable
    ? preferFL
      ? 'FL'
      : 'A'
    : 'B';
  const recommendedBin = consumable
    ? resolveTargetConsumableLocation(fullItem.location_code, preferFL)
    : fullItem.location_code;
  const placementReasonAr = consumable
    ? `قطعة استهلاكية سريعة الدوران (المقاس: ${sizeProf.mmLabel}) — توجه ضمن خطة النقل إلى رف القطع الاستهلاكية (${recommendedBin}) في (A / FL).`
    : `قطعة غير استهلاكية — مستثناة من خطة النقل (خطة النقل مخصصة للقطع الاستهلاكية فقط).`;

  return {
    part_number: fullItem.part_number,
    description_en: fullItem.description_en,
    description_ar: finalDescAr,
    dimensions_calculation_ar: sizeProf.dimensionsLabel,
    material_ar: materialAr,
    estimated_weight_kg: unitWeightKg,
    total_weight_kg: totalWeightKg,
    weight_label_ar: `القطعة ~${unitWeightKg} كجم | الإجمالي ~${totalWeightKg} كجم`,
    estimated_price_sar: sizeProf.estimatedPriceSar,
    total_value_sar: sizeProf.totalValueSar,
    price_label_ar: sizeProf.priceLabelAr,
    price_category: sizeProf.priceCategory,
    size_category: sizeProf.sizeCategory,
    current_bin: fullItem.location_code,
    recommended_shelf_code: recommendedShelfCode,
    recommended_bin: recommendedBin,
    placement_reason_ar: placementReasonAr,
    source: 'engineering-engine',
  };
}

export async function analyzePartsWithGeminiAssistant(
  items: Array<Partial<InventoryItem> & { part_number: string; description_en: string; location_code?: string }>
): Promise<GeminiPartAnalysis[]> {
  const localAnalyses = items.map((item) => computeLocalPartEngineeringAnalysis(item));

  const mergeAiAnalyses = (analyses: any[]): GeminiPartAnalysis[] => {
    const aiMap = new Map<string, any>();
    for (const a of analyses) {
      if (a?.part_number) aiMap.set(String(a.part_number), a);
    }
    return localAnalyses.map((loc) => {
      const ai = aiMap.get(loc.part_number);
      if (!ai) return loc;
      return {
        ...loc,
        description_ar: ai.description_ar || loc.description_ar,
        dimensions_calculation_ar: ai.dimensions_calculation_ar || loc.dimensions_calculation_ar,
        material_ar: ai.material_ar || loc.material_ar,
        source: 'gemini-ai',
      };
    });
  };

  const candidateUrls = getCandidateApiUrls('/api/gemini/analyze-parts');
  for (const url of candidateUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 14000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: items.slice(0, 45) }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        if (data?.success && Array.isArray(data.analyses) && data.analyses.length > 0) {
          return mergeAiAnalyses(data.analyses);
        }
      }
    } catch {
      clearTimeout(timeoutId);
    }
  }

  return localAnalyses;
}

/**
 * تحديد ما إذا كانت القطعة من "القطع الاستهلاكية" (Consumable Parts)
 * سواء تم تعليمها يدوياً بواسطة المستخدم (is_consumable === 1) أو تلقائياً من طبيعة الصنف (فلاتر، سيور، أورنق، صوف، وجيه، فيوزات، لمبات، خراطيم، شحوم، مسامير استهلاكية)
 */
export function isConsumablePart(
  item: Pick<InventoryItem, 'description_en' | 'description_ar' | 'category' | 'is_consumable'>
): boolean {
  if (item.is_consumable === 1) return true;
  if (item.is_consumable === 0) return false;
  const text = `${item.description_en || ''} ${item.description_ar || ''} ${item.category || ''}`.toUpperCase();
  return /\b(FILTER|CARTRIDGE|STRAINER|BELT|V-BELT|O-RING|ORING|SEAL|GASKET|HOSE|FUSE|LAMP|BULB|GLOVE|GREASE|LUBRICANT|OIL|TAPE|PACKING|WASHER|NUT|BOLT|SCREW|STUD|BEARING)\b|فلتر|فلاتر|مصفاة|مصافي|سير|سيور|أورنق|اورنق|صوفة|مانع تسرب|جازكيت|وجيه|جوان|خرطوم|فيوز|لمبة|شحم|زيت|استهلاكي|استهلاكية/i.test(
    text
  );
}

/**
 * التحقق مما إذا كان الموقع من مواقع القطع الاستهلاكية السريعة (A أو FL)
 */
export function isConsumableTargetLocation(locationCode: string): boolean {
  const clean = (locationCode || '').trim().toUpperCase();
  if (!clean) return false;
  return /^[A-Z]\d{2}(?:A|FL)\d+$/i.test(clean) || /^(?:A|FL)\d+$/i.test(clean);
}

/**
 * اقتراح أقرب موقع استهلاكي (A أو FL) لنفس الممر أو القطاع
 */
export function resolveTargetConsumableLocation(
  currentLocation: string,
  preferFL: boolean = false
): string {
  const clean = (currentLocation || '').trim().toUpperCase();
  const m = clean.match(/^([A-Z]\d{2})([A-Z]{1,2})(\d+)$/);
  if (m) {
    const prefix = m[1];
    const level = m[3] === '2' ? '2' : '1';
    return `${prefix}${preferFL ? 'FL' : 'A'}${level}`;
  }
  return preferFL ? 'N11FL1' : 'N11A1';
}

export interface ConsumableRelocationSuggestion {
  partNumber: string;
  descriptionAr: string;
  descriptionEn: string;
  category: string;
  quantity: number;
  from: string;
  to: string;
  isManualConsumable: boolean;
  reason: string;
}

export function suggestConsumableItemsToAOrFL(
  items: InventoryItem[],
  pendingParts: Set<string> = new Set()
): ConsumableRelocationSuggestion[] {
  const suggestions: ConsumableRelocationSuggestion[] = [];
  for (const item of items) {
    if (item.qty_remaining <= 0 || item.is_missing === 1) continue;
    if (pendingParts.has(item.part_number)) continue;
    if (!isConsumablePart(item)) continue;
    if (isConsumableTargetLocation(item.location_code)) continue;
    const preferFL = /FILTER|HOSE|BELT|GASKET|فلتر|خرطوم|سير|جازكيت/i.test(
      `${item.description_en} ${item.description_ar}`
    );
    const target = resolveTargetConsumableLocation(item.location_code, preferFL);
    suggestions.push({
      partNumber: item.part_number,
      descriptionAr: item.description_ar,
      descriptionEn: item.description_en,
      category: item.category || 'قطع استهلاكية',
      quantity: item.qty_remaining,
      from: item.location_code,
      to: target,
      isManualConsumable: item.is_consumable === 1,
      reason: `نقل قطعة استهلاكية سريعة الدوران (${item.description_ar || item.description_en}) من ${item.location_code} إلى رف القطع الاستهلاكية القريب (${target}) لسهولة الصرف اليومي.`,
    });
  }
  return suggestions;
}

