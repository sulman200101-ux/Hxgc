import React, { useState, useEffect, useRef } from 'react';
import { 
  Trash2, 
  X, 
  ShieldAlert, 
  KeyRound, 
  Check, 
  AlertTriangle,
  RotateCcw
} from 'lucide-react';

interface WipeDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmWipe: () => Promise<void>;
  totalItemsCount: number;
  totalLocationsCount: number;
}

const PIN_STORAGE_KEY = 'asmo_wipe_secret_pin';

export const WipeDatabaseModal: React.FC<WipeDatabaseModalProps> = ({
  isOpen,
  onClose,
  onConfirmWipe,
  totalItemsCount,
  totalLocationsCount,
}) => {
  const [existingPin, setExistingPin] = useState<string | null>(null);
  const [isSettingUp, setIsSettingUp] = useState<boolean>(false);
  
  // 4 Digits state
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const [confirmDigits, setConfirmDigits] = useState<string[]>(['', '', '', '']);
  
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isWiping, setIsWiping] = useState<boolean>(false);
  const [isVerified, setIsVerified] = useState<boolean>(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (isOpen) {
      const stored = localStorage.getItem(PIN_STORAGE_KEY);
      setExistingPin(stored);
      setIsSettingUp(!stored);
      setDigits(['', '', '', '']);
      setConfirmDigits(['', '', '', '']);
      setErrorMessage('');
      setIsVerified(false);
      setIsWiping(false);

      // Focus first input
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 150);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDigitChange = (
    index: number, 
    value: string, 
    isConfirm: boolean = false
  ) => {
    const char = value.replace(/[^0-9]/g, '').slice(-1);
    const targetState = isConfirm ? [...confirmDigits] : [...digits];
    targetState[index] = char;
    
    if (isConfirm) {
      setConfirmDigits(targetState);
    } else {
      setDigits(targetState);
    }

    setErrorMessage('');

    // Auto advance
    if (char && index < 3) {
      const refs = isConfirm ? confirmInputRefs.current : inputRefs.current;
      refs[index + 1]?.focus();
    }

    // Auto verify if last digit entered
    if (char && index === 3) {
      const fullPin = targetState.join('');
      if (!isConfirm && !isSettingUp && existingPin) {
        if (fullPin === existingPin) {
          setIsVerified(true);
          setErrorMessage('');
        } else {
          setErrorMessage('الرمز السري غير صحيح، يرجى المحاولة مجدداً');
          // Reset digits
          setTimeout(() => {
            setDigits(['', '', '', '']);
            inputRefs.current[0]?.focus();
          }, 400);
        }
      }
    }
  };

  const handleKeyDown = (
    index: number, 
    e: React.KeyboardEvent<HTMLInputElement>,
    isConfirm: boolean = false
  ) => {
    if (e.key === 'Backspace') {
      const targetState = isConfirm ? confirmDigits : digits;
      if (!targetState[index] && index > 0) {
        const refs = isConfirm ? confirmInputRefs.current : inputRefs.current;
        refs[index - 1]?.focus();
      }
    }
  };

  const handleSaveInitialPin = () => {
    const pin = digits.join('');
    const confirm = confirmDigits.join('');

    if (pin.length !== 4) {
      setErrorMessage('يجب إدخال 4 أرقام كاملة');
      return;
    }

    if (pin !== confirm) {
      setErrorMessage('تأكيد الرمز السري غير متطابق');
      return;
    }

    localStorage.setItem(PIN_STORAGE_KEY, pin);
    setExistingPin(pin);
    setIsSettingUp(false);
    setIsVerified(true);
    setErrorMessage('');
  };

  const handleExecuteWipe = async () => {
    setIsWiping(true);
    try {
      await onConfirmWipe();
      onClose();
    } catch (err) {
      console.error('Wipe error:', err);
      setErrorMessage('حدث خطأ أثناء مسح البيانات');
    } finally {
      setIsWiping(false);
    }
  };

  const handleResetPin = () => {
    localStorage.removeItem(PIN_STORAGE_KEY);
    setExistingPin(null);
    setIsSettingUp(true);
    setIsVerified(false);
    setDigits(['', '', '', '']);
    setConfirmDigits(['', '', '', '']);
    setErrorMessage('');
    setTimeout(() => {
      inputRefs.current[0]?.focus();
    }, 100);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="bg-[#241712] border-2 border-red-600/60 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-5 py-4 bg-[#1B100C] border-b border-[#3D251C] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-950/70 border border-red-600/50 flex items-center justify-center text-red-400 shadow-inner">
              <Trash2 className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                مسح كافة بيانات البرنامج
              </h2>
              <p className="text-[11px] text-red-300/80">
                حماية بواسطة 4 أرقام سرية
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#301C15] hover:bg-[#43261C] text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          
          {/* Warning Banner */}
          <div className="p-3.5 rounded-xl bg-red-950/50 border border-red-600/50 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs text-red-200 space-y-1">
              <p className="font-bold text-red-100">
                تحذير نهائي لا يمكن التراجع عنه:
              </p>
              <p className="text-[11px] leading-relaxed text-red-200/90">
                سيتم مسح <span className="font-bold underline text-white font-mono">{totalItemsCount.toLocaleString()} قطعة</span> موزعة على <span className="font-bold underline text-white font-mono">{totalLocationsCount} موقع</span>، وتصفير قاعدة البيانات بالكامل.
              </p>
            </div>
          </div>

          {/* Setup Mode: First time 4-digit PIN */}
          {isSettingUp && (
            <div className="space-y-4 pt-1">
              <div className="text-center">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold">
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>تعيين رمز سري لمرة واحدة (4 أرقام)</span>
                </span>
                <p className="text-xs text-neutral-400 mt-2">
                  اختر رمزاً من 4 أرقام لحماية عمليات المسح المستقبلية:
                </p>
              </div>

              {/* Enter PIN */}
              <div>
                <label className="block text-[11px] text-neutral-400 mb-2 text-center font-bold">
                  الرمز السري الجديد:
                </label>
                <div className="flex justify-center gap-3 dir-ltr" dir="ltr">
                  {[0, 1, 2, 3].map((idx) => (
                    <input
                      key={idx}
                      ref={(el) => {
                        inputRefs.current[idx] = el;
                      }}
                      type="password"
                      inputMode="numeric"
                      maxLength={1}
                      value={digits[idx]}
                      onChange={(e) => handleDigitChange(idx, e.target.value, false)}
                      onKeyDown={(e) => handleKeyDown(idx, e, false)}
                      className="w-12 h-13 text-center text-xl font-bold bg-[#180E0B] border-2 border-[#4A2D22] focus:border-amber-500 rounded-xl text-white outline-none transition-all shadow-inner"
                    />
                  ))}
                </div>
              </div>

              {/* Confirm PIN */}
              <div>
                <label className="block text-[11px] text-neutral-400 mb-2 text-center font-bold">
                  تأكيد الرمز السري:
                </label>
                <div className="flex justify-center gap-3 dir-ltr" dir="ltr">
                  {[0, 1, 2, 3].map((idx) => (
                    <input
                      key={idx}
                      ref={(el) => {
                        confirmInputRefs.current[idx] = el;
                      }}
                      type="password"
                      inputMode="numeric"
                      maxLength={1}
                      value={confirmDigits[idx]}
                      onChange={(e) => handleDigitChange(idx, e.target.value, true)}
                      onKeyDown={(e) => handleKeyDown(idx, e, true)}
                      className="w-12 h-13 text-center text-xl font-bold bg-[#180E0B] border-2 border-[#4A2D22] focus:border-amber-500 rounded-xl text-white outline-none transition-all shadow-inner"
                    />
                  ))}
                </div>
              </div>

              <button
                onClick={handleSaveInitialPin}
                className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-lg transition-transform active:scale-98 cursor-pointer flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>حفظ الرمز السري والمتابعة</span>
              </button>
            </div>
          )}

          {/* Normal Mode: Enter established 4-digit PIN */}
          {!isSettingUp && !isVerified && (
            <div className="space-y-3 pt-1">
              <div className="text-center">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-950/40 border border-red-500/30 text-red-300 text-xs font-bold">
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>أدخل الرمز السري (4 أرقام) للتأكيد</span>
                </span>
              </div>

              <div className="flex justify-center gap-3 pt-2 dir-ltr" dir="ltr">
                {[0, 1, 2, 3].map((idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      inputRefs.current[idx] = el;
                    }}
                    type="password"
                    inputMode="numeric"
                    maxLength={1}
                    value={digits[idx]}
                    onChange={(e) => handleDigitChange(idx, e.target.value, false)}
                    onKeyDown={(e) => handleKeyDown(idx, e, false)}
                    className="w-12 h-14 text-center text-2xl font-bold bg-[#180E0B] border-2 border-[#523326] focus:border-red-500 rounded-xl text-white outline-none transition-all shadow-inner"
                  />
                ))}
              </div>

              <div className="flex justify-between items-center text-[11px] text-neutral-400 pt-2 px-1">
                <span>الرمز محمي لمرة واحدة</span>
                <button
                  type="button"
                  onClick={handleResetPin}
                  className="text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>إعادة تعيين الرمز</span>
                </button>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="p-2.5 rounded-xl bg-red-950/80 border border-red-500/80 text-xs text-red-200 font-bold flex items-center gap-2 justify-center animate-shake">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Verified: Final Destructive Confirmation Button */}
          {isVerified && (
            <div className="space-y-3 pt-2">
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-600/40 text-xs text-emerald-300 font-bold flex items-center justify-center gap-2">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>تم تأكيد الرمز السري بنجاح</span>
              </div>

              <button
                onClick={handleExecuteWipe}
                disabled={isWiping}
                className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 active:scale-98 text-white font-black text-sm shadow-xl shadow-red-950 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Trash2 className="w-5 h-5" />
                <span>{isWiping ? 'جاري تصفير قاعدة البيانات...' : 'تأكيد مسح كافة البيانات الآن (Wipe All)'}</span>
              </button>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#1B100C] border-t border-[#3D251C] flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">
            قطع الغيار - أسمو (ASMO)
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#2D1B15] hover:bg-[#3E251E] text-neutral-300 text-xs font-bold transition-colors cursor-pointer"
          >
            إلغاء
          </button>
        </div>

      </div>
    </div>
  );
};
