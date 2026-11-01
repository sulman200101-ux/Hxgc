import React, { useEffect, useMemo, useState } from 'react';
import type { InventoryItem } from '../types';
import { dbService } from '../services/db';
import {
  analyzePartsWithGeminiAssistant,
  computeLocalPartEngineeringAnalysis,
  type GeminiPartAnalysis,
} from '../services/transferSuggestions';
import {
  Sparkles,
  Scale,
  Ruler,
  Languages,
  MapPin,
  ArrowRightLeft,
  CheckCircle2,
  Loader2,
  Search,
} from 'lucide-react';

interface GeminiEngineeringAssistantPanelProps {
  items: InventoryItem[];
  onRefresh: () => void;
  onMoveItemToShelf: (partNumber: string, targetBin: string) => Promise<void>;
}

export const GeminiEngineeringAssistantPanel: React.FC<GeminiEngineeringAssistantPanelProps> = ({
  items,
  onRefresh,
  onMoveItemToShelf,
}) => {
  const [analysesMap, setAnalysesMap] = useState<Record<string, GeminiPartAnalysis>>({});
  const [isAnalyzingAi, setIsAnalyzingAi] = useState(false);
  const [isUpdatingTranslations, setIsUpdatingTranslations] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'mismatch' | 'heavy' | 'medium' | 'light'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // حاسبة ومترجم جمني الفوري لأي وصف أو مقاس يدوي
  const [customDescEn, setCustomDescEn] = useState('');
  const [customAisle, setCustomAisle] = useState('N11A1');
  const [customQty, setCustomQty] = useState(1);
  const [customAnalysis, setCustomAnalysis] = useState<GeminiPartAnalysis | null>(null);
  const [isCustomLoading, setIsCustomLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // حساب فوري لكافة القطع عبر المحرك الهندسي المحلي ثم تحديثها بـ Gemini AI عند الطلب
  const allAnalyses = useMemo(() => {
    return items.map((item) => {
      if (analysesMap[item.part_number]) {
        return analysesMap[item.part_number];
      }
      return computeLocalPartEngineeringAnalysis(item);
    });
  }, [items, analysesMap]);

  // تشغيل تحليل Gemini AI التلقائي عند توفر قطع في المخزون
  const handleRunGeminiBatchAnalysis = async () => {
    if (items.length === 0) return;
    setIsAnalyzingAi(true);
    setFeedbackMsg(null);
    try {
      const results = await analyzePartsWithGeminiAssistant(items);
      const nextMap: Record<string, GeminiPartAnalysis> = {};
      for (const r of results) {
        nextMap[r.part_number] = r;
      }
      setAnalysesMap(nextMap);
      setFeedbackMsg(
        `✅ اكتمل تحليل مساعد جمني الذكي لعدد (${results.length}) قطعة: تم تدقيق الترجمة العربية وحسبة المقاسات بالملم/البوصة وتقدير الأوزان والأرفف المناسبة!`
      );
    } catch (err) {
      setFeedbackMsg(`⚠️ ${(err as Error).message}`);
    } finally {
      setIsAnalyzingAi(false);
    }
  };

  useEffect(() => {
    if (items.length > 0 && Object.keys(analysesMap).length === 0) {
      handleRunGeminiBatchAnalysis();
    }
  }, [items.length]);

  // حفظ وتحديث الترجمات العربية الدقيقة في قاعدة البيانات لجميع القطع
  const handleSaveAllTranslationsToDb = async () => {
    if (items.length === 0) return;
    setIsUpdatingTranslations(true);
    try {
      let updatedCount = 0;
      for (const item of items) {
        const analysis = analysesMap[item.part_number] || computeLocalPartEngineeringAnalysis(item);
        if (analysis.description_ar && analysis.description_ar !== item.description_ar) {
          await dbService.insertOrUpdateItem(
            item.part_number,
            item.location_code,
            item.description_en,
            item.qty_total,
            item.qty_out,
            item.status,
            analysis.description_ar,
            item.is_missing
          );
          updatedCount++;
        }
      }
      onRefresh();
      setFeedbackMsg(
        updatedCount > 0
          ? `✅ تم تحديث وحفظ الترجمة العربية الصحيحة لعدد (${updatedCount}) قطعة في المخزون!`
          : '✅ جميع الترجمات العربية في المخزون محدثة ومعتمدة بالفعل!'
      );
    } finally {
      setIsUpdatingTranslations(false);
    }
  };

  // تحليل نص أو مقاس يكتبه المستخدم مباشرة في مختبر جمني
  const handleAnalyzeCustomInput = async () => {
    if (!customDescEn.trim()) return;
    setIsCustomLoading(true);
    try {
      const results = await analyzePartsWithGeminiAssistant([
        {
          part_number: 'CUSTOM-CALC',
          description_en: customDescEn.trim(),
          location_code: customAisle.trim().toUpperCase() || 'N11A1',
          qty_remaining: Math.max(1, customQty),
        },
      ]);
      if (results.length > 0) {
        setCustomAnalysis(results[0]);
      }
    } finally {
      setIsCustomLoading(false);
    }
  };

  const filteredAnalyses = useMemo(() => {
    return allAnalyses.filter((a) => {
      if (filterMode === 'mismatch' && a.current_bin === a.recommended_bin) return false;
      if (filterMode === 'heavy' && a.size_category !== 'كبير / ثقيل') return false;
      if (filterMode === 'medium' && a.size_category !== 'متوسط الحجم') return false;
      if (filterMode === 'light' && a.size_category !== 'صغير / خفيف') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          a.part_number.toLowerCase().includes(q) ||
          a.description_ar.toLowerCase().includes(q) ||
          a.description_en.toLowerCase().includes(q) ||
          a.current_bin.toLowerCase().includes(q) ||
          a.recommended_bin.toLowerCase().includes(q) ||
          a.dimensions_calculation_ar.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allAnalyses, filterMode, searchQuery]);

  const mismatchCount = useMemo(
    () => allAnalyses.filter((a) => a.current_bin !== a.recommended_bin).length,
    [allAnalyses]
  );

  return (
    <div className="bg-[#211510] border-2 border-amber-500/60 rounded-2xl p-4 space-y-4 shadow-xl" dir="rtl">
      {/* رأس مساعد جمني للترجمة وحسبة المقاسات والأماكن المناسبة */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#3D271F] pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500/30 to-emerald-500/20 border border-amber-400/60 flex items-center justify-center text-amber-300 shadow-inner">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-black text-white">
                مساعد جمني الذكي (Gemini AI) للترجمة وحسبة المقاسات والأماكن المناسبة للحجم والوزن
              </h3>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/60 text-[11px] font-black">
                FL=0م | A=1م | B=2م | BB=3م | C=4م | D=5م
              </span>
            </div>
            <p className="text-xs text-neutral-300 mt-0.5">
              يقرأ الوصف الإنجليزي، يترجمه للعربية بدقة، يحسب المقاسات (بوصة ⬅ ملم وسم)، يقدر الوزن بالكيلوجرام، ويحدد الرف الأنسب لوزن وحجم كل قطعة
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={isAnalyzingAi || items.length === 0}
            onClick={handleRunGeminiBatchAnalysis}
            className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            {isAnalyzingAi ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>تحليل شامل عبر جمني للمقاسات والأوزان ✨</span>
          </button>

          <button
            type="button"
            disabled={isUpdatingTranslations || items.length === 0}
            onClick={handleSaveAllTranslationsToDb}
            className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <Languages className="w-4 h-4" />
            <span>اعتماد وحفظ الترجمات الصحيحة في المخزون ✓</span>
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div className="p-3 rounded-xl bg-emerald-950/90 border border-emerald-500/70 text-emerald-200 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* 1. مختبر وحاسبة جمني الفورية لأي وصف أو مقاس */}
      <div className="bg-[#180F0C] border border-[#3E2820] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-xs sm:text-sm font-black text-amber-300 flex items-center gap-1.5">
            <Ruler className="w-4 h-4 text-amber-400" />
            <span>حاسبة ومترجم جمني الفوري (اكتب أو الصق أي وصف قطعة أو مقاس لحساب وزنه والرف المناسب له):</span>
          </h4>
          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
            <span className="text-neutral-400">أمثلة سريعة:</span>
            {[
              {
                label: 'حلقة تآكل 215MM',
                text: 'RING WEAR, CASING, 215 MM OD, 185 MM ID, 25 MM THK, ASTM A276 TYPE 316',
                loc: 'N11D1',
              },
              {
                label: 'دعامة مواسير 3/4 بوصة',
                text: 'SUPPORT: RIGID CONDUIT; 3/4 IN; STEEL',
                loc: 'N12A1',
              },
              {
                label: 'أورينج مشغل 50 بوصة²',
                text: 'O-RING: YOKE; FOR 50 SQ IN ACTUATOR, NITRILE',
                loc: 'N11FL1',
              },
            ].map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => {
                  setCustomDescEn(ex.text);
                  setCustomAisle(ex.loc);
                }}
                className="px-2 py-0.5 rounded bg-[#271914] hover:bg-[#38241C] text-amber-200 border border-[#4A3227] cursor-pointer"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
          <div className="md:col-span-6">
            <label className="block text-[11px] font-bold text-neutral-300 mb-1">
              الوصف الإنجليزي والمقاسات (Material Description):
            </label>
            <input
              type="text"
              dir="ltr"
              value={customDescEn}
              onChange={(e) => setCustomDescEn(e.target.value)}
              placeholder="مثال: RING WEAR, CASING, 215 MM OD, ASTM A276 TYPE 316 أو SUPPORT 3/4 IN STEEL"
              className="w-full px-3 py-2 rounded-xl bg-[#120B08] border border-[#4A3227] text-white text-xs font-mono focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-[11px] font-bold text-neutral-300 mb-1">
              الممر/الموقع الحالي:
            </label>
            <input
              type="text"
              dir="ltr"
              value={customAisle}
              onChange={(e) => setCustomAisle(e.target.value.toUpperCase())}
              placeholder="N11A1"
              className="w-full px-3 py-2 rounded-xl bg-[#120B08] border border-[#4A3227] text-amber-300 text-xs font-mono font-bold text-center"
            />
          </div>

          <div className="md:col-span-1">
            <label className="block text-[11px] font-bold text-neutral-300 mb-1">
              العدد:
            </label>
            <input
              type="number"
              min={1}
              value={customQty}
              onChange={(e) => setCustomQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full px-2 py-2 rounded-xl bg-[#120B08] border border-[#4A3227] text-white text-xs font-mono font-bold text-center"
            />
          </div>

          <div className="md:col-span-3">
            <button
              type="button"
              disabled={isCustomLoading || !customDescEn.trim()}
              onClick={handleAnalyzeCustomInput}
              className="w-full px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:opacity-40 text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
            >
              {isCustomLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>ترجمة وحسبة المقاس والرف ✨</span>
            </button>
          </div>
        </div>

        {/* نتيجة التحليل الفوري للقطعة المخصصة */}
        {customAnalysis && (
          <div className="p-3.5 rounded-xl bg-[#241712] border border-amber-500/50 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-[#180F0C] border border-[#3A271F] space-y-1">
              <div className="text-[11px] text-amber-400 font-bold flex items-center gap-1">
                <Languages className="w-3.5 h-3.5" />
                <span>الترجمة العربية الهندسية الصحيحة:</span>
              </div>
              <div className="font-black text-white text-sm">{customAnalysis.description_ar}</div>
              <div className="text-[11px] text-neutral-400">المعدن/المادة: {customAnalysis.material_ar}</div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#180F0C] border border-[#3A271F] space-y-1">
              <div className="text-[11px] text-sky-400 font-bold flex items-center gap-1">
                <Ruler className="w-3.5 h-3.5" />
                <span>حسبة المقاسات وتحويل الوحدات:</span>
              </div>
              <div className="font-bold text-sky-200">{customAnalysis.dimensions_calculation_ar}</div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#180F0C] border border-[#3A271F] space-y-1">
              <div className="text-[11px] text-orange-400 font-bold flex items-center gap-1">
                <Scale className="w-3.5 h-3.5" />
                <span>تقدير الحجم والوزن التقريبي:</span>
              </div>
              <div className="font-black text-orange-200">{customAnalysis.size_category}</div>
              <div className="text-[11px] text-neutral-300">{customAnalysis.weight_label_ar}</div>
            </div>

            <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/50 space-y-1">
              <div className="text-[11px] text-emerald-300 font-bold flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                <span>المكان والرف المناسب للحجم والوزن:</span>
              </div>
              <div className="font-mono font-black text-emerald-300 text-sm">
                {customAnalysis.recommended_bin} — {customAnalysis.recommended_elevation.shortLabelAr}
              </div>
              <div className="text-[11px] text-neutral-200">{customAnalysis.placement_reason_ar}</div>
            </div>
          </div>
        )}
      </div>

      {/* 2. جدول وبطاقات تحليل جميع قطع المخزون (الترجمة + حسبة المقاسات + الوزن + المكان المناسب) */}
      {items.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1.5 rounded-xl font-bold border cursor-pointer ${
                  filterMode === 'all'
                    ? 'bg-amber-600 text-white border-amber-400'
                    : 'bg-[#180F0C] text-neutral-300 border-[#3A271F]'
                }`}
              >
                كافة القطع ({allAnalyses.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('mismatch')}
                className={`px-3 py-1.5 rounded-xl font-bold border cursor-pointer ${
                  filterMode === 'mismatch'
                    ? 'bg-emerald-600 text-white border-emerald-400'
                    : 'bg-[#180F0C] text-emerald-300 border-emerald-700/50'
                }`}
              >
                ينصح بنقلها لرف يناسب حجمها ووزنها ({mismatchCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('heavy')}
                className={`px-3 py-1.5 rounded-xl font-bold border cursor-pointer ${
                  filterMode === 'heavy'
                    ? 'bg-red-700 text-white border-red-400'
                    : 'bg-[#180F0C] text-red-300 border-red-800/50'
                }`}
              >
                كبير / ثقيل ⬅ FL الأرضي أو A=1م
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('medium')}
                className={`px-3 py-1.5 rounded-xl font-bold border cursor-pointer ${
                  filterMode === 'medium'
                    ? 'bg-sky-700 text-white border-sky-400'
                    : 'bg-[#180F0C] text-sky-300 border-sky-800/50'
                }`}
              >
                متوسط الحجم ⬅ B=2م أو BB=3م
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('light')}
                className={`px-3 py-1.5 rounded-xl font-bold border cursor-pointer ${
                  filterMode === 'light'
                    ? 'bg-purple-700 text-white border-purple-400'
                    : 'bg-[#180F0C] text-purple-300 border-purple-800/50'
                }`}
              >
                صغير / خفيف ⬅ C=4م أو D=5م
              </button>
            </div>

            <div className="relative min-w-[230px]">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث برقم القطعة أو المقاس أو الرف..."
                className="w-full pr-8 pl-3 py-1.5 rounded-xl bg-[#140C09] border border-[#3E2820] text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 max-h-[520px] overflow-y-auto pr-1">
            {filteredAnalyses.map((row, idx) => {
              const needsHeightMove = row.current_bin !== row.recommended_bin;
              return (
                <div
                  key={`${row.part_number}-${idx}`}
                  className={`p-3 rounded-xl border transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs ${
                    needsHeightMove
                      ? 'bg-[#1B120E] border-amber-600/60 hover:border-amber-400'
                      : 'bg-[#170F0C] border-[#35231C]'
                  }`}
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-black text-amber-300 bg-[#120B08] px-2.5 py-0.5 rounded border border-amber-700/50">
                        {row.part_number}
                      </span>
                      <span className="font-black text-white text-sm">
                        {row.description_ar}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded font-bold text-[11px] border ${
                          row.size_category === 'كبير / ثقيل'
                            ? 'bg-red-950/90 text-red-200 border-red-500/60'
                            : row.size_category === 'متوسط الحجم'
                            ? 'bg-sky-950/90 text-sky-200 border-sky-500/60'
                            : 'bg-purple-950/90 text-purple-200 border-purple-500/60'
                        }`}
                      >
                        {row.size_category}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-stone-900 text-neutral-300 border border-stone-700 text-[11px]">
                        المعدن: {row.material_ar}
                      </span>
                    </div>

                    <div className="text-[11px] text-neutral-400 font-mono" dir="ltr">
                      {row.description_en}
                    </div>

                    {/* تفاصيل حسبة المقاسات والوزن */}
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <span className="px-2.5 py-1 rounded-lg bg-[#241813] border border-sky-700/40 text-sky-200 font-bold flex items-center gap-1">
                        <Ruler className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span>حسبة المقاس: {row.dimensions_calculation_ar}</span>
                      </span>

                      <span className="px-2.5 py-1 rounded-lg bg-[#241813] border border-orange-700/40 text-orange-200 font-bold flex items-center gap-1">
                        <Scale className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                        <span>الوزن المقدر: {row.weight_label_ar}</span>
                      </span>
                    </div>

                    <div className="text-[11px] text-emerald-300 font-bold">
                      💡 توصية جمني للمكان والارتفاع: {row.placement_reason_ar}
                    </div>
                  </div>

                  {/* مقارنة الرف الحالي بالرف المقترح وزر النقل */}
                  <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-center gap-2 shrink-0 min-w-[230px]">
                    <div className="flex items-center gap-1.5 text-[11px] font-mono bg-[#120B08] px-2.5 py-1.5 rounded-lg border border-[#38241C]">
                      <span className="text-neutral-400 font-sans">الحالي:</span>
                      <strong className="text-amber-300">{row.current_bin}</strong>
                      <span className="text-neutral-400 font-sans">
                        ({row.current_elevation.meters === 0 ? 'أرضي 0م' : `${row.current_elevation.meters}م`})
                      </span>
                      <span>⬅</span>
                      <span className="text-neutral-400 font-sans">الأنسب:</span>
                      <strong className="text-emerald-400">{row.recommended_bin}</strong>
                      <span className="text-emerald-300 font-sans">
                        ({row.recommended_elevation.meters === 0 ? 'أرضي 0م' : `${row.recommended_elevation.meters}م`})
                      </span>
                    </div>

                    {needsHeightMove ? (
                      <button
                        type="button"
                        onClick={() => onMoveItemToShelf(row.part_number, row.recommended_bin)}
                        className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>
                          نقل للرف الأنسب ({row.recommended_bin} — {row.recommended_elevation.meters === 0 ? 'الأرض 0م' : `${row.recommended_elevation.meters}م`}) 🟢
                        </span>
                      </button>
                    ) : (
                      <span className="px-3 py-1 rounded-lg bg-emerald-950/60 text-emerald-300 border border-emerald-700/50 text-[11px] font-bold text-center">
                        ✓ في الرف والارتفاع المثالي لحجمها ووزنها
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
