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
  try {
    const targetUrl = new URL(target, root);
    try {
      await access(targetUrl);
    } catch {
      await copyFile(new URL(source, root), targetUrl);
    }
  } catch {
    // Keep existing asset if node_modules source is not yet extracted
  }
}
for (const [source, target] of optionalSimdFiles) {
  try {
    const targetUrl = new URL(target, root);
    try {
      await access(targetUrl);
    } catch {
      await access(new URL(source, root));
      await copyFile(new URL(source, root), targetUrl);
    }
  } catch {
    // SIMD files optional depending on tesseract.js-core version
  }
}

// فك ضغط ملفات اللغات (.traineddata) مباشرة بدون الاحتفاظ بنسخة .gz لمنع تعارض mergeDebugAssets في أندرويد ولضمان عمل gzip: false في كل من APK والمتصفح
for (const [lang, sourcePath] of langGzSources) {
  try {
    const rawUrl = new URL(`public/ocr/lang/${lang}.traineddata`, root);
    const oldGzUrl = new URL(`public/ocr/lang/${lang}.traineddata.gz`, root);
    await rm(oldGzUrl, { force: true });
    try {
      await access(rawUrl);
    } catch {
      const srcUrl = new URL(sourcePath, root);
      await access(srcUrl);
      const gzBuf = await readFile(srcUrl);
      const uncompressed = gunzipSync(gzBuf);
      await writeFile(rawUrl, uncompressed);
    }
  } catch {
    // المتابعة في حال كانت اللغة الاختيارية غير متوفرة
  }
}

// مزامنة قاعدة بيانات القطع الخارجية (JSON) بين data/inventory-store.json و public/inventory-store.json للعمل أوفلاين في APK و dist بدون تضمينها داخل الكود المصدري
try {
  const runtimeStoreUrl = new URL('data/inventory-store.json', root);
  const publicStoreUrl = new URL('public/inventory-store.json', root);
  await mkdir(new URL('data/', root), { recursive: true });
  await mkdir(new URL('public/', root), { recursive: true });

  const readStoreSafe = async (url) => {
    try {
      const raw = await readFile(url, 'utf8');
      const parsed = JSON.parse(raw);
      const count = parsed?.items ? Object.keys(parsed.items).length : 0;
      return { raw, rev: Number(parsed?.revision || 0), count, updatedAt: String(parsed?.updatedAt || '') };
    } catch {
      return null;
    }
  };

  const dataStore = await readStoreSafe(runtimeStoreUrl);
  const pubStore = await readStoreSafe(publicStoreUrl);

  if (dataStore && pubStore) {
    const pubIsNewer =
      pubStore.rev > dataStore.rev ||
      (pubStore.rev === dataStore.rev && pubStore.count > dataStore.count) ||
      (pubStore.rev === dataStore.rev && pubStore.count === dataStore.count && pubStore.updatedAt > dataStore.updatedAt);
    if (pubIsNewer) {
      await writeFile(runtimeStoreUrl, pubStore.raw, 'utf8');
    } else {
      await writeFile(publicStoreUrl, dataStore.raw, 'utf8');
    }
  } else if (pubStore && !dataStore) {
    await writeFile(runtimeStoreUrl, pubStore.raw, 'utf8');
  } else if (dataStore && !pubStore) {
    await writeFile(publicStoreUrl, dataStore.raw, 'utf8');
  }
} catch {
  // الاحتفاظ بالنسخة الموجودة في public/inventory-store.json
}

console.log('Packaged local OCR worker, WASM, uncompressed English + Arabic traineddata, and external runtime inventory store');

