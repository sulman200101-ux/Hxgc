# Android Build v2.4.0

`asmo-inventory-v2.4.0.apk` is the current unified release build (`versionCode 21`, `versionName "2.4.0"`).
All older APK builds (`v1.0.0` through `v2.3.0` and `v3.0.0`) have been removed and superseded by `v2.4.0`.

## Key Features in v2.4.0
- Strict 15-item shelf limit (`MAX_ITEMS_PER_SHELF = 15`) with automatic overflow redistribution (`A1 -> A2 -> B1 -> B2 -> BB1 -> BB2`).
- Dedicated shelf consolidation for the top 15 most expensive parts (`رف القطع الأغلى سعراً`) with SAR unit/total price estimation.
- Heavy-duty part routing across `D` and `C` locations (`isCLocation` & `isHeavyDutyDOrCLocation`), capped at 15 items per shelf.
- Pure 37-row SAP calibration sheet OCR without static fallback rows, powered by server-side Gemini Vision + local Tri-Band OCR.
