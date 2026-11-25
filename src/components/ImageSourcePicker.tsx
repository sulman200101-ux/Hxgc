import React, { useRef, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { captureAndProcessImage } from '../services/cameraService';

export interface ImageSourcePickerProps {
  onImages: (files: File[]) => void;
  disabled?: boolean;
  onError: (message: string) => void;
  autoCamera?: boolean;
}

async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || 'image/jpeg' });
}

export function ImageSourcePicker({
  onImages,
  disabled = false,
  onError,
  autoCamera = false,
}: ImageSourcePickerProps) {
  const album = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const accept = (input: HTMLInputElement) => {
    const files = Array.from(input.files || []);
    if (files.length) onImages(files);
    input.value = '';
  };

  const takePicture = async () => {
    if (!Capacitor.isNativePlatform()) {
      camera.current?.click();
      return;
    }
    try {
      const processedDataUrl = await captureAndProcessImage();
      if (!processedDataUrl) throw new Error('لم تصل صورة من الكاميرا');
      const file = await dataUrlToFile(processedDataUrl, `camera-${Date.now()}.jpg`);
      onImages([file]);
    } catch {
      onError('لم يتم التقاط صورة. تحقق من إذن الكاميرا أو اختر صورة من الألبوم.');
    }
  };

  const started = useRef(false);
  useEffect(() => {
    if (autoCamera && !started.current) {
      started.current = true;
      void takePicture();
    }
  }, []);

  return (
    <div className="flex flex-wrap gap-3 py-2">
      <button
        type="button"
        disabled={disabled}
        className="flex-1 min-w-40 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-xl p-3.5 font-bold cursor-pointer transition-colors"
        onClick={takePicture}
      >
        التقاط بالكاميرا (مع القص)
      </button>
      <button
        type="button"
        disabled={disabled}
        className="flex-1 min-w-40 border border-orange-500 hover:bg-stone-800 disabled:opacity-50 rounded-xl p-3.5 font-bold cursor-pointer transition-colors"
        onClick={() => album.current?.click()}
      >
        اختيار من الألبوم
      </button>
      <input
        ref={camera}
        aria-label="صورة الكاميرا"
        className="hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => accept(e.target)}
      />
      <input
        ref={album}
        aria-label="صور الألبوم"
        className="hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => accept(e.target)}
      />
    </div>
  );
}
