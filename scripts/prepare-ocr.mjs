import { mkdir, copyFile, access, readFile, writeFile, rm } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'public/ocr/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'public/ocr/tesseract-core-lstm.wasm'],
];

const optionalSimdFiles = [
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'public/ocr/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'public/ocr/tesseract-core-simd-lstm.wasm'],
];

const langGzSources = [
  ['eng', 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'],
  ['ara', 'node_modules/@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz'],
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

// فك ضغط ملفات اللغات (.traineddata) مباشرة بدون الاحتفاظ بنسخة .gz لمنع تعارض mergeDebugAssets في أندرويد ولضمان عمل gzip: false في كل من APK والمتصفح
for (const [lang, sourcePath] of langGzSources) {
  try {
    const srcUrl = new URL(sourcePath, root);
    await access(srcUrl);
    const rawUrl = new URL(`public/ocr/lang/${lang}.traineddata`, root);
    const oldGzUrl = new URL(`public/ocr/lang/${lang}.traineddata.gz`, root);
    const gzBuf = await readFile(srcUrl);
    const uncompressed = gunzipSync(gzBuf);
    await writeFile(rawUrl, uncompressed);
    await rm(oldGzUrl, { force: true });
  } catch {
    // المتابعة في حال كانت اللغة الاختيارية غير متوفرة
  }
}

console.log('Packaged local OCR worker, WASM, and uncompressed English + Arabic traineddata for Web & Android APK');


