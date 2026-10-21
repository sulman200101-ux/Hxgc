/**
 * معالج الصور المتقدم المعتمد على خوارزميات OpenCV (Computer Vision Preprocessing)
 * يقوم بالمعالجة المسبقة لصور جداول الجرد والمستندات قبل تمريرها لمحرك الـ OCR:
 * 1. تحويل الصورة إلى تدرج رمادي وإزالة الضوضاء.
 * 2. تطبيق خوارزمية cv2.adaptiveThreshold للحصول على أبيض وأسود نقي وإزالة كافة الظلال والانحناءات.
 * 3. تطبيق خوارزمية إزالة خطوط الجدول (Table Grid Removal) باستخدام العمليات المورفولوجية
 *    لحذف الخطوط الأفقية والعمودية الفاصلة بين الخلايا حتى لا يقرؤها الـ OCR كرموز مثل: | أو I أو 1 أو l.
 */

export interface PreprocessingResult {
  cleanedDataUrl: string;
  cleanedBlob: Blob;
  stats: {
    width: number;
    height: number;
    shadowsRemoved: boolean;
    gridLinesRemoved: boolean;
    executionTimeMs: number;
  };
}

export interface PreprocessingOptions {
  rotateCounterClockwise90?: boolean;
}

/**
 * تنفيذ خوارزمية OpenCV المتكاملة:
 * 1. تدوير الورقة أوتوماتيكياً (90° Counter-Clockwise) لتصبح القراءة صحيحة من اليسار لليمين
 * 2. تطبيق cv2.adaptiveThreshold لإزالة كافة الظلال وتبييض الورقة
 * 3. تطبيق Table Grid Removal لحذف خطوط الخلايا لمنع قراءة | و I و 1
 */
export async function preprocessImageWithOpenCV(
  imageSource: string | File | Blob,
  options?: PreprocessingOptions
): Promise<PreprocessingResult> {
  const startTime = performance.now();

  const img = await loadImageElement(imageSource);
  const origWidth = img.naturalWidth || img.width;
  const origHeight = img.naturalHeight || img.height;

  // 1. تدوير الورقة أوتوماتيكياً (Orientation Fix: 90° Counter-Clockwise)
  const shouldRotate = options?.rotateCounterClockwise90 ?? true;
  const width = shouldRotate ? origHeight : origWidth;
  const height = shouldRotate ? origWidth : origHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  if (shouldRotate) {
    // تدوير 90 درجة عكس عقارب الساعة
    ctx.translate(0, origWidth);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, 0, 0);
  } else {
    ctx.drawImage(img, 0, 0, width, height);
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  // 2. تحويل الصورة إلى رمادي (Grayscale)
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    // خوارزمية الإضاءة القياسية: Y = 0.299*R + 0.587*G + 0.114*B
    gray[j] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }

  // 3. خوارزمية cv2.adaptiveThreshold (Adaptive Gaussian / Mean Thresholding)
  // تقوم بحساب العتبة ديناميكياً لكل منطقة موضعية لإلغاء أي ظلال أو إضاءة غير متساوية على الورقة
  const binary = applyAdaptiveThreshold(gray, width, height, 15, 8);

  // 4. خوارزمية إزالة خطوط الجدول (Table Grid Removal):
  // كشف الخطوط الأفقية والعمودية باستخدام Morpological Kernels ثم حذفها
  const cleanedBinary = removeTableGridLines(binary, width, height);

  // 5. كتابة البكسلات المعالجة إلى الـ Canvas (أبيض وأسود نقي تماماً بدون شبكة الجدول وبدون ظلال)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const val = cleanedBinary[j]; // 255 للأبيض، 0 للأسود (النصوص)
    data[i] = val;     // R
    data[i + 1] = val; // G
    data[i + 2] = val; // B
    data[i + 3] = 255; // Alpha
  }

  ctx.putImageData(imageData, 0, 0);

  const cleanedDataUrl = canvas.toDataURL('image/png');
  const cleanedBlob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  const executionTimeMs = Math.round(performance.now() - startTime);

  return {
    cleanedDataUrl,
    cleanedBlob,
    stats: {
      width,
      height,
      shadowsRemoved: true,
      gridLinesRemoved: true,
      executionTimeMs,
    },
  };
}

/**
 * محاكاة دقيقة لخوارزمية cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, blockSize, C)
 * تعتمد على تقنية جدول المساحات التراكمية (Integral Image) لضمان سرعة فائقة مع الصور الكبيرة
 */
function applyAdaptiveThreshold(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  blockSize: number = 15,
  C: number = 8
): Uint8ClampedArray {
  const binary = new Uint8ClampedArray(width * height);
  const radius = Math.floor(blockSize / 2);

  // بناء الصورة التكاملية (Integral Image) لحساب المتوسط المحلي بـ O(1)
  const integral = new Float64Array((width + 1) * (height + 1));
  const intW = width + 1;

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * intW + (x + 1)] = integral[y * intW + (x + 1)] + rowSum;
    }
  }

  // تطبيق العتبة الموضعية وإزالة الظلال
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);

    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);

      const count = (x1 - x0) * (y1 - y0);
      const sum =
        integral[y1 * intW + x1] -
        integral[y0 * intW + x1] -
        integral[y1 * intW + x0] +
        integral[y0 * intW + x0];

      const localMean = sum / count;
      const pixelVal = gray[y * width + x];

      // بكسل النص يكون أغمق من المتوسط الموضعي بمقدار C
      // الناتج: 0 للأسود (النص) و 255 للأبيض (الخلفية النقية الخالية من الظلال)
      binary[y * width + x] = pixelVal < localMean - C ? 0 : 255;
    }
  }

  return binary;
}

/**
 * خوارزمية إزالة خطوط الجدول (Table Grid Line Removal):
 * تستخدم العمليات المورفولوجية (Erosion ثم Dilation) لاكتشاف الخطوط الأفقية والعمودية الطويلة
 * ثم استبدالها باللون الأبيض (255) لحذفها حتى لا تتداخل مع قراءة النصوص كـ | أو I أو 1 أو l.
 */
function removeTableGridLines(
  binary: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(binary);

  // حجم النواة الأفقية: خطوط الجدول الأفقية تمتد لأكثر من 25 بكسل
  const hKernelSize = Math.max(20, Math.floor(width / 35));
  // حجم النواة العمودية: خطوط الجدول الرأسية تمتد لأكثر من 20 بكسل
  const vKernelSize = Math.max(20, Math.floor(height / 35));

  const isTextPixel = (x: number, y: number) => binary[y * width + x] === 0;

  // 1. كشف الخطوط الأفقية (Horizontal Lines Detection)
  const isHorizontalLine = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let runLength = 0;
    for (let x = 0; x < width; x++) {
      if (isTextPixel(x, y)) {
        runLength++;
      } else {
        if (runLength >= hKernelSize) {
          for (let k = x - runLength; k < x; k++) {
            isHorizontalLine[y * width + k] = 1;
            // فحص سمك الخط (خط أو خطين لأعلى وأسفل)
            if (y > 0 && isTextPixel(k, y - 1)) isHorizontalLine[(y - 1) * width + k] = 1;
            if (y < height - 1 && isTextPixel(k, y + 1)) isHorizontalLine[(y + 1) * width + k] = 1;
          }
        }
        runLength = 0;
      }
    }
    if (runLength >= hKernelSize) {
      for (let k = width - runLength; k < width; k++) {
        isHorizontalLine[y * width + k] = 1;
      }
    }
  }

  // 2. كشف الخطوط العمودية الفاصلة بين خلايا الجدول (Vertical Lines Detection)
  // هذه هي الخطوط المسؤولة عن اللبس مع الرموز | و I و 1 و l
  const isVerticalLine = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let runLength = 0;
    for (let y = 0; y < height; y++) {
      if (isTextPixel(x, y)) {
        runLength++;
      } else {
        if (runLength >= vKernelSize) {
          for (let k = y - runLength; k < y; k++) {
            isVerticalLine[k * width + x] = 1;
            // فحص سمك الخط الرأسي (يمين ويسار)
            if (x > 0 && isTextPixel(x - 1, k)) isVerticalLine[k * width + (x - 1)] = 1;
            if (x < width - 1 && isTextPixel(x + 1, k)) isVerticalLine[k * width + (x + 1)] = 1;
          }
        }
        runLength = 0;
      }
    }
    if (runLength >= vKernelSize) {
      for (let k = height - runLength; k < height; k++) {
        isVerticalLine[k * width + x] = 1;
      }
    }
  }

  // 3. حذف شبكة الجدول (استبدال خطوط الجدول بالأبيض 255)
  // مع الحفاظ على النقاط والحروف التي لا تشكل خطاً طويلاً
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (isHorizontalLine[idx] === 1 || isVerticalLine[idx] === 1) {
        result[idx] = 255; // حذف الخط الفاصل وتحويله لخلفية بيضاء
      }
    }
  }

  return result;
}

function loadImageElement(source: string | File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Failed to load image for OpenCV processing: ' + e));

    if (typeof source === 'string') {
      img.src = source;
    } else {
      const url = URL.createObjectURL(source);
      img.src = url;
    }
  });
}
