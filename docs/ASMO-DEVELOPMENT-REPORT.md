# ASMO development report

Branch: `feat/asmo-inventory-safety`. No merge into main.

## Current functionality

- IndexedDB v8 upgrades stores/indexes in place, preserves legacy records and stock history, and no longer seeds or cleans records destructively. Missing Arabic descriptions and categories are enriched using the technical dictionary, with recoverable before/after audit events. Custom translations, original English names, quantities, locations, statuses and historical approvals remain intact.
- Mutations and audit events share a transaction. Wiping stock preserves audit history. JSON backup includes inventory, audits, documents and original image bytes. Restore merges without clearing existing data and retains existing document approvals. Backups are not encrypted.
- Supervisor PIN uses salted PBKDF2-SHA256 (600,000 iterations), temporary lockout and verified changes. The old plaintext PIN is migrated. No owner PIN is embedded in source. This is local single-supervisor protection, not a multiuser authentication backend.
- Separate issue, receipt, inventory and transfer documents retain originals, require explicit row review, and need supervisor approval before changing stock. Document IDs are normalized and unique. Reapplying an approved document is rejected. Negative stock is rejected and zero-balance items stay in history.
- Inventory `-N`, including `- 1`, deducts N once after approval; F1/F2/F4 increases are excluded. Blank, check and cross marks remain distinct. Existing book quantities are not replaced by OCR QTY. Reviewed initial inventory can add new part numbers.
- Part number is the inventory identity. Saving a changed part number from the same photo is allowed. Existing part receipts update the existing record rather than creating another. Location codes are normalized and grouped into one card. Multiple different parts can share a location. Duplicate part rows inside one document are rejected.
- Transfer documents retain old/proposed locations, quantity, reason, requester, approval and execution time. Partial transfers are not yet supported. Direct item editing cannot bypass the transfer workflow.
- Seven PDF report views cover inventory, shortage/missing, unverified items, issues, receipts, transfers and audit operations. Arabic names appear above original English names, with storage kept separate.
- Distinct audio patterns indicate duplicate document, committed issue and uncertain reading. Text feedback remains available if autoplay or device volume prevents audio.
- @huggingface/transformers is installed for optional browser/WASM English-to-Arabic suggestions. The technical dictionary works without model weights. English originals and numeric technical specifications are retained. General model weights could not be downloaded because the egress policy denied Hugging Face; that translation path is not validated.

## Reading many sheets

The “قراءة وحفظ عدة أوراق دفعة واحدة” panel accepts multiple images. Images are processed sequentially to limit OCR memory use; workers are released after success or failure; failure of one sheet does not stop the rest. Each original remains available for comparison. Failed sheets can be retried or transcribed manually. Unread quantities remain empty rather than silently becoming zero. Every row and document number needs review before saving.

All reviewed drafts are saved in one IndexedDB transaction, without changing stock. A duplicate document aborts the complete save. The supervisor can approve a batch with one PIN check. Approval applies documents/lines sequentially in one transaction, including repeated parts across sheets. Shared balances therefore cannot suffer lost updates or cumulative overdraw. A failure rolls back every approval, stock change and audit event from that request. Inventory rescans do not multiply book quantities; receipt documents deliberately add incoming quantities.

Current input is image files, not multipage PDF files. No measured OCR accuracy percentage is available for real customer sheets. Human review is required; the checkbox records review, not proof of OCR correctness.

## Validation

- Frozen dependency install passed: `ONNXRUNTIME_NODE_INSTALL=skip npm ci --no-audit --no-fund`. This is the library's official option for skipping unneeded native Node/CUDA extras; browser WASM remains enabled.
- `npm run lint` and `npm run typecheck`: passed. Both currently run TypeScript; there is no separate ESLint configuration.
- `npm test`: **63 checks passed** using real Chromium and IndexedDB. Includes v6/v7 upgrades, v8 enrichment, preserved originals, PIN, quantities, replay prevention, transaction rollback, batch sequencing and duplicate records/locations. OCR queue failure tests use controlled reader results; they do not measure OCR recognition quality.
- `npm run build`: passed. Existing warnings concern CSS import order, future Vite config loading and bundle size.
- `npm run test:ui` (with the development server running) passed for the batch workflow. Browser smoke tests passed: receipt creation, PIN setup, approval and PDF download; selecting two sheet images, reviewing both drafts, saving together and approving with one PIN. Repeated inventory part remained one record with unchanged balance and one location. No browser page errors in those flows.
- `npx cap sync android`: passed.
- Full Android `assembleDebug assembleRelease` build passed after installing JDK/SDK. No phone/emulator installation or real-camera check was performed.

## Android tools and update compatibility

Installed outside the repository in `/workspace/asmo-tools`:

- Temurin JDK **21.0.13+9**, verified against its official SHA-256.
- Android command-line tools **23.0**, verified against Google's archive checksum and pinned SHA-256.
- Platform Tools **37.0.1**, Android API **35**, Build Tools **35.0.0**.

Activate each shell with `source /workspace/asmo-tools/android-env.sh`. The environment script preserves the session HTTPS proxy for Java and the system CA truststore. `/workspace/asmo-tools/install-android.sh` was run successfully and rerun to verify repeatability. Complete install/start instructions are saved in the environment draft; saving is separate from publication.

The project keeps `com.asmo.inventory` and the HTTPS WebView origin, and increments versionCode from 6 to **7** (versionName **1.6.0**). Code/data migration tests pass. However, **the current APK is not a compatible in-place update of the published v1.5.0 APK**:

- Published v1.5.0 signing certificate SHA-256: `99caeaf4d339c85eede322cee9229446bee7893e3e3d20f712a4b777d0556131`.
- Current local debug signing certificate SHA-256: `8c724c2404daaa26945f7b9203be1f23d5447e976d57e4055e9d53237318c1e0`.

The previous APK uses an Android Debug key. No private keystore was found in the repository or its full history. The old GitHub Actions workflow generated debug builds and did not preserve their signing key. A certificate inside an APK cannot recreate the private key. The user reports they do not have the key. Genuine in-place installation therefore remains blocked unless that original key is recovered from its build environment. Do not uninstall the old app or clear its data to work around the signature mismatch.

Artifacts:

- `android/app/build/outputs/apk/debug/app-debug.apk`: signed with the new local debug key, **testing only**.
- `android/app/build/outputs/apk/release/app-release-unsigned.apk`: **unsigned**, requires a suitable signing process.

## Remaining limitations

Real-device OCR/handwriting accuracy, distortion/rotation/shadow cases, authenticated multiuser roles, partial/multi-bin transfers, intelligent location planning and general model translation quality are not validated or complete. Plant, Area and Bun are not separately modeled. Saved document drafts currently have no editing/rejection workflow; cancelling approval leaves them pending. Long audit/PDF pagination and Android print/share behavior need device validation. No fresh-task snapshot restoration or environment publication is claimed. GitHub API access was denied, so no PR creation is claimed; the development branch is uploaded separately.

## Main files

`src/services/db.ts`, `documents.ts`, `batchOcr.ts`, `security.ts`, `partTranslation.ts`; `src/components/BatchDocumentsPanel.tsx`, `StockDocumentsPanel.tsx`, `AuthorizationDialog.tsx`, `DataSafetyPanel.tsx`, `ReportsPanel.tsx`, `WipeDatabaseModal.tsx`, `ItemModal.tsx`, `ItemsTableView.tsx`, `FlutterCodeViewer.tsx`; `src/App.tsx`, `src/types.ts`, OCR services and parser utilities; `tests/inventory-safety.mjs`; `android/app/build.gradle`, Capacitor config, generated Android web assets, package manifests/lockfile and README.

## 1.6.1: separate screens and local OCR repair

Inventory and operations/reports now occupy separate screens, with right/left swipes and navigation buttons. Hidden screens retain draft state; vertical scrolling and form/table gestures do not switch screens. Browser tests cover navigation, horizontal/vertical gestures and draft retention.

Replaced the legacy Gemini-only scanner with the reviewed local document workflow. Build/dev scripts package Tesseract's worker, scalar WASM core and English language data into the app, so runtime downloads and Gemini credentials are unnecessary for local OCR. The original image is read first; enhancement is a fallback and does not rotate the image automatically. Numeric quantity is proposed only from the bounded field after the storage bin/unit; unknown values require manual entry. Technical descriptions retain original suffixes such as M16 rather than being reduced to a dictionary term.

`npm run test:ocr` reads a real generated image through the production OCR function with all external requests blocked, checking exact part number, bin, quantity and M16 specification. This validates the engine path on a clear synthetic sheet, not recognition accuracy on the user's actual sheets or handwriting. A physical-device test is still required. Debug versionCode is 8 / versionName 1.6.1; its certificate matches the uploaded 1.6.0 test APK. It does not match the old 1.5.0 certificate.

## 1.6.2: first visual SAP sample

A sideways SAP Inventory Controller sheet was received in chat. It visibly includes Plant/Area/Bun columns, PAA/ZYD units and handwritten Check/Remark cells. No image file was available to the shell runner, so this report does not claim an OCR execution or measured accuracy on that exact attachment. Added fallback rotation attempts when no usable part/bin pairs are found, and bounded quantity extraction for PAA/ZYD units. Offline real-engine tests pass on upright and rotated synthetic images plus SAP-shaped text rows. Handwritten check/remark values still require human review; no inference of a blank mark as checked is allowed. Version 1.6.2 uses versionCode 9 and the existing test signing key.

## Second visual SAP sample

A second chat image shows repeated Material 1000428938 in bin N12A2 with PK quantities 3 and 6. The parser now preserves repeated source rows instead of silently keeping the first. Both single-sheet and batch review display a duplicate warning; existing document validation blocks saving until the operator reconciles the rows. Quantities are not automatically summed and inventory identity remains unique. Regression checks use a transcription of those printed columns; they do not establish handwriting recognition or whole-image OCR accuracy for the attachment. This source change needs inclusion in the next test APK after sample review.
