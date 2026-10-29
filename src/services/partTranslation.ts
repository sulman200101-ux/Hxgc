import { categorizeAndTranslate } from '../utils/translator';
export interface PartTranslation {
  original: string;
  arabic: string;
  source: 'technical-dictionary' | 'local-model';
  needsReview: true;
}
export const TRANSLATION_MODEL = 'Xenova/opus-mt-en-ar';
export function preserveTechnicalSpecifications(original: string, translated: string): string {
  const tokens = original.split(/\s+/).filter(token => /\d/.test(token));
  const missing = tokens.filter(token => !translated.includes(token));
  return missing.length ? `${translated} — المواصفات الأصلية: ${missing.join(' ')}` : translated;
}
export function suggestTechnicalTranslation(original: string): PartTranslation {
  const result = categorizeAndTranslate(original);
  return { original, arabic: preserveTechnicalSpecifications(original, result.descAr), source: 'technical-dictionary', needsReview: true };
}
let loading: Promise<any> | undefined;
export async function suggestModelTranslation(original: string, onProgress?: (message: string) => void): Promise<PartTranslation> {
  if (!original.trim()) throw new Error('أدخل الاسم الإنجليزي أولًا');
  // Loaded only on explicit request. Never sends the part description to a remote translation API.
  loading ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = true;
    env.localModelPath = '/models/';
    return pipeline('translation', TRANSLATION_MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (event: any) => onProgress?.(`تحميل مكتبة الترجمة: ${event.status || ''}`),
    });
  })().catch(error => { loading = undefined; throw error; });
  try {
    const translator = await loading;
    const output = await translator(original, { max_new_tokens: 128 });
    const text = output?.[0]?.translation_text;
    if (typeof text !== 'string' || !text.trim()) throw new Error('لم يُرجع النموذج ترجمة');
    return { original, arabic: preserveTechnicalSpecifications(original, text), source: 'local-model', needsReview: true };
  } catch {
    throw new Error('تعذر تحميل أو تشغيل نموذج الترجمة. استخدم القاموس الصناعي أو أدخل الترجمة يدويًا؛ الاسم الأصلي محفوظ.');
  }
}
