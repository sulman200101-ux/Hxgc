import React, { useState } from 'react';
import { X, Check, MapPin } from 'lucide-react';

interface RenameLocationModalProps {
  isOpen: boolean;
  currentLocationCode: string;
  onClose: () => void;
  onConfirmRename: (oldCode: string, newCode: string) => Promise<void>;
}

export const RenameLocationModal: React.FC<RenameLocationModalProps> = ({
  isOpen,
  currentLocationCode,
  onClose,
  onConfirmRename,
}) => {
  const [newCode, setNewCode] = useState(currentLocationCode);
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    setNewCode(currentLocationCode);
  }, [currentLocationCode, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || newCode.trim() === currentLocationCode) {
      onClose();
      return;
    }
    setIsSubmitting(true);
    await onConfirmRename(currentLocationCode, newCode.trim().toUpperCase());
    setIsSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[#2C1E18] border border-[#52382D] w-full max-w-sm rounded-2xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-white text-sm">تعديل رمز الموقع</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg bg-[#3A271F] hover:bg-[#4D342A] text-neutral-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-neutral-300 mb-1">
              رمز الموقع الجديد (سيتنقل جميع القطع إليه تلقائياً)
            </label>
            <input
              type="text"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-xl bg-[#1F1511] border border-[#4A342B] text-amber-300 font-mono font-bold focus:outline-none focus:border-amber-500 text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl bg-[#3A271F] text-neutral-300 text-xs font-bold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>تأكيد التعديل</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
