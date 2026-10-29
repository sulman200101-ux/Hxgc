# ASMO development report

Branch: `feat/asmo-inventory-safety`. No merge into main.

## Implemented

- IndexedDB version 7 upgrades stores and indexes in place. Startup no longer deletes malformed legacy records, rewrites quantities, or automatically seeds sample stock. Public reads return copies.
- Durable before/after audit events share the same IndexedDB transaction as stock mutations. Wiping stock retains audit history and before-images.
- JSON backup includes inventory, audit history, documents and original image bytes. Restore validates inventory before writes, merges without clearing existing records, archives imported audit history, and preserves existing document approvals to prevent replay. Backups contain sensitive business data and are not encrypted.
- Four-digit local supervisor PIN uses salted PBKDF2-SHA256 (600,000 iterations), temporary lockout after repeated failures, verified changes, and migration of the previous plaintext PIN. No owner-selected PIN is embedded in source. The former unauthenticated reset control was removed.
- Separate issue, receipt, inventory and transfer document panels support manual entry and provisional photo OCR, original-image retention, explicit row review, draft submission and separate supervisor approval. Document IDs are unique. Approval atomically checks current stock and prevents duplicate application and negative quantities. Exhausted records remain in history and are hidden from the default available view.
- Reviewed inventory `-N`, including `- 1`, deducts N once on approval; overdraw is rejected. F1/F2/F4 patterns are excluded from updates. Blank, check and cross marks are distinct. Inventory does not replace book quantity with the OCR QTY value.
- Transfer requests retain old/proposed locations, quantity, reason, requester, approval and execution time. Legacy transfer controls also create a document before supervisor approval. Manual item editing cannot bypass the transfer workflow by changing location.
- Seven selectable PDF report views cover inventory, missing/shortage, unverified items, issues, receipts, transfers and audit events. Arabic and English descriptions and technical dimensions remain separate from part identity.
- Removed automatic repair of ambiguous part numbers and hardcoded substitutions of specific parts. The legacy bulk OCR save is blocked; the document workflow is the reviewed replacement. Plain-text OCR no longer invents QTY or issued quantities.
- Repaired package-lock synchronization and existing TypeScript errors in the Capacitor config and Flutter viewer. Added reproducible Playwright/Chromium regression tests and npm test/typecheck commands. Updated Android generated web assets from the current web build.

## Validation

- `npm ci --no-audit --no-fund`: passed after lockfile repair.
- `npm run lint` and `npm run typecheck`: passed. Both currently invoke TypeScript; this repository has no separate ESLint configuration.
- `npm test`: real Chromium/IndexedDB regression suite; 45 checks passed.
- `npm run build`: passed; remaining warnings concern CSS import ordering, large bundle size and future Vite native config loading.
- `npm run dev`: started; HTML request and missing-image API response verified.
- Browser UI smoke: receipt draft, initial PIN setup, supervisor approval, report rendering and a PDF download passed with no page errors.
- `npx cap sync android`: passed.
- APK: **not built**. Gradle download succeeded using JVM proxy properties, then compilation setup failed because the installed Java 21 runtime lacks the JDK compiler. Android SDK is also not configured. No signed release APK was produced.

## Remaining limitations

- This is a local, single-supervisor implementation. The PIN is not server-side identity, tamper-resistant storage, or a multiuser role/approval system. Multiuser deployment needs authenticated employee and supervisor identities and an authoritative backend. Clearing browser storage can remove local protection and data; external backups remain essential.
- OCR correctness on real handwritten, shadowed, tilted or inverted customer sheets has not been validated. All extracted rows require review. Original document number is entered manually. Table fields Plant, Area and Bun are not modeled independently yet.
- Transfers currently move the complete available balance for a part. Partial multi-bin stock and intelligent location-planning suggestions remain to be implemented.
- Stock document UI currently has no editing/rejection workflow after saving a draft. A cancelled approval leaves a pending document rather than changing stock.
- Reports have a verified general PDF path; exhaustive pagination and physical Android print/share behavior remain unverified. Long audit snapshots may need a more compact report layout.
- Existing terminal data cannot prove a successful future snapshot restore, publication, or real-device behavior. Environment draft saving is separate from publication.

## Main files

`src/services/db.ts`, `src/services/security.ts`, `src/services/documents.ts`, `src/App.tsx`, `src/components/AuthorizationDialog.tsx`, `DataSafetyPanel.tsx`, `StockDocumentsPanel.tsx`, `ReportsPanel.tsx`, `WipeDatabaseModal.tsx`, `FlutterCodeViewer.tsx`, `src/utils/regexSanitizer.ts`, `strictTableParser.ts`, `src/services/geminiVisionService.ts`, `server.ts`, `capacitor.config.ts`, `package.json`, `package-lock.json`, `tests/inventory-safety.mjs`, `README.md`, and generated Android web assets.

## Follow-up: document replay and audio

Document IDs remain unique and normalized, but original images no longer impose uniqueness. The same image can be saved with changed part numbers and a new document ID. IndexedDB v7 drops the old unique image index without deleting documents or stock. Part numbers remain inventory primary keys: an approved receipt updates an existing part rather than inserting a duplicate. New location codes are normalized; location summaries group case/spacing variants into one card. Multiple different parts can share that location. Duplicate part rows inside one document remain rejected. Approval replay protection still prevents applying a given issue document twice.

A successful committed issue plays an ascending success tone. Provisional OCR plays a separate uncertainty warning and requires manual review. A duplicate document ID plays an already-saved warning. Device volume and browser autoplay policy may affect audible playback; text warnings remain visible. Tests verify distinct scheduled tone patterns; physical speaker output is not verified.

GitHub API access returned Forbidden. The environment draft now requests api.github.com, preserving the existing package-manager network preset. That draft change is not yet applied or published. A PR cannot be claimed until GitHub confirms creation.

## Translation library and issue approval

Installed @huggingface/transformers for optional browser/WASM English-to-Arabic suggestions using Xenova/opus-mt-en-ar. The native Node/CUDA extra download is unnecessary for this browser workflow; the official ONNXRUNTIME_NODE_INSTALL=skip installation option is used. Technical dictionary translation remains immediately available. Both item editing and stock documents have explicit translation controls; the original English is retained in description_en and Arabic suggestions in description_ar, with original numeric specifications appended if missing from the suggestion.

Model weights have **not** been downloaded or validated: huggingface.co returned HTTP 403 from the egress proxy. Relevant model-download destinations are saved in the environment network draft. Review/apply those settings before retrying model download. Installing the JS library does not establish model readiness. The full general-purpose model translation path remains unverified.

Issue review now displays current, requested and projected balances, the original document image, an explicit “اعتماد الصرف وإنقاص المخزون” action, and a committed approval marker. Unclear OCR still requires manual correction; no claim of perfect sheet recognition is made.

Item names are displayed as one group with Arabic above the original English, including edit forms, document rows and reports. Storage keeps the two values separate. The initial push was rejected by GitHub private-email protection; only this task's new commit will be amended with a noreply Codex identity before retrying.
