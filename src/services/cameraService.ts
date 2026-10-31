import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { preprocessImageForOCR } from '../utils/imagePreprocess';

export const captureAndProcessImage = async (): Promise<string | undefined> => {
  try {
    const photo = await Camera.getPhoto({
      quality: 100, // التقاط بأعلى جودة
      allowEditing: true, // مهم جداً: يسمح للمستخدم بقص النص المراد فقط
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
    });

    if (photo.dataUrl) {
      // معالجة الصورة قبل إرسالها للذكاء الاصطناعي أو Tesseract
      const processedImage = await preprocessImageForOCR(photo.dataUrl);
      return processedImage;
    }
    return undefined;
  } catch (error) {
    console.error('Camera error:', error);
    throw error;
  }
};
