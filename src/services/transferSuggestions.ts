import type { InventoryItem } from '../types';
export interface TransferSuggestion { partNumber: string; from: string; to: string; quantity: number; family: string; reason: string }
const zone = (location: string) => (location || '').toUpperCase().replace(/\s+/g,'').match(/^([A-Z]\d{2})/)?.[1];
function family(item: InventoryItem): string | undefined {
  return (item.description_en || '').toUpperCase().match(/\b(BOLT|NUT|WASHER|SCREW|GASKET|O-RING|BEARING|VALVE|FILTER|LAMP|FUSE|SEAL|FLANGE|CABLE)\b/)?.[1];
}
export function suggestTransfers(items: InventoryItem[], pendingParts: Set<string> = new Set(), limit = 200): TransferSuggestion[] {
  const eligible = items.filter(item => item.qty_remaining > 0 && item.is_missing !== 1 && zone(item.location_code) && family(item));
  const groups = new Map<string, Map<string, number>>();
  for (const item of eligible) {
    const key = `${zone(item.location_code)}:${family(item)}`;
    const bins = groups.get(key) || new Map<string, number>();
    bins.set(item.location_code, (bins.get(item.location_code) || 0) + 1); groups.set(key, bins);
  }
  const targets = new Map<string, [string, number]>();
  for (const [key,bins] of groups) targets.set(key, Array.from(bins).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0]);
  const result: TransferSuggestion[] = [];
  for (const item of eligible) {
    if (pendingParts.has(item.part_number)) continue;
    const technicalFamily=family(item)!; const key=`${zone(item.location_code)}:${technicalFamily}`; const bins=groups.get(key)!; const target=targets.get(key)!;
    if (target[0] === item.location_code || target[1] <= bins.get(item.location_code)!) continue;
    result.push({ partNumber:item.part_number, from:item.location_code, to:target[0], quantity:item.qty_remaining, family:technicalFamily,
      reason:`تجميع عائلة ${technicalFamily} مع ${target[1]} قطع أخرى في المنطقة ${zone(item.location_code)}. القرب مقترح بحسب ترميز الموقع ويحتاج تحققًا ميدانيًا.` });
    if (result.length >= limit) break;
  }
  return result;
}
