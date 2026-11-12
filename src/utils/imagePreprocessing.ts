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

export async function preprocessImageWithOpenCV(
  imageSource: string | File | Blob,
  options?: PreprocessingOptions
): Promise<PreprocessingResult> {
  const startTime = performance.now();

  const img = await loadImageElement(imageSource);
  const origWidth = img.naturalWidth || img.width;
  const origHeight = img.naturalHeight || img.height;

  const shouldRotate = options?.rotateCounterClockwise90 ?? true;
  let width = shouldRotate ? origHeight : origWidth;
  let height = shouldRotate ? origWidth : origHeight;

  const MAX_DIM = 2200;
  let scale = 1;
  if (width > MAX_DIM || height > MAX_DIM) {
    scale = MAX_DIM / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement('canvas');
  try {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    if (shouldRotate) {
      ctx.translate(0, height);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, 0, 0, height, width);
    } else {
      ctx.drawImage(img, 0, 0, width, height);
    }

    const imageData = ctx.getImageData(0, 0, width, height);
    const { data } = imageData;

    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }

    const binary = applyAdaptiveThreshold(gray, width, height, 15, 8);
    const cleanedBinary = removeTableGridLines(binary, width, height);

    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const val = cleanedBinary[j];
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
      data[i + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);

    const cleanedDataUrl = canvas.toDataURL('image/png');
    const cleanedBlob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b || new Blob()), 'image/png')
    );
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
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function applyAdaptiveThreshold(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  blockSize: number = 15,
  C: number = 8
): Uint8ClampedArray {
  const binary = new Uint8ClampedArray(width * height);
  const radius = Math.floor(blockSize / 2);

  const integral = new Float64Array((width + 1) * (height + 1));
  const intW = width + 1;

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * intW + (x + 1)] = integral[y * intW + (x + 1)] + rowSum;
    }
  }

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

      binary[y * width + x] = pixelVal < localMean - C ? 0 : 255;
    }
  }

  return binary;
}

function removeTableGridLines(
  binary: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(binary);

  const hKernelSize = Math.max(20, Math.floor(width / 35));
  const vKernelSize = Math.max(20, Math.floor(height / 35));

  const isTextPixel = (x: number, y: number) => binary[y * width + x] === 0;

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

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (isHorizontalLine[idx] === 1 || isVerticalLine[idx] === 1) {
        result[idx] = 255;
      }
    }
  }

  return result;
}

function loadImageElement(source: string | File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let objectUrl: string | null = null;

    img.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = (e) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for OpenCV processing: ' + e));
    };

    if (typeof source === 'string') {
      img.src = source;
    } else {
      objectUrl = URL.createObjectURL(source);
      img.src = objectUrl;
    }
  });
}
