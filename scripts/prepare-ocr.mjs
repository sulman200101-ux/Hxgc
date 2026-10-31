import { mkdir, copyFile, access } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

const requiredFiles = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'public/ocr/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'public/ocr/tesseract-core-lstm.wasm'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'public/ocr/lang/eng.traineddata.gz'],
  ['node_modules/@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz', 'public/ocr/lang/ara.traineddata.gz'],
];

const optionalSimdFiles = [
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'public/ocr/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'public/ocr/tesseract-core-simd-lstm.wasm'],
];

await mkdir(new URL('public/ocr/lang/', root), { recursive: true });

for (const [source, target] of requiredFiles) {
  await copyFile(new URL(source, root), new URL(target, root));
}

for (const [source, target] of optionalSimdFiles) {
  try {
    const srcUrl = new URL(source, root);
    await access(srcUrl);
    await copyFile(srcUrl, new URL(target, root));
  } catch {
    // تجاهل في حال عدم توفر نسخة SIMD في الحزمة الحالية
  }
}

console.log('Packaged local OCR worker, WASM (including SIMD when available), and language data');
