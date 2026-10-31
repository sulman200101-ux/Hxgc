export const preprocessImageForOCR = async (imageSrc: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageSrc;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject('Canvas not supported');

      canvas.width = img.width;
      canvas.height = img.height;

      // رسم الصورة الأصلية
      ctx.drawImage(img, 0, 0);

      // سحب بيانات البكسل
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // تطبيق فلتر أبيض وأسود (Grayscale) وزيادة التباين (Contrast)
      const contrast = 100; // نسبة التباين
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

      for (let i = 0; i < data.length; i += 4) {
        // تحويل للرمادي
        const avg = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

        // تطبيق التباين
        const newValue = factor * (avg - 128) + 128;

        // تعيين القيم الجديدة
        const finalValue = Math.min(255, Math.max(0, newValue));
        data[i] = finalValue; // Red
        data[i + 1] = finalValue; // Green
        data[i + 2] = finalValue; // Blue
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 1.0));
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
