/**
 * خوارزمية تنقية الصورة المتقدمة مع عزل حبر القلم الأزرق عن أعمدة الأرقام وحذف خطوط الشبكة (Blue-Ink Suppressed & Grid-Free Adaptive Preprocessor)
 * تقوم بـ:
 * 1. كبت آثار القلم الأزرق (Blue Ballpoint Ink Suppression) في أعمدة البيانات المطبوعة (#, Material, Plant, Area, Storage Bin, BUn, QTY)
 *    مع الحفاظ التام على وضوح علامات القلم اليدوية (✓ و × و -N) في عمودي Check و Remark (من 42% إلى 53% من العرض).
 * 2. موازنة إضاءة الورقة موضعياً عبر تمريرتين للصورة التكاملية (2-Pass Integral Image Box Blur) لإزالة الظلال الجانبية.
 * 3. حذف خطوط الجدول الأفقية والعمودية الطويلة لمنع انحراف الأسطر عبر عمود New BIN الفارغ ومنع التصاق خط الجدول بالرقم الأول من Material.
 */

function boxBlurIntegral(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const intW = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const rowOff = y * width;
    const intRowOff = (y + 1) * intW;
    const prevIntRowOff = y * intW;
    for (let x = 0; x < width; x++) {
      rowSum += src[rowOff + x];
      integral[intRowOff + (x + 1)] = integral[prevIntRowOff + (x + 1)] + rowSum;
    }
  }

  const dst = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const count = (x1 - x0) * (y1 - y0);
      const sum =
        integral[y1 * intW + x1] -
        integral[y0 * intW + x1] -
        integral[y1 * intW + x0] +
        integral[y0 * intW + x0];
      dst[rowOff + x] = sum / count;
    }
  }
  return dst;
}

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
      const totalPixels = width * height;
      const hybridGray = new Float32Array(totalPixels);

      // عمودا Check و Remark يقعان بين 42% و 53% من عرض الورقة
      const checkColStart = Math.round(width * 0.42);
      const checkColEnd = Math.round(width * 0.53);

      for (let y = 0; y < height; y++) {
        const rowOff = y * width;
        for (let x = 0; x < width; x++) {
          const j = rowOff + x;
          const i = j * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          if (x >= checkColStart && x <= checkColEnd) {
            // في عمودي Check و Remark نحتفظ بشدة حبر القلم الأزرق (X و -N) كاملة
            hybridGray[j] = 0.299 * r + 0.587 * g + 0.114 * b;
          } else {
            // في أعمدة الأرقام والنصوص المطبوعة نكبت حبر القلم الأزرق العارض المتقاطع مع الأرقام
            const blueExcess = Math.max(0, b - r);
            hybridGray[j] = Math.min(255, b + blueExcess * 0.6);
          }
        }
      }

      // 2-Pass Box Blur لتقدير الخلفية الموضعية بنعومة مماثلة لـ Gaussian Blur وإزالة الظلال
      const radius = Math.max(24, Math.round(Math.min(width, height) / 38));
      const pass1Bg = boxBlurIntegral(hybridGray, width, height, radius);
      const localBg = boxBlurIntegral(pass1Bg, width, height, radius);

      const norm = new Uint8ClampedArray(totalPixels);
      for (let j = 0; j < totalPixels; j++) {
        const bgVal = Math.max(60, localBg[j]);
        norm[j] = Math.min(255, Math.max(0, Math.round((hybridGray[j] / bgVal) * 245)));
      }

      // كشف خطوط الشبكة الأفقية (طول >= 85) والعمودية (طول >= 55 في القسم الأيسر x < 34%)
      const hKernel = Math.max(45, Math.round(width / 28));
      const vKernel = Math.max(32, Math.round(height / 32));
      const vCutoffX = Math.round(width * 0.34);

      const gridMask = new Uint8Array(totalPixels);

      // 1D Horizontal Opening
      for (let y = 0; y < height; y++) {
        const rowOff = y * width;
        let run = 0;
        for (let x = 0; x < width; x++) {
          if (norm[rowOff + x] < 210) {
            run++;
          } else {
            if (run >= hKernel) {
              for (let k = x - run; k < x; k++) gridMask[rowOff + k] = 1;
            }
            run = 0;
          }
        }
        if (run >= hKernel) {
          for (let k = width - run; k < width; k++) gridMask[rowOff + k] = 1;
        }
      }

      // 1D Vertical Opening (في منطقة الأعمدة الرقمية اليسرى فقط لحماية الفاصل بين QTY و Check)
      for (let x = 0; x < vCutoffX; x++) {
        let run = 0;
        for (let y = 0; y < height; y++) {
          if (norm[y * width + x] < 210) {
            run++;
          } else {
            if (run >= vKernel) {
              for (let k = y - run; k < y; k++) {
                gridMask[k * width + x] = 1;
                if (x + 1 < vCutoffX) gridMask[k * width + (x + 1)] = 1;
              }
            }
            run = 0;
          }
        }
        if (run >= vKernel) {
          for (let k = height - run; k < height; k++) {
            gridMask[k * width + x] = 1;
            if (x + 1 < vCutoffX) gridMask[k * width + (x + 1)] = 1;
          }
        }
      }

      // تبييض خطوط الشبكة وتطبيق تباين خطي متوازن يحفظ الحروف الرمادية والرفيعة
      for (let j = 0, i = 0; j < totalPixels; j++, i += 4) {
        const v = gridMask[j] ? 248 : norm[j];
        const stretched = Math.min(255, Math.max(0, Math.round((v - 190) * 1.8 + 190)));
        data[i] = stretched;
        data[i + 1] = stretched;
        data[i + 2] = stretched;
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.94));
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
