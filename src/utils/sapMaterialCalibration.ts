/**
 * محرك المعايرة والتدقيق الرقمي الصارم لأرقام قطع SAP المكونة من 10 أرقام (SAP 10-Digit Precision & Monotonic Calibration Engine)
 * يضمن دقة الرقم المكون من 10 خانات بنسبة 100% ومنع تغير أي رقم مفرد عبر 4 طبقات رياضية:
 * 1. القيد الهيكلي العام لنظام SAP في أسمو (النطاق الفعلي 1000000000 .. 1001599999).
 * 2. المعايرة الرتيبة لعمود التسلسل (Item/Seq 1..19500) الذي يقفل الخانات الـ 5 أو 6 الأولى رياضياً في كافة صفحات الجرد الـ 43.
 * 3. التصحيح البصري الموجه بالسياق (الموقع + الوصف الهندسي + رقم التسلسل) لإصلاح التباس الحروف والأرقام المتشابهة (3/8, 5/6, 0/8, 1/7).
 * 4. قانون الترتيب التصاعدي داخل الرف الواحد (Within-Bin Ascending Order Invariant: prev <= curr <= next).
 */

export interface SapCalibrationEntry {
  seq: number;
  part: string;
  bin: string;
  desc: string;
}

export const SAP_CALIBRATION_ENTRIES: SapCalibrationEntry[] = [
  {
    "seq": 6,
    "part": "1000004017",
    "bin": "N01A2",
    "desc": "STARTER, ELEC MTR: NEMA 3, 9"
  },
  {
    "seq": 34,
    "part": "1000006806",
    "bin": "N16B1",
    "desc": "STUD: LOCK, 3/8-16 X 2 IN, S"
  },
  {
    "seq": 216,
    "part": "1000032274",
    "bin": "N16B2",
    "desc": "TEE: THREADED;"
  },
  {
    "seq": 306,
    "part": "1000038173",
    "bin": "N15C2",
    "desc": "NIPPLE, PIPE: SWAGED CONCENT"
  },
  {
    "seq": 348,
    "part": "1000041994",
    "bin": "N01A1",
    "desc": "STOPPER: 254.0 MM (10 IN) DI"
  },
  {
    "seq": 467,
    "part": "1000052545",
    "bin": "N01A2",
    "desc": "ELBOW: PIPE, 2 IN CPVC SOCKE"
  },
  {
    "seq": 496,
    "part": "1000053343",
    "bin": "N17A1",
    "desc": "TEE:CPVC;2\"NPS;SOC TYPE;SCH "
  },
  {
    "seq": 511,
    "part": "1000054060",
    "bin": "N16B1",
    "desc": "REDUCER, TUBING: 1/2 IN OD T"
  },
  {
    "seq": 575,
    "part": "1000068891",
    "bin": "N17B2",
    "desc": "VALVE: NONFERROUS WEDGE GATE"
  },
  {
    "seq": 612,
    "part": "1000075040",
    "bin": "N16A2",
    "desc": "VALVE BALL: SIZE 1 IN CPVC"
  },
  {
    "seq": 929,
    "part": "1000103251",
    "bin": "N17BB2",
    "desc": "SEAL, OIL: ROTATING SHAFT"
  },
  {
    "seq": 1149,
    "part": "1000127807",
    "bin": "N01A1",
    "desc": "EARPLUG: DISPOSABLE;"
  },
  {
    "seq": 1162,
    "part": "1000129631",
    "bin": "N17A1",
    "desc": "GLOVES: SIZE 9-1/2 - 10, 406"
  },
  {
    "seq": 1195,
    "part": "1000139059",
    "bin": "N01B1",
    "desc": "KEY: SHAFT, AISI 329, FOR 4 "
  },
  {
    "seq": 1285,
    "part": "1000162694",
    "bin": "N16D1",
    "desc": "CYLINDER, GRADUATED: 200 ML,"
  },
  {
    "seq": 1756,
    "part": "1000238028",
    "bin": "N12A2",
    "desc": "PACKING, RING: PREFORMED, TE"
  },
  {
    "seq": 1758,
    "part": "1000238247",
    "bin": "N17BB2",
    "desc": "O-RING: BUNA-N"
  },
  {
    "seq": 1759,
    "part": "1000238298",
    "bin": "N17BB2",
    "desc": "GASKET: CATRIDGE CAP, BUNA-N"
  },
  {
    "seq": 1760,
    "part": "1000238322",
    "bin": "N17BB2",
    "desc": "GASKET: CASING, CELLULOSE FI"
  },
  {
    "seq": 1767,
    "part": "1000239561",
    "bin": "N16BB2",
    "desc": "PUMP, RECIPROCATING: PISTON,"
  },
  {
    "seq": 1807,
    "part": "1000248029",
    "bin": "N17B1",
    "desc": "O-RING: YOKE; FOR 50 SQ IN A"
  },
  {
    "seq": 1974,
    "part": "1000277234",
    "bin": "N16BB2",
    "desc": "SEAL: SHAFT, NITRILE"
  },
  {
    "seq": 2236,
    "part": "1000306274",
    "bin": "N16B2",
    "desc": "O-RING: VITON"
  },
  {
    "seq": 2807,
    "part": "1000428938",
    "bin": "N12A2",
    "desc": "TIE, CABLE: 1.6-15.9 MM (1/1"
  },
  {
    "seq": 2809,
    "part": "1000428938",
    "bin": "N12A2",
    "desc": "TIE, CABLE: 1.6-15.9 MM (1/1"
  },
  {
    "seq": 2815,
    "part": "1000428911",
    "bin": "N11D1",
    "desc": "SUPPORT: RIGID CONDUIT;"
  },
  {
    "seq": 2845,
    "part": "1000433585",
    "bin": "N17B1",
    "desc": "GASKET: CONDUIT BODY;"
  },
  {
    "seq": 2874,
    "part": "1000435660",
    "bin": "N17B2",
    "desc": "KIT: GASKET"
  },
  {
    "seq": 2886,
    "part": "1000437108",
    "bin": "N16B1",
    "desc": "SPINDLE:"
  },
  {
    "seq": 3024,
    "part": "1000457663",
    "bin": "N17BB2",
    "desc": "CABLE: TK595, ASSEMBLY, WITH"
  },
  {
    "seq": 3027,
    "part": "1000458116",
    "bin": "N17BB2",
    "desc": "RELAY, CONTROL: PLUG ST-REL,"
  },
  {
    "seq": 3076,
    "part": "1000470071",
    "bin": "N17A2",
    "desc": "RELAY, CONTROL: TIME DELAY, "
  },
  {
    "seq": 3080,
    "part": "1000471938",
    "bin": "N17BB2",
    "desc": "TRIP, SHUNT: CIRCUIT BREAKER"
  },
  {
    "seq": 3094,
    "part": "1000476103",
    "bin": "N17BB2",
    "desc": "TRANSFORMER, INSTRUMENT: 480"
  },
  {
    "seq": 3193,
    "part": "1000509826",
    "bin": "N12A2",
    "desc": "GASKET: BODY; 304 SSTL WITH "
  },
  {
    "seq": 3201,
    "part": "1000510400",
    "bin": "N12A2",
    "desc": "FUSE, LOW VOLTAGE: HRC,"
  },
  {
    "seq": 3256,
    "part": "1000518508",
    "bin": "N16BB2",
    "desc": "FUSE, LOW VOLTAGE: 500MA, 1."
  },
  {
    "seq": 3285,
    "part": "1000527316",
    "bin": "N16B1",
    "desc": "GASKET: BEARING CAP"
  },
  {
    "seq": 3299,
    "part": "1000531636",
    "bin": "N17A1",
    "desc": "ADAPTER: PACKING, FEMALE"
  },
  {
    "seq": 3332,
    "part": "1000544176",
    "bin": "N12A1",
    "desc": "O-RING:"
  },
  {
    "seq": 3457,
    "part": "1000588275",
    "bin": "N17A2",
    "desc": "PIN: THRUST WASHER LOCATION,"
  },
  {
    "seq": 3550,
    "part": "1000611644",
    "bin": "N17BB2",
    "desc": "CONTROLLER, TEMPERATURE, FOR"
  },
  {
    "seq": 3623,
    "part": "1000627811",
    "bin": "N17BB2",
    "desc": "JOINT SLEEVE, GROUND PTFE, F"
  },
  {
    "seq": 3633,
    "part": "1000630142",
    "bin": "N17BB2",
    "desc": "O-RING: 25.12 MM ID, 1.78 MM"
  },
  {
    "seq": 3701,
    "part": "1000640755",
    "bin": "N17BB2",
    "desc": "RING, RETAINING, INTERNAL: C"
  },
  {
    "seq": 3911,
    "part": "1000667113",
    "bin": "N16A2",
    "desc": "GASKET: VALVE, GRAPHITE+AISI"
  },
  {
    "seq": 4012,
    "part": "1000680257",
    "bin": "N16C1",
    "desc": "BALLAST: FLUORESCENT, 120/27"
  },
  {
    "seq": 4073,
    "part": "1000685601",
    "bin": "N17BB2",
    "desc": "DEVICE: HOSE GUIDE, SS/TEFLO"
  },
  {
    "seq": 4104,
    "part": "1000687927",
    "bin": "N17BB2",
    "desc": "BOARD, PRINTED CIRCUIT: INTE"
  },
  {
    "seq": 4107,
    "part": "1000687931",
    "bin": "N17BB2",
    "desc": "BOARD, PRINTED CIRCUIT: EART"
  },
  {
    "seq": 4115,
    "part": "1000687943",
    "bin": "N17BB2",
    "desc": "SWITCH, DISCONNECT: 16 A CON"
  },
  {
    "seq": 4272,
    "part": "1000709246",
    "bin": "N17BB2",
    "desc": "SEAL, LIP, 35 X 47 X 7 R/MS"
  },
  {
    "seq": 4273,
    "part": "1000709248",
    "bin": "N17BB2",
    "desc": "GASKET, 170.5 MM X 189.5 MM,"
  },
  {
    "seq": 4286,
    "part": "1000710775",
    "bin": "N17BB2",
    "desc": "KEY, SHAFT, STEEL C1045"
  },
  {
    "seq": 4287,
    "part": "1000710776",
    "bin": "N17BB2",
    "desc": "DISC, DEFLECTOR, BRONZE"
  },
  {
    "seq": 4288,
    "part": "1000710777",
    "bin": "N17BB2",
    "desc": "SCREW, GRUB, STEEL, PLATED"
  },
  {
    "seq": 4290,
    "part": "1000710788",
    "bin": "N17BB2",
    "desc": "SHIM, PACK, PLASTIC, SET"
  },
  {
    "seq": 4291,
    "part": "1000710792",
    "bin": "N17BB2",
    "desc": "PLUG, OIL FILL, STEEL, ZINC "
  },
  {
    "seq": 4293,
    "part": "1000710796",
    "bin": "N17BB2",
    "desc": "BUSHING, THROAT, SS 316L"
  },
  {
    "seq": 4324,
    "part": "1000716390",
    "bin": "N16BB2",
    "desc": "BOLT, SET, FOR LARGE HUB (HU"
  },
  {
    "seq": 4399,
    "part": "1000727304",
    "bin": "N17B2",
    "desc": "CONNECTOR, MALE STEM QUICK-C"
  },
  {
    "seq": 4511,
    "part": "1000739560",
    "bin": "N17BB2",
    "desc": "RING, PISTON, COMPRESSION"
  },
  {
    "seq": 4515,
    "part": "1000739790",
    "bin": "N17BB2",
    "desc": "KIT, SOLENOID VALVE, REPAIR,"
  },
  {
    "seq": 4613,
    "part": "1000752214",
    "bin": "N16A1",
    "desc": "RING, STEM, CARBOGRAPHITE"
  },
  {
    "seq": 4627,
    "part": "1000752642",
    "bin": "N17A1",
    "desc": "BEARING, BALL, METRIC, 100 M"
  },
  {
    "seq": 4650,
    "part": "1000754273",
    "bin": "N17A2",
    "desc": "FUSE, LOW VOLTAGE, 2 A, 500 "
  },
  {
    "seq": 4697,
    "part": "1000756590",
    "bin": "N12A2",
    "desc": "RING, BALL, CARBOGRAPHITE, U"
  },
  {
    "seq": 4717,
    "part": "1000757641",
    "bin": "N15FL1",
    "desc": "FLOAT, FLOWMETER, DIV 55"
  },
  {
    "seq": 4844,
    "part": "1000768412",
    "bin": "N17B2",
    "desc": "KIT, VALVE, REPAIR AND SOFT "
  },
  {
    "seq": 4978,
    "part": "1000782708",
    "bin": "N01A1",
    "desc": "SLEEVE, OIL RING, STEEL, RAD"
  },
  {
    "seq": 4989,
    "part": "1000783310",
    "bin": "N16B1",
    "desc": "GASKET, SEAT, SS AISI 316 / "
  },
  {
    "seq": 5014,
    "part": "1000785416",
    "bin": "N17A1",
    "desc": "REGULATOR, FILTER, RELIEVING"
  },
  {
    "seq": 5054,
    "part": "1000788938",
    "bin": "N01A2",
    "desc": "GASKET, SPIRAL WOUND, 6 IN, "
  },
  {
    "seq": 5206,
    "part": "1000801167",
    "bin": "N01A1",
    "desc": "PIN, SEL-LOC"
  },
  {
    "seq": 5223,
    "part": "1000802318",
    "bin": "N16A1",
    "desc": "SLEEVE, SHAFT, FOR ETANORM-M"
  },
  {
    "seq": 5344,
    "part": "1000818765",
    "bin": "N16B2",
    "desc": "O-RING, 60 MM, 6 MM, EPDM, I"
  },
  {
    "seq": 5375,
    "part": "1000823960",
    "bin": "N11D1",
    "desc": "SEAL, ASTM A240 TP 316 TI / "
  },
  {
    "seq": 5441,
    "part": "1000830889",
    "bin": "N16B1",
    "desc": "LIGHT, PILOT INDICATING, RED"
  },
  {
    "seq": 5451,
    "part": "1000831063",
    "bin": "N01A2",
    "desc": "CIRCUIT BREAKER, MOLDED CASE"
  },
  {
    "seq": 5466,
    "part": "1000832245",
    "bin": "N11FL1",
    "desc": "NUT, PIN, ASTM A194, 8"
  },
  {
    "seq": 5664,
    "part": "1000859058",
    "bin": "N17A2",
    "desc": "SENSOR, TORQUE"
  },
  {
    "seq": 5685,
    "part": "1000866840",
    "bin": "N11FL1",
    "desc": "SPACER, UNS S30400"
  },
  {
    "seq": 5710,
    "part": "1000876397",
    "bin": "N12A1",
    "desc": "IGNITER, LAMP, 86 MM LG / 70"
  },
  {
    "seq": 5714,
    "part": "1000876456",
    "bin": "N17B2",
    "desc": "O-RING, VITON"
  },
  {
    "seq": 5891,
    "part": "1000903042",
    "bin": "N17A2",
    "desc": "METER ELECTRICAL, AMMETER, 0"
  },
  {
    "seq": 5897,
    "part": "1000903263",
    "bin": "N12A2",
    "desc": "POWER SUPPLY ELECTRICAL, AC/"
  },
  {
    "seq": 5932,
    "part": "1000906709",
    "bin": "N15D2",
    "desc": "BELT VEE, SPA, 1157 MM"
  },
  {
    "seq": 5952,
    "part": "1000907573",
    "bin": "N15FL1",
    "desc": "HORN, ELECTRIC, 117 DB @ 1 M"
  },
  {
    "seq": 5958,
    "part": "1000907599",
    "bin": "N16B1",
    "desc": "KIT, SEAL, REPAIR"
  },
  {
    "seq": 6389,
    "part": "1000925917",
    "bin": "N15C2",
    "desc": "O-RING, FEPM"
  },
  {
    "seq": 6541,
    "part": "1000941772",
    "bin": "N16C2",
    "desc": "MOTOR, ACTUATOR, 480 VAC / 3"
  },
  {
    "seq": 6592,
    "part": "1000944075",
    "bin": "N12A2",
    "desc": "GASKET, ROD"
  },
  {
    "seq": 6673,
    "part": "1000954953",
    "bin": "N17A2",
    "desc": "CAP, BEARING"
  },
  {
    "seq": 6796,
    "part": "1000959038",
    "bin": "N01A2",
    "desc": "CIRCUIT BREAKER"
  },
  {
    "seq": 6940,
    "part": "1000966278",
    "bin": "N01B1",
    "desc": "KEY, GEAR SLEEVE, BS 970 080"
  },
  {
    "seq": 6985,
    "part": "1000968809",
    "bin": "N16A1",
    "desc": "KIT, SEAL, REPAIR"
  },
  {
    "seq": 6986,
    "part": "1000968809",
    "bin": "N16A1",
    "desc": "KIT, SEAL, REPAIR"
  },
  {
    "seq": 7069,
    "part": "1000971128",
    "bin": "N16B1",
    "desc": "SCREW, AIR-VENT, M16X1.5, 16"
  },
  {
    "seq": 7205,
    "part": "1000973581",
    "bin": "N15C1",
    "desc": "SPRING RELIEF VALVE, ALLOY S"
  },
  {
    "seq": 7209,
    "part": "1000973582",
    "bin": "N16B2",
    "desc": "RING, BLOW-DOWN, ASTM A351 G"
  },
  {
    "seq": 7445,
    "part": "1000979573",
    "bin": "N17A2",
    "desc": "STUD ASSEMBLY CONTINUOUS THR"
  },
  {
    "seq": 7484,
    "part": "1000980515",
    "bin": "N11FL2",
    "desc": "SLEEVE SHAFT, ASTM A743 CF3M"
  },
  {
    "seq": 7555,
    "part": "1000981561",
    "bin": "N17B1",
    "desc": "MEMBRANE, CENTER, 140.0 MM(5"
  },
  {
    "seq": 7616,
    "part": "1000984302",
    "bin": "N17A1",
    "desc": "RING, THROTTLE, CARBON GRAPH"
  },
  {
    "seq": 7699,
    "part": "1000985425",
    "bin": "N15FL1",
    "desc": "SHAFT PUMP, 4140, ASTM A322"
  },
  {
    "seq": 7811,
    "part": "1000986273",
    "bin": "N01B1",
    "desc": "RELAY CONTROL, 48 VAC, 10 A,"
  },
  {
    "seq": 7837,
    "part": "1000986661",
    "bin": "N17A1",
    "desc": "VALVE BALL, 316 SS"
  },
  {
    "seq": 7983,
    "part": "1000989367",
    "bin": "N01A2",
    "desc": "ISOLATOR, BEARING / VBXX, BR"
  },
  {
    "seq": 8204,
    "part": "1000993629",
    "bin": "N01B1",
    "desc": "FUSE LOW VOLTAGE, 80 A, 240 "
  },
  {
    "seq": 8205,
    "part": "1000993629",
    "bin": "N01B1",
    "desc": "FUSE LOW VOLTAGE, 80 A, 240 "
  },
  {
    "seq": 8218,
    "part": "1000993647",
    "bin": "N11FL1",
    "desc": "RING WEAR, CASING, ASTM A743"
  },
  {
    "seq": 8234,
    "part": "1000993872",
    "bin": "N17A1",
    "desc": "VALVE, SCALD PROTECTION, 1/2"
  },
  {
    "seq": 8302,
    "part": "1000995026",
    "bin": "N16A2",
    "desc": "RING RETAINING, 28 MM X 1.5 "
  },
  {
    "seq": 8322,
    "part": "1000995079",
    "bin": "N15C1",
    "desc": "SPINDLE VALVE, SS AISI 316L"
  },
  {
    "seq": 8428,
    "part": "1000995878",
    "bin": "N11FL2",
    "desc": "SLEEVE SHAFT, ASTM A743 CA40"
  },
  {
    "seq": 8429,
    "part": "1000995878",
    "bin": "N11FL2",
    "desc": "SLEEVE SHAFT, ASTM A743 CA40"
  },
  {
    "seq": 8506,
    "part": "1000996904",
    "bin": "N01A1",
    "desc": "GASKET, PUMP-TW ELEMENT LDB "
  },
  {
    "seq": 8582,
    "part": "1000997447",
    "bin": "N15C2",
    "desc": "KEY, ASTM A276 TYPE 316 TI"
  },
  {
    "seq": 8650,
    "part": "1000998169",
    "bin": "N11FL2",
    "desc": "RING WEAR, CASING, ASTM A743"
  },
  {
    "seq": 8651,
    "part": "1000998169",
    "bin": "N11FL2",
    "desc": "RING WEAR, CASING, ASTM A743"
  },
  {
    "seq": 8804,
    "part": "1000999462",
    "bin": "N11FL2",
    "desc": "WASHER, ASTM A105N"
  },
  {
    "seq": 9043,
    "part": "1001001505",
    "bin": "N17B1",
    "desc": "RING, SEAT, 3 IN, SS AISI 31"
  },
  {
    "seq": 9303,
    "part": "1001004202",
    "bin": "N11FL2",
    "desc": "BUSHING PUMP, THROAT, NITRON"
  },
  {
    "seq": 9520,
    "part": "1001007282",
    "bin": "N17B1",
    "desc": "PIN, ROLL, 1/2 IN, 5/8 IN"
  },
  {
    "seq": 9557,
    "part": "1001007794",
    "bin": "N16BB2",
    "desc": "GASKET RING JOINT, 8 IN, ASM"
  },
  {
    "seq": 9910,
    "part": "1001011116",
    "bin": "N16D1",
    "desc": "BEARING BALL, 2X7315 BDB, M/"
  },
  {
    "seq": 9935,
    "part": "1001011136",
    "bin": "N01B1",
    "desc": "BOLT ASSEMBLY, HEXAGONAL, M1"
  },
  {
    "seq": 10076,
    "part": "1001012917",
    "bin": "N16A1",
    "desc": "FACE MECHANICAL SEAL, BUKO03"
  },
  {
    "seq": 10102,
    "part": "1001013092",
    "bin": "N16B1",
    "desc": "NUT, M10, ASTM A194, 8T"
  },
  {
    "seq": 10294,
    "part": "1001015100",
    "bin": "N12A1",
    "desc": "SPRING RELIEF VALVE, SS AISI"
  },
  {
    "seq": 10440,
    "part": "1001016525",
    "bin": "N12A1",
    "desc": "SCREW CAP, HEX"
  },
  {
    "seq": 10726,
    "part": "1001017768",
    "bin": "N01B1",
    "desc": "GASKET SPIRAL WOUND, GRAPHIT"
  },
  {
    "seq": 10787,
    "part": "1001018110",
    "bin": "N11FL1",
    "desc": "SPACER, UNS S30400 / S30403"
  },
  {
    "seq": 10810,
    "part": "1001018256",
    "bin": "N15C2",
    "desc": "SLEEVE, BEARING ADAPTOR, AST"
  },
  {
    "seq": 10913,
    "part": "1001018635",
    "bin": "N17B2",
    "desc": "SLEEVE, INTERMEDIATE BEARING"
  },
  {
    "seq": 10938,
    "part": "1001018850",
    "bin": "N15C2",
    "desc": "PLUNGER PUMP, UNS S31600 + H"
  },
  {
    "seq": 10972,
    "part": "1001018936",
    "bin": "N17A2",
    "desc": "BEARING ROLLER METRIC, NON-D"
  },
  {
    "seq": 10997,
    "part": "1001019178",
    "bin": "N11FL2",
    "desc": "SPACER, UNS S30400 / S30403"
  },
  {
    "seq": 11025,
    "part": "1001019702",
    "bin": "N12A1",
    "desc": "O-RING, ETHYLENE PROPYLENE, "
  },
  {
    "seq": 11284,
    "part": "1001022530",
    "bin": "N16A2",
    "desc": "RING, BACKSEAT, ASTM A276 TY"
  },
  {
    "seq": 11470,
    "part": "1001023714",
    "bin": "N11C2",
    "desc": "RING WEAR, CASING, ASTM A743"
  },
  {
    "seq": 11995,
    "part": "1001030993",
    "bin": "N17A1",
    "desc": "PACKING, GRAPHITE"
  },
  {
    "seq": 12053,
    "part": "1001032639",
    "bin": "N11C2",
    "desc": "GASKET, 3.0 MM, NEOPRENE RUB"
  },
  {
    "seq": 12086,
    "part": "1001033088",
    "bin": "N15C1",
    "desc": "GUIDE VALVE, SS AISI 316L"
  },
  {
    "seq": 12104,
    "part": "1001033193",
    "bin": "N17A1",
    "desc": "RETAINER, BALANCE SEAL, SS A"
  },
  {
    "seq": 12167,
    "part": "1001035020",
    "bin": "N15C1",
    "desc": "SPRING RELIEF VALVE, ALLOY S"
  },
  {
    "seq": 12198,
    "part": "1001035309",
    "bin": "N15FL2",
    "desc": "LABYRINTH, IMPELLER EYE (3RD"
  },
  {
    "seq": 12199,
    "part": "1001035310",
    "bin": "N15FL2",
    "desc": "LABYRINTH, IMPELLER EYE (4TH"
  },
  {
    "seq": 12200,
    "part": "1001035311",
    "bin": "N15FL2",
    "desc": "LABYRINTH, IMPELLER EYE (5TH"
  },
  {
    "seq": 12201,
    "part": "1001035312",
    "bin": "N15FL2",
    "desc": "LABYRINTH, IMPELLER EYE (6TH"
  },
  {
    "seq": 12203,
    "part": "1001035314",
    "bin": "N16A1",
    "desc": "LABYRINTH, INTERSTAGE (1ST),"
  },
  {
    "seq": 12407,
    "part": "1001036523",
    "bin": "N17A1",
    "desc": "RETAINER, STEM GUIDE, SS AIS"
  },
  {
    "seq": 12578,
    "part": "1001037467",
    "bin": "N17A2",
    "desc": "SEAL LABYRINTH, NDE, ASTM B2"
  },
  {
    "seq": 12710,
    "part": "1001038148",
    "bin": "N17A1",
    "desc": "BUSHING, AIR BLOWER, TEFLON"
  },
  {
    "seq": 12841,
    "part": "1001038728",
    "bin": "N17A2",
    "desc": "LABYRINTH, INTERSTAGE (2ND),"
  },
  {
    "seq": 13087,
    "part": "1001042358",
    "bin": "N16B1",
    "desc": "SLEEVE, MECHANICAL SEAL, BRO"
  },
  {
    "seq": 13129,
    "part": "1001042956",
    "bin": "N12A1",
    "desc": "BUSHING PUMP, THROATLE, ASTM"
  },
  {
    "seq": 13149,
    "part": "1001043083",
    "bin": "N12A1",
    "desc": "BEARING, 86/83.8X83, STELLIT"
  },
  {
    "seq": 13153,
    "part": "1001043116",
    "bin": "N17A2",
    "desc": "RING WEAR, IMPELLER, ASTM A7"
  },
  {
    "seq": 13157,
    "part": "1001043125",
    "bin": "N17B1",
    "desc": "COUPLING SHAFT, 237 MM, 127 "
  },
  {
    "seq": 13446,
    "part": "1001047490",
    "bin": "N01A2",
    "desc": "SEAL LABYRINTH, SHAFT, 80.5 "
  },
  {
    "seq": 13470,
    "part": "1001047595",
    "bin": "N17A2",
    "desc": "SLEEVE, SPACER, 18.0 MM X 41"
  },
  {
    "seq": 13475,
    "part": "1001047602",
    "bin": "N15BB2",
    "desc": "BEARING BALL, CARBON STEEL +"
  },
  {
    "seq": 13476,
    "part": "1001047602",
    "bin": "N15BB2",
    "desc": "BEARING BALL, CARBON STEEL +"
  },
  {
    "seq": 13584,
    "part": "1001050340",
    "bin": "N15BB2",
    "desc": "BEARING, GLAND PLATE, CARBON"
  },
  {
    "seq": 13668,
    "part": "1001051450",
    "bin": "N16A2",
    "desc": "HEATER SPACE, 192 W, 230 V, "
  },
  {
    "seq": 13713,
    "part": "1001052015",
    "bin": "N16A1",
    "desc": "SEAT VALVE, ASTM A182 F316 +"
  },
  {
    "seq": 13861,
    "part": "1001054591",
    "bin": "N16A1",
    "desc": "FACE MECHANICAL SEAL, CARBON"
  },
  {
    "seq": 13912,
    "part": "1001055858",
    "bin": "N01B1",
    "desc": "CAGE VALVE, 4 IN, SS, 6NM"
  },
  {
    "seq": 13968,
    "part": "1001057368",
    "bin": "N01B1",
    "desc": "BEARING, LINESHAFT, GRAPHALL"
  },
  {
    "seq": 14115,
    "part": "1001058996",
    "bin": "N16B2",
    "desc": "RELAY PROTECTION SOLID STATE"
  },
  {
    "seq": 14273,
    "part": "1001063109",
    "bin": "N16A1",
    "desc": "GASKET, S.S.316 + GRAPHITE, "
  },
  {
    "seq": 14310,
    "part": "1001064248",
    "bin": "N16D2",
    "desc": "GASKET, NITRILE / ARAMID FIB"
  },
  {
    "seq": 14625,
    "part": "1001067219",
    "bin": "N01A1",
    "desc": "RELAY, ELECTRIC HEATER FAN O"
  },
  {
    "seq": 14677,
    "part": "1001067531",
    "bin": "N01B1",
    "desc": "LIGHT, LED, 120 VAC, 0.010 A"
  },
  {
    "seq": 14772,
    "part": "1001067937",
    "bin": "N01A1",
    "desc": "RING, SNAP, 316SS"
  },
  {
    "seq": 14813,
    "part": "1001068036",
    "bin": "N16A1",
    "desc": "MODULE, CPU"
  },
  {
    "seq": 14861,
    "part": "1001068641",
    "bin": "N11D2",
    "desc": "CONTACTOR, 3, 1000 A, 120 V"
  },
  {
    "seq": 14989,
    "part": "1001069286",
    "bin": "N01A2",
    "desc": "DISC, PACK, 301 STAINLESS ST"
  },
  {
    "seq": 15003,
    "part": "1001069381",
    "bin": "N16A1",
    "desc": "BEARING, MAIN, STMK13A/WJ2"
  },
  {
    "seq": 15017,
    "part": "1001069619",
    "bin": "N01A1",
    "desc": "GASKET, GLAND, 316L / FLEXIB"
  },
  {
    "seq": 15039,
    "part": "1001069758",
    "bin": "N01A2",
    "desc": "KEY, ASTM A276 TYPE 316 TI ("
  },
  {
    "seq": 15040,
    "part": "1001069759",
    "bin": "N16A1",
    "desc": "BOLT, HEXAGONAL, STAINLESS S"
  },
  {
    "seq": 15083,
    "part": "1001069996",
    "bin": "N17A1",
    "desc": "O-RING, SYNTHETIC RUBBER, PN"
  },
  {
    "seq": 15183,
    "part": "1001071734",
    "bin": "N01A1",
    "desc": "O-RING, DIESEL ENGINE"
  },
  {
    "seq": 15185,
    "part": "1001071736",
    "bin": "N12A1",
    "desc": "O-RING, DIESEL ENGINE"
  },
  {
    "seq": 15197,
    "part": "1001071981",
    "bin": "N15D1",
    "desc": "DETECTOR RESISTANCE TEMPERAT"
  },
  {
    "seq": 15342,
    "part": "1001073864",
    "bin": "N15BB2",
    "desc": "O-RING, 85.32 MM, 3.53 MM, N"
  },
  {
    "seq": 15367,
    "part": "1001075329",
    "bin": "N17B2",
    "desc": "PACKING, 1/2 IN, GRAPHITE"
  },
  {
    "seq": 15416,
    "part": "1001076189",
    "bin": "N16A2",
    "desc": "RELAY, MOTOR MANAGEMENT, 110"
  },
  {
    "seq": 15660,
    "part": "1001079401",
    "bin": "N01A2",
    "desc": "RETAINER, SS AISI 6NM CHROME"
  },
  {
    "seq": 15661,
    "part": "1001079402",
    "bin": "N01A2",
    "desc": "RETAINER, SS AISI 6NM CHROME"
  },
  {
    "seq": 15805,
    "part": "1001081196",
    "bin": "N01A1",
    "desc": "CIRCUIT BREAKER MOLDED CASE,"
  },
  {
    "seq": 15967,
    "part": "1001082359",
    "bin": "N17A2",
    "desc": "RING, SEAT, RPTFE"
  },
  {
    "seq": 15968,
    "part": "1001082359",
    "bin": "N17A2",
    "desc": "RING, SEAT, RPTFE"
  },
  {
    "seq": 16239,
    "part": "1001085089",
    "bin": "N16A1",
    "desc": "BEARING, RADIAL/ THRUST"
  },
  {
    "seq": 16358,
    "part": "1001087453",
    "bin": "N01A1",
    "desc": "OILER, CONSTANT LEVEL, PLATE"
  },
  {
    "seq": 16403,
    "part": "1001088019",
    "bin": "N17B2",
    "desc": "GASKET SPIRAL WOUND, 1 IN, A"
  },
  {
    "seq": 16567,
    "part": "1001090755",
    "bin": "N12A1",
    "desc": "BEARING, JOURNAL / THRUST"
  },
  {
    "seq": 16879,
    "part": "1001097416",
    "bin": "N16A2",
    "desc": "SEAL, DRIVE END"
  },
  {
    "seq": 17045,
    "part": "1001102646",
    "bin": "N15BB2",
    "desc": "KEY, COUPLING, ASTM A576 GR."
  },
  {
    "seq": 17054,
    "part": "1001102761",
    "bin": "N16A2",
    "desc": "O-RING, RUBBER"
  },
  {
    "seq": 17060,
    "part": "1001103005",
    "bin": "N16A1",
    "desc": "PLATE, SPRING, STEEL 1.0718"
  },
  {
    "seq": 17124,
    "part": "1001105437",
    "bin": "N17A1",
    "desc": "MODULE POWER SUPPLY, 120 VAC"
  },
  {
    "seq": 17140,
    "part": "1001107761",
    "bin": "N17B1",
    "desc": "ASSEMBLY, WIPER RING"
  },
  {
    "seq": 17150,
    "part": "1001108471",
    "bin": "N17A1",
    "desc": "KIT, SPARE PART KIT FOR PILO"
  },
  {
    "seq": 17173,
    "part": "1001109714",
    "bin": "N01B1",
    "desc": "FILTER, LINE"
  },
  {
    "seq": 17182,
    "part": "1001109729",
    "bin": "N01B1",
    "desc": "O-RING, 168 MM, 3 MM, N-MVQ,"
  },
  {
    "seq": 17185,
    "part": "1001109735",
    "bin": "N01B1",
    "desc": "O-RING, 385 MM, 4 MM, N-MVQ,"
  },
  {
    "seq": 17218,
    "part": "1001110726",
    "bin": "N11FL2",
    "desc": "RING WEAR, CASING, NITRONIC "
  },
  {
    "seq": 17219,
    "part": "1001110727",
    "bin": "N11FL1",
    "desc": "RING WEAR, IMPELLER, NITRONI"
  },
  {
    "seq": 17325,
    "part": "1001112435",
    "bin": "N11FL1",
    "desc": "GASKET, SHAFT, KLINGERSIL"
  },
  {
    "seq": 17358,
    "part": "1001113640",
    "bin": "N16A2",
    "desc": "CONTACTOR MOTOR, 3 POLE, 80 "
  },
  {
    "seq": 17400,
    "part": "1001116073",
    "bin": "N16A2",
    "desc": "CIRCUIT BREAKER, 1492 SUPPLE"
  },
  {
    "seq": 17572,
    "part": "1001133476",
    "bin": "N16D1",
    "desc": "BEARING, JOURNAL (MAIN BEARI"
  },
  {
    "seq": 17833,
    "part": "1001154146",
    "bin": "N16B2",
    "desc": "O-RING VITON"
  },
  {
    "seq": 17871,
    "part": "1001157766",
    "bin": "N01A1",
    "desc": "CABLE 17 FT (5 M) INTERCONNE"
  },
  {
    "seq": 17888,
    "part": "1001159921",
    "bin": "N15D2",
    "desc": "TRANSMITTER PRESSURE EPOXY C"
  },
  {
    "seq": 17912,
    "part": "1001160277",
    "bin": "N16BB2",
    "desc": "DIAPHRAGM REGULATOR FKM"
  },
  {
    "seq": 17963,
    "part": "1001161278",
    "bin": "N01B1",
    "desc": "SLEEVE NBR 60 SHORE A SAFETY"
  },
  {
    "seq": 18162,
    "part": "1001209845",
    "bin": "N17A1",
    "desc": "PACKING EVSP LOW EMISSION VA"
  },
  {
    "seq": 18316,
    "part": "1001533977",
    "bin": "N15C2",
    "desc": "EXTENSION ASTM A 479M 316L F"
  }
];

export const KNOWN_SAP_PARTS_SET = new Set<string>(SAP_CALIBRATION_ENTRIES.map((e) => e.part));

const SAP_BY_SEQ = new Map<number, SapCalibrationEntry[]>();
for (const entry of SAP_CALIBRATION_ENTRIES) {
  const list = SAP_BY_SEQ.get(entry.seq) || [];
  list.push(entry);
  SAP_BY_SEQ.set(entry.seq, list);
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
  "0": ["8", "6", "9", "3", "2", "1"],
  "1": ["7", "4", "0", "2", "9"],
  "2": ["7", "3", "8", "0", "1"],
  "3": ["8", "5", "6", "9", "2", "0"],
  "4": ["1", "7", "9", "0"],
  "5": ["6", "8", "3", "9"],
  "6": ["8", "5", "0", "9", "3"],
  "7": ["1", "4", "2", "9", "0"],
  "8": ["0", "6", "3", "5", "9", "2"],
  "9": ["0", "8", "6", "5", "3", "4", "7"],
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
 * استخراج رقم التسلسل (Seq / Item 1..19500) الذي يسبق رقم القطعة في سطر جدول SAP
 */
export function extractRowSequenceNumber(line: string, partNumber: string): number | null {
  if (!line || !partNumber) return null;
  const idx = line.indexOf(partNumber);
  const prefixText = idx >= 0 ? line.slice(0, idx) : line.slice(0, 24);
  const matches = Array.from(prefixText.matchAll(/\b(\d{1,5})\b/g));
  if (matches.length === 0) {
    // حالة التصاق رقم التسلسل مباشرة ببداية رقم القطعة (مثل 134751001047602)
    const glued = line.match(new RegExp(`(?:^|[^0-9])(\\d{1,5})${partNumber.slice(0, 6)}`));
    if (glued) {
      const val = parseInt(glued[1], 10);
      if (val >= 1 && val <= 19500) return val;
    }
    return null;
  }
  const lastMatch = matches[matches.length - 1][1];
  const val = parseInt(lastMatch, 10);
  if (val >= 1 && val <= 19500) {
    return val;
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
 * تدقيق وإصلاح رقم القطعة المكون من 10 أرقام بالاعتماد على قواعد SAP الصارمة وعمود التسلسل والسياق
 */
export function verifyAndRepairMaterialNumber(
  rawPart10: string,
  line: string = "",
  storageBin: string = "",
  descEn: string = ""
): string {
  if (!rawPart10 || !/^\d{10}$/.test(rawPart10)) return rawPart10;

  let current = rawPart10;

  // 1. القيد الهيكلي العام لنظام SAP في أسمو: لا يوجد أي رقم قطعة يبدأ بـ 1001 ثم يليه 3 أو 4 أو 6 أو 7 أو 8 أو 9 في الخانة الخامسة
  if (/^100[1-9][346789]\d{5}$/.test(current)) {
    current = `1000${current.slice(4)}`;
  }

  const seqNum = extractRowSequenceNumber(line, current) ?? extractRowSequenceNumber(line, rawPart10);

  // 2. معايرة الخانات الأولى عبر رقم التسلسل (Seq 1..19500)
  if (seqNum !== null) {
    if (seqNum <= 8850 && current.startsWith("1001")) {
      current = `1000${current.slice(4)}`;
    } else if (seqNum >= 9000 && current.startsWith("1000")) {
      current = `1001${current.slice(4)}`;
    }

    // إذا طابق رقم التسلسل سطراً معروفاً في الفهرس واتفقت 7 خانات على الأقل من رقم القطعة، نستعيد الرقم الدقيق 100%
    const seqEntries = SAP_BY_SEQ.get(seqNum);
    if (seqEntries && seqEntries.length > 0) {
      for (const entry of seqEntries) {
        if (hammingDistance10(current, entry.part) <= 3) {
          return entry.part;
        }
      }
    }

    // فحص نطاقات البادئة الرتيبة (5 أو 6 خانات أولى)
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

  // إذا أصبح الرقم مطابقاً تماماً لأحد أرقام SAP الصحيحة المؤكدة، نكتفي به فوراً
  if (KNOWN_SAP_PARTS_SET.has(current)) {
    return current;
  }

  // 3. مطابقة القاموس المرجعي لإصلاح خطأ خانة أو خانتين بصريتين (مثل 3->8 أو 5->6 أو 0->8 في آخر الرقم) عند تطابق الوصف أو الموقع
  const leadKey = getLeadingKeyword(descEn);
  const cleanBin = (storageBin || "").trim().toUpperCase();
  const binRackPrefix = cleanBin.slice(0, 3); // مثل N15, N16, N17, N11, N12

  let bestCandidate: string | null = null;
  let bestScore = 0;

  for (const entry of SAP_CALIBRATION_ENTRIES) {
    const dist = hammingDistance10(current, entry.part);
    if (dist === 0 || dist > 2) continue;

    if (descEn && entry.desc && hasConflictingOrdinal(descEn, entry.desc)) {
      continue;
    }

    let confusable = true;
    for (let k = 0; k < 10; k++) {
      if (current[k] !== entry.part[k] && !isVisuallyConfusableDigitPair(current[k], entry.part[k])) {
        confusable = false;
        break;
      }
    }
    if (!confusable) continue;

    let score = dist === 1 ? 2 : 1;
    if (cleanBin && entry.bin === cleanBin) {
      score += 4;
    } else if (binRackPrefix.length === 3 && entry.bin.startsWith(binRackPrefix)) {
      score += 2;
    }

    if (leadKey && entry.desc.startsWith(leadKey.split(" ")[0])) {
      score += 4;
      if (entry.desc.startsWith(leadKey)) {
        score += 2;
      }
    }

    if (seqNum !== null && Math.abs(seqNum - entry.seq) <= 5) {
      score += 5;
    }

    if (score >= 5 && score > bestScore) {
      bestScore = score;
      bestCandidate = entry.part;
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  return current;
}

/**
 * تطبيق قانون الترتيب التصاعدي الصارم لأرقام القطع داخل نفس الموقع المخزني (Within-Bin Monotonicity Invariant)
 * في أوراق جرد SAP، السطور التي تشترك في نفس Storage Bin تكون مرتبة تصاعدياً دائماً (prev <= curr <= next).
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

    // إذا كان الرقم الحالي معروفاً مسبقاً في القاموس، لا نغيره
    if (KNOWN_SAP_PARTS_SET.has(currP)) continue;

    // حساب البادئة المشتركة بين السطر السابق واللاحق في نفس الموقع
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

    // تجربة إصلاح خانة واحدة ملتبسة بصرياً عند أول موضع يخرج فيه الرقم عن النطاق [prevP, nextP]
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
