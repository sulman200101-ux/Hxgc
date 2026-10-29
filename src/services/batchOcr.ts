import type { ExtractedSparePart } from './localOcr';
export interface BatchImage { key: string; original: Blob }
export type BatchReadResult = { key: string; state: 'review'; rows: ExtractedSparePart[] } | { key: string; state: 'error'; message: string };
// Sequential processing limits OCR worker/memory use and keeps failures local to their sheet.
export async function readImageBatch(
  images: BatchImage[],
  reader: (image: Blob) => Promise<ExtractedSparePart[]>,
  onStart: (key: string, index: number, total: number) => void,
  onResult: (result: BatchReadResult) => void,
): Promise<void> {
  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    onStart(image.key, index + 1, images.length);
    try {
      const rows = await reader(image.original);
      if (!rows.length) throw new Error('لم تُقرأ الورقة بوضوح؛ أعد المحاولة أو أدخل بياناتها يدويًا');
      onResult({ key: image.key, state: 'review', rows });
    } catch (error) {
      onResult({ key: image.key, state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
}
