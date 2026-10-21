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
  MapPin,
  Sparkles,
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
  const [repairedCount, setRepairedCount] = useState<number>(0);
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
      setRepairedCount(0);
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

  // إحصائيات وفحص الورقة المقروءة
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
   * معالجة الصورة بنفس آلية المحاكي 100% مع الخوارزميات المساعدة الذكية
   */
  const processImageDirectly = async (rawDataUrl: string) => {
    setIsProcessing(true);
    setWarningAlert(null);
    setRepairedCount(0);
    setStatusMessage('⚡ جاري القراءة السريعة لكامل الورقة وتطبيق الخوارزميات المساعدة لتصحيح الأرقام والمواقع وعلامات (✓ / ×)...');

    try {
      // معالجة مطابقة للمحاكي تماماً (1600px دون تدوير قسري مزدوج)
      const calibratedUrl = await prepareImageForAi(rawDataUrl, {
        maxDimension: 1600,
        enhanceContrast: true,
      });
      setLastImage(calibratedUrl);

      let result = await parseTableWithGeminiVision(calibratedUrl);

      // خوارزمية المساعدة التلقائية للاتجاه: إذا كانت الورقة مقلوبة أو مصورة بزاوية صعبة ولم تُقرأ من المحاولة الأولى، تدور 270 درجة تلقائياً
      if (!result.items || result.items.length === 0) {
        setStatusMessage('⚡ جاري تعديل زاوية الورقة تلقائياً وإعادة القراءة...');
        const rotated270 = await rotateImageDegrees(calibratedUrl, 270);
        const retryResult = await parseTableWithGeminiVision(rotated270);
        if (retryResult.items && retryResult.items.length > 0) {
          result = retryResult;
          setLastImage(rotated270);
        }
      }

      if (result.items && result.items.length > 0) {
        setExtractedItems(result.items);
        setRepairedCount(result.repairedCount || 0);

        if (result.skippedRows && result.skippedRows.length > 0) {
          setSkippedRows(result.skippedRows);
          playHighPitchWarningAlert();
          const warnMsg = `⚠️ تم قراءة (${result.items.length}) صنف بنجاح، ويوجد (${result.skippedRows.length}) سطر غير واضح. يمكنك حفظ الأصناف المقروءة فوراً أو مراجعة السطر غير الواضح أو إعادة رفع الورقة.`;
          setWarningAlert(warnMsg);
          setStatusMessage(warnMsg);
        } else {
          setSkippedRows([]);
          setWarningAlert(null);
          const missingCount = result.items.filter(
            (i) => i.is_missing === 1 || i.status === 'غير موجودة'
          ).length;
          setStatusMessage(
            `✅ اكتملت قراءة الورقة بنجاح 100%! (${result.items.length} صنف — منها ${missingCount} معلمة بـ × غير موجودة)`
          );
        }
      } else {
        setExtractedItems([]);
        setSkippedRows([]);
        playHighPitchWarningAlert();
        const errWarn =
          result.message ||
          '⚠️ لم يتم العثور على جدول واضح في هذه الصورة — يرجى الضغط على "تدوير 90° ↺" أو إعادة تصوير/رفع الورقة بوضوح.';
        setWarningAlert(errWarn);
        setStatusMessage(errWarn);
      }
    } catch (err) {
      console.error('Error processing image:', err);
      playHighPitchWarningAlert();
      const errWarn =
        '⚠️ حدث خطأ أثناء قراءة الورقة — يرجى إعادة رفع أو تصوير الورقة مرة أخرى.';
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
    setStatusMessage('⚡ جاري تدوير الورقة 90° وإعادة قراءة كامل الأصناف...');
    try {
      const newlyRotated = await rotateImageDegrees(lastImage, 270);
      setLastImage(newlyRotated);
      const result = await parseTableWithGeminiVision(newlyRotated);

      if (result.items && result.items.length > 0) {
        setExtractedItems(result.items);
        setRepairedCount(result.repairedCount || 0);
        if (result.skippedRows && result.skippedRows.length > 0) {
          setSkippedRows(result.skippedRows);
          const warnMsg = `⚠️ تم استخراج (${result.items.length}) صنف ويوجد (${result.skippedRows.length}) سطر غير واضح.`;
          setWarningAlert(warnMsg);
          setStatusMessage(warnMsg);
        } else {
          setSkippedRows([]);
          setWarningAlert(null);
          setStatusMessage(`✅ الورقة مكتملة القراءة 100% (${result.items.length} صنف)!`);
        }
      } else {
        const warnMsg =
          '⚠️ لم تظهر أسطر واضحة بعد التدوير — جرب الضغط على تدوير 90° مرة أخرى أو أعد رفع الورقة.';
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
   * التقاط صورة من الكاميرا بدون قص مربع (بدون فرض width/height متساويين يقصان أطراف الورقة في الأندرويد!)
   */
  const takePicture = async (source: CameraSource = CameraSource.Camera) => {
    try {
      const image = await CapCamera.getPhoto({
        quality: 90,
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
    canvas.width = videoRef.current.videoWidth || 1600;
    canvas.height = videoRef.current.videoHeight || 1200;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const rawDataUrl = canvas.toDataURL('image/jpeg', 0.88);
      stopCamera();
      await processImageDirectly(rawDataUrl);
    }
  };

  /**
   * قراءة ملف الصورة من الألبوم بنفس طريقة المحاكي تماماً (FileReader المباشر بدون تشويه أبعاد الصورة)
   */
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
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  /**
   * تبديل علامة (× غير موجودة / ✓ موجودة) لأي سطر بضغطة واحدة
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
   * حفظ كافة الأصناف الصحيحة المستخرجة من الورقة فوراً دون رفض تعسفي
   */
  const handleSaveToDatabase = async () => {
    const validToSave = extractedItems.filter(
      (item) =>
        strict10DigitRegexFilter(item.part_number) &&
        isValidSpecificLocation(item.location_code)
    );
    if (validToSave.length === 0) {
      playHighPitchWarningAlert();
      return;
    }
    setIsProcessing(true);
    await onSaveItems(validToSave);
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
    setWarningAlert(null);
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
                  الماسح الذكي لأوراق الجرد (مدعوم بالخوارزميات المساعدة)
                </h2>
                <p className="text-[10px] text-amber-300/90">
                  قراءة كامل الورقة بأي عدد أصناف + ترميم الـ 10 أرقام + استنتاج الموقع السياقي + تمييز مرن لـ (✓ / ×)
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

              {/* استخدام نفس قارئ الملفات المباشر المطابق للمحاكي 100% في الأندرويد والويب لمنع تشويه أو قص الصور */}
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

            {/* زر رفع وحفظ الورقة: متاح دائماً لحفظ كافة الأصناف الصحيحة المستخرجة من الورقة */}
            <button
              onClick={handleSaveToDatabase}
              disabled={extractedItems.length === 0 || isProcessing}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 shadow-lg transition-all ${
                extractedItems.length > 0 && !isProcessing
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/50 cursor-pointer active:scale-95'
                  : 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700'
              }`}
            >
              <Save className="w-4 h-4" />
              <span>
                {extractedItems.length > 0
                  ? `رفع وحفظ الورقة (${extractedItems.length} صنف)`
                  : 'رفع الورقة لقاعدة البيانات'}
              </span>
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
                    تأكد من ظهور زوايا الورقة وكافة الأسطر بوضوح
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
                <span className="text-amber-400 font-mono text-[11px] font-bold">Fast Assistive Vision</span>
              </div>
            )}

            {/* شريط التنبيه الذكي عند وجود أسطر غير واضحة */}
            {!isProcessing && warningAlert && (
              <div className="p-3.5 rounded-xl bg-amber-950/90 border border-amber-500/80 text-amber-100 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-black text-xs sm:text-sm text-amber-200">
                      تنبيه فحص الورقة الميداني
                    </div>
                    <p className="text-xs text-amber-200/90 mt-0.5 leading-relaxed">
                      {warningAlert}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 self-end sm:self-center shrink-0">
                  <button
                    type="button"
                    onClick={handleReuploadSheet}
                    className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#FF6D00] to-[#E65100] hover:from-[#FF8500] hover:to-[#F57C00] text-white font-black text-xs flex items-center gap-1.5 shadow cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>إعادة رفع الورقة</span>
                  </button>
                  {skippedRows.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsSkippedModalOpen(true)}
                        className="px-3 py-1.5 rounded-xl bg-amber-800 hover:bg-amber-700 text-white font-bold text-xs flex items-center gap-1 cursor-pointer border border-amber-400/50"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>تصحيح ({skippedRows.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDismissAllSkipped}
                        className="px-3 py-1.5 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-emerald-100 font-bold text-xs flex items-center gap-1 cursor-pointer border border-emerald-500/50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>اعتماد الأصناف المقروءة ({extractedItems.length})</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* شريط إحصائيات الورقة المقروءة */}
            {!isProcessing && extractedItems.length > 0 && (
              <div className="p-3 rounded-xl border bg-emerald-950/60 border-emerald-600/60 text-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2.5 font-bold">
                  <span className="flex items-center gap-1.5 text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    الأصناف المستخرجة: ({extractedItems.length} صنف)
                  </span>

                  <span className="px-2 py-0.5 rounded-md bg-black/40 text-emerald-300 border border-emerald-700/50">
                    ✓ موجودة: {sheetValidation.presentItemsCount}
                  </span>

                  <span className="px-2 py-0.5 rounded-md bg-red-950 text-red-300 border border-red-600/60 font-black">
                    × غير موجودة: {sheetValidation.missingItemsCount}
                  </span>

                  <span className="px-2 py-0.5 rounded-md bg-amber-950/80 text-amber-300 border border-amber-700/50">
                    المواقع الفعلية: {sheetValidation.uniqueLocationsCount} موقع
                  </span>

                  {repairedCount > 0 && (
                    <span className="px-2 py-0.5 rounded-md bg-orange-950/90 text-amber-200 border border-amber-500/50 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      تم تصحيح {repairedCount} رقم تلقائياً بالخوارزميات المساعدة
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleReuploadSheet}
                  className="px-3 py-1.5 rounded-lg bg-[#2D1B15] hover:bg-[#40271E] text-amber-300 border border-amber-500/40 font-bold text-xs flex items-center gap-1.5 self-end sm:self-auto cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>ورقة أخرى</span>
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
                    جاهز لقراءة كامل الورقة بأي عدد من الأصناف (مدعوم بالخوارزميات المساعدة)
                  </h3>
                  <p className="text-xs text-neutral-400 max-w-md mx-auto leading-relaxed">
                    اضغط على <span className="text-amber-400 font-bold">التقاط من الكاميرا</span> أو{' '}
                    <span className="text-amber-400 font-bold">رفع الورقة من الألبوم</span> لقراءة جميع الأصناف في الورقة بسرعة فائقة مع التصحيح التلقائي للأرقام الـ 10 والمواقع وعلامات <span className="text-emerald-400 font-bold">(✓)</span> و <span className="text-red-400 font-bold">(×)</span>.
                  </p>
                </div>
              )
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-[#231713] border-t border-[#3D271F] flex items-center justify-between text-xs">
            <span className="text-[11px] text-neutral-400">
              {extractedItems.length > 0
                ? `✅ جاهز لحفظ (${extractedItems.length}) صنف من الورقة في قاعدة البيانات`
                : 'خوارزميات القراءة المساعدة نشطة: قراءة سريعة ودقيقة لكافة أوراق الجرد'}
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
