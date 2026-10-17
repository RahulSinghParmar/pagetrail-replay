# PageTrail Replay — 0.1.2 local preview

## Website-session HTML — not the 0.1.1 text-only export

The 0.1.1 HTML was a small text-reading document, not the saved website. On embedded courses it could contain only the outer player: the inherited DOM-text parser returned inside its document loop. That early return is corrected. **0.1.2 adds a new visual recording path** using Chromium's `Page.captureSnapshot` MIME serialization, which includes accessible frames, rendered markup, styles and resources. It stores changed visual states alongside the existing network archive, in a separate local IndexedDB database. It is not a screen-image recorder. Common resource bytes are content-hashed and shared rather than duplicated for every state. Generated frame IDs are normalized so identical captures do not create false new states.

**Main output: Save website session (.html).** A single file embeds the visited document states, nested course frames, styles, images/fonts, coverage report and a small offline reader. No companion folder, viewer server or extension is needed to read this HTML. Captured states can be selected or visited with Previous/Next. Links to recorded top-level URLs and observed button transitions can navigate within the file. Only PageTrail's navigation bridge runs in sandboxed frames; original website scripts, forms, server actions, quizzes and audio/video are not recreated. Missing/unsupported resources are listed. Zero missing references is not proof that every lesson was visited. Canvas/WebGL-only lesson content and some shadow/custom-player interactions may not survive. It is a visual visited-session archive, **not** a fully working clone of the application's backend.

**Update the same existing `dist/ext` installation in place, then Reload in Edge. Do not uninstall or clear storage. Start a new recording for this format.** Old WACZ/resource archives remain unchanged and available, but no full visual history can be retroactively recovered from their text fields. The website-session button is disabled for archives without visual states; it does not quietly substitute text-only HTML. Re-record only the permitted completed material you want, in the same selected tab. Start/Resume reloads that tab. Browse normally and pause for roughly 2–3 seconds after revealing a meaningful section; capture is debounced and does not guarantee every transient animation or rapid click. Pause/Finish awaits queued work, takes a final in-scope state and stops the visual observer before detaching. Paused time is not recorded; Resume continues the same session.

The library reports saved visual-state count, document count in the latest capture, approximate visual storage and capture errors. A course loaded in a frame should normally show more than one document. Check that the lesson text/images appear in an export before recording a long course. Keep the recording if anything is missing; no export/cancel path deletes it.

Text-only HTML and Markdown remain clearly labelled secondary formats. New recordings extract text from **all saved frame documents and states**; neither is validated AI study notes. Original hidden text and form values are excluded from reading exports. Full DOM/MIME capture and the underlying resource archive can still contain sensitive data; input fields are blanked and disabled in visual HTML, but this is not complete content redaction. Do not publicly share private exports.

Preview limits: one MIME capture at most 60 MB, up to 500 visual states / approximately 100 MB referenced visual data per session, and 100 MB final export. Repeated visits to older resource sets can conservatively increase the budget. Limit/quota/serialization failures appear as coverage warnings and preserve earlier data; they do not certify a complete session. Real debugger capture on the user's Edge/Amazon player is **not yet verified**. The synthetic browser test seeds Chromium-format captures into the actual local database and exercises the production exporter; it does not substitute for that acceptance test.

The 0.1.1 section below is retained as history. Its “HTML” means the secondary **text-only reading HTML**, not the main 0.1.2 website-session HTML.

## Export repair and simpler formats

Version 0.1.1 replaces the service-worker download URL with direct IndexedDB reads and a locally generated Blob file. The old URL-based flow could be handed to Edge Downloads as a network request; a reported "Network issue" from that path is not proof your saved archive is gone. The new extension requests the `downloads` permission and checks the browser's completed/interrupted status rather than immediately claiming success. Keep the archive-library tab open while downloading. A 100 MB per-file preview limit avoids unbounded Blob buffering; source archives are never deleted by export or cancellation.

The library now offers three choices:

- **Save readable HTML (.html)**: one ordinary reading document with inline styling and internal contents links. Double-click to read; no separate viewer, extension or server is needed.
- **Save Markdown notes (.md)**: recorded text grouped by source page, suitable for notes/AFFiNE import. These are captured source notes, not AI-generated or validated study notes.
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

- Top-level navigation is limited to the starting host and its nested subdomains with the same protocol/port. Starting `learn.example.com` does not grant sibling `mail.example.com`. Leaving scope pauses recording; resource storage also checks the current top-level site. This is not a pre-navigation firewall.
- Only the explicitly selected tab and engine-accessible frames are recorded. Necessary third-party scripts, styles and API resources used by that tab can be included; this is not a strict same-host resource filter.
- Screenshots, cookie capture and local/session-storage dumps default off in the local workflow. Common cookie/authorization/API-key headers are filtered before storage; obvious login, token and logout endpoints are excluded. **This is not complete redaction.** URLs, HTML, request bodies and API responses can still contain confidential data, signed URLs, embedded tokens or personal information. Filtering credentials can also reduce replay fidelity.
- The local interface exposes no upload/sharing workflow, and the fork rejects the upstream cloud-upload/IPFS API routes. Recording still makes normal resource requests to the original site. Offline replay of missing pages shows an archive error; an explicit user-selected “Load the live page” link can leave the archive.
- Only content actually captured can be replayed. Authentication, quizzes, completion writes, live search, WebSockets, expiring tokens, protected media and some course players may fail. A course can use a different content hostname; a top-level move there pauses this preview until scope handling is reviewed.
- No background whole-domain crawler or automated button clicking is enabled. The original learning scope was completed courses; broad crawling could reach unrelated account areas or alter learning progress. A later read-only crawler needs an explicit bounded course scope and its own tests.
- No hard archive-size cap or disk-space alert is implemented in this first preview. Large sessions can exhaust browser storage. Pause/finish and export regularly during pilot testing. Do not call this build production-safe for unbounded sessions.

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
