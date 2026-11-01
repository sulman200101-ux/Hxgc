/**
 * خوارزمية تنقية الصورة المتقدمة وحذف خطوط الجدول مع حفظ الحروف (Stroke-Preserving Grid Removal & Shadow-Free Normalization)
 * محسّنة للعمل بدون تجميد واجهة المستخدم (Non-Blocking Async Yielding) ومع سقف أبعاد ذكي لمنع التعليق عند 55%.
 */
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export const preprocessImageForOCR = async (imageSrc: string): Promise<string> => {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (resultUrl: string) => {
      if (settled) return;
      settled = true;
      resolve(resultUrl);
    };

    // صمام أمان زمني لمنع تعليق المعالجة لأي سبب
    const safetyTimer = setTimeout(() => {
      finish(imageSrc);
    }, 6500);

    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = async () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          clearTimeout(safetyTimer);
          return finish(imageSrc);
        }

        const rawW = img.naturalWidth || img.width;
        const rawH = img.naturalHeight || img.height;
        if (!rawW || !rawH) {
          clearTimeout(safetyTimer);
          return finish(imageSrc);
        }

        // سقف أبعاد عالي الدقة (1950px) لضمان وضوح الأرقام الصغيرة في الجداول الكثيفة (37+ سطراً)
        const maxDim = 1950;
        const minDim = 1450;
        const longest = Math.max(rawW, rawH);
        const scale =
          longest > maxDim
            ? maxDim / longest
            : longest > 480 && longest < minDim
            ? minDim / longest
            : 1;
        const width = Math.max(1, Math.round(rawW * scale));
        const height = Math.max(1, Math.round(rawH * scale));

        canvas.width = width;
        canvas.height = height;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const totalPixels = width * height;
        const gray = new Float32Array(totalPixels);

        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }

        await yieldToMain();

        // 1. بناء الصورة التكاملية (Integral Image) لتقدير إضاءة خلفية الورقة الموضعية بـ O(1)
        const intW = width + 1;
        const integral = new Float64Array((width + 1) * (height + 1));
        for (let y = 0; y < height; y++) {
          let rowSum = 0;
          const rowOff = y * width;
          const intRowOff = (y + 1) * intW;
          const prevIntRowOff = y * intW;
          for (let x = 0; x < width; x++) {
            rowSum += gray[rowOff + x];
            integral[intRowOff + (x + 1)] = integral[prevIntRowOff + (x + 1)] + rowSum;
          }
        }

        await yieldToMain();

        const radius = Math.max(22, Math.round(Math.min(width, height) / 26));
        const norm = new Uint8ClampedArray(totalPixels);

        for (let y = 0; y < height; y++) {
          const y0 = Math.max(0, y - radius);
          const y1 = Math.min(height, y + radius + 1);
          const rowOff = y * width;
          for (let x = 0; x < width; x++) {
            const x0 = Math.max(0, x - radius);
            const x1 = Math.min(width, x + radius + 1);
            const count = (x1 - x0) * (y1 - y0);
            const localSum =
              integral[y1 * intW + x1] -
              integral[y0 * intW + x1] -
              integral[y1 * intW + x0] +
              integral[y0 * intW + x0];
            const localBg = Math.max(60, localSum / count);
            const px = gray[rowOff + x];
            norm[rowOff + x] = Math.min(255, Math.max(0, Math.round((px / localBg) * 255)));
          }
        }

        await yieldToMain();

        // 2. زيادة حدة الحروف والأرقام بلطف للحفاظ على الفراغات الداخلية للأرقام (3, 5, 6, 8, 9, 0)
        const sharpened = new Uint8ClampedArray(norm);
        for (let y = 1; y < height - 1; y++) {
          const rowOff = y * width;
          for (let x = 1; x < width - 1; x++) {
            const idx = rowOff + x;
            const c = norm[idx];
            const blur = (norm[idx - width] + norm[idx + width] + norm[idx - 1] + norm[idx + 1] + c * 4) >> 3;
            const sharpenedVal = c + ((c - blur) * 2) / 5;
            sharpened[idx] = Math.min(255, Math.max(0, Math.round(sharpenedVal)));
          }
        }

        await yieldToMain();

        // 3. تعزيز التباين الطبيعي وتبييض خلفية الورقة دون تضخيم سمك الأرقام (منع تحول 3/5/6 إلى 8)
        for (let j = 0, i = 0; j < totalPixels; j++, i += 4) {
          const v = sharpened[j];
          const stretched =
            v >= 244
              ? 255
              : v <= 38
              ? 0
              : Math.min(255, Math.max(0, Math.round(((v - 38) * 255) / 206)));
          data[i] = stretched;
          data[i + 1] = stretched;
          data[i + 2] = stretched;
        }

        ctx.putImageData(imageData, 0, 0);
        clearTimeout(safetyTimer);
        finish(canvas.toDataURL('image/jpeg', 0.95));
      } catch {
        clearTimeout(safetyTimer);
        finish(imageSrc);
      }
    };

    img.onerror = () => {
      clearTimeout(safetyTimer);
      finish(imageSrc);
    };

    img.src = imageSrc;
  });
};

export async function preprocessImage(imageSource: string | File | Blob): Promise<string> {
  const dataUrl =
    typeof imageSource === 'string'
      ? imageSource
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error('تعذر قراءة ملف الصورة'));
          reader.readAsDataURL(imageSource);
        });
  return preprocessImageForOCR(dataUrl);
}

export const preprocessImageForOcr = preprocessImageForOCR;
