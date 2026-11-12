/**
 * خوارزمية تنقية الصورة المتقدمة وحذف خطوط الجدول مع حفظ الحروف (Stroke-Preserving Grid Removal & Shadow-Free Normalization)
 * تقوم بـ:
 * 1. موازنة إضاءة الورقة موضعياً عبر الصورة التكاملية (Integral Image) لإزالة الظلال الجانبية.
 * 2. تطبيق زيادة حدة الحروف (Unsharp Mask) لإبراز الأرقام الباهتة في زوايا الورقة.
 * 3. حذف خطوط الشبكة العمودية والأفقية الفاصلة بين خلايا الجدول مع الحفاظ التام على ضربات الحروف والأرقام المتقاطعة معها.
 */
export const preprocessImageForOCR = async (imageSrc: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageSrc;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          reject('Canvas not supported');
          return;
        }

        const origWidth = img.naturalWidth || img.width;
        const origHeight = img.naturalHeight || img.height;
        const maxDim = 2400;
        const scale = Math.max(origWidth, origHeight) > maxDim ? maxDim / Math.max(origWidth, origHeight) : 1;
        const width = Math.max(1, Math.round(origWidth * scale));
        const height = Math.max(1, Math.round(origHeight * scale));
        canvas.width = width;
        canvas.height = height;

        ctx.drawImage(img, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const totalPixels = width * height;
        const gray = new Float32Array(totalPixels);

        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }

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

        const radius = Math.max(22, Math.round(Math.min(width, height) / 28));
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

        // 3. كشف خطوط الجدول الأفقية والعمودية الطويلة وحذفها دون مسح الحروف المتقاطعة معها
        const hKernel = Math.max(38, Math.round(width / 26));
        const vKernel = Math.max(32, Math.round(height / 26));
        const hLineMask = new Uint8Array(totalPixels);
        const vLineMask = new Uint8Array(totalPixels);

        // كشف الخطوط الأفقية
        for (let y = 0; y < height; y++) {
          const rowOff = y * width;
          let run = 0;
          for (let x = 0; x < width; x++) {
            if (sharpened[rowOff + x] < 205) {
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

        // كشف الخطوط العمودية الفاصلة بين الأعمدة
        for (let x = 0; x < width; x++) {
          let run = 0;
          for (let y = 0; y < height; y++) {
            if (sharpened[y * width + x] < 205) {
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
          for (let x = 0; x < width; x++) {
            const idx = rowOff + x;
            if (
              hLineMask[idx] ||
              hLineMask[idx - width] ||
              hLineMask[idx + width] ||
              hLineMask[idx - width * 2] ||
              hLineMask[idx + width * 2]
            ) {
              const aboveDark = sharpened[idx - width * 3] < 200 || sharpened[idx - width * 4] < 200;
              const belowDark = sharpened[idx + width * 3] < 200 || sharpened[idx + width * 4] < 200;
              if (!(aboveDark && belowDark)) {
                cleaned[idx] = 255;
              }
            }
          }
        }

        for (let y = 0; y < height; y++) {
          const rowOff = y * width;
          for (let x = 2; x < width - 2; x++) {
            const idx = rowOff + x;
            if (
              vLineMask[idx] ||
              vLineMask[idx - 1] ||
              vLineMask[idx + 1] ||
              vLineMask[idx - 2] ||
              vLineMask[idx + 2]
            ) {
              cleaned[idx] = 255;
            }
          }
        }

        for (let j = 0, i = 0; j < totalPixels; j++, i += 4) {
          const v = cleaned[j];
          const stretched = v >= 215 ? 255 : Math.min(255, Math.max(0, Math.round(((v - 110) * 255) / 130)));
          data[i] = stretched;
          data[i + 1] = stretched;
          data[i + 2] = stretched;
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    };

    img.onerror = (err) => reject(err);
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
