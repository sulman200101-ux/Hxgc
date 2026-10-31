/**
 * تنقية الصورة وتوحيد الإضاءة الموضعية (Shadow-Free Adaptive Normalization)
 * بدلاً من التباين الحاد (contrast = 100) الذي كان يطمس ~30% من السطور والكميات باللون الأبيض،
 * تقوم هذه الخوارزمية بموازنة إضاءة الورقة موضعياً مع الحفاظ الكامل على وضوح كافة الأرقام والحروف الباهتة.
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

      // بناء الصورة التكاملية (Integral Image) لتقدير إضاءة خلفية الورقة الموضعية وإزالة ظلال التصوير
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
      const outGray = new Uint8ClampedArray(width * height);

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
            // تقوية الحروف والأرقام الرفيعة في الجداول الكثيفة (37 سطراً) دون طمسها
            normalized = Math.max(0, (ratio - 0.54) * 340);
          } else {
            normalized = 252;
          }

          outGray[y * width + x] = Math.min(255, Math.max(0, Math.round(normalized)));
        }
      }

      // تخفيف خطوط الشبكة الأفقية الرفيعة (1-2 بكسل) التي تلتصق بأعلى أو أسفل الأرقام دون المساس بالحروف
      const span = Math.max(28, Math.round(width / 35));
      for (let y = 2; y < height - 2; y++) {
        let runLen = 0;
        for (let x = 0; x < width; x++) {
          if (outGray[y * width + x] < 160) {
            runLen++;
          } else {
            if (runLen >= span) {
              for (let k = x - runLen; k < x; k++) {
                const above = outGray[(y - 2) * width + k];
                const below = outGray[(y + 2) * width + k];
                if (above > 210 && below > 210) {
                  outGray[y * width + k] = 245;
                }
              }
            }
            runLen = 0;
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
