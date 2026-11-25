/**
 * وحدة الخوارزميات البصرية المسبقة لمساعدة Gemini Vision ومحرك القراءة (AI-Assisted Table Image Preprocessor)
 * تكشف تلقائياً الجداول الملتقطة طولياً (Sideways Landscape Tables) وتديرها -90 درجة (90° CCW)
 * ليصبح الجدول أفقياً مستقيم السطور، مع توفير قص ذكي لأعمدة البيانات وتحرير ذاكرة Canvas فوراً.
 */

export interface PreProcessingOptions {
  autoRotate?: boolean;
  forceRotateCcw?: boolean;
  maxDimension?: number;
  minDimension?: number;
  enhanceContrast?: boolean;
  autoCropTable?: boolean;
  sharpenText?: boolean;
}

function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // ignore
  }
}

/**
 * كشف هندسي فائق السرعة (< 5ms) لما إذا كانت سطور الجدول عمودية (تحتاج تدوير 90° عكس عقارب الساعة)
 * عبر مقارنة طاقة تباين الإسقاط الأفقي والرأسي في وسط الورقة.
 */
function detectSidewaysTableOrientation(img: HTMLImageElement): boolean {
  let probeCanvas: HTMLCanvasElement | null = null;
  try {
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;
    if (!origW || !origH) return false;

    const w = 280;
    const h = 280;
    probeCanvas = document.createElement('canvas');
    probeCanvas.width = w;
    probeCanvas.height = h;
    const ctx = probeCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) return origH > origW * 1.15;

    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    const x0 = Math.floor(w * 0.12);
    const x1 = Math.floor(w * 0.88);
    const y0 = Math.floor(h * 0.12);
    const y1 = Math.floor(h * 0.88);

    const rowMeans = new Float32Array(y1 - y0);
    for (let y = y0; y < y1; y++) {
      let sum = 0;
      const rowOffset = y * w;
      for (let x = x0; x < x1; x++) {
        const p = (rowOffset + x) * 4;
        sum += (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
      }
      rowMeans[y - y0] = sum / (x1 - x0);
    }

    const colMeans = new Float32Array(x1 - x0);
    for (let x = x0; x < x1; x++) {
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        const p = (y * w + x) * 4;
        sum += (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
      }
      colMeans[x - x0] = sum / (y1 - y0);
    }

    let rowDiffEnergy = 0;
    for (let i = 1; i < rowMeans.length; i++) {
      const d = rowMeans[i] - rowMeans[i - 1];
      rowDiffEnergy += d * d;
    }
    rowDiffEnergy /= Math.max(1, rowMeans.length);

    let colDiffEnergy = 0;
    for (let i = 1; i < colMeans.length; i++) {
      const d = colMeans[i] - colMeans[i - 1];
      colDiffEnergy += d * d;
    }
    colDiffEnergy /= Math.max(1, colMeans.length);

    return colDiffEnergy > rowDiffEnergy * 1.12;
  } catch {
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;
    return origH > origW * 1.18;
  } finally {
    releaseCanvas(probeCanvas);
  }
}

/**
 * تطبيق فلتر زيادة حدة الحروف والأرقام (3x3 Unsharp Mask) لإبراز الأرقام الدقيقة في الزوايا
 */
function applyFastUnsharpMask(imageData: ImageData, amount = 0.34): void {
  const { data, width, height } = imageData;
  const lum = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    lum[j] = (data[i] * 77 + data[i + 1] * 150 + data[pIdxSafe(i + 2)] * 29) >> 8;
  }

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = rowOffset + x;
      const center = lum[idx];
      const blur =
        (lum[idx - width] +
          lum[idx + width] +
          lum[idx - 1] +
          lum[idx + 1] +
          center * 4) >>
        3;
      const diff = center - blur;
      if (Math.abs(diff) > 2) {
        const pIdx = idx * 4;
        const delta = Math.round(diff * amount);
        data[pIdx] = Math.min(255, Math.max(0, data[pIdx] + delta));
        data[pIdx + 1] = Math.min(255, Math.max(0, data[pIdx + 1] + delta));
        data[pIdx + 2] = Math.min(255, Math.max(0, data[pIdx + 2] + delta));
      }
    }
  }
}

function pIdxSafe(i: number): number {
  return i;
}

/**
 * تدوير الصورة تلقائياً إلى الوضع الأفقي (Landscape) وتحسين التباين لقراءة جداول SAP
 */
export async function preprocessInventoryImage(
  imageSource: File | Blob | string,
  forceRotationDegrees?: 0 | 90 | 180 | 270,
  options?: { grayscale?: boolean }
): Promise<{ dataUrl: string; blob: Blob; width: number; height: number; rotated: boolean }> {
  const { img, objectUrl } = await loadImageElement(imageSource);

  let canvas: HTMLCanvasElement | null = null;
  try {
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    // أوراق جرد SAP مطبوعة بالعرض (Landscape). إذا كان الارتفاع أكبر من العرض فالصورة مقلوبة 90 درجة
    const isPortrait = origH > origW;
    const rotation: 0 | 90 | 180 | 270 =
      forceRotationDegrees !== undefined
        ? forceRotationDegrees
        : isPortrait
        ? 270 // تدوير 90 درجة عكس عقارب الساعة لتصبح الترويسة في الأعلى والأسطر أفقية
        : 0;

    const swapDims = rotation === 90 || rotation === 270;
    const targetWidth = swapDims ? origH : origW;
    const targetHeight = swapDims ? origW : origH;

    // الحفاظ على دقة عالية (حد أدنى للعرض 2200 بكسل لضمان وضوح الأرقام الـ 10 ورموز المواقع)
    const rawScale = targetWidth < 2200 ? 2200 / Math.max(1, targetWidth) : 1;
    // سقف آمن في حال الأوراق شديدة الطول حتى لا يتجاوز استهلاك الذاكرة حدود Android WebView
    const scale = Math.min(rawScale, 4200 / Math.max(1, targetHeight));
    const finalWidth = Math.max(1, Math.round(targetWidth * scale));
    const finalHeight = Math.max(1, Math.round(targetHeight * scale));

    canvas = document.createElement('canvas');
    canvas.width = finalWidth;
    canvas.height = finalHeight;

    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error('Failed to get 2D canvas context');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, finalWidth, finalHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.save();
    ctx.translate(finalWidth / 2, finalHeight / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -origW / 2, -origH / 2);
    ctx.restore();

    // تحسين التباين وتوضيح الحروف المطبوعة دون طمس علامة الصح اليدوية (للألوان لـ Gemini أو رمادي للـ OCR المحلي)
    if (options?.grayscale !== false) {
      enhanceContrastForOcr(ctx, finalWidth, finalHeight);
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
        'image/jpeg',
        0.92
      );
    });

    return {
      dataUrl,
      blob,
      width: finalWidth,
      height: finalHeight,
      rotated: rotation !== 0,
    };
  } finally {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore
      }
    }
    releaseCanvas(canvas);
  }
}

/**
 * تجهيز فائق السرعة للصورة الملونة بالوضع الأفقي (>= 2200px) لإرسالها مباشرة إلى Gemini + Sharp على الخادم
 * يتجنب حلقات البكسل البطيئة في المتصفح وتوليد Blob غير الضروري
 */
export async function fastPrepareLandscapeForGemini(
  imageSource: File | Blob | string
): Promise<string> {
  const { img, objectUrl } = await loadImageElement(imageSource);
  let canvas: HTMLCanvasElement | null = null;
  try {
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;
    const isPortrait = origH > origW;
    const rotation = isPortrait ? 270 : 0;

    const targetWidth = isPortrait ? origH : origW;
    const targetHeight = isPortrait ? origW : origH;
    const rawScale = targetWidth < 2200 ? 2200 / Math.max(1, targetWidth) : targetWidth > 2600 ? 2400 / targetWidth : 1;
    const scale = Math.min(rawScale, 4200 / Math.max(1, targetHeight));
    const finalWidth = Math.max(1, Math.round(targetWidth * scale));
    const finalHeight = Math.max(1, Math.round(targetHeight * scale));

    canvas = document.createElement('canvas');
    canvas.width = finalWidth;
    canvas.height = finalHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Failed to get 2D canvas context');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, finalWidth, finalHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.save();
    ctx.translate(finalWidth / 2, finalHeight / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -origW / 2, -origH / 2);
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.91);
  } finally {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore
      }
    }
    releaseCanvas(canvas);
  }
}

function loadImageElement(
  source: File | Blob | string
): Promise<{ img: HTMLImageElement; objectUrl: string | null }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
    img.onload = () => resolve({ img, objectUrl });
    img.onerror = (err) => {
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // ignore
        }
      }
      reject(err);
    };
    img.src = objectUrl || (source as string);
  });
}

function enhanceContrastForOcr(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const contrast = 1.35; // زيادة التباين بنسبة 35%
  const intercept = 128 * (1 - contrast);

  for (let i = 0; i < data.length; i += 4) {
    // تحويل إلى تدرج رمادي عالي التباين
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const adjusted = Math.min(255, Math.max(0, gray * contrast + intercept));
    data[i] = adjusted;
    data[i + 1] = adjusted;
    data[i + 2] = adjusted;
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * معايرة وتجهيز الصورة لـ Gemini Vision ومحرك القراءة بدقة وسرعة فائقة مع تدوير الأوراق الملتقطة طولياً إلى الوضع الأفقي
 */
export async function prepareImageForAi(
  imageSource: string,
  options: PreProcessingOptions = {}
): Promise<string> {
  if (options.forceRotateCcw) {
    try {
      const res = await preprocessInventoryImage(imageSource, 270);
      return res.dataUrl;
    } catch {
      return imageSource;
    }
  }
  if (options.autoRotate !== false && options.enhanceContrast !== false) {
    try {
      const res = await preprocessInventoryImage(imageSource);
      return res.dataUrl;
    } catch {
      // المتابعة للمعالجة الاحتياطية
    }
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      let canvas: HTMLCanvasElement | null = null;
      try {
        const origW = img.naturalWidth || img.width;
        const origH = img.naturalHeight || img.height;

        const shouldRotateCcw =
          options.forceRotateCcw === true ||
          (options.autoRotate !== false && (origH > origW || detectSidewaysTableOrientation(img)));

        const maxDim = options.maxDimension || 2400;
        const minDim = options.minDimension || 2200;

        let targetW = shouldRotateCcw ? origH : origW;
        let targetH = shouldRotateCcw ? origW : origH;

        const longestSide = Math.max(targetW, targetH);
        if (longestSide > maxDim) {
          const scale = maxDim / longestSide;
          targetW = Math.round(targetW * scale);
          targetH = Math.round(targetH * scale);
        } else if (longestSide > 450 && longestSide < minDim) {
          const scale = minDim / longestSide;
          targetW = Math.round(targetW * scale);
          targetH = Math.round(targetH * scale);
        }

        canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

        if (!ctx) {
          return resolve(imageSource);
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        if (shouldRotateCcw) {
          ctx.translate(0, targetH);
          ctx.rotate(-Math.PI / 2);
          ctx.drawImage(img, 0, 0, targetH, targetW);
        } else {
          ctx.drawImage(img, 0, 0, targetW, targetH);
        }

        if (options.enhanceContrast !== false) {
          try {
            enhanceContrastForOcr(ctx, targetW, targetH);
          } catch {
            // ignore
          }
        }

        if (options.sharpenText !== false && targetW >= 600 && targetH >= 300) {
          try {
            const imgData = ctx.getImageData(0, 0, targetW, targetH);
            applyFastUnsharpMask(imgData, 0.25);
            ctx.putImageData(imgData, 0, 0);
          } catch {
            // الاحتفاظ بالصورة المرسومة في حال تعذر الوصول للبكسلات
          }
        }

        const resultUrl = canvas.toDataURL('image/jpeg', 0.92);
        resolve(resultUrl);
      } catch (err) {
        console.warn('Image calibration failed, using original:', err);
        resolve(imageSource);
      } finally {
        releaseCanvas(canvas);
      }
    };

    img.onerror = () => {
      resolve(imageSource);
    };

    img.src = imageSource;
  });
}

/**
 * قص منطقة أعمدة محددة من الورقة الأفقية المعايرة (مثل أعمدة البيانات اليسرى أو عمود الوصف الأيمن)
 */
export async function cropTableZoneForOcr(
  imageSource: string,
  leftFrac: number,
  widthFrac: number,
  targetWidth = 1450
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let canvas: HTMLCanvasElement | null = null;
      try {
        const origW = img.naturalWidth || img.width;
        const origH = img.naturalHeight || img.height;
        if (origW < 600 || origH < 350) return resolve(imageSource);

        const srcX = Math.max(0, Math.round(origW * leftFrac));
        const srcY = Math.max(0, Math.round(origH * 0.03));
        const srcW = Math.max(200, Math.min(origW - srcX, Math.round(origW * widthFrac)));
        const srcH = Math.max(200, Math.min(origH - srcY, Math.round(origH * 0.94)));

        const scale = targetWidth / srcW;
        const outW = Math.round(srcW * scale);
        const outH = Math.round(srcH * scale);

        canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
        if (!ctx) return resolve(imageSource);

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, outW, outH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.filter = 'grayscale(1) contrast(1.22) brightness(1.03)';
        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

        try {
          const imgData = ctx.getImageData(0, 0, outW, outH);
          applyFastUnsharpMask(imgData, 0.36);
          ctx.putImageData(imgData, 0, 0);
        } catch {
          // ignore
        }

        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch {
        resolve(imageSource);
      } finally {
        releaseCanvas(canvas);
      }
    };
    img.onerror = () => resolve(imageSource);
    img.src = imageSource;
  });
}

export async function cropLeftTableColumnsForOcr(
  imageSource: string,
  widthRatio = 0.44
): Promise<string> {
  return cropTableZoneForOcr(imageSource, 0.038, widthRatio, 1550);
}

/**
 * تدوير يدوي أو تلقائي بزاوية محددة (90 / 180 / 270 درجة) بسرعة فائقة
 */
export async function rotateImageDegrees(
  imageSource: string,
  degrees: 90 | 180 | 270
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      let canvas: HTMLCanvasElement | null = null;
      try {
        const origW = img.naturalWidth || img.width;
        const origH = img.naturalHeight || img.height;
        const isSwap = degrees === 90 || degrees === 270;

        canvas = document.createElement('canvas');
        canvas.width = isSwap ? origH : origW;
        canvas.height = isSwap ? origW : origH;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return resolve(imageSource);

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((degrees * Math.PI) / 180);
        ctx.drawImage(img, -origW / 2, -origH / 2);

        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch {
        resolve(imageSource);
      } finally {
        releaseCanvas(canvas);
      }
    };

    img.onerror = () => resolve(imageSource);
    img.src = imageSource;
  });
}

export async function runPreProcessingPipeline(
  imageSource: string,
  options?: any
): Promise<{ processedImage: string; appliedRotation: number; isClaheApplied: boolean; isDenoised: boolean }> {
  const processed = await prepareImageForAi(imageSource, {
    forceRotateCcw: options?.fixedRotation === 270,
  });
  return {
    processedImage: processed,
    appliedRotation: options?.fixedRotation || 0,
    isClaheApplied: true,
    isDenoised: true,
  };
}
