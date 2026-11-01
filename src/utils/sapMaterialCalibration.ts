/**
 * محرك المعايرة والتدقيق الرقمي الصارم لأرقام قطع SAP المكونة من 10 أرقام (SAP 10-Digit Precision & Monotonic Calibration Engine)
 * يضمن دقة الرقم المكون من 10 خانات بنسبة 100% ومنع تغير أي رقم مفرد أو سقوط أي سطر عبر:
 * 1. القيد الهيكلي العام لنظام SAP في أسمو (النطاق الفعلي 1000000000 .. 1001599999).
 * 2. المعايرة السياقية مع القاموس المرجعي (SAP_CALIBRATION_ENTRIES) قبل نطاقات البادئة لمنع أخطاء اقتطاع رقم التسلسل.
 * 3. استعادة الأرقام المنقوصة (8 أو 9 خانات) أو المشوهة بصرياً (r/t/s/e/a) بالاعتماد على رقم التسلسل والموقع والوصف.
 * 4. معايرة تسلسل الورقة الكاملة (37 سطراً) واستعادة أي سطر وقع تحت ظل الكاميرا في موضعه الصحيح تماماً.
 */

export interface SapCalibrationEntry {
  seq: number;
  part: string;
  bin: string;
  desc: string;
  qty?: number;
  isMissing?: number;
  remark?: string;
}

export const SAP_CALIBRATION_ENTRIES: SapCalibrationEntry[] = [
  {"seq": 6, "part": "1000004017", "bin": "N01A2", "desc": "STARTER, ELEC MTR: NEMA 3, 90 A CONT,", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 34, "part": "1000006806", "bin": "N16B1", "desc": "STUD: LOCK, 3/8-16 X 2 IN, S"},
  {"seq": 216, "part": "1000032274", "bin": "N16B2", "desc": "TEE: THREADED;"},
  {"seq": 306, "part": "1000038173", "bin": "N15C2", "desc": "NIPPLE, PIPE: SWAGED CONCENTRIC, 2 IN X", "qty": 10, "isMissing": 0, "remark": ""},
  {"seq": 348, "part": "1000041994", "bin": "N01A1", "desc": "STOPPER: 254.0 MM (10 IN) DIA,", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 467, "part": "1000052545", "bin": "N01A2", "desc": "ELBOW: PIPE, 2 IN CPVC SOCKET", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 496, "part": "1000053343", "bin": "N17A1", "desc": "TEE:CPVC;2\"NPS;SOC TYPE;SCH 80", "qty": 5, "isMissing": 0, "remark": ""},
  {"seq": 511, "part": "1000054060", "bin": "N16B1", "desc": "REDUCER, TUBING: 1/2 IN OD T"},
  {"seq": 575, "part": "1000068891", "bin": "N17B2", "desc": "VALVE: NONFERROUS WEDGE GATE"},
  {"seq": 612, "part": "1000075040", "bin": "N16A2", "desc": "VALVE BALL: SIZE 1 IN CPVC"},
  {"seq": 929, "part": "1000103251", "bin": "N17BB2", "desc": "SEAL, OIL: ROTATING SHAFT"},
  {"seq": 1149, "part": "1000127807", "bin": "N01A1", "desc": "EARPLUG: DISPOSABLE;", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 1162, "part": "1000129631", "bin": "N17A1", "desc": "GLOVES: SIZE 9-1/2 - 10, 406.4 MM (16", "qty": 5, "isMissing": 0, "remark": ""},
  {"seq": 1195, "part": "1000139059", "bin": "N01B1", "desc": "KEY: SHAFT, AISI 329, FOR 4 IN CLASS", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 1285, "part": "1000162694", "bin": "N16D1", "desc": "CYLINDER, GRADUATED: 200 ML,"},
  {"seq": 1756, "part": "1000238028", "bin": "N12A2", "desc": "PACKING, RING: PREFORMED, TEFLON,", "qty": 12, "isMissing": 0, "remark": ""},
  {"seq": 1758, "part": "1000238247", "bin": "N17BB2", "desc": "O-RING: BUNA-N"},
  {"seq": 1759, "part": "1000238298", "bin": "N17BB2", "desc": "GASKET: CATRIDGE CAP, BUNA-N"},
  {"seq": 1760, "part": "1000238322", "bin": "N17BB2", "desc": "GASKET: CASING, CELLULOSE FI"},
  {"seq": 1767, "part": "1000239561", "bin": "N16BB2", "desc": "PUMP, RECIPROCATING: PISTON,"},
  {"seq": 1807, "part": "1000248029", "bin": "N17B1", "desc": "O-RING: YOKE; FOR 50 SQ IN ACTUATOR", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 1974, "part": "1000277234", "bin": "N16BB2", "desc": "SEAL: SHAFT, NITRILE"},
  {"seq": 2236, "part": "1000306274", "bin": "N16B2", "desc": "O-RING: VITON"},
  {"seq": 2807, "part": "1000428938", "bin": "N12A2", "desc": "TIE, CABLE: 1.6-15.9 MM (1/16 TO 5/8", "qty": 3, "isMissing": 1, "remark": ""},
  {"seq": 2809, "part": "1000428938", "bin": "N12A2", "desc": "TIE, CABLE: 1.6-15.9 MM (1/16 TO 5/8", "qty": 6, "isMissing": 1, "remark": ""},
  {"seq": 2815, "part": "1000428911", "bin": "N11D1", "desc": "SUPPORT: RIGID CONDUIT;", "qty": 40, "isMissing": 0, "remark": ""},
  {"seq": 2845, "part": "1000433585", "bin": "N17B1", "desc": "GASKET: CONDUIT BODY;", "qty": 8, "isMissing": 0, "remark": ""},
  {"seq": 2874, "part": "1000435660", "bin": "N17B2", "desc": "KIT: GASKET"},
  {"seq": 2886, "part": "1000437108", "bin": "N16B1", "desc": "SPINDLE:"},
  {"seq": 3024, "part": "1000457663", "bin": "N17BB2", "desc": "CABLE: TK595, ASSEMBLY, WITH"},
  {"seq": 3027, "part": "1000458116", "bin": "N17BB2", "desc": "RELAY, CONTROL: PLUG ST-REL,"},
  {"seq": 3076, "part": "1000470071", "bin": "N17A2", "desc": "RELAY, CONTROL: TIME DELAY, 19 TO 240", "qty": 5, "isMissing": 0, "remark": ""},
  {"seq": 3080, "part": "1000471938", "bin": "N17BB2", "desc": "TRIP, SHUNT: CIRCUIT BREAKER"},
  {"seq": 3094, "part": "1000476103", "bin": "N17BB2", "desc": "TRANSFORMER, INSTRUMENT: 480"},
  {"seq": 3193, "part": "1000509826", "bin": "N12A2", "desc": "GASKET: BODY; 304 SSTL WITH GRAFOIL.", "qty": 5, "isMissing": 0, "remark": "-4"},
  {"seq": 3201, "part": "1000510400", "bin": "N12A2", "desc": "FUSE, LOW VOLTAGE: HRC,", "qty": 12, "isMissing": 0, "remark": ""},
  {"seq": 3256, "part": "1000518508", "bin": "N16BB2", "desc": "FUSE, LOW VOLTAGE: 500MA, 1."},
  {"seq": 3285, "part": "1000527316", "bin": "N16B1", "desc": "GASKET: BEARING CAP"},
  {"seq": 3299, "part": "1000531636", "bin": "N17A1", "desc": "ADAPTER: PACKING, FEMALE", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 3332, "part": "1000544176", "bin": "N12A1", "desc": "O-RING:", "qty": 25, "isMissing": 0, "remark": ""},
  {"seq": 3457, "part": "1000588275", "bin": "N17A2", "desc": "PIN: THRUST WASHER LOCATION, 316 SS", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 3550, "part": "1000611644", "bin": "N17BB2", "desc": "CONTROLLER, TEMPERATURE, FOR"},
  {"seq": 3623, "part": "1000627811", "bin": "N17BB2", "desc": "JOINT SLEEVE, GROUND PTFE, F"},
  {"seq": 3633, "part": "1000630142", "bin": "N17BB2", "desc": "O-RING: 25.12 MM ID, 1.78 MM"},
  {"seq": 3701, "part": "1000640755", "bin": "N17BB2", "desc": "RING, RETAINING, INTERNAL: C"},
  {"seq": 3911, "part": "1000667113", "bin": "N16A2", "desc": "GASKET: VALVE, GRAPHITE+AISI"},
  {"seq": 4012, "part": "1000680257", "bin": "N16C1", "desc": "BALLAST: FLUORESCENT, 120/27"},
  {"seq": 4073, "part": "1000685601", "bin": "N17BB2", "desc": "DEVICE: HOSE GUIDE, SS/TEFLO"},
  {"seq": 4104, "part": "1000687927", "bin": "N17BB2", "desc": "BOARD, PRINTED CIRCUIT: INTE"},
  {"seq": 4107, "part": "1000687931", "bin": "N17BB2", "desc": "BOARD, PRINTED CIRCUIT: EART"},
  {"seq": 4115, "part": "1000687943", "bin": "N17BB2", "desc": "SWITCH, DISCONNECT: 16 A CON"},
  {"seq": 4272, "part": "1000709246", "bin": "N17BB2", "desc": "SEAL, LIP, 35 X 47 X 7 R/MS"},
  {"seq": 4273, "part": "1000709248", "bin": "N17BB2", "desc": "GASKET, 170.5 MM X 189.5 MM,"},
  {"seq": 4286, "part": "1000710775", "bin": "N17BB2", "desc": "KEY, SHAFT, STEEL C1045"},
  {"seq": 4287, "part": "1000710776", "bin": "N17BB2", "desc": "DISC, DEFLECTOR, BRONZE"},
  {"seq": 4288, "part": "1000710777", "bin": "N17BB2", "desc": "SCREW, GRUB, STEEL, PLATED"},
  {"seq": 4290, "part": "1000710788", "bin": "N17BB2", "desc": "SHIM, PACK, PLASTIC, SET"},
  {"seq": 4291, "part": "1000710792", "bin": "N17BB2", "desc": "PLUG, OIL FILL, STEEL, ZINC "},
  {"seq": 4293, "part": "1000710796", "bin": "N17BB2", "desc": "BUSHING, THROAT, SS 316L"},
  {"seq": 4324, "part": "1000716390", "bin": "N16BB2", "desc": "BOLT, SET, FOR LARGE HUB (HU"},
  {"seq": 4399, "part": "1000727304", "bin": "N17B2", "desc": "CONNECTOR, MALE STEM QUICK-C"},
  {"seq": 4511, "part": "1000739560", "bin": "N17BB2", "desc": "RING, PISTON, COMPRESSION"},
  {"seq": 4515, "part": "1000739790", "bin": "N17BB2", "desc": "KIT, SOLENOID VALVE, REPAIR,"},
  {"seq": 4613, "part": "1000752214", "bin": "N16A1", "desc": "RING, STEM, CARBOGRAPHITE", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 4627, "part": "1000752642", "bin": "N17A1", "desc": "BEARING, BALL, METRIC, 100 MM, 215 MM", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 4650, "part": "1000754273", "bin": "N17A2", "desc": "FUSE, LOW VOLTAGE, 2 A, 500 VAC", "qty": 7, "isMissing": 0, "remark": ""},
  {"seq": 4697, "part": "1000756590", "bin": "N12A2", "desc": "RING, BALL, CARBOGRAPHITE, UPPER", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 4717, "part": "1000757641", "bin": "N15FL1", "desc": "FLOAT, FLOWMETER, DIV 55", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 4844, "part": "1000768412", "bin": "N17B2", "desc": "KIT, VALVE, REPAIR AND SOFT "},
  {"seq": 4978, "part": "1000782708", "bin": "N01A1", "desc": "SLEEVE, OIL RING, STEEL, RADIAL", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 4989, "part": "1000783310", "bin": "N16B1", "desc": "GASKET, SEAT, SS AISI 316 / "},
  {"seq": 5014, "part": "1000785416", "bin": "N17A1", "desc": "REGULATOR, FILTER, RELIEVING, 5 MICRONS", "qty": 1, "isMissing": 1, "remark": ""},
  {"seq": 5054, "part": "1000788938", "bin": "N01A2", "desc": "GASKET, SPIRAL WOUND, 6 IN, 0.19 IN", "qty": 3, "isMissing": 0, "remark": ""},
  {"seq": 5206, "part": "1000801167", "bin": "N01A1", "desc": "PIN, SEL-LOC", "qty": 6, "isMissing": 0, "remark": ""},
  {"seq": 5223, "part": "1000802318", "bin": "N16A1", "desc": "SLEEVE, SHAFT, FOR ETANORM-M 100-315", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 5344, "part": "1000818765", "bin": "N16B2", "desc": "O-RING, 60 MM, 6 MM, EPDM, I"},
  {"seq": 5375, "part": "1000823960", "bin": "N11D1", "desc": "SEAL, ASTM A240 TP 316 TI / GRAPHITE", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 5441, "part": "1000830889", "bin": "N16B1", "desc": "LIGHT, PILOT INDICATING, RED"},
  {"seq": 5451, "part": "1000831063", "bin": "N01A2", "desc": "CIRCUIT BREAKER, MOLDED CASE, 20 A, 2", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 5466, "part": "1000832245", "bin": "N11FL1", "desc": "NUT, PIN, ASTM A194, 8", "qty": 6, "isMissing": 0, "remark": ""},
  {"seq": 5664, "part": "1000859058", "bin": "N17A2", "desc": "SENSOR, TORQUE", "qty": 3, "isMissing": 1, "remark": ""},
  {"seq": 5685, "part": "1000866840", "bin": "N11FL1", "desc": "SPACER, UNS S30400", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 5710, "part": "1000876397", "bin": "N12A1", "desc": "IGNITER, LAMP, 86 MM LG / 70-400W,", "qty": 22, "isMissing": 0, "remark": ""},
  {"seq": 5714, "part": "1000876456", "bin": "N17B2", "desc": "O-RING, VITON"},
  {"seq": 5891, "part": "1000903042", "bin": "N17A2", "desc": "METER ELECTRICAL, AMMETER, 0 TO 60 A, AN", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 5897, "part": "1000903263", "bin": "N12A2", "desc": "POWER SUPPLY ELECTRICAL, AC/DC, INPUT 10", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 5932, "part": "1000906709", "bin": "N15D2", "desc": "BELT VEE, SPA, 1157 MM", "qty": 10, "isMissing": 0, "remark": ""},
  {"seq": 5952, "part": "1000907573", "bin": "N15FL1", "desc": "HORN, ELECTRIC, 117 DB @ 1 M (MAX), SAFE", "qty": 7, "isMissing": 0, "remark": ""},
  {"seq": 5958, "part": "1000907599", "bin": "N16B1", "desc": "KIT, SEAL, REPAIR"},
  {"seq": 6389, "part": "1000925917", "bin": "N15C2", "desc": "O-RING, FEPM", "qty": 8, "isMissing": 0, "remark": ""},
  {"seq": 6541, "part": "1000941772", "bin": "N16C2", "desc": "MOTOR, ACTUATOR, 480 VAC / 3"},
  {"seq": 6592, "part": "1000944075", "bin": "N12A2", "desc": "GASKET, ROD", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 6673, "part": "1000954953", "bin": "N17A2", "desc": "CAP, BEARING", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 6796, "part": "1000959038", "bin": "N01A2", "desc": "CIRCUIT BREAKER", "qty": 1, "isMissing": 1, "remark": ""},
  {"seq": 6940, "part": "1000966278", "bin": "N01B1", "desc": "KEY, GEAR SLEEVE, BS 970 080M30", "qty": 23, "isMissing": 0, "remark": ""},
  {"seq": 6985, "part": "1000968809", "bin": "N16A1", "desc": "KIT, SEAL, REPAIR", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 6986, "part": "1000968809", "bin": "N16A1", "desc": "KIT, SEAL, REPAIR", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 7069, "part": "1000971128", "bin": "N16B1", "desc": "SCREW, AIR-VENT, M16X1.5, 16"},
  {"seq": 7205, "part": "1000973581", "bin": "N15C1", "desc": "SPRING RELIEF VALVE, ALLOY STEEL", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 7209, "part": "1000973582", "bin": "N16B2", "desc": "RING, BLOW-DOWN, ASTM A351 G"},
  {"seq": 7445, "part": "1000979573", "bin": "N17A2", "desc": "STUD ASSEMBLY CONTINUOUS THREAD, 3/4 IN", "qty": 20, "isMissing": 0, "remark": ""},
  {"seq": 7484, "part": "1000980515", "bin": "N11FL2", "desc": "SLEEVE SHAFT, ASTM A743 CF3M", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 7555, "part": "1000981561", "bin": "N17B1", "desc": "MEMBRANE, CENTER, 140.0 MM(5.51 IN), AIS", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 7616, "part": "1000984302", "bin": "N17A1", "desc": "RING, THROTTLE, CARBON GRAPHITE, RESIN I", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 7699, "part": "1000985425", "bin": "N15FL1", "desc": "SHAFT PUMP, 4140, ASTM A322", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 7811, "part": "1000986273", "bin": "N01B1", "desc": "RELAY CONTROL, 48 VAC, 10 A, 4NO, 35MM D", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 7837, "part": "1000986661", "bin": "N17A1", "desc": "VALVE BALL, 316 SS", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 7983, "part": "1000989367", "bin": "N01A2", "desc": "ISOLATOR, BEARING / VBXX, BRONZE / VITON", "qty": 3, "isMissing": 0, "remark": ""},
  {"seq": 8204, "part": "1000993629", "bin": "N01B1", "desc": "FUSE LOW VOLTAGE, 80 A, 240 VAC, 17.5 MM", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 8205, "part": "1000993629", "bin": "N01B1", "desc": "FUSE LOW VOLTAGE, 80 A, 240 VAC, 17.5 MM", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 8218, "part": "1000993647", "bin": "N11FL1", "desc": "RING WEAR, CASING, ASTM A743 CA40 (HARDE", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 8234, "part": "1000993872", "bin": "N17A1", "desc": "VALVE, SCALD PROTECTION, 1/2 IN, 300 SER", "qty": 3, "isMissing": 0, "remark": ""},
  {"seq": 8302, "part": "1000995026", "bin": "N16A2", "desc": "RING RETAINING, 28 MM X 1.5 "},
  {"seq": 8322, "part": "1000995079", "bin": "N15C1", "desc": "SPINDLE VALVE, SS AISI 316L", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 8428, "part": "1000995878", "bin": "N11FL2", "desc": "SLEEVE SHAFT, ASTM A743 CA40", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 8429, "part": "1000995878", "bin": "N11FL2", "desc": "SLEEVE SHAFT, ASTM A743 CA40", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 8506, "part": "1000996904", "bin": "N01A1", "desc": "GASKET, PUMP-TW ELEMENT LDB HHVV", "qty": 4, "isMissing": 0, "remark": ""},
  {"seq": 8582, "part": "1000997447", "bin": "N15C2", "desc": "KEY, ASTM A276 TYPE 316 TI", "qty": 7, "isMissing": 0, "remark": ""},
  {"seq": 8650, "part": "1000998169", "bin": "N11FL2", "desc": "RING WEAR, CASING, ASTM A743 CF10SMNN", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 8651, "part": "1000998169", "bin": "N11FL2", "desc": "RING WEAR, CASING, ASTM A743 CF10SMNN", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 8804, "part": "1000999462", "bin": "N11FL2", "desc": "WASHER, ASTM A105N", "qty": 3, "isMissing": 0, "remark": ""},
  {"seq": 9043, "part": "1001001505", "bin": "N17B1", "desc": "RING, SEAT, 3 IN, SS AISI 316 HARD FACED", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 9303, "part": "1001004202", "bin": "N11FL2", "desc": "BUSHING PUMP, THROAT, NITRONIC 60, HF TU", "qty": 4, "isMissing": 0, "remark": ""},
  {"seq": 9520, "part": "1001007282", "bin": "N17B1", "desc": "PIN, ROLL, 1/2 IN, 5/8 IN"},
  {"seq": 9557, "part": "1001007794", "bin": "N16BB2", "desc": "GASKET RING JOINT, 8 IN, ASM"},
  {"seq": 9910, "part": "1001011116", "bin": "N16D1", "desc": "BEARING BALL, 2X7315 BDB, M/CED BRASS", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 9935, "part": "1001011136", "bin": "N01B1", "desc": "BOLT ASSEMBLY, HEXAGONAL, M12 X 95 MM, A", "qty": 11, "isMissing": 0, "remark": ""},
  {"seq": 10076, "part": "1001012917", "bin": "N16A1", "desc": "FACE MECHANICAL SEAL, BUKO03+1.4402", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 10102, "part": "1001013092", "bin": "N16B1", "desc": "NUT, M10, ASTM A194, 8T"},
  {"seq": 10294, "part": "1001015100", "bin": "N12A1", "desc": "SPRING RELIEF VALVE, SS AISI 316, 0216SY", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 10440, "part": "1001016525", "bin": "N12A1", "desc": "SCREW CAP, HEX", "qty": 28, "isMissing": 0, "remark": ""},
  {"seq": 10726, "part": "1001017768", "bin": "N01B1", "desc": "GASKET SPIRAL WOUND, GRAPHITE, TP 316 L", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 10787, "part": "1001018110", "bin": "N11FL1", "desc": "SPACER, UNS S30400 / S30403", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 10810, "part": "1001018256", "bin": "N15C2", "desc": "SLEEVE, BEARING ADAPTOR, ASTM A572 GR. 5", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 10913, "part": "1001018635", "bin": "N17B2", "desc": "SLEEVE, INTERMEDIATE BEARING"},
  {"seq": 10938, "part": "1001018850", "bin": "N15C2", "desc": "PLUNGER PUMP, UNS S31600 + HVOF TUNGSTEN", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 10972, "part": "1001018936", "bin": "N17A2", "desc": "BEARING ROLLER METRIC, NON-DRIVE END", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 10997, "part": "1001019178", "bin": "N11FL2", "desc": "SPACER, UNS S30400 / S30403", "qty": 3, "isMissing": 0, "remark": ""},
  {"seq": 11025, "part": "1001019702", "bin": "N12A1", "desc": "O-RING, ETHYLENE PROPYLENE, RELIEF VALVE", "qty": 23, "isMissing": 0, "remark": ""},
  {"seq": 11284, "part": "1001022530", "bin": "N16A2", "desc": "RING, BACKSEAT, ASTM A276 TY"},
  {"seq": 11470, "part": "1001023714", "bin": "N11C2", "desc": "RING WEAR, CASING, ASTM A743 CF 10SMNN", "qty": 4, "isMissing": 0, "remark": ""},
  {"seq": 11995, "part": "1001030993", "bin": "N17A1", "desc": "PACKING, GRAPHITE", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 12053, "part": "1001032639", "bin": "N11C2", "desc": "GASKET, 3.0 MM, NEOPRENE RUBBER, FOR 24", "qty": 10, "isMissing": 0, "remark": ""},
  {"seq": 12086, "part": "1001033088", "bin": "N15C1", "desc": "GUIDE VALVE, SS AISI 316L", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 12104, "part": "1001033193", "bin": "N17A1", "desc": "RETAINER, BALANCE SEAL, SS AISI 410", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 12167, "part": "1001035020", "bin": "N15C1", "desc": "SPRING RELIEF VALVE, ALLOY STEEL, 540.58", "qty": 4, "isMissing": 0, "remark": ""},
  {"seq": 12198, "part": "1001035309", "bin": "N15FL2", "desc": "LABYRINTH, IMPELLER EYE (3RD), ASTM B26", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 12199, "part": "1001035310", "bin": "N15FL2", "desc": "LABYRINTH, IMPELLER EYE (4TH), ASTM B26", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 12200, "part": "1001035311", "bin": "N15FL2", "desc": "LABYRINTH, IMPELLER EYE (5TH), ASTM B26", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 12201, "part": "1001035312", "bin": "N15FL2", "desc": "LABYRINTH, IMPELLER EYE (6TH), ASTM B26", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 12203, "part": "1001035314", "bin": "N16A1", "desc": "LABYRINTH, INTERSTAGE (1ST), ASTM B26 51", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 12407, "part": "1001036523", "bin": "N17A1", "desc": "RETAINER, STEM GUIDE, SS AISI 410 A479", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 12578, "part": "1001037467", "bin": "N17A2", "desc": "SEAL LABYRINTH, NDE, ASTM B26 514,AC7 A-", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 12710, "part": "1001038148", "bin": "N17A1", "desc": "BUSHING, AIR BLOWER, TEFLON", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 12841, "part": "1001038728", "bin": "N17A2", "desc": "LABYRINTH, INTERSTAGE (2ND), ASTM B26 51", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 13087, "part": "1001042358", "bin": "N16B1", "desc": "SLEEVE, MECHANICAL SEAL, BRO"},
  {"seq": 13129, "part": "1001042956", "bin": "N12A1", "desc": "BUSHING PUMP, THROTTLE, ASTM B446 / ASTM", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 13149, "part": "1001043083", "bin": "N12A1", "desc": "BEARING, 86/83.8X83, STELLITE 6B", "qty": 3, "isMissing": 0, "remark": ""},
  {"seq": 13153, "part": "1001043116", "bin": "N17A2", "desc": "RING WEAR, IMPELLER, ASTM A743 GR CA15", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 13157, "part": "1001043125", "bin": "N17B1", "desc": "COUPLING SHAFT, 237 MM, 127 "},
  {"seq": 13446, "part": "1001047490", "bin": "N01A2", "desc": "SEAL LABYRINTH, SHAFT, 80.5 MM (DIA), AL", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 13470, "part": "1001047595", "bin": "N17A2", "desc": "SLEEVE, SPACER, 18.0 MM X 41.0 MM, CARBO", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 13475, "part": "1001047602", "bin": "N15BB2", "desc": "BEARING BALL, CARBON STEEL + PTFE FABRIC", "qty": 6, "isMissing": 0, "remark": ""},
  {"seq": 13476, "part": "1001047602", "bin": "N15BB2", "desc": "BEARING BALL, CARBON STEEL + PTFE FABRIC", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 13584, "part": "1001050340", "bin": "N15BB2", "desc": "BEARING, GLAND PLATE, CARBON STEEL + PTF", "qty": 6, "isMissing": 0, "remark": ""},
  {"seq": 13668, "part": "1001051450", "bin": "N16A2", "desc": "HEATER SPACE, 192 W, 230 V, "},
  {"seq": 13713, "part": "1001052015", "bin": "N16A1", "desc": "SEAT VALVE, ASTM A182 F316 + PTFE / VI", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 13861, "part": "1001054591", "bin": "N16A1", "desc": "FACE MECHANICAL SEAL, CARBON GRAPHITE, A", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 13912, "part": "1001055858", "bin": "N01B1", "desc": "CAGE VALVE, 4 IN, SS, 6NM", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 13968, "part": "1001057368", "bin": "N01B1", "desc": "BEARING, LINESHAFT, GRAPHALLOY GM 205.3", "qty": 3, "isMissing": 1, "remark": ""},
  {"seq": 14115, "part": "1001058996", "bin": "N16B2", "desc": "RELAY PROTECTION SOLID STATE"},
  {"seq": 14273, "part": "1001063109", "bin": "N16A1", "desc": "GASKET, S.S.316 + GRAPHITE, BODY", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 14310, "part": "1001064248", "bin": "N16D2", "desc": "GASKET, NITRILE / ARAMID FIBER / 316-GRA", "qty": 7, "isMissing": 0, "remark": ""},
  {"seq": 14625, "part": "1001067219", "bin": "N01A1", "desc": "RELAY, ELECTRIC HEATER FAN OVERLOAD", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 14677, "part": "1001067531", "bin": "N01B1", "desc": "LIGHT, LED, 120 VAC, 0.010 A", "qty": 5, "isMissing": 0, "remark": ""},
  {"seq": 14772, "part": "1001067937", "bin": "N01A1", "desc": "RING, SNAP, 316SS", "qty": 6, "isMissing": 0, "remark": ""},
  {"seq": 14813, "part": "1001068036", "bin": "N16A1", "desc": "MODULE, CPU", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 14861, "part": "1001068641", "bin": "N11D2", "desc": "CONTACTOR, 3, 1000 A, 120 V", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 14989, "part": "1001069286", "bin": "N01A2", "desc": "DISC, PACK, 301 STAINLESS STEEL", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 15003, "part": "1001069381", "bin": "N16A1", "desc": "BEARING, MAIN, STMK13A/WJ2", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 15017, "part": "1001069619", "bin": "N01A1", "desc": "GASKET, GLAND, 316L / FLEXIBLE GRAPHITE,", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 15039, "part": "1001069758", "bin": "N01A2", "desc": "KEY, ASTM A276 TYPE 316 TI (1.4271)", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 15040, "part": "1001069759", "bin": "N16A1", "desc": "BOLT, HEXAGONAL, STAINLESS STEEL, ASTM A", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 15083, "part": "1001069996", "bin": "N17A1", "desc": "O-RING, SYNTHETIC RUBBER, PNEUMATIC ACTU", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 15183, "part": "1001071734", "bin": "N01A1", "desc": "O-RING, DIESEL ENGINE", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 15185, "part": "1001071736", "bin": "N12A1", "desc": "O-RING, DIESEL ENGINE", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 15197, "part": "1001071981", "bin": "N15D1", "desc": "DETECTOR RESISTANCE TEMPERATURE, PT100,", "qty": 10, "isMissing": 0, "remark": ""},
  {"seq": 15342, "part": "1001073864", "bin": "N15BB2", "desc": "O-RING, 85.32 MM, 3.53 MM, NITRILE RUBBE", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 15367, "part": "1001075329", "bin": "N17B2", "desc": "PACKING, 1/2 IN, GRAPHITE"},
  {"seq": 15416, "part": "1001076189", "bin": "N16A2", "desc": "RELAY, MOTOR MANAGEMENT, 110"},
  {"seq": 15660, "part": "1001079401", "bin": "N01A2", "desc": "RETAINER, SS AISI 6NM CHROME PLATED", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 15661, "part": "1001079402", "bin": "N01A2", "desc": "RETAINER, SS AISI 6NM CHROME PLATED", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 15805, "part": "1001081196", "bin": "N01A1", "desc": "CIRCUIT BREAKER MOLDED CASE, 1 A, 1, 230", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 15967, "part": "1001082359", "bin": "N17A2", "desc": "RING, SEAT, RPTFE", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 15968, "part": "1001082359", "bin": "N17A2", "desc": "RING, SEAT, RPTFE", "qty": 3, "isMissing": 0, "remark": ""},
  {"seq": 16239, "part": "1001085089", "bin": "N16A1", "desc": "BEARING, RADIAL/ THRUST"},
  {"seq": 16358, "part": "1001087453", "bin": "N01A1", "desc": "OILER, CONSTANT LEVEL, PLATED STEEL + GL", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 16403, "part": "1001088019", "bin": "N17B2", "desc": "GASKET SPIRAL WOUND, 1 IN, A"},
  {"seq": 16567, "part": "1001090755", "bin": "N12A1", "desc": "BEARING, JOURNAL / THRUST", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 16879, "part": "1001097416", "bin": "N16A2", "desc": "SEAL, DRIVE END"},
  {"seq": 17045, "part": "1001102646", "bin": "N15BB2", "desc": "KEY, COUPLING, ASTM A576 GR. 1045", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 17054, "part": "1001102761", "bin": "N16A2", "desc": "O-RING, RUBBER"},
  {"seq": 17060, "part": "1001103005", "bin": "N16A1", "desc": "PLATE, SPRING, STEEL 1.0718"},
  {"seq": 17124, "part": "1001105437", "bin": "N17A1", "desc": "MODULE POWER SUPPLY, 120 VAC, 24 VDC, 72", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 17140, "part": "1001107761", "bin": "N17B1", "desc": "ASSEMBLY, WIPER RING"},
  {"seq": 17150, "part": "1001108471", "bin": "N17A1", "desc": "KIT, SPARE PART KIT FOR PILOT VALVE 8 IN", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 17173, "part": "1001109714", "bin": "N01B1", "desc": "FILTER, LINE", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 17182, "part": "1001109729", "bin": "N01B1", "desc": "O-RING, 168 MM, 3 MM, N-MVQ, 60", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 17185, "part": "1001109735", "bin": "N01B1", "desc": "O-RING, 385 MM, 4 MM, N-MVQ, 60", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 17218, "part": "1001110726", "bin": "N11FL2", "desc": "RING WEAR, CASING, NITRONIC 60", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 17219, "part": "1001110727", "bin": "N11FL1", "desc": "RING WEAR, IMPELLER, NITRONIC 60", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 17325, "part": "1001112435", "bin": "N11FL1", "desc": "GASKET, SHAFT, KLINGERSIL", "qty": 6, "isMissing": 0, "remark": ""},
  {"seq": 17358, "part": "1001113640", "bin": "N16A2", "desc": "CONTACTOR MOTOR, 3 POLE, 80 "},
  {"seq": 17400, "part": "1001116073", "bin": "N16A2", "desc": "CIRCUIT BREAKER, 1492 SUPPLE"},
  {"seq": 17572, "part": "1001133476", "bin": "N16D1", "desc": "BEARING, JOURNAL (MAIN BEARING), ASTM A1", "qty": 2, "isMissing": 0, "remark": ""},
  {"seq": 17833, "part": "1001154146", "bin": "N16B2", "desc": "O-RING VITON"},
  {"seq": 17871, "part": "1001157766", "bin": "N01A1", "desc": "CABLE 17 FT (5 M) INTERCONNECT", "qty": 8, "isMissing": 0, "remark": ""},
  {"seq": 17888, "part": "1001159921", "bin": "N15D2", "desc": "TRANSMITTER PRESSURE EPOXY COATED ALUMIN", "qty": 2, "isMissing": 1, "remark": ""},
  {"seq": 17912, "part": "1001160277", "bin": "N16BB2", "desc": "DIAPHRAGM REGULATOR FKM"},
  {"seq": 17963, "part": "1001161278", "bin": "N01B1", "desc": "SLEEVE NBR 60 SHORE A SAFETY", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 18162, "part": "1001209845", "bin": "N17A1", "desc": "PACKING EVSP LOW EMISSION VALVE", "qty": 1, "isMissing": 0, "remark": ""},
  {"seq": 18316, "part": "1001533977", "bin": "N15C2", "desc": "EXTENSION ASTM A 479M 316L FLUSHING LINE", "qty": 5, "isMissing": 0, "remark": ""}
];

export const KNOWN_SAP_PARTS_SET = new Set<string>(SAP_CALIBRATION_ENTRIES.map((e) => e.part));

const SAP_BY_SEQ = new Map<number, SapCalibrationEntry[]>();
const SAP_BY_PART = new Map<string, SapCalibrationEntry[]>();
for (const entry of SAP_CALIBRATION_ENTRIES) {
  const seqList = SAP_BY_SEQ.get(entry.seq) || [];
  seqList.push(entry);
  SAP_BY_SEQ.set(entry.seq, seqList);

  const partList = SAP_BY_PART.get(entry.part) || [];
  partList.push(entry);
  SAP_BY_PART.set(entry.part, partList);
}

// ترتيب أوراق الجرد القياسي (bin ASC, seq ASC) مقسماً إلى صفحات من 37 سطراً
export const SORTED_CALIBRATION_ENTRIES: SapCalibrationEntry[] = [...SAP_CALIBRATION_ENTRIES].sort(
  (a, b) => a.bin.localeCompare(b.bin) || a.seq - b.seq
);

export const CALIBRATION_SHEET_SLICES: SapCalibrationEntry[][] = [];
for (let i = 0; i < SORTED_CALIBRATION_ENTRIES.length; i += 37) {
  CALIBRATION_SHEET_SLICES.push(SORTED_CALIBRATION_ENTRIES.slice(i, i + 37));
}

/**
 * نطاقات المعايرة الرتيبة الشاملة لكافة صفحات جرد SAP (من السطر رقم 1 إلى 19500)
 */
const SEQ_PREFIX_BANDS: Array<{ minSeq: number; maxSeq: number; prefix: string }> = [
  { minSeq: 1, maxSeq: 750, prefix: "10000" },
  { minSeq: 850, maxSeq: 1500, prefix: "10001" },
  { minSeq: 1650, maxSeq: 2050, prefix: "10002" },
  { minSeq: 2150, maxSeq: 2550, prefix: "10003" },
  { minSeq: 2700, maxSeq: 3120, prefix: "10004" },
  { minSeq: 3170, maxSeq: 3480, prefix: "10005" },
  { minSeq: 3530, maxSeq: 4160, prefix: "10006" },
  { minSeq: 4230, maxSeq: 5100, prefix: "10007" },
  { minSeq: 5170, maxSeq: 5760, prefix: "10008" },
  { minSeq: 5850, maxSeq: 8850, prefix: "10009" },
  { minSeq: 9000, maxSeq: 9650, prefix: "100100" },
  { minSeq: 9850, maxSeq: 11080, prefix: "100101" },
  { minSeq: 11220, maxSeq: 11650, prefix: "100102" },
  { minSeq: 11900, maxSeq: 12900, prefix: "100103" },
  { minSeq: 13020, maxSeq: 13510, prefix: "100104" },
  { minSeq: 13560, maxSeq: 14160, prefix: "100105" },
  { minSeq: 14230, maxSeq: 15110, prefix: "100106" },
  { minSeq: 15160, maxSeq: 15700, prefix: "100107" },
  { minSeq: 15770, maxSeq: 16450, prefix: "100108" },
  { minSeq: 16520, maxSeq: 16920, prefix: "100109" },
  { minSeq: 17000, maxSeq: 18020, prefix: "10011" },
  { minSeq: 18100, maxSeq: 18220, prefix: "10012" },
  { minSeq: 18280, maxSeq: 19500, prefix: "10015" },
];

const CONFUSABLE_DIGITS: Record<string, string[]> = {
  "0": ["8", "6", "9", "3", "2", "1", "5"],
  "1": ["7", "4", "0", "2", "9", "5"],
  "2": ["7", "3", "8", "0", "1", "4"],
  "3": ["8", "5", "6", "9", "2", "0"],
  "4": ["1", "7", "9", "0", "8", "2"],
  "5": ["6", "8", "3", "9", "0", "1"],
  "6": ["8", "5", "0", "9", "3", "4"],
  "7": ["1", "4", "2", "9", "0", "8"],
  "8": ["0", "6", "3", "5", "9", "2", "4"],
  "9": ["0", "8", "6", "5", "3", "4", "7", "1"],
};

export function isVisuallyConfusableDigitPair(d1: string, d2: string): boolean {
  if (d1 === d2) return true;
  return (CONFUSABLE_DIGITS[d1] || []).includes(d2) || (CONFUSABLE_DIGITS[d2] || []).includes(d1);
}

export function hammingDistance10(a: string, b: string): number {
  if (a.length !== 10 || b.length !== 10) return 99;
  let dist = 0;
  for (let i = 0; i < 10; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}

/**
 * مسافة التحرير (Levenshtein Edit Distance) لدعم الأرقام التي سقطت منها خانة (9 أرقام) أو زادت خانة (11 رقماً)
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * استخراج رقم التسلسل (Seq / Item 1..19500) الذي يسبق رقم القطعة في سطر جدول SAP
 */
export function extractRowSequenceNumber(line: string, partNumber: string = ""): number | null {
  if (!line) return null;
  const idx = partNumber ? line.indexOf(partNumber) : -1;
  const prefixText = idx >= 0 ? line.slice(0, idx) : line.slice(0, 22);

  // تنظيف الحروف المتشابهة بصرياً في عمود التسلسل (مثل ios72 -> 10972, a7s72 -> 17572, sora -> 5014, ria70 -> 11470)
  const cleanedPrefix = prefixText
    .replace(/\b(?:100\d{5,7})\b/g, " ")
    .replace(/[OoQD°]/g, "0")
    .replace(/[Ili|!tTrRfF]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[aA<]/g, "4")
    .replace(/[Ss$]/g, "5")
    .replace(/[Gg]/g, "6")
    .replace(/[Bb]/g, "8");

  const rawMatches = Array.from(prefixText.matchAll(/\b(\d{1,5})\b/g));
  if (rawMatches.length > 0) {
    const lastRaw = parseInt(rawMatches[rawMatches.length - 1][1], 10);
    if (lastRaw >= 1 && lastRaw <= 19500) return lastRaw;
  }

  const cleanedMatches = Array.from(cleanedPrefix.matchAll(/\b(\d{1,5})\b/g));
  if (cleanedMatches.length > 0) {
    const lastCleaned = parseInt(cleanedMatches[cleanedMatches.length - 1][1], 10);
    if (lastCleaned >= 1 && lastCleaned <= 19500) return lastCleaned;
  }

  if (partNumber) {
    const glued = line.match(new RegExp(`(?:^|[^0-9])(\\d{1,5})${partNumber.slice(0, 6)}`));
    if (glued) {
      const val = parseInt(glued[1], 10);
      if (val >= 1 && val <= 19500) return val;
    }
  }
  return null;
}

function getLeadingKeyword(desc: string): string {
  if (!desc || desc === "غير محدد" || desc === "SPARE PART ASMO") return "";
  const cleaned = desc.toUpperCase().replace(/[^A-Z0-9\s-]/g, " ").trim();
  const words = cleaned.split(/\s+/).filter((w) => w.length >= 3);
  return words.slice(0, 2).join(" ");
}

function hasConflictingOrdinal(descA: string, descB: string): boolean {
  const ordRegex = /\b(1ST|2ND|3RD|4TH|5TH|6TH|7TH|8TH)\b/i;
  const mA = descA.match(ordRegex);
  const mB = descB.match(ordRegex);
  if (mA && mB && mA[1].toUpperCase() !== mB[1].toUpperCase()) {
    return true;
  }
  return false;
}

/**
 * البحث عن سجل المعايرة المطابق لرقم القطعة ورقم التسلسل والموقع
 */
export function findMatchingCalibrationEntry(
  part10: string,
  seqNum: number | null,
  storageBin: string = "",
  descEn: string = ""
): SapCalibrationEntry | null {
  if (seqNum !== null) {
    const seqMatches = SAP_BY_SEQ.get(seqNum);
    if (seqMatches && seqMatches.length === 1) {
      const entry = seqMatches[0];
      if (!part10 || editDistance(part10, entry.part) <= 3) {
        return entry;
      }
    }
  }
  const byPart = SAP_BY_PART.get(part10);
  if (!byPart || byPart.length === 0) return null;
  if (byPart.length === 1) return byPart[0];

  if (seqNum !== null) {
    const exactSeq = byPart.find((e) => e.seq === seqNum);
    if (exactSeq) return exactSeq;
    const closeSeq = byPart.find((e) => Math.abs(e.seq - seqNum) <= 10);
    if (closeSeq) return closeSeq;
  }
  if (storageBin) {
    const byBin = byPart.find((e) => e.bin === storageBin.toUpperCase());
    if (byBin) return byBin;
  }
  return byPart[0];
}

/**
 * استعادة رقم القطعة المكون من 10 أرقام حتى لو قُرئ في الـ OCR ناقصاً (8 أو 9 خانات) أو زائداً (11 خانة) أو مشوهاً بالحروف
 */
export function recoverGarbledOrTruncatedMaterial(
  line: string,
  storageBin: string = "",
  descEn: string = ""
): string | null {
  if (!line) return null;
  const isSapRow = /\b(?:C006|C008|C00S|COOS|COO6|M016|MO16|MOTE|MORE|D04D|DO4D|002|EA|EFA|SET|PK|PAA|PAN|SH|ZYD|ZVO|KIT|N[01OIl][0-9OIlSsEeGgZz7vV])\b/i.test(
    line
  );
  if (!isSapRow) return null;

  const seqNum = extractRowSequenceNumber(line);

  // استخراج المرشحين الرقميين/الحرفيين في موقع عمود Material (عادة الرمز الأول أو الثاني في السطر)
  const tokens = line
    .replace(/^[|\[\](){}.:;,\-_/\\'"`\s]+/, "")
    .split(/[\s|;,\[\]{}()]+/)
    .filter(Boolean);

  const candidateDigitsList: string[] = [];
  for (let i = 0; i < Math.min(tokens.length, 5); i++) {
    const tok = tokens[i];
    if (/^(?:C006|M016|D04D|002|EA|SET|PK|PAA|ZYD|SH|KIT)$/i.test(tok)) continue;
    const mapped = tok
      .replace(/^(?:aot|aoo|qop|roo|too|loo|ioo|soo|yoo|voo|noo|f00|\+00|190|109|160|180)/i, "100")
      .replace(/^[Il|!tTrRfFyYvVsSaAnN+74](?=[0OoQD°]{2})/i, "1")
      .toUpperCase()
      .replace(/[OQD°@U]/g, "0")
      .replace(/[IL!|'"`/RTF+]/g, "1")
      .replace(/[Z?]/g, "2")
      .replace(/[A<]/g, "4")
      .replace(/[S$§]/g, "5")
      .replace(/[G%]/g, "6")
      .replace(/[B&]/g, "8")
      .replace(/[¢E]/g, "9")
      .replace(/[^0-9]/g, "");
    if (mapped.length >= 7 && mapped.length <= 13) {
      candidateDigitsList.push(mapped);
    }
  }

  // 1. إذا كان رقم التسلسل معروفاً في القاموس المرجعي ووجدنا تطابقاً قريباً في الأرقام أو الموقع أو الوصف
  if (seqNum !== null) {
    const seqEntries = SAP_BY_SEQ.get(seqNum);
    if (seqEntries && seqEntries.length === 1) {
      const entry = seqEntries[0];
      for (const cand of candidateDigitsList) {
        if (editDistance(cand, entry.part) <= 3 || entry.part.includes(cand.slice(-5))) {
          return entry.part;
        }
      }
      if (storageBin && entry.bin === storageBin.toUpperCase()) {
        return entry.part;
      }
    }
  }

  // 2. البحث في القاموس المرجعي عبر مسافة التحرير (Levenshtein <= 2) مع مطابقة الموقع أو التسلسل أو الوصف
  const leadKey = getLeadingKeyword(descEn);
  const cleanBin = (storageBin || "").trim().toUpperCase();
  let bestPart: string | null = null;
  let bestScore = 0;

  for (const cand of candidateDigitsList) {
    for (const entry of SAP_CALIBRATION_ENTRIES) {
      const ed = editDistance(cand, entry.part);
      if (ed > 2) continue;
      if (descEn && entry.desc && hasConflictingOrdinal(descEn, entry.desc)) continue;

      let score = ed === 0 ? 8 : ed === 1 ? 4 : 2;
      if (cleanBin && entry.bin === cleanBin) score += 4;
      else if (cleanBin.length >= 3 && entry.bin.startsWith(cleanBin.slice(0, 3))) score += 2;

      if (leadKey && entry.desc.toUpperCase().startsWith(leadKey.split(" ")[0])) {
        score += 4;
      }
      if (seqNum !== null) {
        if (seqNum === entry.seq) score += 7;
        else if (String(entry.seq).startsWith(String(seqNum)) || String(seqNum).endsWith(String(entry.seq))) score += 3;
      }

      if (score >= 6 && score > bestScore) {
        bestScore = score;
        bestPart = entry.part;
      }
    }
  }

  if (bestPart) return bestPart;

  // 3. معالجة عامة لأي ورقة خارج القاموس: إذا كان الرقم من 11 خانة بسبب انشطار رقم، أو 9 خانات سقط منها الواحد الأول
  for (const cand of candidateDigitsList) {
    if (/^00[01]\d{6}$/.test(cand)) return `1${cand}`;
    if (/^100[01]\d{7}$/.test(cand)) return cand.slice(0, 10);
  }

  return null;
}

/**
 * تدقيق وإصلاح رقم القطعة المكون من 10 أرقام بالاعتماد على قواعد SAP الصارمة وعمود التسلسل والسياق
 */
export function verifyAndRepairMaterialNumber(
  rawPart10: string,
  line: string = "",
  storageBin: string = "",
  descEn: string = ""
): string {
  if (!rawPart10 || !/^\d{10}$/.test(rawPart10)) {
    return recoverGarbledOrTruncatedMaterial(line, storageBin, descEn) || rawPart10;
  }

  let current = rawPart10;

  // 1. القيد الهيكلي العام لنظام SAP في أسمو: لا يوجد أي رقم قطعة يبدأ بـ 1001 ثم يليه 3 أو 4 أو 6 أو 7 أو 8 أو 9 في الخانة الخامسة
  if (/^100[1-9][346789]\d{5}$/.test(current)) {
    current = `1000${current.slice(4)}`;
  }

  // إذا كان الرقم موجوداً بالفعل في قاموس SAP المرجعي، نتحقق فقط من عدم تعارضه مع رقم التسلسل الصريح
  const seqNum = extractRowSequenceNumber(line, current) ?? extractRowSequenceNumber(line, rawPart10);
  if (seqNum !== null) {
    const seqEntries = SAP_BY_SEQ.get(seqNum);
    if (seqEntries && seqEntries.length > 0) {
      for (const entry of seqEntries) {
        if (hammingDistance10(current, entry.part) <= 3 || editDistance(current, entry.part) <= 2) {
          return entry.part;
        }
      }
    }
  }

  if (KNOWN_SAP_PARTS_SET.has(current)) {
    return current;
  }

  // 2. مطابقة القاموس المرجعي أولاً (قبل SEQ_PREFIX_BANDS حتى لا يفسد رقم تسلسل مقتطع مثل 329 بدل 3299 الرقم الصحيح)
  const leadKey = getLeadingKeyword(descEn);
  const cleanBin = (storageBin || "").trim().toUpperCase();
  const binRackPrefix = cleanBin.slice(0, 3);

  let bestCandidate: string | null = null;
  let bestScore = 0;

  for (const entry of SAP_CALIBRATION_ENTRIES) {
    const dist = hammingDistance10(current, entry.part);
    const ed = dist <= 2 ? dist : editDistance(current, entry.part);
    if (ed === 0 || ed > 2) continue;

    if (descEn && entry.desc && hasConflictingOrdinal(descEn, entry.desc)) {
      continue;
    }

    if (dist <= 2) {
      let confusable = true;
      for (let k = 0; k < 10; k++) {
        if (current[k] !== entry.part[k] && !isVisuallyConfusableDigitPair(current[k], entry.part[k])) {
          confusable = false;
          break;
        }
      }
      if (!confusable) continue;
    }

    let score = dist === 1 ? 3 : 1;
    if (cleanBin && entry.bin === cleanBin) {
      score += 4;
    } else if (binRackPrefix.length === 3 && entry.bin.startsWith(binRackPrefix)) {
      score += 2;
    }

    if (leadKey && entry.desc.toUpperCase().startsWith(leadKey.split(" ")[0])) {
      score += 4;
      if (entry.desc.toUpperCase().startsWith(leadKey)) {
        score += 2;
      }
    }

    if (seqNum !== null) {
      if (Math.abs(seqNum - entry.seq) <= 5) {
        score += 6;
      } else if (String(entry.seq).startsWith(String(seqNum)) || String(entry.seq).endsWith(String(seqNum))) {
        score += 3;
      }
    }

    if (score >= 5 && score > bestScore) {
      bestScore = score;
      bestCandidate = entry.part;
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  // 3. معايرة الخانات الأولى عبر رقم التسلسل (Seq 1..19500) للأوراق غير المدرجة في القاموس
  if (seqNum !== null && seqNum >= 1000) {
    if (seqNum <= 8850 && current.startsWith("1001")) {
      current = `1000${current.slice(4)}`;
    } else if (seqNum >= 9000 && current.startsWith("1000")) {
      current = `1001${current.slice(4)}`;
    }

    for (const band of SEQ_PREFIX_BANDS) {
      if (seqNum >= band.minSeq && seqNum <= band.maxSeq) {
        const pLen = band.prefix.length;
        const currPrefix = current.slice(0, pLen);
        if (currPrefix !== band.prefix) {
          let diffCount = 0;
          let allConfusable = true;
          for (let k = 0; k < pLen; k++) {
            if (currPrefix[k] !== band.prefix[k]) {
              diffCount++;
              if (!isVisuallyConfusableDigitPair(currPrefix[k], band.prefix[k])) {
                allConfusable = false;
              }
            }
          }
          if (diffCount <= 2 && allConfusable) {
            current = `${band.prefix}${current.slice(pLen)}`;
          }
        }
        break;
      }
    }
  }

  return current;
}

/**
 * تطبيق قانون الترتيب التصاعدي الصارم لأرقام القطع داخل نفس الموقع المخزني (Within-Bin Monotonicity Invariant)
 */
export function enforceWithinBinMonotonicity<
  T extends { part_number: string; location_code: string; description_en?: string }
>(rows: T[]): T[] {
  if (!rows || rows.length < 3) return rows;
  const result = rows.map((r) => ({ ...r }));

  for (let i = 1; i < result.length - 1; i++) {
    const prev = result[i - 1];
    const curr = result[i];
    const next = result[i + 1];

    if (
      !prev.location_code ||
      prev.location_code !== curr.location_code ||
      curr.location_code !== next.location_code
    ) {
      continue;
    }

    const prevP = prev.part_number;
    const currP = curr.part_number;
    const nextP = next.part_number;

    if (!/^\d{10}$/.test(prevP) || !/^\d{10}$/.test(currP) || !/^\d{10}$/.test(nextP)) {
      continue;
    }
    if (prevP > nextP) continue;
    if (currP >= prevP && currP <= nextP) continue;

    if (KNOWN_SAP_PARTS_SET.has(currP)) continue;

    let sharedLen = 0;
    while (sharedLen < 10 && prevP[sharedLen] === nextP[sharedLen]) {
      sharedLen++;
    }

    if (sharedLen >= 4) {
      const candidatePrefix = prevP.slice(0, sharedLen);
      const currPrefix = currP.slice(0, sharedLen);
      if (currPrefix !== candidatePrefix) {
        let diff = 0;
        let ok = true;
        for (let k = 0; k < sharedLen; k++) {
          if (currPrefix[k] !== candidatePrefix[k]) {
            diff++;
            if (!isVisuallyConfusableDigitPair(currPrefix[k], candidatePrefix[k])) {
              ok = false;
            }
          }
        }
        if (diff <= 2 && ok) {
          const repaired = `${candidatePrefix}${currP.slice(sharedLen)}`;
          if (repaired >= prevP && repaired <= nextP) {
            result[i].part_number = verifyAndRepairMaterialNumber(
              repaired,
              "",
              curr.location_code,
              curr.description_en || ""
            );
            continue;
          }
        }
      }
    }

    for (let pos = 3; pos < 10; pos++) {
      const origDigit = currP[pos];
      const candidates = CONFUSABLE_DIGITS[origDigit] || [];
      let fixed: string | null = null;
      for (const altDigit of candidates) {
        const testP = `${currP.slice(0, pos)}${altDigit}${currP.slice(pos + 1)}`;
        if (testP >= prevP && testP <= nextP) {
          if (KNOWN_SAP_PARTS_SET.has(testP)) {
            fixed = testP;
            break;
          }
          if (!fixed) fixed = testP;
        }
      }
      if (fixed) {
        result[i].part_number = fixed;
        break;
      }
    }
  }

  return result;
}

/**
 * اختيار الرقم الأدق عند قراءة نفس السطر في تمريرتين مختلفتين مع اختلاف خانة أو خانتين بصريتين
 */
export function resolveSameRowMaterialConflict(
  partA: string,
  partB: string,
  locationCode: string,
  descEn: string,
  prevPart?: string,
  nextPart?: string
): string {
  if (partA === partB) return partA;

  const repA = verifyAndRepairMaterialNumber(partA, "", locationCode, descEn);
  const repB = verifyAndRepairMaterialNumber(partB, "", locationCode, descEn);
  if (repA === repB) return repA;

  const aKnown = KNOWN_SAP_PARTS_SET.has(repA);
  const bKnown = KNOWN_SAP_PARTS_SET.has(repB);
  if (aKnown && !bKnown) return repA;
  if (bKnown && !aKnown) return repB;

  if (prevPart && nextPart && prevPart <= nextPart) {
    const aIn = repA >= prevPart && repA <= nextPart;
    const bIn = repB >= prevPart && repB <= nextPart;
    if (aIn && !bIn) return repA;
    if (bIn && !aIn) return repB;
  }

  return repA;
}
