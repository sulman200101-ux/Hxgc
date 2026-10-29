import React, { useRef, useEffect } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
export function ImageSourcePicker({ onImages, disabled = false, onError, autoCamera = false }: { onImages: (files: File[]) => void; disabled?: boolean; onError: (message: string) => void; autoCamera?: boolean }) {
  const album = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const accept = (input: HTMLInputElement) => { const files = Array.from(input.files || []); if (files.length) onImages(files); input.value = ''; };
  const takePicture = async () => {
      if (!Capacitor.isNativePlatform()) { camera.current?.click(); return; }
      try {
        const photo = await Camera.getPhoto({ source: CameraSource.Camera, resultType: CameraResultType.Uri, quality: 95, correctOrientation: true });
        if (!photo.webPath) throw new Error('لم تصل صورة من الكاميرا');
        const response = await fetch(photo.webPath); if (!response.ok) throw new Error('تعذر فتح الصورة');
        const blob = await response.blob(); onImages([new File([blob], `camera-${Date.now()}.${photo.format || 'jpg'}`, { type: blob.type || 'image/jpeg' })]);
      } catch (err) { onError('لم يتم التقاط صورة. تحقق من إذن الكاميرا أو اختر صورة من الألبوم.'); }
      };
  const started = useRef(false);
  useEffect(() => { if (autoCamera && !started.current) { started.current = true; void takePicture(); } }, []);
  return <div className="flex flex-wrap gap-3 py-4">
    <button type="button" disabled={disabled} className="flex-1 min-w-40 bg-orange-600 rounded-xl p-4 font-bold" onClick={takePicture}>التقاط بالكاميرا</button>
    <button type="button" disabled={disabled} className="flex-1 min-w-40 border border-orange-500 rounded-xl p-4 font-bold" onClick={() => album.current?.click()}>اختيار من الألبوم</button>
    <input ref={camera} aria-label="صورة الكاميرا" className="hidden" type="file" accept="image/*" capture="environment" onChange={e => accept(e.target)} />
    <input ref={album} aria-label="صور الألبوم" className="hidden" type="file" accept="image/*" multiple onChange={e => accept(e.target)} />
  </div>;
}
