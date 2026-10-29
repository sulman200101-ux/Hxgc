# Android test build

`asmo-inventory-1.6.0-debug.apk` is the current development build (versionCode 7).

This APK is signed with a different debug key from the previously published v1.5.0 APK. It is for testing, not an in-place update of that version. Do not uninstall the existing app or clear its data to bypass the signature mismatch. Keep a verified external backup before any migration.

No real-device OCR accuracy percentage or compatibility with existing installed data is claimed. Source validation and limitations: `../docs/ASMO-DEVELOPMENT-REPORT.md`.

## Current test build: 1.6.1

`asmo-inventory-1.6.1-debug.apk` includes separate inventory/operations screens with swipe navigation and bundled local OCR engine/language assets. A clear synthetic sheet was read with external network blocked. Real customer-sheet and Android-camera accuracy remains unverified. This build uses the same certificate as the test 1.6.0 APK in this directory, but not the previous published 1.5.0 APK. Keep a verified backup before any update.

Latest trial: `asmo-inventory-1.6.2-debug.apk` (versionCode 9). Adds fallback image rotation and SAP PAA/ZYD unit support based on the visually received sheet. The exact customer attachment was not run through the shell OCR test; handwritten marks still require review. Signing key is unchanged from test versions 1.6.0/1.6.1.

Latest trial: `asmo-inventory-1.6.3-debug.apk` (versionCode 10). Duplicate source rows are preserved and can request explicit supervisor-approved addition of their combined quantity to the existing part balance. One stock record is retained; original rows and approval are recorded. Normal inventory rows without an additional-stock request do not increase the balance. Tests: 70 service/browser checks, offline OCR synthetic checks and UI duplicate-approval flow. Real handwriting remains subject to manual review.

Latest trial: `asmo-inventory-1.6.4-debug.apk` (versionCode 11). The scanner starts with camera/album buttons, with album allowing one or many sheets and automatic local reading. The issue action opens the camera immediately. Transfer stays inside item controls; item rows/cards also have verified/unverified actions. Row review and supervisor approval remain required before stock changes. Browser capture, album one/two-image OCR, status-toggle/cancellation and duplicate-quantity approval tests passed. Physical Android camera permission behavior still needs device confirmation. Test signing key is unchanged from 1.6.0–1.6.3.
