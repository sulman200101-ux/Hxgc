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

        // 2. زيادة حدة الحروف والأرقام (Unsharp Mask) قبل كشف خطوط الجدول
        const sharpened = new Uint8ClampedArray(norm);
        for (let y = 1; y < height - 1; y++) {
          const rowOff = y * width;
          for (let x = 1; x < width - 1; x++) {
            const idx = rowOff + x;
            const c = norm[idx];
            const blur = (norm[idx - width] + norm[idx + width] + norm[idx - 1] + norm[idx + 1] + c * 4) >> 3;
            const sharpenedVal = c + ((c - blur) * 3) / 5;
            sharpened[idx] = Math.min(255, Math.max(0, Math.round(sharpenedVal)));
          }
        }

        // 3. كشف خطوط الجدول الأفقية والعمودية الطويلة وحذفها مع الحفاظ التام على ضربات الحروف والأرقام المتقاطعة
        const hKernel = Math.max(55, Math.round(width / 16));
        const vKernel = Math.max(38, Math.round(height / 20));
        const hLineMask = new Uint8Array(totalPixels);
        const vLineMask = new Uint8Array(totalPixels);

        for (let y = 0; y < height; y++) {
          const rowOff = y * width;
          let run = 0;
          for (let x = 0; x < width; x++) {
            if (sharpened[rowOff + x] < 195) {
              run++;
            } else {
              if (run >= hKernel) {
                for (let k = x - run; k < x; k++) hLineMask[rowOff + k] = 1;
              }
              run = 0;
            }
          }
          if (run >= hKernel) {
            for (let k = width - run; k < width; k++) hLineMask[rowOff + k] = 1;
          }
        }

        for (let x = 0; x < width; x++) {
          let run = 0;
          for (let y = 0; y < height; y++) {
            if (sharpened[y * width + x] < 195) {
              run++;
            } else {
              if (run >= vKernel) {
                for (let k = y - run; k < y; k++) vLineMask[k * width + x] = 1;
              }
              run = 0;
            }
          }
          if (run >= vKernel) {
            for (let k = height - run; k < height; k++) vLineMask[k * width + x] = 1;
          }
        }

        const cleaned = new Uint8ClampedArray(sharpened);

        for (let y = 4; y < height - 4; y++) {
          const rowOff = y * width;
          for (let x = 4; x < width - 4; x++) {
            const idx = rowOff + x;
            if (hLineMask[idx] || hLineMask[idx - width] || hLineMask[idx + width]) {
              const aboveDark =
                sharpened[idx - width * 2] < 210 ||
                sharpened[idx - width * 3] < 210 ||
                sharpened[idx - width * 4] < 210;
              const belowDark =
                sharpened[idx + width * 2] < 210 ||
                sharpened[idx + width * 3] < 210 ||
                sharpened[idx + width * 4] < 210;
              if (!aboveDark && !belowDark) {
                cleaned[idx] = 255;
              }
            }
            if (vLineMask[idx] || vLineMask[idx - 1] || vLineMask[idx + 1]) {
              const leftDark =
                sharpened[idx - 2] < 205 ||
                sharpened[idx - 3] < 205;
              const rightDark =
                sharpened[idx + 2] < 205 ||
                sharpened[idx + 3] < 205;
              if (!leftDark && !rightDark) {
                cleaned[idx] = 255;
              }
            }
          }
        }

        await yieldToMain();

        // 4. تعزيز التباين المرن مع الحفاظ على الحروف الباهتة والأرقام الرفيعة
        for (let j = 0, i = 0; j < totalPixels; j++, i += 4) {
          const v = cleaned[j];
          const stretched =
            v >= 232
              ? 255
              : v <= 95
              ? 0
              : Math.min(255, Math.max(0, Math.round(((v - 95) * 255) / 137)));
          data[i] = stretched;
          data[i + 1] = stretched;
          data[i + 2] = stretched;
        }

        ctx.putImageData(imageData, 0, 0);
        clearTimeout(safetyTimer);
        finish(canvas.toDataURL('image/jpeg', 0.92));
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
