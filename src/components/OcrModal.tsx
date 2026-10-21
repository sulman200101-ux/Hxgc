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
  Sparkles,
  Edit3,
  RotateCcw,
  XCircle,
  Lock,
  MapPin,
} from 'lucide-react';
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { ExtractedSparePart, parseSimulatedTableOcr } from '../services/localOcr';
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
  const [lastImage, setLastImage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

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
   * معالجة الصورة بسرعة فائقة واستخراج جدول جرد SAP بدقة
   */
  const processImageDirectly = async (rawDataUrl: string) => {
    setIsProcessing(true);
    setStatusMessage('⚡ جاري القراءة الفورية السريعة لجدول الجرد وفحص الأرقام الـ 10 والمواقع وعلامات (×)...');

    try {
      const calibratedUrl = await prepareImageForAi(rawDataUrl, {
        maxDimension: 1800,
        enhanceContrast: true,
      });
      setLastImage(calibratedUrl);

      const result = await parseTableWithGeminiVision(calibratedUrl);

      if (result.items && result.items.length > 0) {
        setExtractedItems(result.items);

        if (result.skippedRows && result.skippedRows.length > 0) {
          setSkippedRows(result.skippedRows);
          playHighPitchWarningAlert();
          setStatusMessage(
            `⛔ الورقة غير مكتملة القراءة: تم قراءة ${result.items.length} قطعة ويوجد ${result.skippedRows.length} سطر ناقص يجب إكماله أو حذفه قبل الرفع.`
          );
        } else {
          setSkippedRows([]);
          const missingCount = result.items.filter(
            (i) => i.is_missing === 1 || i.status === 'غير موجودة'
          ).length;
          setStatusMessage(
            `✅ الورقة مكتملة القراءة 100%! (${result.items.length} قطعة | منها ${missingCount} معلمة بـ × غير موجودة)`
          );
        }
      } else {
        setStatusMessage(
          '⚠️ لم يتم العثور على أسطر مكتملة في هذه اللقطة. اضغط على "تدوير 90° ↺" إذا كانت الورقة مصورة بشكل طولي.'
        );
      }
    } catch (err) {
      console.error('Error processing image:', err);
      setStatusMessage('حدث خطأ أثناء تحليل الورقة، يرجى إعادة المحاولة.');
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * تدوير يدوي سريع 90 درجة للأوراق المصورة طولياً
   */
  const handleQuickRotate = async () => {
    if (!lastImage || isProcessing) return;
    setIsProcessing(true);
    setStatusMessage('⚡ جاري تدوير الورقة 90° وإعادة القراءة السريعة...');
    try {
      const newlyRotated = await rotateImageDegrees(lastImage, 270);
      setLastImage(newlyRotated);
      const result = await parseTableWithGeminiVision(newlyRotated);

      if (result.items && result.items.length > 0) {
        setExtractedItems(result.items);
        if (result.skippedRows && result.skippedRows.length > 0) {
          setSkippedRows(result.skippedRows);
          playHighPitchWarningAlert();
          setStatusMessage(
            `⛔ تم استخراج ${result.items.length} قطعة ويوجد ${result.skippedRows.length} سطر ناقص يحتاج مراجعة.`
          );
        } else {
          setSkippedRows([]);
          setStatusMessage(`✅ الورقة مكتملة القراءة 100% (${result.items.length} قطعة)!`);
        }
      } else {
        setStatusMessage('لم يتم العثور على قطع بعد التدوير. جرب تدوير 90° مرة أخرى أو التقط صورة أوضح.');
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
   * فتح ألبوم الصور بسرعة فائقة (ضبط الأبعاد إلى 1800px لمنع بطء الذاكرة على الهاتف)
   */
  const pickFromGallery = async () => {
    try {
      const photo = await CapCamera.getPhoto({
        quality: 85,
        width: 1800,
        height: 1800,
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
   * التقاط صورة من الكاميرا بسرعة فائقة
   */
  const takePicture = async (source: CameraSource = CameraSource.Camera) => {
    try {
      const image = await CapCamera.getPhoto({
        quality: 85,
        width: 1800,
        height: 1800,
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
    canvas.width = videoRef.current.videoWidth || 1800;
    canvas.height = videoRef.current.videoHeight || 1200;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const rawDataUrl = canvas.toDataURL('image/jpeg', 0.86);
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
  };

  const handleRunSample = () => {
    setIsProcessing(true);
    setStatusMessage('⚡ جاري قراءة أوراق جرد أسمو (SAP Inventory Controller)...');
    setTimeout(() => {
      const sampleItems = parseSimulatedTableOcr();
      setExtractedItems(sampleItems);
      setSkippedRows([]);
      setIsProcessing(false);
      const missingCount = sampleItems.filter((i) => i.is_missing === 1).length;
      setStatusMessage(
        `✅ الورقة مكتملة القراءة 100%! (${sampleItems.length} قطعة — منها ${missingCount} قطعة معلمة بـ × غير موجودة)`
      );
    }, 150);
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
          {/* Header */}
          <div className="px-4 py-3 bg-[#231713] border-b border-[#3D271F] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-600/20 border border-amber-600/40 flex items-center justify-center text-amber-400">
                <Camera className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-white">
                  الفحص السريع لأوراق الجرد (SAP Inventory Controller)
                </h2>
                <p className="text-[10px] text-amber-300/80">
                  قراءة 10 أرقام كاملة (Material) + اسم الموقع الفعلي (Storage Bin) + رصد علامة (× غير موجودة)
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
                  className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg transition-transform active:scale-95 cursor-pointer"
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
                  className="px-4 py-2.5 rounded-xl bg-[#2D1B15] hover:bg-[#40271E] text-amber-200 border border-[#523428] font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <Upload className="w-4 h-4 text-amber-400" />
                  <span>ألبوم الصور ⚡</span>
                </button>
              ) : (
                <label className="px-4 py-2.5 rounded-xl bg-[#2D1B15] hover:bg-[#40271E] text-amber-200 border border-[#523428] font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors">
                  <Upload className="w-4 h-4 text-amber-400" />
                  <span>ألبوم الصور ⚡</span>
                  <input
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
                  className="px-3 py-2 rounded-xl bg-[#2D1B15] hover:bg-[#43271D] text-amber-300 border border-amber-600/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>تدوير 90° ↺</span>
                </button>
              )}

              <button
                onClick={handleRunSample}
                disabled={isProcessing}
                className="px-3 py-2 rounded-xl bg-[#261712] hover:bg-[#382119] text-neutral-300 text-xs font-bold flex items-center gap-1.5 border border-[#3D251C] cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>تحميل ورقة الجرد المرفقة</span>
              </button>
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
                  <span>رفع وحفظ الورقة المكتملة ({extractedItems.length})</span>
                </>
              ) : extractedItems.length > 0 ? (
                <>
                  <Lock className="w-4 h-4 text-red-300" />
                  <span>أكمل النواقص أولاً ({sheetValidation.totalIncomplete} سطر ناقص)</span>
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
                    وجه الكاميرا نحو جدول الجرد بوضوح
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Modal Body */}
          <div className="p-4 overflow-y-auto flex-1 space-y-3">
            {/* Status Bar */}
            {isProcessing && (
              <div className="bg-[#1C120E] p-3 rounded-xl border border-amber-600/40 flex items-center justify-between text-xs animate-pulse">
                <span className="text-amber-300 font-bold flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                  <span>{statusMessage}</span>
                </span>
                <span className="text-neutral-400 font-mono text-[11px]">Fast Vision Engine</span>
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
                      الورقة مكتملة القراءة 100% ({extractedItems.length} قطعة)
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-red-300">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      الورقة غير مكتملة: يوجد ({sheetValidation.totalIncomplete}) سطر ناقص يمنع رفع الورقة
                    </span>
                  )}

                  <span className="px-2 py-0.5 rounded-md bg-black/40 text-emerald-300 border border-emerald-700/50">
                    ✓ موجودة: {sheetValidation.presentItemsCount}
                  </span>

                  <span className="px-2 py-0.5 rounded-md bg-red-950 text-red-300 border border-red-600/60 font-black">
                    × غير موجودة: {sheetValidation.missingItemsCount}
                  </span>

                  <span className="px-2 py-0.5 rounded-md bg-amber-950/80 text-amber-300 border border-amber-700/50">
                    المواقع المحددة: {sheetValidation.uniqueLocationsCount} موقع
                  </span>
                </div>

                {skippedRows.length > 0 && (
                  <button
                    onClick={() => setIsSkippedModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs flex items-center gap-1.5 self-end sm:self-auto cursor-pointer shadow"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>إكمال أو حذف الأسطر الناقصة ({skippedRows.length})</span>
                  </button>
                )}
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
                            key={`${item.part_number}-${idx}`}
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
                <div className="py-14 px-4 text-center rounded-2xl bg-[#1C120E] border border-[#3E2820] space-y-2.5">
                  <div className="w-12 h-12 mx-auto rounded-full bg-[#2C1B14] flex items-center justify-center text-amber-500">
                    <Package className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-neutral-200">
                    جاهز للقراءة السريعة لأوراق الجرد (SAP Inventory Controller)
                  </h3>
                  <p className="text-xs text-neutral-400 max-w-md mx-auto leading-relaxed">
                    اضغط على <span className="text-amber-400 font-bold">التقاط من الكاميرا</span> أو{' '}
                    <span className="text-amber-400 font-bold">ألبوم الصور</span> لقراءة أرقام القطع الـ 10 ومواقعها الفعلية ورصد القطع المعلمة بـ <span className="text-red-400 font-bold">(× غير موجودة)</span> تلقائياً.
                  </p>
                </div>
              )
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-[#231713] border-t border-[#3D271F] flex items-center justify-between text-xs">
            <span className="text-[11px] text-neutral-400">
              {sheetValidation.isComplete
                ? `✅ الورقة مكتملة القراءة (${extractedItems.length} قطعة) وجاهزة للحفظ`
                : extractedItems.length > 0
                ? `⛔ أكمل مراجعة ${sheetValidation.totalIncomplete} سطر ناقص لتفعيل رفع الورقة`
                : 'لا يتم رفع الورقة إلا بعد اكتمال القراءة 100%'}
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
