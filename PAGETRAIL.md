# PageTrail Replay — 0.1.2 public beta

## Phase 6 — practical beta verification (October 21–22, 2026)

Phase 6 adds a repeatable beta gate without changing recording data. Run `npm run verify:beta` from the project root. It executes the full PageTrail test suite, TypeScript and source lint; builds the synthetic demos, local reader and production extension; creates the beta package; verifies its required files, SHA-256 manifest and ZIP integrity; and rejects private-file patterns or unexpected WACZ recordings. The machine-readable result is written to `test/artifacts/beta-verification/beta-verification.json` and remains ignored by Git.

Automated success is only the first half of this phase. `BETA-ACCEPTANCE.md` contains the practical installed-Edge checks for in-place reload, preservation of existing recordings, Start/Pause/Resume/Finish, controlled crawl, every export format, cancellation/retry, WACZ replay, portable-note import and privacy-minimised diagnostics. Use invented local content first. Do not uninstall the existing extension, clear its storage, test private courses, publish recordings or treat a synthetic pass as production certification.

The `0.1.2-beta.1` candidate passed the automated gate and an installed-Edge re-export. The authorised interactive workload retained all 11 detected outline sections, resolved all 61 packaged image assets and omitted no media reference. Forty large raster inputs were reduced from 55,598,819 bytes to 2,933,540 bytes, producing a 10,797,273-byte learning package. The source recording still reported one visual gap; the release does not claim capture completeness or production/security certification. No browser-store submission is included.

The sections below retain the development history that led to this beta.

## Phase 5 — portable learning exports (October 20, local/unreleased)

In **Offline exports**, select a finished recording, choose **Portable learning package · ZIP**, then **Export**. This adds a reading/migration format without replacing Website HTML or WACZ. It uses the existing background worker, progress, cancellation, retry and download flow. Nothing is uploaded or sent to AFFiNE.

Unzip the downloaded package:

- `PageTrail - <title> - Detailed notes.md`: structured captured source material, with headings, lists, tables, code, explicit captured-section references and saved supported images. Distinct same-URL captures and embedded documents remain separate with source URLs and capture times. The ASCII-safe descriptive filename becomes a useful imported page title.
- `PageTrail - <title> - Quick revision.md`: mechanically selected, labelled source excerpts, with exact detailed-section names instead of custom-anchor links that some notes apps silently break. These are source-derived review points, not validated study guidance; completion status is unknown.
- `index.html`: a local reading copy with working section navigation and links to the package's deduplicated `assets/` folder. Keep the unzipped package together. This is a clean reading layout, not the original interactive website.
- `assets/`: deduplicated saved PNG/JPEG/GIF/WebP images, sanitized SVG geometry and original PDF attachments for Markdown migration. Keep this folder beside the Markdown files. Import behavior varies by notes app; check images/attachments after import.
- `manifest.json`: source provenance, extraction mode, capture coverage, warnings and SHA-256 hashes/byte counts for every other packaged file.
- `README.txt`: offline reading, import and privacy instructions. The text extension prevents Markdown-with-media importers from creating an unwanted third note.

The exporter reads existing visual captures first, including captured frames; older archives fall back to saved HTML/page text and disclose that limitation. It does not fetch missing resources or infer unvisited content. Missing/unsupported assets, text-only fallback and capture gaps are reported. Original scripts, forms, input values and inline-hidden elements are excluded from parsed HTML; CSS-based visibility beyond inline styles is not reconstructed. Source text and URLs can still be confidential. Review before sharing. Original PDF contents are not sanitized; use a PDF viewer. Inline SVG, audio/video, canvas and arbitrary website behavior are not reproduced in reading content; stored SVG image attachments are sanitized and may render differently.

Learning exports enforce 2,000 documents, 2,000 attachment lookup keys, 5 MB per included notes asset, 20 MB total included notes media, 10 MB combined source text per document, 100 MB cumulative input and generated-package budgets, and a 200,000 rendered-node limit. Raster images over 768 KB are reduced to bounded static WebP previews when the browser can decode them and the result is materially smaller. Originals remain in the recording and archival formats. Nested list/table subtrees are reused instead of rendered repeatedly. These limits do not guarantee peak browser memory or capture completeness. Native offline replay still uses WACZ plus the local reader.

AFFiNE self-hosted web import was validated with an invented Markdown-with-media ZIP on October 20. Headings, bold/italic text, Unicode, ordered/nested lists, tables, fenced/inline code and both PNG/SVG images survived; images were uploaded as local AFFiNE blobs at their original dimensions. The tested importer used archive filenames as AFFiNE page titles. It stripped custom HTML anchor targets, leaving section links nonfunctional, and rewrote a linked local PDF into an invalid external `https://assets/...` URL instead of attaching it. PageTrail now emits descriptive ASCII filenames, plain exact-section references and non-clickable saved-PDF paths; `index.html` retains working in-file navigation and embedded PDF links. To place a PDF inside AFFiNE, upload it manually from the unzipped `assets/` folder. The initial synthetic import created `notes`, `quick-revision` and `README` test pages before these fixes; they were intentionally left in place because existing notes were not to be modified or deleted.

Local sample and automated verification is recorded in `test/VERIFICATION.md`. The same `dist/ext` folder was rebuilt with an unreleased Phase 5 label. Reload the existing extension only after ending any active recording; do not uninstall it or clear its storage. No Git commit, push, release, recording deletion or notes-app migration was performed.

## Phase 4 — controlled crawling (local/unreleased)

The extension popup now includes **Controlled crawling**. Start recording, expand this section, enter an explicit path inside the recording boundary, choose a page limit and link depth, acknowledge automatic visits, and select **Start crawl**. `/` explicitly includes the exact recording origin; neighbouring subdomains and ports are not included. The current content page must be within the chosen path. The crawler uses the recording tab, so leave that tab to it until it pauses or finishes. It retains the same archive and existing HTML, Markdown and WACZ export paths.

The queue follows ordinary anchor links breadth-first, removes fragments for duplicate detection and retains distinct query URLs within bounded limits. Defaults are 20 page attempts and depth 2; supported limits are 1–50 attempts and depth 0–3. At most 200 URLs are queued and 1,000 links inspected per page. A page gets a 30-second deadline, waits for document completion and at least one second without pending captured work, then awaits visual capture and coverage persistence. A 10-minute accumulated visit budget is checked between pages; a final visit/cleanup can extend elapsed wall time. The existing recording byte limits still apply. Visited means the navigation/discovery step finished, not that every resource or visual capture succeeded: inspect the separate capture coverage before exporting.

**Pause crawl / Resume crawl / Stop crawl** operate the crawl queue; recording remains active. **Pause recording / Finish session** stop further automatic visits before draining the recorder. The queue and attempt counts persist locally; an interrupted running crawl becomes paused and never resumes automatically. A failed/timed-out page pauses the crawl and remains labelled failed. Resume continues other queued URLs, rather than silently retrying failed pages. Starting a new crawl replaces the current crawl queue, not earlier archive content. The popup shows visited, queued, failed and skipped-link counts.

The extension adapter uses the existing debugger connection, reads top-level anchors from an isolated DOM world, and intercepts requests during crawling. It rejects top-level navigation outside the selected boundary, known action/authentication routes, and non-GET/HEAD/OPTIONS requests in attached targets; response-stage capture is retained. Required subframe/assets may originate elsewhere. Known action links, common download/media links, forms and buttons are not followed by the queue. This is a conservative compatibility filter, **not a guarantee against server-side changes**: page scripts and GET endpoints can still have side effects. No automatic quiz interaction, robots/sitemap discovery, infinite scrolling, login automation, full-site completeness guarantee, or arbitrary SPA button crawling is implemented.

Verification on October 19: **80 automated tests passed**, type checking passed, source lint had no errors (four test-harness warnings), and production extension/sample builds passed with existing bundle-size warnings. The real HTTP sample crawl passed pause, reload-with-queue-retention, resume and completion: three pages visited, zero failed, nine excluded-link occurrences skipped. Its native WACZ export passed ZIP integrity. With the sample source stopped, the local reader imported the file, followed original Tools/Home links, reopened after reload and expanded revision content with the saved stylesheet/image and Unicode intact. This browser test uses a test-only HTTP adapter with the production queue, IndexedDB archive and exporter; CDP adapter behavior is covered with injected-command tests. Actual installed Edge debugger crawling and private-course compatibility remain unverified. See `test/VERIFICATION.md` for artifact paths and precise boundaries.

The built extension is still `dist/ext`; reload the existing installation to load this local build after active recording has finished. No reinstall, storage clearing, version/tag change, push or release is required. For repeatable synthetic QA, build `npm run build:export-demo` and run `node tools/crawl-demo-server.mjs`; open `http://127.0.0.1:4180/`. That helper serves only invented local sample content. Interactive original-site replay still uses WACZ plus the local reader; standalone HTML retains its visual-state navigation. Structured notes and AFFiNE migration remain later phases.

## Phase 3 — original-link offline navigation (local/unreleased)

**Local import update:** Open recording now fully imports resources into a separate browser-stored collection. It no longer relies on an expiring file/Blob reference for uncached lesson responses after reopening. The opaque local identity reopens that same native collection. This uses additional browser storage and never deletes older imports. Existing lazy file imports are retained; choose their original WACZ again to make a new durable import. The independent manual acceptance rerun in `test/VERIFICATION.md` records the failure found and repaired, rather than treating an HTML shell loading as proof that every interaction works.

The separate local reader now opens at the first recorded page, with the website's own interface filling the reading area. Use its original menus, links, recorded GET/API-driven buttons, expandable sections and in-page anchors. PageTrail's small toolbar supplies Back, Forward, Reload page and an **optional** Recorded pages list for finding saved destinations or recovering from a missing route. The list is hidden initially; a separate section is not required for each click. Open recording can switch to another local archive without deleting imported archives or recorder data.

**This interactive path uses one `.wacz` recording and the separately installed local reader.** It does not turn the existing standalone `.html` visual-state export into a complete executable website. HTML and Markdown exports remain available and unchanged. Missing responses, unvisited pages and server behaviour cannot be invented; automatic crawling is Phase 4, not implemented here. A client-side SPA transition may work while that page remains loaded, but refreshing/deep-linking an uncaptured SPA route can still fail. Use Recorded pages to return to a known captured route.

The reader has its own `reader-sw.js`, using the bundled replay engine without the recording proxy or extension API. Replay HTTP requests outside the reader are rejected; archive-origin requests cannot use the reader control API or static live proxy. Replay CSP disables forms, popups/top-level escapes, workers, plugins and live WebSocket connections. Original code may retarget a new-window link into the same replay frame; it does not promise native multi-window behaviour. Missing document responses show a local "This page wasn't captured" explanation, not a live-site link. A captured HTTP 404 remains the original recorded error page. This is a compatibility/read-only policy for trusted recordings, **not a hardened malware sandbox or an OS-wide network firewall**. Do not open untrusted archives. Streaming media, workers, authentication and assessment/submission flows are not supported acceptance cases.

Build just the local reader without touching release files:

```sh
cd pagetrail-replay
npm run build:reader
npm run demo:reader
```

Open `http://127.0.0.1:4175/`, choose **Open recording**, then your exported WACZ. Keep this local server running while reading; it does not require the original site or internet. The local file picker does not upload your recording. For the current isolated development test, port 4179 is running (`npm run demo:reader -- --port=4179`). Existing extension storage is separate and untouched.

After an in-place reader update, **close all tabs for that reader and reopen** if its engine is stale; do not clear browser storage. The toolbar confirms **Phase 3 · durable local replay v2** only after a validated message from the controlling reader worker. A delayed/missing confirmation displays reopen guidance. Reader-only builds are staged in `dist/reader`; release packaging and GitHub publishing remain separate, unrun steps. See `test/VERIFICATION.md` for synthetic source-off checks and remaining real-course/Edge acceptance work.

The following Phase 2 and earlier sections are retained as implementation history.

## Phase 2 — local capture reliability (unreleased)

This phase improves capture, not interactive replay or crawling. The recorder adapter is now separated into `src/pagetrail/capture-recorder.ts`; background messaging, session control, visual storage and the earlier responsive export/diagnostics work remain in place. The GitHub beta is unchanged. Build into the same `dist/ext` folder and Reload the existing extension only after finishing active work. Do not uninstall, clear storage or move the installation.

Top-level navigation now uses the **exact starting origin** (protocol, hostname and port), not nested subdomains. An optional path in the popup narrows navigation further; `/learn/course` includes that exact path and its child paths, not `/learn/coursework`. Path validation runs before an archive is created. The rule applies to top-level navigation/metadata and visual snapshots; frames, styles, images and API responses actually used by the selected in-scope tab may come from other hosts. This remains a post-navigation capture boundary, not a browser firewall or proof that a server endpoint is read-only.

Network resources are recorded continuously by the existing engine. A new, separate `pagetrail-coverage-v1` database records observed request attempts and outcomes: pending, saved, failed, excluded, unsupported or unavailable. HTTP errors are not counted as successful coverage even when their error response is retained. Cached bodies are requested from the browser when possible; unavailable cached bodies are reported. Native body reads, resource commits and page writes are tracked so normal Finish does not close the archive database ahead of them. The adapter confirms the exact stored URL/timestamp record, including when the upstream API masks a failed write. Same-URL responses receive distinct storage timestamps, seeded from existing data after Resume, rather than overwriting one another in the same millisecond. Changed visual states at one URL remain separate in the visual store; text exports still have the historical URL/line consolidation described below, pending Phase 5.

Finish waits for quiet (up to 10 seconds), takes a final in-scope visual capture and drains native work within a 30-second capture-work budget. Coverage persistence and best-effort detach have separate bounded waits. Remaining request gaps are retained in the report. **STOPPED means capture settled, not that the entire website/course was captured.** If cleanup/storage cannot be confirmed, the session stays ERROR, not falsely STOPPED; retry Finish after the underlying operation settles. Popup counts continue updating during Finish. Restart recovery retains prior data, marks persisted pending attempts interrupted and requires explicit Resume.

The popup and library show coverage counts. **Capture coverage · JSON** exports detailed local outcomes and is available even for an unfinished/error session. HTML/Markdown include the coverage summary, and WACZ includes it in its exported description; the original collection metadata is not modified. This report is distinct from the privacy-minimised diagnostic log: it retains source origin/path and archive timestamps, but omits URL credentials, query strings, fragments, headers, request/response bodies and raw errors. Paths can still contain confidential information. Reports are never uploaded automatically. Older recordings show unknown coverage; missing historical outcomes are not fabricated.

Conservative preview budgets: **20 MB per network response, 100 MB referenced response bytes per session, and 10,000 tracked request attempts**. Concurrent writes reserve budget before committing. Oversized declared bodies are skipped before reading; unknown-size bodies can only be rejected after the browser returns them. These budgets do not cap the website's own network downloads or guarantee peak-memory usage. Visual limits remain separate (60 MB MIME capture, 500 states / approximately 100 MB visual references, 100 MB export). There is no global disk-space/retention manager yet. Budget/persistence failures and tracking overflow are warnings, never completeness certificates.

Supplementary engine fetching is disabled in this phase: no independent URL retries, media prefetch or crawler is enabled. Normal website code/user browsing can still make requests, including server-side progress updates; this is not a guarantee that visiting a course never changes its progress. No automation submits forms, completes assessments or clicks through lessons. Quizzes, protected/streaming media, WebSockets/EventSource and arbitrary backend behaviour are not recreated. Phase 3 improves resource replay; Phase 4 adds separately approved bounded crawling; Phase 5 adds structured notes and attachments. PageTrail does not connect to an AFFiNE account or author validated study guidance.

For the synthetic browser integration fixture, build `npm run build:export-demo` and run `npm run demo:capture`, then open `http://127.0.0.1:4178/`. It uses the production recorder adapter, native archive/visual/coverage databases and exporters, but explicitly simulated debugger events and invented payloads. It does **not** prove actual Edge debugger capture or private-course compatibility. See `test/VERIFICATION.md` for executed checks.

## Historical local export/diagnostics work — October 17, 2026

At that point, the published GitHub beta was unchanged and `dist/ext` contained a local build addressing an unresponsive export interface. The guidance was to keep the existing installation folder and reload that same extension in Edge after finishing any active recording, without uninstalling or clearing storage.

The library is simplified to one format selector and Export button per recording. Website-session HTML retains captured layout; Markdown and text-only HTML remain secondary reading formats, while WACZ retains original-resource replay. Nothing is uploaded by these controls.

Preparation now runs in a short-lived dedicated worker, not the interface thread. Visual HTML and text export no longer open Webrecorder's unrelated network-archive database; the larger native engine loads only for WACZ or legacy text fallback. Resource reads are batched, Markdown reads only HTML documents, repeated text extraction/styles are cached, and generated-HTML budgets are checked before unlimited buffering. A progress bar shows counts for the **current stage**, not a fabricated overall percentage. The elapsed-time indicator remains responsive. Cancel terminates the worker, releases its work and leaves the source recording untouched.

Recorder status checks time out after 8 seconds. Worker silence times out after 30 seconds, with a 120-second overall preparation limit even if progress messages continue. Save-dialog and download confirmation have separate limits and messages. If the native Save dialog is still open after cancel/timeout, dismiss it yourself. A prepared Blob stays available as **Save ready file**, so a canceled/failed save does not require rebuilding. A standard-browser fallback says only “download requested”; only confirmed native completion says “saved.”

**Local diagnostics** is a collapsed panel in the library with live stages, timings, resource/state counts and actionable error codes. At most 200 recent events are retained on-device. **Save diagnostic report (.json)** exports those operation events and aggregate storage usage/quota. The runtime allowlist excludes page text, URLs/query strings, titles, archive/session identifiers, selectors, credentials and raw error messages/stacks. Reports are never uploaded automatically. Recorder changes, captures and failures feed the same local log. Diagnostics are not complete OS/browser tracing and cannot reveal an earlier failure that happened before this build was installed.

If an export fails: keep the recording, note the displayed stage, open Local diagnostics, and save the report. Do not clear storage. The actual Edge recording must be retried; synthetic browser tests establish the new flow, not the exact cause of an earlier Mac spinning cursor. See the current verification notes below.

## Website-session HTML — not the 0.1.1 text-only export

The 0.1.1 HTML was a small text-reading document, not the saved website. On embedded courses it could contain only the outer player: the inherited DOM-text parser returned inside its document loop. That early return is corrected. **0.1.2 adds a new visual recording path** using Chromium's `Page.captureSnapshot` MIME serialization, which includes accessible frames, rendered markup, styles and resources. It stores changed visual states alongside the existing network archive, in a separate local IndexedDB database. It is not a screen-image recorder. Common resource bytes are content-hashed and shared rather than duplicated for every state. Generated frame IDs are normalized so identical captures do not create false new states.

**Main output: Save website session (.html).** A single file embeds the visited document states, nested course frames, styles, images/fonts, coverage report and a small offline reader. No companion folder, viewer server or extension is needed to read this HTML. Captured states can be selected or visited with Previous/Next. Links to recorded top-level URLs and observed button transitions can navigate within the file. Only PageTrail's navigation bridge runs in sandboxed frames; original website scripts, forms, server actions, quizzes and audio/video are not recreated. Missing/unsupported resources are listed. Zero missing references is not proof that every lesson was visited. Canvas/WebGL-only lesson content and some shadow/custom-player interactions may not survive. It is a visual visited-session archive, **not** a fully working clone of the application's backend.

**Update the same existing `dist/ext` installation in place, then Reload in Edge. Do not uninstall or clear storage. Start a new recording for this format.** Old WACZ/resource archives remain unchanged and available, but no full visual history can be retroactively recovered from their text fields. The website-session button is disabled for archives without visual states; it does not quietly substitute text-only HTML. Re-record only the permitted completed material you want, in the same selected tab. Start/Resume reloads that tab. Browse normally and pause for roughly 2–3 seconds after revealing a meaningful section; capture is debounced and does not guarantee every transient animation or rapid click. Pause/Finish awaits queued work, takes a final in-scope state and stops the visual observer before detaching. Paused time is not recorded; Resume continues the same session.

The library reports saved visual-state count, document count in the latest capture, approximate visual storage and capture errors. A course loaded in a frame should normally show more than one document. Check that the lesson text/images appear in an export before recording a long course. Keep the recording if anything is missing; no export/cancel path deletes it.

Text-only HTML and Markdown remain clearly labelled secondary formats. New recordings extract text from **all saved frame documents and states**; neither is validated study guidance. Original hidden text and form values are excluded from reading exports. Full DOM/MIME capture and the underlying resource archive can still contain sensitive data; input fields are blanked and disabled in visual HTML, but this is not complete content redaction. Do not publicly share private exports.

Preview limits: one MIME capture at most 60 MB, up to 500 visual states / approximately 100 MB referenced visual data per session, and 100 MB final export. Repeated visits to older resource sets can conservatively increase the budget. Limit/quota/serialization failures appear as coverage warnings and preserve earlier data; they do not certify a complete session. Real debugger capture on the user's Edge/Amazon player is **not yet verified**. The synthetic browser test seeds Chromium-format captures into the actual local database and exercises the production exporter; it does not substitute for that acceptance test.

The 0.1.1 section below is retained as history. Its “HTML” means the secondary **text-only reading HTML**, not the main 0.1.2 website-session HTML.

## Export repair and simpler formats

Version 0.1.1 replaces the service-worker download URL with direct IndexedDB reads and a locally generated Blob file. The old URL-based flow could be handed to Edge Downloads as a network request; a reported "Network issue" from that path is not proof your saved archive is gone. The new extension requests the `downloads` permission and checks the browser's completed/interrupted status rather than immediately claiming success. Keep the archive-library tab open while downloading. A 100 MB per-file preview limit avoids unbounded Blob buffering; source archives are never deleted by export or cancellation.

The library now offers three choices:

- **Save readable HTML (.html)**: one ordinary reading document with inline styling and internal contents links. Double-click to read; no separate viewer, extension or server is needed.
- **Save Markdown notes (.md)**: recorded text grouped by source page, suitable for notes/AFFiNE import. These are captured source notes, not validated study guidance.
- **Save replay archive (.wacz)**: retains the resource archive for the separate local replay reader described below.

HTML/Markdown use recorded page text first, and inert extraction of saved HTML when that text is absent. Repeated visits to one URL are consolidated, retaining new lines; distinct query-string routes remain separate. These formats intentionally do not reproduce original page styling, images, active buttons or server behavior. A coverage warning lists entries where readable text was unavailable, and a completely empty reading export fails visibly. Text never recorded cannot be recovered by conversion; older recordings may lack dynamically rendered lesson/frame text.

**Upgrade without losing recordings:** keep the existing extension installed and keep its original folder path. If you loaded this checkout's `dist/ext`, use **Reload** on the same extension card after building/updating. If you installed from an extracted ZIP elsewhere, copy the new extension files into that same existing folder before Reload; loading a different folder as a new extension can create a different storage identity. Do not uninstall, clear storage or discard the recording. Edge may ask you to acknowledge the new downloads permission. Prior 0.1.0 release files remain available separately.

This is a separate replacement for the earlier snapshot-oriented PageTrail forks. It records website **network resources** with Webrecorder's ArchiveWeb.page engine, then exports one WACZ archive. The separately bundled ReplayWeb.page reader can replay original links, scripts, frames and captured API responses. It is not a screen recording, a flattened document, or an automatic copy of every page on a domain.

**Status: preview for testing, not production-ready.** The synthetic replay exercise and automated checks do not prove the recording adapter works on Amazon Learn. Start with synthetic content in Edge before a permitted completed course. Existing `pagetrail` and `singlefile-pagetrail` folders and stored archives have not been deleted or migrated.

## Install this preview in Edge

1. Export anything you still need from earlier recorders. Disable them to avoid recording twice; do not uninstall or clear their storage before export.
2. Open `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select this project's `dist/ext` folder. From the release ZIP, select its `extension` folder instead.
3. Check the card says **PageTrail Replay (Local Preview)** and version **0.1.2**. This is a different extension from the SingleFile fork; follow the in-place upgrade instructions above.
4. The recorder requests browser debugging access, website access, tabs, storage and unlimited storage. While active, Edge may show a debugging banner. It observes the selected tab's network traffic; it does not need your password. Developer Tools or another debugger may conflict with it.

## Record and export

1. Open the permitted site's page. Open the extension, acknowledge local capture, and click **Start new session**. The tab reloads so its initial scripts/styles/API responses are recorded.
2. Browse normally in this same tab. Open menus, expand material and view content you need. This preview does not follow new tabs; if a lesson opens another tab, recording does not automatically transfer there.
3. **Pause** drains pending resources and detaches recording. **Resume** reloads the original tab and continues the **same archive**, not a new snapshot file. **Finish session** drains and detaches recording and unlocks export.
4. Open **archive library**, refresh if needed, and choose HTML, Markdown or WACZ. Keep that tab open until completion is confirmed. Failure/cancellation preserves the archive so you can retry.
5. Open website-session HTML directly to browse captured visual content, import Markdown into your notes app, or start the local reader for WACZ as below. Only WACZ is intended for replaying original site scripts; website-session HTML uses recorded-state navigation instead.

Starting a later session creates a separate collection without deleting prior ones. Downloads stay on disk independently of extension storage. No automatic deletion or retention timer is implemented. Keep exports before uninstalling, clearing browser storage or changing profiles.

## Open an archive offline

The viewer runs separately on loopback so archived site scripts do not get the extension's recorder privileges. This preview deliberately does **not** disable the extension's content security policy to run arbitrary captured scripts inside privileged extension pages.

For the packaged release, open Terminal in its `reader` folder and run:

```sh
node serve-reader.mjs
```

The executable `start-reader.command` is a Mac shortcut for the same command. It requires Node available in your login shell. Open `http://127.0.0.1:4175/` in Edge/Chrome and use **Open local WACZ** in the top bar to choose the file. This standard file input also works when the reader's native File System Access dialog is unavailable. To choose another file, first return to ReplayWeb.page Home. The reader assets are bundled; no public upload or Internet connection is required for local-file replay. Keep this small local reader process running while reading. It binds only `127.0.0.1`, not your network. Ctrl+C stops it. Port 4175 must be free.

From this source checkout, `npm run demo:reader` starts the development reader after packaging. The test archive is `test/fixtures/interactive-demo.wacz`; it contains only invented library lessons.

## Coverage and privacy

- Top-level navigation is limited to the exact starting origin and optional path boundary. Nested and sibling subdomains are not implicitly included. Leaving scope pauses recording; resource storage also checks the current top-level site. This is not a pre-navigation firewall.
- Only the explicitly selected tab and engine-accessible frames are recorded. Necessary third-party scripts, styles and API resources used by that tab can be included; this is not a strict same-host resource filter.
- Screenshots, cookie capture and local/session-storage dumps default off in the local workflow. Common cookie/authorization/API-key headers are filtered before storage; obvious login, token and logout endpoints are excluded. **This is not complete redaction.** URLs, HTML, request bodies and API responses can still contain confidential data, signed URLs, embedded tokens or personal information. Filtering credentials can also reduce replay fidelity.
- The local interface exposes no upload/sharing workflow, and the fork rejects the upstream cloud-upload/IPFS API routes. Recording still makes normal resource requests to the original site. Offline replay of missing pages shows an archive error; an explicit user-selected “Load the live page” link can leave the archive.
- Only content actually captured can be replayed. Authentication, quizzes, completion writes, live search, WebSockets, expiring tokens, protected media and some course players may fail. A course can use a different content hostname; a top-level move there pauses this preview until scope handling is reviewed.
- No background whole-domain crawler or automated button clicking is enabled. The original learning scope was completed courses; broad crawling could reach unrelated account areas or alter learning progress. A later read-only crawler needs an explicit bounded course scope and its own tests.
- Phase 2 adds per-response/session network budgets and bounded request tracking, separate from the visual/export budgets. There is still no global disk-space alert or retention manager; multiple sessions can exhaust storage. Pause/finish and export regularly during pilot testing. Do not call this build production-safe for unbounded sessions.

## Development and verification

Use Node 22.18+ (tested environment also supports Node 26), Corepack and the checked-in Yarn 4 lockfile. Dependency installation is reproducible and skips dependency build scripts, including Electron downloads; the extension build does not require Electron:

```sh
corepack yarn install --immutable --mode=skip-build
npm run test:pagetrail
npm run typecheck
npm run lint:pagetrail
npm run package:pagetrail
```

The fixture WACZ is checked in so archive-integrity tests work without the original test server. To regenerate it, run `npm run demo:source`, then in another terminal `npm run demo:archive`. Stop the source server before testing replay. `npm run demo:reader` serves the bundled reader and fixture at loopback 4175. The demo maker explicitly fetches nine known test resources through the native exporter; it is **not** a substitute for a real Chrome-debugger capture test.

See `test/VERIFICATION.md` for what was actually tested and the outstanding production gates. Source and attribution are retained under AGPL-3.0-or-later; see `UPSTREAM.md` and `LICENSE.md`.
