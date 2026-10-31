import { mkdir, copyFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'public/ocr/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'public/ocr/tesseract-core-lstm.wasm'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'public/ocr/lang/eng.traineddata.gz'],
  ['node_modules/@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz', 'public/ocr/lang/ara.traineddata.gz'],
];

await mkdir(new URL('public/ocr/lang/', root), { recursive: true });
for (const [source, target] of files) {
  await copyFile(new URL(source, root), new URL(target, root));
}
console.log('Packaged local OCR worker, WASM, and English + Arabic language data');
