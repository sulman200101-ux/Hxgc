/**
 * تنقية الصورة وتوحيد الإضاءة الموضعية عبر الصورة التكاملية (Integral Image Adaptive Normalization)
 * مع خوارزمية حذف خطوط الشبكة العمودية والأفقية مع الحفاظ التام على ضربات الحروف المتقاطعة (Stroke-Preserving Grid Removal):
 * 1. موازنة إضاءة الورقة موضعياً لإزالة ظلال التصوير مع الحفاظ الكامل على الحروف الرفيعة في الجداول الكثيفة (37 سطراً).
 * 2. مسح خطوط الشبكة الأفقية والعمودية الطويلة فقط في النقاط التي لا تتقاطع مع ضربات الحروف والأرقام،
 *    مما يمنع قراءة الخط العمودي (|) كرقم (1 أو 7) ويمنع التصاق الأرقام بحدود الجدول.
 */
export const preprocessImageForOCR = async (imageSrc: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageSrc;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject('Canvas not supported');

      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      const gray = new Float32Array(width * height);

      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }

      // 1. بناء الصورة التكاملية (Integral Image) لتقدير إضاءة خلفية الورقة الموضعية وإزالة ظلال التصوير
      const intW = width + 1;
      const integral = new Float64Array((width + 1) * (height + 1));
      for (let y = 0; y < height; y++) {
        let rowSum = 0;
        for (let x = 0; x < width; x++) {
          rowSum += gray[y * width + x];
          integral[(y + 1) * intW + (x + 1)] = integral[y * intW + (x + 1)] + rowSum;
        }
      }

      const radius = Math.max(20, Math.round(Math.min(width, height) / 32));
      const normGray = new Uint8ClampedArray(width * height);

      for (let y = 0; y < height; y++) {
        const y0 = Math.max(0, y - radius);
        const y1 = Math.min(height, y + radius + 1);
        for (let x = 0; x < width; x++) {
          const x0 = Math.max(0, x - radius);
          const x1 = Math.min(width, x + radius + 1);
          const count = (x1 - x0) * (y1 - y0);
          const localSum =
            integral[y1 * intW + x1] -
            integral[y0 * intW + x1] -
            integral[y1 * intW + x0] +
            integral[y0 * intW + x0];
          const localBg = Math.max(65, localSum / count);
          const px = gray[y * width + x];

          const ratio = px / localBg;
          let normalized: number;
          if (ratio < 0.91) {
            normalized = Math.max(0, (ratio - 0.54) * 340);
          } else {
            normalized = 252;
          }

          normGray[y * width + x] = Math.min(255, Math.max(0, Math.round(normalized)));
        }
      }

      const outGray = new Uint8ClampedArray(normGray);

      // 2. حذف خطوط الشبكة الأفقية مع الحفاظ التام على ضربات الحروف المتقاطعة (Horizontal Stroke-Preserving Grid Removal)
      const minHorizSpan = Math.max(36, Math.round(width / 28));
      for (let y = 2; y < height - 2; y++) {
        let runStart = -1;
        for (let x = 0; x <= width; x++) {
          const isDark = x < width && normGray[y * width + x] < 165;
          if (isDark) {
            if (runStart === -1) runStart = x;
          } else if (runStart !== -1) {
            const runLen = x - runStart;
            if (runLen >= minHorizSpan) {
              for (let k = runStart; k < x; k++) {
                const above1 = normGray[(y - 1) * width + k];
                const above2 = normGray[(y - 2) * width + k];
                const below1 = normGray[(y + 1) * width + k];
                const below2 = normGray[(y + 2) * width + k];
                // إذا لم يكن هناك امتداد عمودي لضربة حرف أعلى وأسفل الخط، نمسح بكسل خط الشبكة
                if (above2 > 205 && below2 > 205 && (above1 > 180 || below1 > 180)) {
                  outGray[y * width + k] = 250;
                }
              }
            }
            runStart = -1;
          }
        }
      }

      // 3. حذف خطوط الشبكة العمودية مع الحفاظ التام على ضربات الحروف المتقاطعة (Vertical Stroke-Preserving Grid Removal)
      const minVertSpan = Math.max(26, Math.round(height / 24));
      for (let x = 2; x < width - 2; x++) {
        let runStart = -1;
        for (let y = 0; y <= height; y++) {
          const isDark = y < height && normGray[y * width + x] < 165;
          if (isDark) {
            if (runStart === -1) runStart = y;
          } else if (runStart !== -1) {
            const runLen = y - runStart;
            if (runLen >= minVertSpan) {
              for (let k = runStart; k < y; k++) {
                const left1 = normGray[k * width + (x - 1)];
                const left2 = normGray[k * width + (x - 2)];
                const right1 = normGray[k * width + (x + 1)];
                const right2 = normGray[k * width + (x + 2)];
                // إذا لم يكن هناك امتداد أفقي لضربة رقم أو حرف يمين ويسار الخط العمودي، نمسح بكسل الخط العمودي
                if (left2 > 205 && right2 > 205 && (left1 > 180 || right1 > 180)) {
                  outGray[k * width + x] = 250;
                }
              }
            }
            runStart = -1;
          }
        }
      }

      for (let j = 0; j < outGray.length; j++) {
        const val = outGray[j];
        const idx = j * 4;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
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
