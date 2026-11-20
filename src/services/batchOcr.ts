import { processOcrFromImage, type ExtractedSparePart } from './localOcr';
export interface BatchImage { key: string; original: Blob }
export type BatchReadResult = { key: string; state: 'review'; rows: ExtractedSparePart[] } | { key: string; state: 'error'; message: string };
// Sequential processing limits OCR worker/memory use and keeps failures local to their sheet (supports 55+ sheets).
export async function readImageBatch(
  images: BatchImage[],
  reader: (image: Blob) => Promise<ExtractedSparePart[]>,
  onStart: (key: string, index: number, total: number) => void,
  onResult: (result: BatchReadResult) => void,
): Promise<void> {
  const isDefaultOcr = reader === processOcrFromImage;
  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    onStart(image.key, index + 1, images.length);
    try {
      let rows = await reader(image.original);
      if (!rows.length && isDefaultOcr) {
        await new Promise((r) => setTimeout(r, 200));
        rows = await reader(image.original);
      }
      if (!rows.length) throw new Error('لم تُقرأ الورقة بوضوح؛ أعد المحاولة أو أدخل بياناتها يدويًا');
      onResult({ key: image.key, state: 'review', rows });
    } catch (error) {
      if (isDefaultOcr) {
        try {
          await new Promise((r) => setTimeout(r, 250));
          const retryRows = await reader(image.original);
          if (retryRows.length > 0) {
            onResult({ key: image.key, state: 'review', rows: retryRows });
            continue;
          }
        } catch {
          // fallback to error below
        }
      }
      onResult({ key: image.key, state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    if (index + 1 < images.length && images.length > 3) {
      await new Promise((r) => setTimeout(r, 30));
    }
  }
}
