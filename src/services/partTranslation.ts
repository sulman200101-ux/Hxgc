import { categorizeAndTranslate } from '../utils/translator';

export interface PartTranslation {
  original: string;
  arabic: string;
  source: 'technical-dictionary' | 'local-model';
  needsReview: true;
}

export function preserveTechnicalSpecifications(original: string, translated: string): string {
  const tokens = original.split(/\s+/).filter((token) => /\d/.test(token));
  const missing = tokens.filter((token) => !translated.includes(token));
  return missing.length ? `${translated} — المواصفات الأصلية: ${missing.join(' ')}` : translated;
}

export function suggestTechnicalTranslation(original: string): PartTranslation {
  const result = categorizeAndTranslate(original);
  return {
    original,
    arabic: preserveTechnicalSpecifications(original, result.descAr),
    source: 'technical-dictionary',
    needsReview: true,
  };
}

export async function suggestModelTranslation(
  original: string,
  onProgress?: (message: string) => void
): Promise<PartTranslation> {
  if (!original.trim()) throw new Error('أدخل الاسم الإنجليزي أولًا');
  onProgress?.('جاري الترجمة عبر القاموس الصناعي المحلي السريع...');
  return suggestTechnicalTranslation(original);
}
