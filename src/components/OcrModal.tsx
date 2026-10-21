import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Camera,
  Upload,
  Save,
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Package,
  Edit3,
  RotateCcw,
  XCircle,
  Lock,
  MapPin,
} from 'lucide-react';
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { ExtractedSparePart } from '../services/localOcr';
import { parseTableWithGeminiVision } from '../services/geminiVisionService';
import { SkippedRowsModal, SkippedRow } from './SkippedRowsModal';
import { playHighPitchWarningAlert } from '../utils/audioAlert';
import { prepareImageForAi, rotateImageDegrees } from '../utils/imagePreprocessor';
import { strict10DigitRegexFilter, isValidSpecificLocation } from '../utils/regexSanitizer';

interface OcrModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveItems: (items: ExtractedSparePart[]) => Promise<void>;
}

export const OcrModal: React.FC<OcrModalProps> = ({
  isOpen,
  onClose,
  onSaveItems,
}) => {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedItems, setExtractedItems] = useState<ExtractedSparePart[]>([]);
  const [skippedRows, setSkippedRows] = useState<SkippedRow[]>([]);
  const [isSkippedModalOpen, setIsSkippedModalOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [warningAlert, setWarningAlert] = useState<string | null>(null);
  const [lastImage, setLastImage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      setIsCameraActive(false);
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setIsCameraActive(true);
      }
    } catch (err) {
      console.warn('Camera access denied:', err);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setExtractedItems([]);
      setSkippedRows([]);
      setIsSkippedModalOpen(false);
      setIsProcessing(false);
      setStatusMessage('');
      setWarningAlert(null);
      setLastImage(null);
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, stopCamera]);

  // التحقق الصارم من اكتمال قراءة الورقة 100% قبل السماح برفعها لقاعدة البيانات
  const sheetValidation = useMemo(() => {
    const invalidRowsCount = extractedItems.filter(
      (item) =>
        !strict10DigitRegexFilter(item.part_number) ||
        !isValidSpecificLocation(item.location_code)
    ).length;

    const totalIncomplete = skippedRows.length + invalidRowsCount;
    const isComplete = extractedItems.length > 0 && totalIncomplete === 0;
    const missingItemsCount = extractedItems.filter(
      (i) => i.is_missing === 1 || i.status === 'غير موجودة'
    ).length;
    const presentItemsCount = extractedItems.length - missingItemsCount;
    const uniqueLocationsCount = new Set(extractedItems.map((i) => i.location_code)).size;

    return {
      isComplete,
      totalIncomplete,
      missingItemsCount,
      presentItemsCount,
      uniqueLocationsCount,
    };
  }, [extractedItems, skippedRows]);

  if (!isOpen) return null;

  /**
   * معالجة الصورة الحقيقية واستخراج كافة أصناف جدول جرد SAP (مثل الـ 37 صنفاً بالكامل) بدون أي بيانات وهمية
   */
  const processImageDirectly = async (rawDataUrl: string) => {
    setIsProcessing(true);
    setWarningAlert(null);
    setStatusMessage('⚡ جاري القراءة الفورية الكاملة لجميع أصناف الورقة وفحص الـ 10 أرقام والمواقع وعلامات (×)...');

    try {
      // تدوير تلقائي للأوراق المصورة طولياً (Portrait -> Landscape) وبوضوح 2000px لقراءة 37 سطراً كاملة
      const calibratedUrl = await prepareImageForAi(rawDataUrl, {
        autoRotate: true,
        maxDimension: 2000,
        enhanceContrast: true,
      });
      setLastImage(calibratedUrl);

      let result = await parseTableWithGeminiVision(calibratedUrl);

      // إذا لم يجد أسطراً في الاتجاه الأول، يجرب التدوير العكسي تلقائياً
      if (!result.items || result.items.length === 0) {
        const rotatedAlt = await rotateImageDegrees(calibratedUrl, 180);
        const retryResult = await parseTableWithGeminiVision(rotatedAlt);
        if (retryResult.items && retryResult.items.length > 0) {
          result = retryResult;
          setLastImage(rotatedAlt);
        }
      }

      if (result.items && result.items.length > 0) {
        setExtractedItems(result.items);

        if (result.skippedRows && result.skippedRows.length > 0) {
          setSkippedRows(result.skippedRows);
          playHighPitchWarningAlert();
          const warnMsg = `⛔ تحذير هام للعمل الميداني: قراءة الورقة ناقصة! تم قراءة (${result.items.length}) صنف ولكن يوجد (${result.skippedRows.length}) سطر غير واضح أو ناقص — يرجى إعادة تصوير أو رفع الورقة مرة أخرى بوضوح تام أو تصحيح النواقص قبل الحفظ.`;
          setWarningAlert(warnMsg);
          setStatusMessage(warnMsg);
        } else {
          setSkippedRows([]);
          setWarningAlert(null);
          const missingCount = result.items.filter(
            (i) => i.is_missing === 1 || i.status === 'غير موجودة'
          ).length;
          setStatusMessage(
            `✅ الورقة مكتملة القراءة 100%! تم قراءة (${result.items.length}) صنف بالكامل — منها (${missingCount}) معلمة بـ × غير موجودة.`
          );
        }
      } else {
        setExtractedItems([]);
        setSkippedRows([]);
        playHighPitchWarningAlert();
        const errWarn =
          result.message ||
          '⛔ تحذير: قراءة الورقة غير مكتملة أو الصورة غير واضحة — يرجى إعادة تصوير أو رفع الورقة مرة أخرى (لا يُسمح بأي قراءة ناقصة أو وهمية في العمل الميداني).';
        setWarningAlert(errWarn);
        setStatusMessage(errWarn);
      }
    } catch (err) {
      console.error('Error processing image:', err);
      playHighPitchWarningAlert();
      const errWarn =
        '⛔ تحذير: حدث خطأ أثناء قراءة الورقة — يرجى إعادة رفع أو تصوير الورقة مرة أخرى بوضوح.';
      setWarningAlert(errWarn);
      setStatusMessage(errWarn);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * تدوير يدوي سريع 90 درجة وإعادة الفحص الكامل
   */
  const handleQuickRotate = async () => {
    if (!lastImage || isProcessing) return;
    setIsProcessing(true);
    setWarningAlert(null);
    setStatusMessage('⚡ جاري تدوير الورقة 90° وإعادة قراءة جميع الأصناف...');
    try {
      const newlyRotated = await rotateImageDegrees(lastImage, 270);
      setLastImage(newlyRotated);
      const result = await parseTableWithGeminiVision(newlyRotated);

      if (result.items && result.items.length > 0) {
        setExtractedItems(result.items);
        if (result.skippedRows && result.skippedRows.length > 0) {
          setSkippedRows(result.skippedRows);
          playHighPitchWarningAlert();
          const warnMsg = `⛔ تحذير: يوجد (${result.skippedRows.length}) سطر غير مكتمل في الورقة — يرجى إعادة رفع الورقة بوضوح أو مراجعة النواقص.`;
          setWarningAlert(warnMsg);
          setStatusMessage(warnMsg);
        } else {
          setSkippedRows([]);
          setWarningAlert(null);
          setStatusMessage(`✅ الورقة مكتملة القراءة 100% (${result.items.length} صنف)!`);
        }
      } else {
        playHighPitchWarningAlert();
        const warnMsg =
          '⛔ لم يتم العثور على قراءة مكتملة بعد التدوير — يرجى إعادة تصوير أو رفع الورقة مرة أخرى بوضوح.';
        setWarningAlert(warnMsg);
        setStatusMessage(warnMsg);
      }
    } catch (err) {
      console.error('Rotate error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const analyzeImageWithGemini = async (base64String: string) => {
    const dataUrl = base64String.startsWith('data:')
      ? base64String
      : `data:image/jpeg;base64,${base64String}`;
    stopCamera();
    await processImageDirectly(dataUrl);
  };

  /**
   * فتح ألبوم الصور بدقة عالية (2000px / جودة 90) لضمان قراءة كافة الـ 37 صنفاً
   */
  const pickFromGallery = async () => {
    try {
      const photo = await CapCamera.getPhoto({
        quality: 90,
        width: 2000,
        height: 2000,
        allowEditing: false,
        correctOrientation: true,
        resultType: CameraResultType.Base64,
        source: CameraSource.Photos,
      });

      if (photo && photo.base64String) {
        await analyzeImageWithGemini(photo.base64String);
      }
    } catch (error) {
      console.error('إلغاء أو تعذر فتح الألبوم:', error);
    }
  };

  /**
   * التقاط صورة من الكاميرا بدقة عالية (2000px / جودة 90)
   */
  const takePicture = async (source: CameraSource = CameraSource.Camera) => {
    try {
      const image = await CapCamera.getPhoto({
        quality: 90,
        width: 2000,
        height: 2000,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: source,
        correctOrientation: true,
      });

      if (image && image.base64String) {
        await analyzeImageWithGemini(image.base64String);
      }
    } catch (err: any) {
      console.warn('Capacitor camera interaction:', err);
      if (!err?.message?.includes('cancelled') && !err?.message?.includes('User cancelled')) {
        startCamera();
      }
    }
  };

  const capturePhoto = async () => {
    if (Capacitor.isNativePlatform()) {
      await takePicture(CameraSource.Camera);
      return;
    }
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 2000;
    canvas.height = videoRef.current.videoHeight || 1400;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const rawDataUrl = canvas.toDataURL('image/jpeg', 0.90);
      stopCamera();
      await processImageDirectly(rawDataUrl);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const rawDataUrl = reader.result as string;
      stopCamera();
      await processImageDirectly(rawDataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleReuploadSheet = () => {
    setExtractedItems([]);
    setSkippedRows([]);
    setWarningAlert(null);
    if (Capacitor.isNativePlatform()) {
      pickFromGallery();
    } else if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  /**
   * تبديل علامة (× غير موجودة / ✓ موجودة) لأي سطر في جدول المعاينة قبل الحفظ
   */
  const handleToggleMissingItem = (index: number) => {
    setExtractedItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const currentlyMissing = item.is_missing === 1 || item.status === 'غير موجودة';
        const nextMissing = !currentlyMissing;
        return {
          ...item,
          is_missing: nextMissing ? 1 : 0,
          status: nextMissing ? 'غير موجودة' : 'مضاف',
          qty_remaining: nextMissing ? 0 : Math.max(0, item.qty_total - item.qty_out),
        };
      })
    );
  };

  /**
   * حفظ الورقة في قاعدة البيانات — مشروط باكتمال قراءة الورقة 100%
   */
  const handleSaveToDatabase = async () => {
    if (!sheetValidation.isComplete) {
      playHighPitchWarningAlert();
      setIsSkippedModalOpen(true);
      return;
    }
    setIsProcessing(true);
    await onSaveItems(extractedItems);
    setIsProcessing(false);
    stopCamera();
    onClose();
  };

  const handleDeleteItem = (index: number) => {
    setExtractedItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleApplySkippedRow = (item: ExtractedSparePart, skipId: string) => {
    setExtractedItems((prev) => [item, ...prev]);
    setSkippedRows((prev) => prev.filter((s) => s.id !== skipId));
  };

  const handleRemoveSkippedRow = (skipId: string) => {
    setSkippedRows((prev) => prev.filter((s) => s.id !== skipId));
  };

  const handleDismissAllSkipped = () => {
    setSkippedRows([]);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-sm overflow-y-auto">
        <div className="bg-[#2C1E18] border border-[#52382D] w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
          {/* Header with Ornate Orange Icon */}
          <div className="px-4 py-3 bg-[#231713] border-b border-[#3D271F] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF7A00] via-[#E65100] to-[#B43400] border-2 border-[#FFB74D] shadow-lg shadow-orange-950/70 flex items-center justify-center text-white relative overflow-hidden">
                <div className="absolute inset-0.5 border border-dashed border-amber-200/40 rounded-lg pointer-events-none" />
                <Camera className="w-5 h-5 text-amber-100 drop-shadow" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-white">
                  الفحص الدقيق لأوراق الجرد (SAP Inventory Controller)
                </h2>
                <p className="text-[10px] text-amber-300/90">
                  قراءة حقيقية كاملة 100% لجميع الأصناف (37 صنفاً) + منع أي قراءة ناقصة أو وهمية
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                stopCamera();
                onClose();
              }}
              className="p-1.5 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-neutral-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Controls Bar */}
          <div className="p-3 bg-[#1C120E] border-b border-[#3E2820] flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {!isCameraActive ? (
                <button
                  onClick={() => {
                    if (Capacitor.isNativePlatform()) {
                      takePicture(CameraSource.Camera);
                    } else {
                      startCamera();
                    }
                  }}
                  disabled={isProcessing}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#FF6D00] to-[#E65100] hover:from-[#FF8500] hover:to-[#F57C00] border border-[#FFB74D]/50 text-white font-bold text-xs flex items-center gap-2 shadow-lg transition-transform active:scale-95 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>التقاط من الكاميرا ⚡</span>
                </button>
              ) : (
                <button
                  onClick={capturePhoto}
                  disabled={isProcessing}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg transition-transform active:scale-95 cursor-pointer animate-pulse"
                >
                  <Camera className="w-4 h-4" />
                  <span>التقاط الآن 📸</span>
                </button>
              )}

              {Capacitor.isNativePlatform() ? (
                <button
                  type="button"
                  onClick={pickFromGallery}
                  disabled={isProcessing}
                  className="px-4 py-2.5 rounded-xl bg-[#2D1B15] hover:bg-[#40271E] text-amber-200 border border-[#FF8F00]/50 font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <Upload className="w-4 h-4 text-amber-400" />
                  <span>رفع الورقة من الألبوم ⚡</span>
                </button>
              ) : (
                <label className="px-4 py-2.5 rounded-xl bg-[#2D1B15] hover:bg-[#40271E] text-amber-200 border border-[#FF8F00]/50 font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors">
                  <Upload className="w-4 h-4 text-amber-400" />
                  <span>رفع الورقة من الألبوم ⚡</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              )}

              {lastImage && (
                <button
                  onClick={handleQuickRotate}
                  disabled={isProcessing}
                  title="تدوير 90 درجة وإعادة القراءة"
                  className="px-3 py-2.5 rounded-xl bg-[#2D1B15] hover:bg-[#43271D] text-amber-300 border border-amber-600/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>تدوير 90° ↺</span>
                </button>
              )}
            </div>

            {/* زر رفع وحفظ الورقة: لا يفتح إلا إذا كانت الورقة مكتملة القراءة 100% */}
            <button
              onClick={handleSaveToDatabase}
              disabled={extractedItems.length === 0 || isProcessing}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 shadow-lg transition-all ${
                sheetValidation.isComplete && !isProcessing
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/50 cursor-pointer active:scale-95'
                  : extractedItems.length > 0 && !sheetValidation.isComplete
                  ? 'bg-red-900/80 hover:bg-red-800 text-red-100 border border-red-500 cursor-pointer'
                  : 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700'
              }`}
            >
              {sheetValidation.isComplete ? (
                <>
                  <Save className="w-4 h-4" />
                  <span>رفع وحفظ الورقة المكتملة ({extractedItems.length} صنف)</span>
                </>
              ) : extractedItems.length > 0 ? (
                <>
                  <Lock className="w-4 h-4 text-red-300" />
                  <span>قراءة ناقصة ({sheetValidation.totalIncomplete} سطر) — أعد الرفع أو صحح</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>رفع الورقة لقاعدة البيانات</span>
                </>
              )}
            </button>
          </div>

          {/* Live Camera View */}
          {isCameraActive && (
            <div className="p-3 bg-black flex flex-col items-center border-b border-[#3D271F]">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video max-h-[250px] w-full max-w-xl flex items-center justify-center border-2 border-amber-600 shadow-lg">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-4 border border-dashed border-amber-400/80 rounded-lg pointer-events-none flex items-center justify-center">
                  <span className="text-[11px] text-amber-200 bg-black/75 px-3 py-1 rounded-full font-bold">
                    تأكد من ظهور زوايا الورقة الأربعة وكافة الأسطر بوضوح
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Modal Body */}
          <div className="p-4 overflow-y-auto flex-1 space-y-3">
            {/* Status Bar */}
            {isProcessing && (
              <div className="bg-[#1C120E] p-3.5 rounded-xl border border-amber-500/60 flex items-center justify-between text-xs animate-pulse">
                <span className="text-amber-300 font-bold flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                  <span>{statusMessage}</span>
                </span>
                <span className="text-amber-400 font-mono text-[11px] font-bold">Gemini 3 Vision</span>
              </div>
            )}

            {/* شريط التحذير الصارم عند وجود أي نقص في الورقة أو عدم وضوح */}
            {!isProcessing && warningAlert && (
              <div className="p-4 rounded-xl bg-red-950/90 border-2 border-red-500 text-red-100 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-black text-xs sm:text-sm text-red-200">
                      تحذير عدم اكتمال قراءة الورقة (مرفوضة للعمل الميداني)
                    </div>
                    <p className="text-xs text-red-300 mt-1 leading-relaxed">
                      {warningAlert}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <button
                    type="button"
                    onClick={handleReuploadSheet}
                    className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#FF6D00] to-[#E65100] hover:from-[#FF8500] hover:to-[#F57C00] text-white font-black text-xs flex items-center gap-1.5 shadow-md cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>إعادة رفع / تصوير الورقة مرة أخرى</span>
                  </button>
                  {skippedRows.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsSkippedModalOpen(true)}
                      className="px-3 py-2 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1 cursor-pointer border border-red-400/50"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>مراجعة النواقص ({skippedRows.length})</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* شريط اكتمال الورقة وإحصائيات الموجود وغير الموجود (×) */}
            {!isProcessing && extractedItems.length > 0 && (
              <div
                className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs ${
                  sheetValidation.isComplete
                    ? 'bg-emerald-950/70 border-emerald-600/70 text-emerald-200'
                    : 'bg-red-950/80 border-red-500/80 text-red-200'
                }`}
              >
                <div className="flex flex-wrap items-center gap-3 font-bold">
                  {sheetValidation.isComplete ? (
                    <span className="flex items-center gap-1.5 text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      الورقة مكتملة القراءة 100% ({extractedItems.length} صنف)
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-red-300">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      الورقة ناقصة: يوجد ({sheetValidation.totalIncomplete}) سطر غير مكتمل يمنع رفع الورقة
                    </span>
                  )}

                  <span className="px-2 py-0.5 rounded-md bg-black/40 text-emerald-300 border border-emerald-700/50">
                    ✓ موجودة: {sheetValidation.presentItemsCount}
                  </span>

                  <span className="px-2 py-0.5 rounded-md bg-red-950 text-red-300 border border-red-600/60 font-black">
                    × غير موجودة: {sheetValidation.missingItemsCount}
                  </span>

                  <span className="px-2 py-0.5 rounded-md bg-amber-950/80 text-amber-300 border border-amber-700/50">
                    المواقع الفعلية: {sheetValidation.uniqueLocationsCount} موقع
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleReuploadSheet}
                  className="px-3 py-1.5 rounded-lg bg-[#2D1B15] hover:bg-[#40271E] text-amber-300 border border-amber-500/40 font-bold text-xs flex items-center gap-1.5 self-end sm:self-auto cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>إعادة رفع الورقة</span>
                </button>
              </div>
            )}

            {/* جدول النتائج */}
            {extractedItems.length > 0 ? (
              <div className="bg-[#1C120E] border border-[#3E2820] rounded-xl overflow-hidden shadow">
                <div className="overflow-x-auto max-h-[390px] scrollbar-thin">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-[#180F0C] text-neutral-400 text-[11px] sticky top-0 z-10 border-b border-[#3E2820]">
                      <tr>
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">رقم القطعة (Material 10 أرقام)</th>
                        <th className="py-2.5 px-3">الموقع (Storage Bin)</th>
                        <th className="py-2.5 px-3 text-center">الكمية (QTY)</th>
                        <th className="py-2.5 px-3 text-center">علامة الجرد (Check)</th>
                        <th className="py-2.5 px-3">اسم ووصف القطعة</th>
                        <th className="py-2.5 px-2 text-center w-12">حذف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2F1D16]">
                      {extractedItems.map((item, idx) => {
                        const isMissing = item.is_missing === 1 || item.status === 'غير موجودة';
                        return (
                          <tr
                            key={`${item.part_number}-${item.location_code}-${idx}`}
                            className={`transition-colors ${
                              isMissing
                                ? 'bg-red-950/25 hover:bg-red-950/40'
                                : 'hover:bg-[#261712]'
                            }`}
                          >
                            <td className="py-2.5 px-3 font-mono text-neutral-500">
                              {idx + 1}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-amber-300">
                              {item.part_number}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-emerald-300">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#261712] border border-[#432d24]">
                                <MapPin className="w-3 h-3 text-amber-400" />
                                {item.location_code}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-center">
                              <span className="font-bold text-white">{item.qty_total}</span>
                              {item.remark && (
                                <span className="block text-[10px] text-amber-400">
                                  ملاحظة: {item.remark}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleToggleMissingItem(idx)}
                                title="اضغط للتبديل بين (موجودة ✓) و (غير موجودة ×)"
                                className={`px-2.5 py-1 rounded-lg font-black text-[11px] inline-flex items-center gap-1 cursor-pointer transition-all border ${
                                  isMissing
                                    ? 'bg-red-950 text-red-200 border-red-500 shadow-sm shadow-red-950'
                                    : 'bg-emerald-950/70 text-emerald-300 border-emerald-600/50'
                                }`}
                              >
                                {isMissing ? (
                                  <>
                                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                                    <span>× غير موجودة</span>
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>✓ موجودة</span>
                                  </>
                                )}
                              </button>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-bold text-neutral-100">{item.description_ar}</div>
                              <div className="text-[10px] text-neutral-400 font-sans" dir="ltr">
                                {item.description_en}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <button
                                onClick={() => handleDeleteItem(idx)}
                                title="حذف هذا السطر"
                                className="p-1 rounded text-neutral-500 hover:text-red-400 hover:bg-red-950/40 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              !isProcessing && (
                <div className="py-12 px-4 text-center rounded-2xl bg-[#1C120E] border border-[#3E2820] space-y-2.5">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-[#FF7A00] via-[#E65100] to-[#9E2A00] border-2 border-[#FFB74D] shadow-lg flex items-center justify-center text-white relative">
                    <div className="absolute inset-1 border border-dashed border-amber-200/40 rounded-xl pointer-events-none" />
                    <Package className="w-7 h-7 text-amber-100" />
                  </div>
                  <h3 className="text-sm font-bold text-neutral-200">
                    جاهز للقراءة الكاملة لأوراق الجرد (SAP Inventory Controller)
                  </h3>
                  <p className="text-xs text-neutral-400 max-w-md mx-auto leading-relaxed">
                    اضغط على <span className="text-amber-400 font-bold">التقاط من الكاميرا</span> أو{' '}
                    <span className="text-amber-400 font-bold">رفع الورقة من الألبوم</span> لقراءة جميع الأصناف في الورقة (مثل 37 صنفاً بالكامل). أي نقص في الورقة يعطي تحذيراً فورياً لإعادة رفعها.
                  </p>
                </div>
              )
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-[#231713] border-t border-[#3D271F] flex items-center justify-between text-xs">
            <span className="text-[11px] text-neutral-400">
              {sheetValidation.isComplete
                ? `✅ الورقة مكتملة القراءة (${extractedItems.length} صنف) وجاهزة للحفظ`
                : extractedItems.length > 0
                ? `⛔ تحذير: الورقة بها ${sheetValidation.totalIncomplete} سطر ناقص — يرجى إعادة رفع الورقة أو تصحيح النواقص`
                : 'يُمنع حفظ أي ورقة ناقصة أو قراءة وهمية لضمان دقة العمل الميداني 100%'}
            </span>
            <button
              onClick={() => {
                stopCamera();
                onClose();
              }}
              className="text-neutral-400 hover:text-white transition-colors cursor-pointer font-bold"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>

      <SkippedRowsModal
        isOpen={isSkippedModalOpen}
        onClose={() => setIsSkippedModalOpen(false)}
        skippedRows={skippedRows}
        validCount={extractedItems.length}
        onAcceptCorrectedItem={handleApplySkippedRow}
        onRemoveSkippedRow={handleRemoveSkippedRow}
        onDismissAllSkipped={handleDismissAllSkipped}
      />
    </>
  );
};
