# Preview verification — October 16–17, 2026

## Version 0.1.2 — embedded-course session HTML, October 17

The user correctly reported that 0.1.1's 3 KB text-reading HTML was not the webpage and contained only the Amazon Learn outer player. The inherited `parseTextFromDOMSnapshot` returned after its first document. That return is moved outside the document loop. More importantly, text extraction is no longer presented as full webpage export.

0.1.2 adds a separate visual-capture path: a named isolated-world observer notifies the extension of document changes/clicks; Chromium `Page.captureSnapshot(format:mhtml)` serializes the selected page with accessible frames and resources; the local parser/store retains changed states and content-addressed shared assets. Capture is serialized/debounced with bounded queued work; Pause/Finish awaits work and takes a final in-scope state. Serialization errors and preview limits are visible. Normal network/WACZ recording remains in place. Existing archives are not cleared or migrated, and their missing visual states cannot be retroactively fabricated.

Automated checks cover MIME folded headers, quoted-printable/Unicode, incomplete input, nested frames, HTML sanitization, original-script/input-value removal, all-frame text extraction, missing-resource reporting, rejection of visual export for old archives, separate navigation bridges in nested `srcdoc`, inline-asset runtime generation, mapped embedded-frame transitions, unvisited-action warnings, capture coalescing, awaited finish and capture failures. Browser fixture additionally verifies normalization of generated MIME frame IDs avoids a false third state.

Final source checks: **33 automated tests passed**, TypeScript type checking and source lint passed. The production-optimized bundle and 0.1.2 package are built in place; normal bundle-size warnings remain. The installed folder path is still `dist/ext`, so users must Reload the existing extension, not install another identity.

The browser test seeded **invented Chromium-format captures**, not a real debugger capture. It ran the actual MIME parser, native IndexedDB visual store and production `createLocalExport`. Three fixture captures (including an unchanged repeat with different generated frame IDs) produced **two stored states**, both at the same top-level URL and both with a cross-host lesson frame, shared stylesheet and SVG image. The real browser downloaded one **14,856-byte HTML** and a **1,085-byte Markdown**. Files are `test/artifacts/visual-session-demo.html` and `.md`. Markdown contains the lesson text from both embedded states, not just the wrapper.

The actual HTML was served unchanged through the loopback test server. It rendered the original fixture's green layout and embedded tool illustration inside the nested lesson. The exported **Next** control switched from “Inspect before use” to “Label both ends” while remaining in the same HTML (`#state-2`). Screenshot: `test/artifacts/visual-session-proof.jpg`. Shared asset bytes occur once in the embedded manifest; data URLs are expanded in memory for opaque sandbox frames. A first Blob-asset implementation did not render those assets, and was replaced before release.

**Boundaries:** the browser tool's policy blocks direct `file://` navigation, so double-click/open-from-disk behavior still needs manual Edge confirmation; no bypass was attempted. The tool could read but not activate the nested sandbox lesson button, so that exact pointer path is covered by runtime unit checks, not claimed as a browser click success. The visible top-level Next navigation is browser-verified. Actual extension installation, debugger capture and the user's Amazon course are not verified in this environment. No employer content, credentials, completion actions or private recordings were accessed in this test. This remains a preview, not production certification.

Historical 0.1.1 and 0.1.0 results follow; their “HTML” refers to the older text-only format.

## Version 0.1.1 export repair — October 17

The 0.1.0 library linked Downloads to a service-worker URL. The user reported `Couldn't download — Network issue`. The exact Edge diagnostic is unavailable here; the local code path is confirmed, but the precise browser failure is not. Version 0.1.1 no longer uses that URL: it reads the existing IndexedDB collection in the library page, creates the file locally, and downloads a Blob URL. It does not clear, recreate or migrate existing archive stores.

Three formats are available: ordinary reading HTML, source-text Markdown, and native WACZ. HTML/Markdown are not full interactive website mirrors. They use captured page text, consolidate repeat visits to the same exact URL, fall back to inert saved-HTML text extraction, and report missing readable coverage. The HTML parser never runs page scripts or fetches original resources.

**22 automated tests passed**, including new tests for download completion, cancellation/interruption, pending URL retention, stream errors/limits, missing text, URL grouping, Unicode, safe text extraction and escaped output. Type checking and source lint passed. The production-optimized build completed with bundle-size warnings.

In the in-app browser, a synthetic fixture seeded the real native IndexedDB store with three visits/two page URLs. The same production `createLocalExport` code downloaded an ordinary HTML file (2,372 bytes), Markdown (698 bytes), and WACZ (5,096 bytes), directly from that store. The actual downloaded WACZ passed ZIP integrity checks. HTML/Markdown contain the captured DOM-only text, newly revealed lines and saved-HTML fallback; scripts, hidden test text and input values are excluded from the reading output. The files remain in `test/artifacts/reading-demo.html`, `reading-demo.md`, and `direct-export-demo.wacz`.

The test browser uses a standard Blob-link fallback; native `chrome.downloads` completed/interrupted behavior is covered by injected API tests, **not** a real Edge integration test. The user's failed archive has not been accessed or converted by the agent. They must reload the same extension installation and retry it. New downloads permission may require acknowledgment. Do not uninstall or clear extension storage.

The actual downloaded HTML rendered in the browser, and its contents link navigated within that same HTML to the second page. Visual proof: `test/artifacts/reading-export-proof.jpg`. The 0.1.1 release includes synthetic HTML/Markdown examples in `examples/` for inspection before using private recordings. No employer content is included in those examples.

Version 0.1.0 results below are retained as history, not evidence of the revised Edge download path.

## Verified

- The upstream extension build configuration successfully compiled the actual Webrecorder recorder and replay service-worker engines with the PageTrail control adapter.
- Automated session checks cover consent, one collection across Pause/Resume, finishing, duplicate/concurrent starts, recovery after restart, failed attachment, failed finish, unexpected disconnect, tab isolation and host/subdomain boundaries.
- Privacy helper checks cover case-insensitive credential-header removal and obvious authentication endpoint exclusion.
- The actual upstream `Downloader` exported one 14,995-byte WACZ from nine explicitly fetched synthetic resources and three page URLs. The exporter stored duplicate HTML using WARC revisit references. This fixture is **not** an actual extension capture.
- Archive tests verify resource byte counts, SHA-256 digests, WACZ version/manifest/page list/index, original HTML links/scripts, two distinct API query responses, and an embedded frame.
- In the in-app browser, the locally bundled ReplayWeb.page loaded that WACZ after the original source process on port 4176 was stopped. The original **Load cables lesson** button fetched the saved cables API result. The original **Tools lesson** link navigated to the saved route with its query intact and loaded the tools API result. The embedded frame and Unicode text were visible. An uncaptured link displayed **Archived Page Not Found** rather than silently opening the live site.
- The packaged `interactive-demo.wacz` was also reopened directly from disk through the new **Open local WACZ** standard file input. Its page list loaded, the original home page opened, **Load cables lesson** returned the saved API data, and **Tools lesson** navigated to the captured route. This verifies the file-import fallback without relying on the newer File System Access picker. The latter was intercepted by the embedded test browser and is not counted as tested.

Final checks: **14 tests passed, 0 failed**, TypeScript type checking passed, and linting of the added control/adapter source passed. The production-optimized bundler completed with three bundle-size/performance warnings, not build errors. These are not a production-readiness certification.

The release is `release/PageTrail-Replay-0.1.0-preview.zip` with the extension, separate reader, synthetic demo archive, license, usage/attribution and verification guides, screenshot and per-file SHA-256 manifest. Visual evidence is retained at `test/artifacts/offline-replay-proof.jpg` and included in the release. A checksum validation verifies all packaged files against that manifest.

## Not yet verified / production gates

This chat has an in-app browser but no connected Edge extension-control surface. The unpacked extension has **not** been installed or exercised in the user's Edge profile by the agent. No employer content or credentials were used.

Before considering this production-ready:

1. Run a real Edge capture of the synthetic site: Start → original links/API buttons → Pause → unrecorded change → Resume → Finish → one WACZ download → import in the separate reader with the source stopped. Verify debugger banner, permissions and download completion.
2. Test a single permitted completed course with its actual frames/content hosts. Check replay with Internet disabled and confirm no LMS completion/progress mutations are performed by automation.
3. Add browser-driven extension tests for quota/disk failure, large streaming exports, interruption during export, debugger contention, target close, tab reload, service-worker restart and cleanup barriers.
4. Add disk-space alerts, hard recording limits, archive management/retention, accessibility review, release upgrade/migration tests, and URL/request-body/data-redaction review. Existing headers filtering is not sufficient for public sharing.
5. Complete dependency/license/security audits, test unsupported applications/media behavior, package signed installers if needed, and run clean-profile cross-version Edge/Chrome acceptance tests.

No whole-domain crawling is implemented; no claim is made that arbitrary server behavior or undiscovered content is preserved. This is a testable local preview, not a production certification.
