// قاموس المصطلحات الفنية الشامل لقطع الغيار الصناعية (ASMO SAP Inventory Controller)
const TERM_TRANSLATIONS: Record<string, string> = {
  // مسامير وروابط وتثبيت
  'HEXAGON HEAD BOLT': 'مسمار رأس سداسي',
  'LOCKING BOLT': 'مسمار قفل وتثبيت',
  'BOLT EXPANSION': 'مسمار تمدد (أنكر)',
  'HILTI ANCHOR': 'مسمار تثبيت هيلتي',
  'STUD BOLT': 'مسمار ربط مسنن (ستد بولت)',
  'THREADED ROD': 'عمود مسنن (ثريدد رود)',
  'HEX NUT': 'صامولة سداسية',
  'LOCK NUT': 'صامولة قفل',
  'WASHER LOCK': 'وردة زنق/قفل',
  'FLAT WASHER': 'وردة مسطحة',
  'SPRING WASHER': 'وردة سوستة',
  'BOLT': 'مسمار/برغي',
  'SCREW': 'برغي',
  'NUT': 'صامولة',
  'HEX': 'سداسي',
  'WASHER': 'وردة/حلقة معدنية',
  'ANCHOR': 'مرساة تثبيت/أنكر',
  'STAINLESS STEEL': 'فولاذ مقاوم للصدأ (ستانلس)',
  'CARBON STEEL': 'صلب كربوني',
  'STEEL': 'صلب/حديد',
  'STAINLESS': 'ستانلس ستيل',
  'GALVANIZED': 'مجلفن',
  'BRASS': 'نحاس أصفر',
  'COPPER': 'نحاس',

  // أوجه إحكام وجازكيت وموانع تسرب
  'GASKET SPIRAL WOUND': 'جازكيت حلزوني مدعم',
  'GASKET METAL GROOVED': 'جازكيت معدني مخدد',
  'MECHANICAL SEAL': 'مانع تسرب ميكانيكي (ميكانيكال سيل)',
  'OIL SEAL': 'مانع تسرب زيت (أويل سيل)',
  'GASKET': 'جازكيت/وجه إحكام',
  'SPIRAL WOUND': 'حلزوني مدعم',
  'O-RING': 'حلقة دائرية (أورينج)',
  'SEAL': 'مانع تسرب/سيل',
  'PACKING': 'حشوة إحكام',
  'PTFE': 'تفلون مقاوم للحرارة',
  'VITON': 'فيتون حراري',
  'RUBBER': 'مطاط صناعي',

  // إضاءة وكهرباء ولوحات تحكم
  'LAMP FLUORESCENT': 'لمبة فلورسنت',
  'CIRCUIT BREAKER': 'قاطع تيار كهربائي',
  'PRESSURE SWITCH': 'مفتاح ضغط',
  'LIMIT SWITCH': 'مفتاح نهاية شوط',
  'CABLE GLAND': 'جلبة كابل كهربائي',
  'CONTACTOR': 'كونتاكتور كهربائي',
  'THERMOCOUPLE': 'حساس حرارة (ثرموكبل)',
  'LAMP': 'لمبة/مصباح',
  'LIGHT': 'إضاءة/كشاف',
  'BULB': 'لمبة',
  'FLUORESCENT': 'فلورسنت',
  'LED': 'ليد عالي الكفاءة',
  'BALLAST': 'ترانس/بادئ تشغيل',
  'FLOODLIGHT': 'كشاف غامر',
  'RELAY': 'ريلاي/مرحل كهربائي',
  'FUSE': 'فيوز/مصهر حماية',
  'SWITCH': 'مفتاح تشغيل',
  'SENSOR': 'حساس إلكتروني',
  'CABLE': 'كابل',

  // صمامات ومحابس وتوصيلات أنابيب
  '3 WAY BALL VALVE': 'محبس كروي ثلاثي الاتجاه',
  'VALVE BALL': 'صمام كروي (محبس)',
  'BALL VALVE': 'محبس كروي',
  'GATE VALVE': 'محبس بوابة',
  'CHECK VALVE': 'صمام عدم رجوع (رداد)',
  'GLOBE VALVE': 'صمام قفاز (جلوب)',
  'BUTTERFLY VALVE': 'صمام فراشة',
  'SAFETY VALVE': 'صمام أمان',
  'SOLENOID VALVE': 'صمام كهربائي (سولينويد)',
  'VALVE': 'صمام/محبس',
  'CONNECTOR FEMALE': 'وصلة ربط أنثى',
  'CONNECTOR MALE': 'وصلة ربط ذكر',
  'CONNECTOR': 'وصلة ربط/كونكتور',
  'ELBOW 90 DEGREE': 'كوع زاوية 90 درجة',
  'ELBOW 45 DEGREE': 'كوع زاوية 45 درجة',
  'ELBOW': 'كوع توصيل',
  'FLANGE': 'فلنجة/شفة ربط',
  'PIPE': 'أنبوب/ماسورة',
  'TUBE': 'أنبوب دقيق/تيوب',
  'FITTING': 'وصلة مواسير',
  'TEE': 'مشترك ثلاثي (تي)',
  'NIPPLE': 'نيبل توصيل',
  'REDUCER': 'نقاص مواسير',
  'UNION': 'لاكور تجميع',
  'PLUG': 'طبة سد/بلج',
  'BUSHING': 'جلبة سن',

  // فلاتر ومصافي
  'FILTER ELEMENT': 'عنصر ترشيح/خرطوشة فلتر',
  'FILTER': 'مرشح/فلتر',
  'STRAINER': 'مصفاة خطية',
  'CARTRIDGE': 'خرطوشة',

  // مضخات، محامل، وقطع ميكانيكية
  'BALL BEARING': 'رولمان بلي كروي',
  'ROLLER BEARING': 'محمل أسطواني (رولمان بلي)',
  'ADAPTER SLEEVE': 'جلبة تثبيت رولمان بلي (أدابتر سليف)',
  'SLEEVE SHAFT': 'جلبة عمود دوران (سليف شافت)',
  'RING WEAR': 'حلقة تآكل حماية (رينج وير)',
  'WEAR RING': 'حلقة تآكل حماية',
  'RING, RETAINING': 'حلقة تثبيت وإحكام',
  'RING, SEAT': 'حلقة مقعد صمام',
  'RING, SEAL': 'حلقة مانع تسرب',
  'SEAT VALVE': 'مقعد صمام (سيت فالف)',
  'TIE, CABLE': 'رباط كابل (تاي كابل)',
  'TIE CABLE': 'رباط كابل (تاي كابل)',
  'COVER PLATE': 'لوحة غطاء معدني',
  'INTERMEDIATE PIECE': 'قطعة وسيطة ميكانيكية',
  'BEARING': 'رولمان بلي/محمل',
  'PUMP': 'مضخة',
  'IMPELLER': 'دافع مضخة (إمبلر)',
  'SHAFT': 'عمود دوران (شافت)',
  'SLEEVE': 'جلبة قميص (سليف)',
  'SPACER': 'فاصل معدني/سبيسر',
  'RETAINER': 'حافظ/مثبت ميكانيكي',
  'LABYRINTH': 'مانع تسرب متاهي (لابيرنث)',
  'DEFLECTOR': 'حارف/موجه حماية',
  'MEMBRANE': 'غشاء ترشيح (ممبرين)',
  'REGULATOR': 'منظم ضغط/تدفق',
  'IGNITER': 'مشعل شرارة (إجنيتر)',
  'GLOVES': 'قفازات وقاية صناعية',
  'INSULATOR': 'عازل كهربائي/حراري',
  'TRANSMITTER': 'مرسل قياس (ترانسميتر)',
  'BELLOWS': 'منفاخ تمدد معدني (بيلوز)',
  'COUPLING': 'قارنة ربط (كوبلنج)',
  'PRESSURE GAUGE': 'مقياس ضغط (مانومتر)',
  'TEMPERATURE GAUGE': 'مقياس حرارة',
  'GAUGE': 'عداد قياس',
  'HOSE': 'خرطوم ضغط',
  'BELT': 'سير نقل حركة',
  'CHAIN': 'جنزير/سلسلة',
  'SPRING': 'ياي/سوستة',
  'RING': 'حلقة معدنية (رينج)',
  'HOLDER': 'حامل تثبيت',
  'TAPE': 'شريط عزل/لاصق',
  'DISPLAY': 'شاشة عرض رقمية',
  'INDICATOR': 'مؤشر بيان',
};

// ذاكرة تخزين مؤقت دائمة للترجمة والتصنيف (One-Time Processing Cache)
const TRANSLATION_CACHE = new Map<string, { category: string; descAr: string }>();

export function categorizeAndTranslate(descEn: string): { category: string; descAr: string } {
  const normalizedKey = (descEn || '').trim().toUpperCase();
  if (TRANSLATION_CACHE.has(normalizedKey)) {
    return TRANSLATION_CACHE.get(normalizedKey)!;
  }

  const upper = normalizedKey;

  let category = 'قطع ميكانيكية متنوعة';
  if (
    upper.includes('BOLT') ||
    upper.includes('SCREW') ||
    upper.includes('NUT') ||
    upper.includes('WASHER') ||
    upper.includes('ANCHOR') ||
    upper.includes('THREADED ROD') ||
    upper.includes('STUD')
  ) {
    category = 'مسامير وروابط';
  } else if (
    upper.includes('LAMP') ||
    upper.includes('LIGHT') ||
    upper.includes('BULB') ||
    upper.includes('LED') ||
    upper.includes('FLUORESCENT') ||
    upper.includes('BREAKER') ||
    upper.includes('CONTACTOR') ||
    upper.includes('RELAY') ||
    upper.includes('FUSE') ||
    upper.includes('CABLE') ||
    upper.includes('SWITCH') ||
    upper.includes('SENSOR') ||
    upper.includes('THERMOCOUPLE')
  ) {
    category = 'كهرباء وإضاءة';
  } else if (
    upper.includes('GASKET') ||
    upper.includes('O-RING') ||
    upper.includes('SEAL') ||
    upper.includes('PACKING')
  ) {
    category = 'جازكيت وموانع تسرب';
  } else if (upper.includes('VALVE')) {
    category = 'صمامات ومحابس';
  } else if (upper.includes('FILTER') || upper.includes('STRAINER')) {
    category = 'فلاتر ومصافي';
  } else if (upper.includes('BEARING') || upper.includes('SLEEVE')) {
    category = 'رولمان بلي ومحامل';
  } else if (upper.includes('GAUGE')) {
    category = 'أجهزة قياس';
  } else if (
    upper.includes('FLANGE') ||
    upper.includes('PIPE') ||
    upper.includes('ELBOW') ||
    upper.includes('CONNECTOR') ||
    upper.includes('PLUG') ||
    upper.includes('TEE') ||
    upper.includes('NIPPLE') ||
    upper.includes('TUBE') ||
    upper.includes('FITTING')
  ) {
    category = 'أنابيب ووصلات';
  } else if (
    upper.includes('PUMP') ||
    upper.includes('IMPELLER') ||
    upper.includes('COVER PLATE') ||
    upper.includes('INTERMEDIATE PIECE') ||
    upper.includes('COUPLING') ||
    upper.includes('SHAFT')
  ) {
    category = 'مضخات وقطع ميكانيكية';
  }

  let descAr = descEn;
  const sortedTerms = Object.keys(TERM_TRANSLATIONS).sort((a, b) => b.length - a.length);

  for (const enWord of sortedTerms) {
    const arWord = TERM_TRANSLATIONS[enWord];
    const regex = new RegExp(`\\b${enWord}\\b`, 'gi');
    descAr = descAr.replace(regex, arWord);
  }

  const result = { category, descAr };
  TRANSLATION_CACHE.set(normalizedKey, result);
  return result;
}
