// قاموس المصطلحات الفنية الشامل والموسع لقطع الغيار الصناعية (ASMO SAP Inventory Controller)
const EXACT_PHRASE_TRANSLATIONS: Record<string, string> = {
  // العبارات المركبة الدقيقة لضمان ترجمة عربية هندسية سليمة 100%
  'RING WEAR, CASING': 'حلقة تآكل حماية غلاف المضخة (كيسنج)',
  'RING WEAR, IMPELLER': 'حلقة تآكل حماية دافع المضخة (إمبلر)',
  'SUPPORT: RIGID CONDUIT': 'حامل/دعامة مواسير كهرباء صلبة',
  'SLEEVE SHAFT': 'جلبة عمود دوران (سليف شافت)',
  'BUSHING PUMP, THROAT': 'جلبة عنق مضخة (ثروت بوشنج)',
  'BUSHING PUMP, THROATLE': 'جلبة خانق مضخة (ثروتل بوشنج)',
  'BUSHING PUMP, THROTTLE': 'جلبة خانق مضخة (ثروتل بوشنج)',
  'SPRING RELIEF VALVE': 'ياي/نابض صمام تصريف الضغط',
  'SCREW CAP, HEX': 'مسمار غطاء برأس سداسي',
  'BEARING, JOURNAL / THRUST': 'محمل انزلاقي ودفعي (جورنال/ثرست)',
  'PACKING, RING: PREFORMED': 'حشوة إحكام حلقية مشكلة مسبقاً',
  'FUSE, LOW VOLTAGE: HRC': 'فيوز/مصهر جهد منخفض عالي قدرة القطع HRC',
  'RING, BALL, CARBOGRAPHITE, UPPER': 'حلقة كروية علوية من الكربون الجرافيتي',
  'POWER SUPPLY ELECTRICAL, AC/DC': 'مزود طاقة كهربائي (باور سبلاي) متردد/مستمر',
  'GASKET, ROD': 'جازكيت/وجه إحكام عمود (رود)',
  'BEARING BALL': 'رولمان بلي كروي',
  'DEEP GROOVE': 'مجرى عميق',
  'ADAPTER: PACKING, FEMALE': 'وصلة مهايئ حشوة إحكام (أنثى)',
  'REGULATOR, FILTER, RELIEVING': 'منظم ومصفي ضغط هواء مع تصريف ذاتي',
  'RING, THROTTLE': 'حلقة خانق (ثروتل رينج)',
  'VALVE, SCALD PROTECTION: THERMOSTATIC': 'صمام حماية من الحرارة الزائدة (ثرموستاتي)',
  'VALVE, SCALD PROTECTION': 'صمام حماية من الحرارة الزائدة',
  'RETAINER, BALANCE SEAL': 'حافظ/مثبت مانع تسرب التوازن',
  'RETAINER, STEM GUIDE': 'حافظ/مثبت دليل عمود الصمام',
  'BUSHING, AIR BLOWER': 'جلبة منفاخ هواء (إير بلور)',
  'MODULE POWER SUPPLY': 'وحدة تزويد طاقة كهربائية (موديول باور)',
  'KIT, SPARE PART KIT FOR PILOT VALVE': 'طقم قطع غيار لصمام التوجيه (بايلوت فالف)',
  'SPARE PART KIT FOR PILOT VALVE': 'طقم قطع غيار لصمام التوجيه',
  'PACKING EVSP LOW EMISSION VALVE': 'حشوة إحكام صمام منخفض الانبعاثات EVSP',
  'LOW EMISSION VALVE': 'صمام منخفض الانبعاثات',
  'RELAY, CONTROL: TIME DELAY': 'ريلاي تحكم بتأخير زمني (تايمر)',
  'PIN: THRUST WASHER LOCATION': 'مسمار/بنز تثبيت موضع وردة الدفع',
  'THRUST WASHER LOCATION': 'موضع وردة الدفع',
  'METER ELECTRICAL, AMMETER': 'جهاز قياس شدة التيار الكهربائي (أميتر)',
  'CAP, BEARING': 'غطاء كرسي محمل (رولمان بلي)',
  'STUD ASSEMBLY CONTINUOUS THREAD': 'مجموعة مسمار ربط مسنن بالكامل (ستد بولت)',
  'CONTINUOUS THREAD': 'مسنن بالكامل',
  'BEARING ROLLER METRIC, NON-DRIVE END': 'محمل أسطواني قياسي متري (جهة غير القائد NDE)',
  'BEARING ROLLER METRIC': 'محمل أسطواني قياسي متري',
  'NON-DRIVE END': 'جهة غير القائد (NDE)',
  'DRIVE END': 'جهة القائد (DE)',
  'SEAL LABYRINTH, NDE': 'مانع تسرب متاهي (لابيرنث) جهة غير القائد NDE',
  'SEAL LABYRINTH': 'مانع تسرب متاهي (لابيرنث)',
  'LABYRINTH, INTERSTAGE': 'مانع تسرب متاهي بين المراحل (إنترستيج)',
  'SLEEVE, SPACER': 'جلبة فاصلة (سبيسر سليف)',
  'RING, RETAINING': 'حلقة تثبيت وإحكام (ريتيننج رينج)',
  'CAP: PROTECTIVE, THREAD': 'غطاء حماية لسن القلاووظ',
  'SEAT VALVE': 'مقعد صمام (سيت فالف)',
  'RING, SEAT': 'حلقة مقعد صمام',
  'RING, SEAL': 'حلقة مانع تسرب',
  'MEMBRANE, CENTER': 'غشاء مركزي (ممبرين وسط)',
  'GASKET: CONDUIT BODY': 'جازكيت/وجه إحكام علبة مواسير كهرباء',
  'CONDUIT BODY': 'علبة توصيل مواسير كهرباء',
  'RIGID CONDUIT': 'مواسير كهرباء صلبة',
  'FOR 50 SQ IN ACTUATOR': 'لمشغل ميكانيكي (أكتويتر) مقاس 50 بوصة مربعة',
};

const TERM_TRANSLATIONS: Record<string, string> = {
  // مسامير وروابط وتثبيت
  'HEXAGON HEAD BOLT': 'مسمار رأس سداسي',
  'LOCKING BOLT': 'مسمار قفل وتثبيت',
  'BOLT EXPANSION': 'مسمار تمدد (أنكر)',
  'HILTI ANCHOR': 'مسمار تثبيت هيلتي',
  'STUD BOLT': 'مسمار ربط مسنن (ستد بولت)',
  'THREADED ROD': 'عمود مسنن (ثريدد رود)',
  'SCREW CAP': 'مسمار غطاء',
  'HEX NUT': 'صامولة سداسية',
  'LOCK NUT': 'صامولة قفل',
  'WASHER LOCK': 'وردة زنق/قفل',
  'THRUST WASHER': 'وردة دفع محوري',
  'FLAT WASHER': 'وردة مسطحة',
  'SPRING WASHER': 'وردة سوستة',
  'STUD ASSEMBLY': 'مجموعة مسمار ربط (ستد)',
  'STUD': 'مسمار ربط مسنن (ستد)',
  'BOLT': 'مسمار/برغي',
  'SCREW': 'برغي/مسمار',
  'NUT': 'صامولة',
  'HEX': 'سداسي',
  'WASHER': 'وردة/حلقة معدنية',
  'ANCHOR': 'مرساة تثبيت/أنكر',
  'PIN': 'بنز/مسمار تثبيت',

  // معادن وسبائك ومواد تصنيع
  'STAINLESS STEEL': 'ستانلس ستيل مقاوم للصدأ',
  'CARBON STEEL': 'صلب كربوني',
  'CAST IRON': 'حديد زهر',
  'CARBOGRAPHITE': 'كربون جرافيتي',
  'ARAMID FIBER': 'ألياف أراميد حرارية',
  'KLINGERSIL': 'كلينجرسيل مانع تسرب',
  'GRAFOIL': 'جرافويل (جرافيت مرن)',
  'NITRONIC': 'سبيكة نيتروتك المقاومة للتآكل',
  'INCONEL': 'سبيكة إنكونيل حرارية',
  'STELLITE': 'سبيكة ستالايت شديدة الصلابة',
  'NEOPRENE': 'مطاط نيوبرين',
  'NITRILE': 'مطاط نيتريل (NBR)',
  'TEFLON': 'تفلون (PTFE)',
  'RPTFE': 'تفلون مقوى (RPTFE)',
  'PTFE': 'تفلون حراري (PTFE)',
  'VITON': 'فيتون حراري',
  'NYLON': 'نايلون صناعي',
  'BRONZE': 'برونز',
  'BRASS': 'نحاس أصفر',
  'COPPER': 'نحاس أحمر',
  'ALUMINUM': 'ألمنيوم',
  'CERAMIC': 'سيراميك عازل',
  'LEATHER': 'جلد صناعي متين',
  'PLASTIC': 'بلاستيك مقوى',
  'RUBBER': 'مطاط صناعي',
  'CARBON': 'كربون',
  'STEEL': 'صلب/فولاذ',
  'STAINLESS': 'ستانلس ستيل',
  'GALVANIZED': 'مجلفن',

  // أوجه إحكام وجازكيت وموانع تسرب
  'GASKET SPIRAL WOUND': 'جازكيت حلزوني مدعم',
  'GASKET METAL GROOVED': 'جازكيت معدني مخدد',
  'MECHANICAL SEAL': 'مانع تسرب ميكانيكي (ميكانيكال سيل)',
  'BALANCE SEAL': 'مانع تسرب التوازن',
  'OIL SEAL': 'مانع تسرب زيت (أويل سيل)',
  'GASKET': 'جازكيت/وجه إحكام',
  'SPIRAL WOUND': 'حلزوني مدعم',
  'O-RING': 'حلقة دائرية (أورينج)',
  'SEAL': 'مانع تسرب (سيل)',
  'PACKING': 'حشوة إحكام (باكنج)',
  'PREFORMED': 'مشكلة مسبقاً',

  // إضاءة وكهرباء ولوحات تحكم وأجهزة قياس
  'LAMP FLUORESCENT': 'لمبة فلورسنت',
  'CIRCUIT BREAKER': 'قاطع تيار كهربائي',
  'PRESSURE SWITCH': 'مفتاح ضغط',
  'LIMIT SWITCH': 'مفتاح نهاية شوط',
  'CABLE GLAND': 'جلبة كابل كهربائي',
  'POWER SUPPLY': 'مزود طاقة كهربائي',
  'TIME DELAY': 'تأخير زمني (تايمر)',
  'LOW VOLTAGE': 'جهد منخفض',
  'HIGH VOLTAGE': 'جهد عالي',
  'CONTACTOR': 'كونتاكتور كهربائي',
  'THERMOCOUPLE': 'حساس حرارة (ثرموكبل)',
  'THERMOSTATIC': 'ثرموستاتي (حراري)',
  'AMMETER': 'أميتر (مقياس تيار)',
  'VOLTMETER': 'فولتميتر (مقياس جهد)',
  'ELECTRICAL': 'كهربائي',
  'MODULE': 'وحدة إلكترونية (موديول)',
  'CONTROL': 'تحكم',
  'LAMP': 'لمبة/مصباح',
  'LIGHT': 'إضاءة/كشاف',
  'BULB': 'لمبة',
  'FLUORESCENT': 'فلورسنت',
  'LED': 'ليد',
  'BALLAST': 'ترانس/بادئ تشغيل',
  'FLOODLIGHT': 'كشاف غامر',
  'RELAY': 'ريلاي/مرحل كهربائي',
  'FUSE': 'فيوز/مصهر حماية',
  'SWITCH': 'مفتاح تشغيل',
  'SENSOR': 'حساس إلكتروني',
  'CABLE': 'كابل',
  'METER': 'عداد/مقياس',

  // صمامات ومحابس وتوصيلات أنابيب
  '3 WAY BALL VALVE': 'محبس كروي ثلاثي الاتجاه',
  'RELIEF VALVE': 'صمام تصريف ضغط (أمان)',
  'PILOT VALVE': 'صمام توجيه (بايلوت)',
  'VALVE BALL': 'صمام كروي (محبس)',
  'BALL VALVE': 'محبس كروي',
  'GATE VALVE': 'محبس بوابة',
  'CHECK VALVE': 'صمام عدم رجوع (رداد)',
  'GLOBE VALVE': 'صمام قفاز (جلوب)',
  'BUTTERFLY VALVE': 'صمام فراشة',
  'SAFETY VALVE': 'صمام أمان',
  'SOLENOID VALVE': 'صمام كهربائي (سولينويد)',
  'STEM GUIDE': 'دليل عمود الصمام',
  'ACTUATOR': 'مشغل ميكانيكي (أكتويتر)',
  'YOKE': 'حامل مشغل الصمام (يوك)',
  'VALVE': 'صمام/محبس',
  'CONNECTOR FEMALE': 'وصلة ربط أنثى',
  'CONNECTOR MALE': 'وصلة ربط ذكر',
  'CONNECTOR': 'وصلة ربط/كونكتور',
  'ADAPTER': 'مهايئ/وصلة تحويل',
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
  'BUSHING': 'جلبة (بوشنج)',
  'SUPPORT': 'حامل/دعامة تثبيت',

  // فلاتر ومصافي
  'FILTER ELEMENT': 'عنصر ترشيح/خرطوشة فلتر',
  'FILTER': 'مرشح/فلتر',
  'STRAINER': 'مصفاة خطية',
  'CARTRIDGE': 'خرطوشة',

  // مضخات، محامل، وقطع ميكانيكية
  'BALL BEARING': 'رولمان بلي كروي',
  'ROLLER BEARING': 'محمل أسطواني (رولمان بلي)',
  'JOURNAL': 'محمل انزلاقي',
  'THRUST': 'دفعي محوري',
  'ADAPTER SLEEVE': 'جلبة تثبيت رولمان بلي (أدابتر سليف)',
  'RING WEAR': 'حلقة تآكل حماية (رينج وير)',
  'WEAR RING': 'حلقة تآكل حماية',
  'TIE, CABLE': 'رباط كابل (تاي كابل)',
  'TIE CABLE': 'رباط كابل (تاي كابل)',
  'COVER PLATE': 'لوحة غطاء معدني',
  'INTERMEDIATE PIECE': 'قطعة وسيطة ميكانيكية',
  'AIR BLOWER': 'منفاخ هواء',
  'CASING': 'غلاف المضخة (كيسنج)',
  'THROAT': 'عنق المضخة (ثروت)',
  'THROTTLE': 'خانق (ثروتل)',
  'THROATLE': 'خانق (ثروتل)',
  'INTERSTAGE': 'بين المراحل',
  'BEARING': 'رولمان بلي/محمل',
  'PUMP': 'مضخة',
  'IMPELLER': 'دافع مضخة (إمبلر)',
  'SHAFT': 'عمود دوران (شافت)',
  'SLEEVE': 'جلبة قميص (سليف)',
  'SPACER': 'فاصل معدني (سبيسر)',
  'RETAINER': 'حافظ/مثبت ميكانيكي',
  'LABYRINTH': 'مانع تسرب متاهي (لابيرنث)',
  'DEFLECTOR': 'حارف/موجه حماية',
  'MEMBRANE': 'غشاء (ممبرين)',
  'REGULATOR': 'منظم ضغط/تدفق',
  'RELIEVING': 'تصريف ضغط ذاتي',
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
  'SPRING': 'ياي/نابض',
  'RING': 'حلقة معدنية (رينج)',
  'HOLDER': 'حامل تثبيت',
  'TAPE': 'شريط عزل/لاصق',
  'DISPLAY': 'شاشة عرض رقمية',
  'INDICATOR': 'مؤشر بيان',
  'CAP': 'غطاء',
  'ROD': 'عمود/ذراع',
  'KIT': 'طقم إصلاح/غيار',
  'FEMALE': 'أنثى',
  'MALE': 'ذكر',
  'UPPER': 'علوي',
  'LOWER': 'سفلي',
  'CENTER': 'وسط/مركزي',
  'EXTERNAL': 'خارجي',
  'INTERNAL': 'داخلي',
  'METRIC': 'متري قياسي',
};

// ذاكرة تخزين مؤقت دائمة للترجمة والتصنيف (One-Time Processing Cache)
const TRANSLATION_CACHE = new Map<string, { category: string; descAr: string }>();

export function categorizeAndTranslate(descEn: string): { category: string; descAr: string } {
  const normalizedKey = (descEn || '').trim().toUpperCase();
  if (!normalizedKey || normalizedKey === 'غير محدد' || normalizedKey === 'SPARE PART ASMO' || normalizedKey === 'SPARE PART') {
    return { category: '', descAr: '' };
  }
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
    upper.includes('STUD') ||
    upper.includes('PIN:')
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
    upper.includes('THERMOCOUPLE') ||
    upper.includes('POWER SUPPLY') ||
    upper.includes('AMMETER') ||
    upper.includes('CONDUIT') ||
    upper.includes('INSULATOR')
  ) {
    category = 'كهرباء وإضاءة';
  } else if (
    upper.includes('GASKET') ||
    upper.includes('O-RING') ||
    upper.includes('SEAL') ||
    upper.includes('PACKING') ||
    upper.includes('LABYRINTH')
  ) {
    category = 'جازكيت وموانع تسرب';
  } else if (upper.includes('VALVE') || upper.includes('ACTUATOR')) {
    category = 'صمامات ومحابس';
  } else if (upper.includes('FILTER') || upper.includes('STRAINER') || upper.includes('REGULATOR')) {
    category = 'فلاتر ومصافي';
  } else if (upper.includes('BEARING') || upper.includes('SLEEVE')) {
    category = 'رولمان بلي ومحامل';
  } else if (upper.includes('GAUGE') || upper.includes('METER')) {
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
    upper.includes('FITTING') ||
    upper.includes('ADAPTER')
  ) {
    category = 'أنابيب ووصلات';
  } else if (
    upper.includes('PUMP') ||
    upper.includes('IMPELLER') ||
    upper.includes('RING WEAR') ||
    upper.includes('BUSHING') ||
    upper.includes('RETAINER') ||
    upper.includes('SPACER') ||
    upper.includes('SPRING') ||
    upper.includes('COUPLING') ||
    upper.includes('SHAFT')
  ) {
    category = 'مضخات وقطع ميكانيكية';
  }

  let descAr = descEn;

  // 1. استبدال العبارات المركبة الطويلة أولاً لضمان دقة السياق الهندسي
  const sortedExactPhrases = Object.keys(EXACT_PHRASE_TRANSLATIONS).sort(
    (a, b) => b.length - a.length
  );
  for (const phrase of sortedExactPhrases) {
    const arPhrase = EXACT_PHRASE_TRANSLATIONS[phrase];
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    descAr = descAr.replace(regex, arPhrase);
  }

  // 2. استبدال المصطلحات المفردة والمركبة
  const sortedTerms = Object.keys(TERM_TRANSLATIONS).sort((a, b) => b.length - a.length);
  for (const enWord of sortedTerms) {
    const arWord = TERM_TRANSLATIONS[enWord];
    const escaped = enWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    descAr = descAr.replace(regex, arWord);
  }

  // 3. تعريب وحدات القياس والاختصارات الفنية الشائعة بشكل واضح ومقروء
  descAr = descAr
    .replace(/\b(\d+(?:\.\d+)?)\s*MM\s*OD\b/gi, 'قطر خارجي $1 ملم')
    .replace(/\b(\d+(?:\.\d+)?)\s*MM\s*ID\b/gi, 'قطر داخلي $1 ملم')
    .replace(/\b(\d+(?:\.\d+)?)\s*MM\s*THK\b/gi, 'سماكة $1 ملم')
    .replace(/\b(\d+(?:\.\d+)?)\s*MM\s*LG\b/gi, 'طول $1 ملم')
    .replace(/\b(\d+(?:\.\d+)?)\s*MM\s*WD\b/gi, 'عرض $1 ملم')
    .replace(/\b(\d+(?:\.\d+)?)\s*MM\b/gi, '$1 ملم')
    .replace(/\b(\d+(?:\/\d+)?)\s*IN\b/gi, '$1 بوصة')
    .replace(/\b(\d+)\s*VDC\b/gi, '$1 فولت مستمر')
    .replace(/\b(\d+)\s*VAC\b/gi, '$1 فولت متردد');

  const result = { category, descAr };
  TRANSLATION_CACHE.set(normalizedKey, result);
  return result;
}
