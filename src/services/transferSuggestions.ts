import type { InventoryItem } from '../types';
import { categorizeAndTranslate } from '../utils/translator';

export interface GeminiPartAnalysis {
  part_number: string;
  description_en: string;
  description_ar: string;
  dimensions_calculation_ar: string;
  material_ar: string;
  estimated_weight_kg: number;
  total_weight_kg: number;
  weight_label_ar: string;
  size_category: 'كبير / ثقيل' | 'متوسط الحجم' | 'صغير / خفيف';
  current_bin: string;
  current_elevation: ShelfElevationInfo;
  recommended_shelf_code: 'FL' | 'A' | 'B' | 'BB' | 'C' | 'D';
  recommended_bin: string;
  recommended_elevation: ShelfElevationInfo;
  placement_reason_ar: string;
  source: 'gemini-ai' | 'engineering-engine';
}

export interface ShelfElevationInfo {
  shelfCode: 'FL' | 'A' | 'B' | 'BB' | 'C' | 'D' | string;
  meters: number;
  shortLabelAr: string;
  fullExplanationAr: string;
  suitabilityAr: string;
  badgeColorClass: string;
}

export interface PartSizeProfile {
  sizeScore: number; // 1 (أصغر/أخف) إلى 100 (أكبر/أثقل)
  sizeCategory: 'كبير / ثقيل' | 'متوسط الحجم' | 'صغير / خفيف';
  dimensionsLabel: string;
  recommendedShelves: Array<'FL' | 'A' | 'B' | 'BB' | 'C' | 'D'>;
  recommendedShelfTextAr: string;
}

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
  sizeProfile: PartSizeProfile;
  fromElevation: ShelfElevationInfo;
  toElevation: ShelfElevationInfo;
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
  sizeProfile: PartSizeProfile;
  fromElevation: ShelfElevationInfo;
  toElevation: ShelfElevationInfo;
  reason: string;
}

export interface SimilaritySwapPlan {
  id: string;
  family: string;
  familyAr: string;
  zone: string;
  targetBin: string;
  targetElevation: ShelfElevationInfo;
  recommendedHeightBin: string;
  recommendedHeightElevation: ShelfElevationInfo;
  groupSizeCategory: 'كبير / ثقيل' | 'متوسط الحجم' | 'صغير / خفيف';
  adjacentBins: string[];
  existingMatchingInTarget: InventoryItem[];
  evictions: SwapEvictionStep[];
  consolidations: SwapConsolidationStep[];
  allGroupItemsSortedBySize: Array<{
    item: InventoryItem;
    sizeProfile: PartSizeProfile;
    currentElevation: ShelfElevationInfo;
  }>;
  totalPartsToMove: number;
  totalUnitsToMove: number;
  summaryReason: string;
}

/**
 * دليل ارتفاعات الرفوف المعتمد في المستودع:
 * FL = الرف على الأرض (0 متر)
 * A  = يرتفع 1 متر عن الأرض
 * B  = يرتفع 2 متر عن الأرض (مترين)
 * BB = يرتفع 3 متر عن الأرض
 * C / C4 = يرتفع 4 متر عن الأرض
 * D / D5 = يرتفع 5 متر عن الأرض
 */
export const SHELF_ELEVATION_GUIDE: Array<{
  code: string;
  meters: number;
  titleAr: string;
  descAr: string;
  suitableForAr: string;
}> = [
  {
    code: 'FL',
    meters: 0,
    titleAr: 'FL — الرف على الأرض (0 متر)',
    descAr: 'مستوى أرضية المستودع مباشرة',
    suitableForAr: 'القطع الكبيرة والثقيلة (صمامات، مضخات، محامل كبيرة، أعمدة، فلنجات)',
  },
  {
    code: 'A',
    meters: 1,
    titleAr: 'A — يرتفع 1 متر عن الأرض',
    descAr: 'الرف الأول (ارتفاع متر واحد)',
    suitableForAr: 'القطع المتوسطة المائلة للثقل (حلقات تآكل، جلب أعمدة، كونتاكتورات كبيرة)',
  },
  {
    code: 'B',
    meters: 2,
    titleAr: 'B — يرتفع مترين (2 متر)',
    descAr: 'الرف الثاني (ارتفاع مترين عن الأرض)',
    suitableForAr: 'القطع متوسطة الحجم والوزن (محامل متوسطة، منظمات، وحدات طاقة)',
  },
  {
    code: 'BB',
    meters: 3,
    titleAr: 'BB — يرتفع 3 متر عن الأرض',
    descAr: 'الرف الثالث الوسطي (ارتفاع 3 أمتار)',
    suitableForAr: 'القطع المتوسطة والخفيفة (حشوات، أطقم إصلاح، فواصل معدنية)',
  },
  {
    code: 'C',
    meters: 4,
    titleAr: 'C / C4 — يرتفع 4 متر عن الأرض',
    descAr: 'الرف الرابع العلوي (ارتفاع 4 أمتار)',
    suitableForAr: 'القطع الخفيفة والصغيرة (جازكيت، براغي، ريلاي، فيوزات)',
  },
  {
    code: 'D',
    meters: 5,
    titleAr: 'D / D5 — يرتفع 5 متر عن الأرض',
    descAr: 'الرف الخامس الأعلى (ارتفاع 5 أمتار)',
    suitableForAr: 'القطع الخفيفة والصغيرة جداً (حلقات أورينج O-Ring، أربطة كابلات، أغطية خفيفة)',
  },
];

/**
 * تحليل رمز الموقع (مثل N11FL1, N12A1, N17B1, N11BB1, N11C2, N16D2) واستخراج ارتفاع الرف بالمتر
 */
export function parseShelfElevation(locationCode: string): ShelfElevationInfo {
  const clean = (locationCode || '').trim().toUpperCase().replace(/\s+/g, '');
  // استخراج رمز الرف بعد رمز القطاع ورقم الممر (مثال: N11FL1 -> FL, N11BB2 -> BB, N11C4 -> C, N16D2 -> D)
  const match = clean.match(/^[A-Z]\d{2}(FL|BB|A|B|C|D)\d*$/);
  const shelfCode = match ? match[1] : clean.includes('FL') ? 'FL' : clean.includes('BB') ? 'BB' : '';

  switch (shelfCode) {
    case 'FL':
      return {
        shelfCode: 'FL',
        meters: 0,
        shortLabelAr: 'الرف على الأرض (FL = 0م)',
        fullExplanationAr: 'FL تعني الرف على الأرض (ارتفاع 0 متر)',
        suitabilityAr: 'للقطع الثقيلة والكبيرة الحجم',
        badgeColorClass: 'bg-emerald-950/90 text-emerald-300 border-emerald-500/60',
      };
    case 'A':
      return {
        shelfCode: 'A',
        meters: 1,
        shortLabelAr: 'يرتفع 1 متر (A)',
        fullExplanationAr: 'A تعني يرتفع متر واحد (1م) عن الأرض',
        suitabilityAr: 'للقطع المتوسطة/الثقيلة',
        badgeColorClass: 'bg-teal-950/90 text-teal-300 border-teal-500/60',
      };
    case 'B':
      return {
        shelfCode: 'B',
        meters: 2,
        shortLabelAr: 'يرتفع مترين (B = 2م)',
        fullExplanationAr: 'B تعني يرتفع مترين (2م) عن الأرض',
        suitabilityAr: 'للقطع متوسطة الحجم',
        badgeColorClass: 'bg-sky-950/90 text-sky-300 border-sky-500/60',
      };
    case 'BB':
      return {
        shelfCode: 'BB',
        meters: 3,
        shortLabelAr: 'يرتفع 3 متر (BB)',
        fullExplanationAr: 'BB تعني يرتفع 3 أمتار عن الأرض',
        suitabilityAr: 'للقطع المتوسطة/الخفيفة',
        badgeColorClass: 'bg-indigo-950/90 text-indigo-300 border-indigo-500/60',
      };
    case 'C':
      return {
        shelfCode: 'C',
        meters: 4,
        shortLabelAr: 'يرتفع 4 متر (C)',
        fullExplanationAr: 'C / C4 تعني يرتفع 4 أمتار عن الأرض',
        suitabilityAr: 'للقطع الخفيفة والصغيرة',
        badgeColorClass: 'bg-amber-950/90 text-amber-300 border-amber-500/60',
      };
    case 'D':
      return {
        shelfCode: 'D',
        meters: 5,
        shortLabelAr: 'يرتفع 5 متر (D)',
        fullExplanationAr: 'D / D5 تعني يرتفع 5 أمتار عن الأرض',
        suitabilityAr: 'للقطع الصغيرة والخفيفة جداً',
        badgeColorClass: 'bg-purple-950/90 text-purple-300 border-purple-500/60',
      };
    default:
      return {
        shelfCode: shelfCode || '—',
        meters: 1,
        shortLabelAr: 'مستوى قياسي',
        fullExplanationAr: 'مستوى رف قياسي في المستودع',
        suitabilityAr: 'مناسب لمختلف القطع',
        badgeColorClass: 'bg-stone-900 text-stone-300 border-stone-700',
      };
  }
}

/**
 * تقدير حجم ووزن القطعة الفعلي من وصفها الهندسي والمقاسات (MM, IN, SQ IN, A) لتحديد ترتيب الحجم والرف الأنسب
 */
export function estimatePartSizeProfile(item: Pick<InventoryItem, 'description_en'>): PartSizeProfile {
  const desc = (item.description_en || '').toUpperCase();
  let score = 45; // نقطة البداية (متوسط)
  const extractedDims: string[] = [];

  // 1. استخراج الأبعاد بالمليمتر (MM)
  const mmMatches = Array.from(desc.matchAll(/(\d+(?:\.\d+)?)\s*MM\b/g));
  let maxMm = 0;
  for (const m of mmMatches) {
    const val = parseFloat(m[1]);
    if (!isNaN(val)) {
      if (val > maxMm) maxMm = val;
      extractedDims.push(`${val} ملم`);
    }
  }

  // 2. استخراج الأبعاد بالبوصة (IN أو SQ IN)
  const sqInMatch = desc.match(/(\d+(?:\.\d+)?)\s*SQ\s*IN\b/);
  if (sqInMatch) {
    const sqVal = parseFloat(sqInMatch[1]);
    extractedDims.push(`${sqVal} بوصة مربعة`);
    score += Math.min(35, sqVal * 0.6);
  }

  const inMatches = Array.from(desc.matchAll(/(\d+(?:\/\d+|\.\d+)?)\s*IN\b/g));
  for (const m of inMatches) {
    extractedDims.push(`${m[1]} بوصة`);
    if (!m[1].includes('/')) {
      const val = parseFloat(m[1]);
      if (val >= 2) score += 20;
    }
  }

  // 3. استخراج قدرة التيار بالأمبير (A) للقطع الكهربائية الكبيرة مثل CONTACTOR 1000 A
  const ampMatch = desc.match(/\b(\d+)\s*A\b/);
  if (ampMatch) {
    const amps = parseInt(ampMatch[1], 10);
    extractedDims.push(`${amps} أمبير`);
    if (amps >= 200) score += 35;
    else if (amps >= 50) score += 15;
  }

  // 4. استخراج مقاس القلاووظ المليمتري مثل M10 X 45
  const threadMatch = desc.match(/\b(M\d+(?:\s*X\s*\d+)?)\b/);
  if (threadMatch) {
    extractedDims.push(threadMatch[1]);
  }

  // تأثير القطر/الطول بالمليمتر على الحجم
  if (maxMm >= 180 && !desc.includes('TIE, CABLE')) {
    score += 32;
  } else if (maxMm >= 80 && !desc.includes('TIE, CABLE')) {
    score += 18;
  } else if (maxMm > 0 && maxMm <= 25) {
    score -= 15;
  }

  // 5. تأثير نوع القطعة الهندسي على الوزن والحجم
  if (
    desc.includes('VALVE') ||
    desc.includes('ACTUATOR') ||
    desc.includes('CASING') ||
    desc.includes('IMPELLER') ||
    desc.includes('SLEEVE SHAFT') ||
    desc.includes('BEARING, JOURNAL') ||
    desc.includes('BEARING ROLLER') ||
    desc.includes('STUD ASSEMBLY') ||
    desc.includes('CONTACTOR') ||
    desc.includes('AIR BLOWER') ||
    desc.includes('RING WEAR')
  ) {
    score += 24;
  } else if (
    desc.includes('BUSHING') ||
    desc.includes('SLEEVE') ||
    desc.includes('SPRING') ||
    desc.includes('POWER SUPPLY') ||
    desc.includes('REGULATOR') ||
    desc.includes('LABYRINTH') ||
    desc.includes('RETAINER') ||
    desc.includes('CAP, BEARING') ||
    desc.includes('SUPPORT: RIGID CONDUIT')
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
  const dimensionsLabel =
    extractedDims.length > 0 ? Array.from(new Set(extractedDims)).slice(0, 2).join(' × ') : 'مقاس قياسي';

  if (finalScore >= 65) {
    return {
      sizeScore: finalScore,
      sizeCategory: 'كبير / ثقيل',
      dimensionsLabel,
      recommendedShelves: ['FL', 'A'],
      recommendedShelfTextAr: 'الرف الأرضي FL (0م) أو الرف A (1م)',
    };
  }
  if (finalScore >= 38) {
    return {
      sizeScore: finalScore,
      sizeCategory: 'متوسط الحجم',
      dimensionsLabel,
      recommendedShelves: ['A', 'B', 'BB'],
      recommendedShelfTextAr: 'الرف A (1م) أو B (2م) أو BB (3م)',
    };
  }
  return {
    sizeScore: finalScore,
    sizeCategory: 'صغير / خفيف',
    dimensionsLabel,
    recommendedShelves: ['BB', 'C', 'D'],
    recommendedShelfTextAr: 'الرفوف العلوية BB (3م) أو C (4م) أو D (5م)',
  };
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
  (location || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z]\d{2})/)?.[1];

export function detectTechnicalFamily(item: InventoryItem): string | undefined {
  const text = (item.description_en || '').toUpperCase();
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
  if (text.includes('POWER SUPPLY') || text.includes('AMMETER') || text.includes('INSULATOR') || text.includes('CONTACTOR')) {
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
  const elevA = parseShelfElevation(cleanA).meters;
  const elevB = parseShelfElevation(cleanB).meters;
  const shelfDiff = Math.abs(elevA - elevB) * 2;
  const levelDiff = Math.abs(a.level - b.level);

  return sectorDiff + aisleDiff + shelfDiff + levelDiff;
}

/**
 * اقتراح أقرب المواقع المتجاورة لموقع معين (Proximate Storage Bins) مرتبة حسب الارتفاع والقرب
 */
export function getAdjacentStorageBins(targetBin: string, allBins: string[], maxCount = 6): string[] {
  const cleanTarget = (targetBin || '').trim().toUpperCase();
  const candidates = new Set<string>(allBins.map((b) => b.trim().toUpperCase()).filter(Boolean));

  const m = cleanTarget.match(/^([A-Z]\d{2})([A-Z]{1,2})(\d+)$/);
  if (m) {
    const prefix = m[1];
    const shelf = m[2];
    const level = parseInt(m[3], 10);
    candidates.add(`${prefix}${shelf}${level === 1 ? 2 : 1}`);
    for (const adjShelf of ['FL', 'A', 'B', 'BB', 'C', 'D']) {
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
 * بناء خطة متكاملة لتجميع المتشابهات مع الترتيب حسب الحجم ومراعاة ارتفاع الرف (FL=0م، A=1م، B=2م، BB=3م، C=4م، D=5م)
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
    if (groupItems.length < 2) continue;

    // ترتيب جميع قطع المجموعة من الأكبر/الأثقل حجماً إلى الأصغر/الأخف
    const allGroupItemsSortedBySize = groupItems
      .map((item) => ({
        item,
        sizeProfile: estimatePartSizeProfile(item),
        currentElevation: parseShelfElevation(item.location_code),
      }))
      .sort((a, b) => b.sizeProfile.sizeScore - a.sizeProfile.sizeScore);

    // حساب متوسط حجم المجموعة لتحديد الارتفاع الأنسب (FL, A, B, BB, C, D)
    const avgSizeScore =
      allGroupItemsSortedBySize.reduce((acc, x) => acc + x.sizeProfile.sizeScore, 0) /
      allGroupItemsSortedBySize.length;

    const groupSizeCategory: 'كبير / ثقيل' | 'متوسط الحجم' | 'صغير / خفيف' =
      avgSizeScore >= 65 ? 'كبير / ثقيل' : avgSizeScore >= 38 ? 'متوسط الحجم' : 'صغير / خفيف';

    const idealMeters = groupSizeCategory === 'كبير / ثقيل' ? 0.5 : groupSizeCategory === 'متوسط الحجم' ? 2 : 4;

    const binsCount = new Map<string, number>();
    for (const item of groupItems) {
      const b = item.location_code.trim().toUpperCase();
      binsCount.set(b, (binsCount.get(b) || 0) + 1);
    }

    // اختيار الموقع الفعلي الأمثل مع مراعاة عدد المتشابهات وملاءمة ارتفاع الرف لحجم القطع
    const sortedBins = Array.from(binsCount.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const elevDiffA = Math.abs(parseShelfElevation(a[0]).meters - idealMeters);
      const elevDiffB = Math.abs(parseShelfElevation(b[0]).meters - idealMeters);
      if (elevDiffA !== elevDiffB) return elevDiffA - elevDiffB;
      const occA = (itemsByBin.get(a[0]) || []).length - a[1];
      const occB = (itemsByBin.get(b[0]) || []).length - b[1];
      return occA - occB || a[0].localeCompare(b[0]);
    });

    const targetBin = sortedBins[0][0];
    const targetZone = zone(targetBin) || 'N11';
    const targetElevation = parseShelfElevation(targetBin);

    // حساب الرف المثالي حسب الحجم في نفس الممر (مثلاً إذا كانت القطع ثقيلة نقترح N11FL1 أو N11A1)
    const recommendedShelfCode =
      groupSizeCategory === 'كبير / ثقيل'
        ? targetElevation.meters <= 1
          ? targetElevation.shelfCode
          : 'FL'
        : groupSizeCategory === 'متوسط الحجم'
        ? targetElevation.meters >= 1 && targetElevation.meters <= 3
          ? targetElevation.shelfCode
          : 'B'
        : targetElevation.meters >= 3
        ? targetElevation.shelfCode
        : 'C';

    const recommendedHeightBin =
      recommendedShelfCode === targetElevation.shelfCode
        ? targetBin
        : `${targetZone}${recommendedShelfCode}1`;
    const recommendedHeightElevation = parseShelfElevation(recommendedHeightBin);

    const adjacentBins = getAdjacentStorageBins(targetBin, allBins, 6);

    const existingMatchingInTarget = (itemsByBin.get(targetBin) || [])
      .filter((i) => detectTechnicalFamily(i) === fam)
      .sort((a, b) => estimatePartSizeProfile(b).sizeScore - estimatePartSizeProfile(a).sizeScore);

    const scatteredMatching = allGroupItemsSortedBySize
      .map((x) => x.item)
      .filter(
        (i) => i.location_code.trim().toUpperCase() !== targetBin && !pendingParts.has(i.part_number)
      );

    if (scatteredMatching.length === 0 && binsCount.size < 2) continue;

    const vacatedSourceBins = Array.from(
      new Set(scatteredMatching.map((i) => i.location_code.trim().toUpperCase()))
    ).sort((a, b) => computeBinProximityScore(targetBin, a) - computeBinProximityScore(targetBin, b));

    const nonMatchingInTarget = (itemsByBin.get(targetBin) || []).filter(
      (i) => detectTechnicalFamily(i) !== fam && !pendingParts.has(i.part_number)
    );

    const evictions: SwapEvictionStep[] = nonMatchingInTarget.map((occupant, idx) => {
      const occSize = estimatePartSizeProfile(occupant);
      const preferredEvictShelf =
        occSize.sizeCategory === 'كبير / ثقيل'
          ? `${targetZone}FL1`
          : occSize.sizeCategory === 'متوسط الحجم'
          ? `${targetZone}B1`
          : `${targetZone}D1`;
      const fallbackBin =
        vacatedSourceBins[idx % Math.max(1, vacatedSourceBins.length)] ||
        (preferredEvictShelf !== targetBin ? preferredEvictShelf : adjacentBins[0]) ||
        `${targetZone}B2`;
      const occFamily = detectTechnicalFamily(occupant) || occupant.category || 'متنوع';
      const fromElev = parseShelfElevation(targetBin);
      const toElev = parseShelfElevation(fallbackBin);
      return {
        partNumber: occupant.part_number,
        descriptionAr: occupant.description_ar,
        descriptionEn: occupant.description_en,
        currentFamily: occFamily,
        quantity: occupant.qty_remaining,
        fromBin: targetBin,
        evictToBin: fallbackBin,
        sizeProfile: occSize,
        fromElevation: fromElev,
        toElevation: toElev,
        reason: `إخراج صنف غير متشابه (${occFamily} — ${occSize.sizeCategory}) من ${targetBin} (${fromElev.shortLabelAr}) إلى ${fallbackBin} (${toElev.shortLabelAr})`,
      };
    });

    const consolidations: SwapConsolidationStep[] = scatteredMatching.map((simItem) => {
      const sizeProf = estimatePartSizeProfile(simItem);
      const fromBin = simItem.location_code.trim().toUpperCase();
      const fromElev = parseShelfElevation(fromBin);
      return {
        partNumber: simItem.part_number,
        descriptionAr: simItem.description_ar,
        descriptionEn: simItem.description_en,
        family: fam,
        quantity: simItem.qty_remaining,
        fromBin,
        toBin: targetBin,
        sizeProfile: sizeProf,
        fromElevation: fromElev,
        toElevation: targetElevation,
        reason: `تجميع الصنف المتشابه (${fam} — ${sizeProf.sizeCategory}) من ${fromBin} (${fromElev.shortLabelAr}) إلى ${targetBin} (${targetElevation.shortLabelAr})`,
      };
    });

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
      targetElevation,
      recommendedHeightBin,
      recommendedHeightElevation,
      groupSizeCategory,
      adjacentBins,
      existingMatchingInTarget,
      evictions,
      consolidations,
      allGroupItemsSortedBySize,
      totalPartsToMove,
      totalUnitsToMove,
      summaryReason: `خطة تجميع وترتيب عائلة (${FAMILY_ARABIC_NAMES[fam] || fam}) حسب الحجم (${groupSizeCategory}) في الموقع ${targetBin} (${targetElevation.shortLabelAr}): نقل ${consolidations.length} قطعة متشابهة لتنضم إلى ${existingMatchingInTarget.length} قطع موجودة.`,
    });
  }

  return plans.sort(
    (a, b) =>
      b.allGroupItemsSortedBySize.length - a.allGroupItemsSortedBySize.length
  );
}

/**
 * تحويل كسر البوصة (مثل 3/4 أو 1/2 أو 1.5) إلى قيمة عشرية بالبوصة
 */
function parseInchValue(raw: string): number {
  const clean = raw.trim();
  if (clean.includes('/')) {
    const [num, den] = clean.split('/').map((n) => parseFloat(n));
    if (!isNaN(num) && !isNaN(den) && den !== 0) {
      return num / den;
    }
  }
  const val = parseFloat(clean);
  return isNaN(val) ? 0 : val;
}

/**
 * المساعد الهندسي المحلي لحسبة المقاسات، تحويل الوحدات (بوصة ⬅ ملم/سم)، تقدير الوزن، والترجمة، واقتراح الرف الأنسب
 */
export function computeLocalPartEngineeringAnalysis(
  item: Pick<InventoryItem, 'part_number' | 'description_en' | 'location_code'> & {
    description_ar?: string;
    qty_remaining?: number;
  }
): GeminiPartAnalysis {
  const descEn = (item.description_en || '').trim();
  const upper = descEn.toUpperCase();
  const qty = Math.max(1, Number(item.qty_remaining ?? 1));
  const { descAr: translatedAr } = categorizeAndTranslate(descEn);
  const finalDescAr =
    item.description_ar &&
    /[\u0600-\u06FF]/.test(item.description_ar) &&
    item.description_ar !== descEn
      ? item.description_ar
      : translatedAr;

  const sizeProf = estimatePartSizeProfile({ description_en: descEn });

  // 1. حسبة المقاسات التفصيلية وتحويل الوحدات (بوصة ⬅ ملم وسم)
  const calcParts: string[] = [];

  // القطر الخارجي والداخلي والسماكة والطول والعرض بالمليمتر
  const odMatch = upper.match(/(\d+(?:\.\d+)?)\s*MM\s*OD\b/);
  if (odMatch) {
    const mm = parseFloat(odMatch[1]);
    calcParts.push(`القطر الخارجي (OD): ${mm} ملم (${(mm / 10).toFixed(1)} سم)`);
  }
  const idMatch = upper.match(/(\d+(?:\.\d+)?)\s*MM\s*ID\b/);
  if (idMatch) {
    const mm = parseFloat(idMatch[1]);
    calcParts.push(`القطر الداخلي (ID): ${mm} ملم (${(mm / 10).toFixed(1)} سم)`);
  }
  const thkMatch = upper.match(/(\d+(?:\.\d+)?)\s*MM\s*THK\b/);
  if (thkMatch) {
    const mm = parseFloat(thkMatch[1]);
    calcParts.push(`السماكة (THK): ${mm} ملم`);
  }
  const lgMatch = upper.match(/(\d+(?:\.\d+)?)\s*MM\s*LG\b/);
  if (lgMatch) {
    const mm = parseFloat(lgMatch[1]);
    calcParts.push(`الطول (LG): ${mm} ملم (${(mm / 10).toFixed(1)} سم)`);
  }
  const wdMatch = upper.match(/(\d+(?:\.\d+)?)\s*MM\s*WD\b/);
  if (wdMatch) {
    const mm = parseFloat(wdMatch[1]);
    calcParts.push(`العرض (WD): ${mm} ملم`);
  }

  // أي أبعاد عامة بالمليمتر لم تذكر أعلاه
  if (calcParts.length === 0) {
    const genericMm = Array.from(upper.matchAll(/(\d+(?:\.\d+)?)\s*MM\b/g));
    for (const m of genericMm) {
      const mm = parseFloat(m[1]);
      if (!isNaN(mm)) {
        calcParts.push(`المقاس: ${mm} ملم (${(mm / 10).toFixed(2)} سم / ${(mm / 25.4).toFixed(2)} بوصة)`);
      }
    }
  }

  // تحويل المساحة بالبوصة المربعة (SQ IN) إلى سم²
  const sqInMatch = upper.match(/(\d+(?:\.\d+)?)\s*SQ\s*IN\b/);
  if (sqInMatch) {
    const sqIn = parseFloat(sqInMatch[1]);
    const sqCm = (sqIn * 6.4516).toFixed(1);
    calcParts.push(`مساحة المشغل: ${sqIn} بوصة مربعة = ${sqCm} سم²`);
  }

  // تحويل البوصة (IN) إلى مليمتر وسنتيمتر
  const inMatches = Array.from(upper.matchAll(/\b(\d+(?:\/\d+|\.\d+)?)\s*IN\b/g));
  for (const m of inMatches) {
    if (upper.includes(`${m[1]} SQ IN`)) continue;
    const inchVal = parseInchValue(m[1]);
    if (inchVal > 0) {
      const mmVal = (inchVal * 25.4).toFixed(1);
      const cmVal = (inchVal * 2.54).toFixed(2);
      calcParts.push(`المقاس بالبوصة: ${m[1]} بوصة = ${mmVal} ملم (${cmVal} سم)`);
    }
  }

  // مقاس القلاووظ المليمتري مثل M10 X 45
  const threadMatch = upper.match(/\bM(\d+)\s*X\s*(\d+)\b/);
  if (threadMatch) {
    calcParts.push(`قلاووظ متري: قطر ${threadMatch[1]} ملم × طول ${threadMatch[2]} ملم`);
  }

  // القدرات الكهربائية والضغط
  const ampMatch = upper.match(/\b(\d+)\s*A\b/);
  if (ampMatch) {
    calcParts.push(`قدرة التيار: ${ampMatch[1]} أمبير`);
  }
  const voltMatch = upper.match(/\b(\d+)\s*(VDC|VAC|V)\b/);
  if (voltMatch) {
    calcParts.push(`الجهد الكهربائي: ${voltMatch[1]} ${voltMatch[2] === 'VDC' ? 'فولت مستمر' : 'فولت متردد'}`);
  }
  const barMatch = upper.match(/(\d+\s*-\s*\d+|\d+)\s*BAR\b/);
  if (barMatch) {
    calcParts.push(`نطاق الضغط: ${barMatch[1]} بار`);
  }

  const dimensionsCalculationAr =
    calcParts.length > 0
      ? calcParts.join(' | ')
      : `مقاس صناعي قياسي (${sizeProf.dimensionsLabel})`;

  // 2. استخلاص نوع المعدن/المادة وتقدير الكثافة والوزن
  let materialAr = 'سبائك معدنية صناعية';
  let densityFactor = 1.0;

  if (upper.includes('316') || upper.includes('304') || upper.includes('410') || upper.includes('STAINLESS')) {
    materialAr = 'فولاذ مقاوم للصدأ (ستانلس ستيل)';
    densityFactor = 1.35;
  } else if (upper.includes('CAST IRON')) {
    materialAr = 'حديد زهر عالي الكثافة';
    densityFactor = 1.5;
  } else if (upper.includes('NITRONIC') || upper.includes('INCONEL') || upper.includes('STELLITE')) {
    materialAr = 'سبيكة خاصة عالية الصلابة مقاومة للتآكل والحرارة';
    densityFactor = 1.4;
  } else if (upper.includes('BRONZE') || upper.includes('BRASS') || upper.includes('COPPER')) {
    materialAr = 'سبيكة برونز / نحاس صناعي';
    densityFactor = 1.3;
  } else if (upper.includes('STEEL') || upper.includes('B7') || upper.includes('4140')) {
    materialAr = 'صلب كربوني معالج حرارياً';
    densityFactor = 1.25;
  } else if (upper.includes('CARBOGRAPHITE') || upper.includes('CARBON') || upper.includes('GRAFOIL')) {
    materialAr = 'كربون جرافيتي صناعي';
    densityFactor = 0.55;
  } else if (upper.includes('PTFE') || upper.includes('RPTFE') || upper.includes('TEFLON')) {
    materialAr = 'تفلون حراري (PTFE)';
    densityFactor = 0.3;
  } else if (upper.includes('NEOPRENE') || upper.includes('NITRILE') || upper.includes('VITON') || upper.includes('RUBBER')) {
    materialAr = 'مطاط صناعي مانع للتسرب';
    densityFactor = 0.15;
  } else if (upper.includes('NYLON') || upper.includes('PLASTIC')) {
    materialAr = 'نايلون / بوليمر خفيف';
    densityFactor = 0.1;
  } else if (upper.includes('ARAMID') || upper.includes('KLINGERSIL')) {
    materialAr = 'ألياف أراميد / كلينجرسيل مانعة للتسرب';
    densityFactor = 0.2;
  }

  // تقدير الوزن بالكيلوجرام للقطعة الواحدة بناءً على درجة الحجم والكثافة
  let unitWeightKg = 0.8;
  if (sizeProf.sizeScore >= 75) {
    unitWeightKg = +(8.5 * densityFactor + (sizeProf.sizeScore - 70) * 0.45).toFixed(2);
  } else if (sizeProf.sizeScore >= 65) {
    unitWeightKg = +(4.2 * densityFactor + (sizeProf.sizeScore - 60) * 0.25).toFixed(2);
  } else if (sizeProf.sizeScore >= 45) {
    unitWeightKg = +(1.4 * densityFactor + (sizeProf.sizeScore - 40) * 0.08).toFixed(2);
  } else if (sizeProf.sizeScore >= 30) {
    unitWeightKg = +(0.35 * densityFactor).toFixed(2);
  } else {
    unitWeightKg = +(Math.max(0.02, 0.12 * densityFactor)).toFixed(3);
  }

  const totalWeightKg = +(unitWeightKg * qty).toFixed(2);
  const weightLabelAr =
    unitWeightKg >= 1
      ? `القطعة ~${unitWeightKg} كجم (الإجمالي للكمية ${qty}: ~${totalWeightKg} كجم)`
      : `القطعة ~${Math.round(unitWeightKg * 1000)} جرام (الإجمالي للكمية ${qty}: ~${totalWeightKg} كجم)`;

  // 3. تحديد الرف والموقع الأنسب حسب الوزن والحجم (FL=0م، A=1م، B=2م، BB=3م، C=4م، D=5م)
  const currentBin = (item.location_code || 'N11A1').trim().toUpperCase();
  const currentElevation = parseShelfElevation(currentBin);
  const currentZone = zone(currentBin) || 'N11';
  const currentSubBinMatch = currentBin.match(/(\d+)$/);
  const subBinDigit = currentSubBinMatch ? currentSubBinMatch[1] : '1';

  let recommendedShelfCode: 'FL' | 'A' | 'B' | 'BB' | 'C' | 'D' = 'B';
  if (unitWeightKg >= 9 || sizeProf.sizeScore >= 74) {
    recommendedShelfCode = 'FL';
  } else if (unitWeightKg >= 4 || sizeProf.sizeScore >= 65) {
    recommendedShelfCode = 'A';
  } else if (unitWeightKg >= 1.5 || sizeProf.sizeScore >= 48) {
    recommendedShelfCode = 'B';
  } else if (unitWeightKg >= 0.45 || sizeProf.sizeScore >= 38) {
    recommendedShelfCode = 'BB';
  } else if (unitWeightKg >= 0.12 || sizeProf.sizeScore >= 25) {
    recommendedShelfCode = 'C';
  } else {
    recommendedShelfCode = 'D';
  }

  // إذا كان الرف الحالي يقع أصلاً ضمن النطاق المسموح به للقطعة نحافظ عليه لتجنب النقل غير الضروري
  const isCurrentHeightIdeal =
    sizeProf.recommendedShelves.includes(currentElevation.shelfCode as any) &&
    Math.abs(currentElevation.meters - parseShelfElevation(`${currentZone}${recommendedShelfCode}1`).meters) <= 1;

  const finalShelfCode = isCurrentHeightIdeal
    ? (currentElevation.shelfCode as 'FL' | 'A' | 'B' | 'BB' | 'C' | 'D')
    : recommendedShelfCode;

  const recommendedBin = isCurrentHeightIdeal
    ? currentBin
    : `${currentZone}${finalShelfCode}${subBinDigit}`;
  const recommendedElevation = parseShelfElevation(recommendedBin);

  const placementReasonAr = isCurrentHeightIdeal
    ? `✓ الموقع الحالي (${currentBin} — ${currentElevation.shortLabelAr}) مناسب تماماً لحجم القطعة (${sizeProf.sizeCategory}) ووزنها (~${unitWeightKg >= 1 ? `${unitWeightKg} كجم` : `${Math.round(unitWeightKg * 1000)} جم`}).`
    : `يُنصح بنقلها من (${currentBin} — ${currentElevation.shortLabelAr}) إلى (${recommendedBin} — ${recommendedElevation.shortLabelAr}) لأنها (${sizeProf.sizeCategory} بوزن ~${unitWeightKg >= 1 ? `${unitWeightKg} كجم` : `${Math.round(unitWeightKg * 1000)} جم`}) والرف ${finalShelfCode} (${recommendedElevation.meters === 0 ? 'على الأرض 0م' : `ارتفاع ${recommendedElevation.meters}م`}) هو الأنسب لسلامة التخزين.`;

  return {
    part_number: item.part_number,
    description_en: descEn,
    description_ar: finalDescAr,
    dimensions_calculation_ar: dimensionsCalculationAr,
    material_ar: materialAr,
    estimated_weight_kg: unitWeightKg,
    total_weight_kg: totalWeightKg,
    weight_label_ar: weightLabelAr,
    size_category: sizeProf.sizeCategory,
    current_bin: currentBin,
    current_elevation: currentElevation,
    recommended_shelf_code: finalShelfCode,
    recommended_bin: recommendedBin,
    recommended_elevation: recommendedElevation,
    placement_reason_ar: placementReasonAr,
    source: 'engineering-engine',
  };
}

/**
 * استدعاء مساعد جمني الذكي (/api/gemini/analyze-parts) مع الدمج الفوري بالحاسبة الهندسية المحلية
 */
export async function analyzePartsWithGeminiAssistant(
  items: Array<
    Pick<InventoryItem, 'part_number' | 'description_en' | 'location_code'> & {
      description_ar?: string;
      qty_remaining?: number;
    }
  >
): Promise<GeminiPartAnalysis[]> {
  if (!items || items.length === 0) return [];

  // حساب التحليل الهندسي المحلي أولاً كأساس فوري ودقيق
  const localResults = items.map((item) => computeLocalPartEngineeringAnalysis(item));

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);

    const response = await fetch('/api/gemini/analyze-parts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts: items.slice(0, 45).map((i) => ({
          part_number: i.part_number,
          description_en: i.description_en,
          location_code: i.location_code,
          quantity: i.qty_remaining ?? 1,
        })),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return localResults;
    const data = await response.json();
    if (!data || !data.success || !Array.isArray(data.analyses) || data.analyses.length === 0) {
      return localResults;
    }

    const aiByPart = new Map<string, any>();
    for (const row of data.analyses) {
      if (row && row.part_number) {
        aiByPart.set(String(row.part_number).trim(), row);
      }
    }

    return localResults.map((local, idx) => {
      const aiRow = aiByPart.get(local.part_number) || data.analyses[idx];
      if (!aiRow) return local;

      const validShelf = ['FL', 'A', 'B', 'BB', 'C', 'D'].includes(
        String(aiRow.recommended_shelf_code || '').toUpperCase()
      )
        ? (String(aiRow.recommended_shelf_code).toUpperCase() as 'FL' | 'A' | 'B' | 'BB' | 'C' | 'D')
        : local.recommended_shelf_code;

      const currentZone = zone(local.current_bin) || 'N11';
      const recBin =
        aiRow.recommended_bin && /^[A-Z]\d{2}(FL|BB|A|B|C|D)\d*$/i.test(String(aiRow.recommended_bin).trim())
          ? String(aiRow.recommended_bin).trim().toUpperCase()
          : `${currentZone}${validShelf}1`;

      const unitWeight =
        typeof aiRow.estimated_weight_kg === 'number' && aiRow.estimated_weight_kg > 0
          ? +aiRow.estimated_weight_kg.toFixed(2)
          : local.estimated_weight_kg;

      return {
        ...local,
        description_ar:
          aiRow.description_ar && /[\u0600-\u06FF]/.test(aiRow.description_ar)
            ? String(aiRow.description_ar).trim()
            : local.description_ar,
        dimensions_calculation_ar:
          aiRow.dimensions_calculation_ar && aiRow.dimensions_calculation_ar.length > 3
            ? String(aiRow.dimensions_calculation_ar).trim()
            : local.dimensions_calculation_ar,
        material_ar:
          aiRow.material_ar && aiRow.material_ar.length > 2
            ? String(aiRow.material_ar).trim()
            : local.material_ar,
        estimated_weight_kg: unitWeight,
        weight_label_ar:
          aiRow.weight_label_ar && aiRow.weight_label_ar.length > 3
            ? String(aiRow.weight_label_ar).trim()
            : local.weight_label_ar,
        recommended_shelf_code: validShelf,
        recommended_bin: recBin,
        recommended_elevation: parseShelfElevation(recBin),
        placement_reason_ar:
          aiRow.placement_reason_ar && aiRow.placement_reason_ar.length > 4
            ? String(aiRow.placement_reason_ar).trim()
            : local.placement_reason_ar,
        source: 'gemini-ai',
      };
    });
  } catch {
    return localResults;
  }
}
