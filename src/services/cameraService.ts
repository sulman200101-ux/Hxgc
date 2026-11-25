import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export const captureAndProcessImage = async (): Promise<string | undefined> => {
  try {
    const photo = await Camera.getPhoto({
      quality: 100, // التقاط بأعلى جودة
      allowEditing: false, // قراءة الورقة مباشرة دون إجبار القص المزدوج
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
    });

    if (photo.dataUrl) {
      return photo.dataUrl;
    }
    return undefined;
  } catch (error) {
    console.error('Camera error:', error);
    throw error;
  }
};
