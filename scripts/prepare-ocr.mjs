import { mkdir, copyFile, access, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'public/ocr/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'public/ocr/tesseract-core-lstm.wasm'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'public/ocr/lang/eng.traineddata.gz'],
];

const optionalSimdFiles = [
  ['node_modules/@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz', 'public/ocr/lang/ara.traineddata.gz'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'public/ocr/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'public/ocr/tesseract-core-simd-lstm.wasm'],
];

await mkdir(new URL('public/ocr/lang/', root), { recursive: true });
for (const [source, target] of files) {
  await copyFile(new URL(source, root), new URL(target, root));
}
for (const [source, target] of optionalSimdFiles) {
  try {
    await access(new URL(source, root));
    await copyFile(new URL(source, root), new URL(target, root));
  } catch {
    // SIMD files optional depending on tesseract.js-core version
  }
}

// فك ضغط ملفات اللغات (.traineddata) مسبقاً لضمان عملها فوراً في أندرويد (APK Assets) والمتصفح بدون خطأ 404 أو تأخير فك الضغط
for (const lang of ['eng', 'ara']) {
  try {
    const gzUrl = new URL(`public/ocr/lang/${lang}.traineddata.gz`, root);
    const rawUrl = new URL(`public/ocr/lang/${lang}.traineddata`, root);
    const gzBuf = await readFile(gzUrl);
    const uncompressed = gunzipSync(gzBuf);
    await writeFile(rawUrl, uncompressed);
  } catch {
    // المتابعة في حال كانت اللغة الاختيارية غير متوفرة
  }
}

console.log('Packaged local OCR worker, WASM (including SIMD if present), and uncompressed + gzipped English + Arabic language data');

