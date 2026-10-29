# Android test build

`asmo-inventory-1.6.0-debug.apk` is the current development build (versionCode 7).

This APK is signed with a different debug key from the previously published v1.5.0 APK. It is for testing, not an in-place update of that version. Do not uninstall the existing app or clear its data to bypass the signature mismatch. Keep a verified external backup before any migration.

No real-device OCR accuracy percentage or compatibility with existing installed data is claimed. Source validation and limitations: `../docs/ASMO-DEVELOPMENT-REPORT.md`.

## Current test build: 1.6.1

`asmo-inventory-1.6.1-debug.apk` includes separate inventory/operations screens with swipe navigation and bundled local OCR engine/language assets. A clear synthetic sheet was read with external network blocked. Real customer-sheet and Android-camera accuracy remains unverified. This build uses the same certificate as the test 1.6.0 APK in this directory, but not the previous published 1.5.0 APK. Keep a verified backup before any update.

Latest trial: `asmo-inventory-1.6.2-debug.apk` (versionCode 9). Adds fallback image rotation and SAP PAA/ZYD unit support based on the visually received sheet. The exact customer attachment was not run through the shell OCR test; handwritten marks still require review. Signing key is unchanged from test versions 1.6.0/1.6.1.
