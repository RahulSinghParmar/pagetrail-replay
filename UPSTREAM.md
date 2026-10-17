# Upstream attribution and local modifications

This is a local working fork of [Webrecorder ArchiveWeb.page](https://github.com/webrecorder/archiveweb.page), source commit `595664ca4ae2f0073d883c3bea6011d51004e249`, upstream package version `0.17.1`. The preview extension version is `0.1.2`. No public fork, push or release has been created.

Version 0.1.2 adds Chromium MIME page capture, isolated-world change observation, a content-addressed visual-state store, self-contained sandboxed HTML export with shared inline assets, and frame-aware text exports. It also moves the inherited DOM-text parser's return outside its documents loop. The MIME parser and visual packager are new local source; no SingleFile conversion code was copied. The native Webrecorder resource archive and Downloader remain in place. Existing stores are not deleted or migrated.

Version 0.1.1 adds local Blob downloads with completion checks and HTML/Markdown reading exports. `parse5` 7.1.2 (already present transitively) is now an explicit locked dependency for inert HTML text extraction. Its MIT license is retained with the packaged dependency notices. WACZ serialization itself still uses the native upstream `Downloader`; downloads no longer depend on a service-worker URL. No existing recording databases are cleared or migrated.

The unchanged core recording, IndexedDB, WARC/WACZ and replay engines come from Webrecorder and their contributors, not from PageTrail. Locked packages include `@webrecorder/wabac` 2.27.3, `replaywebpage` 2.5.3 and `warcio` (see Yarn lockfile for its exact resolved version). Original source, license and notices remain. PageTrail additions are AGPL-3.0-or-later.

Added source: `src/pagetrail/` session controller, local privacy filters, engine adapter, popup, dashboard and reader entry. Added build adapter `webpack.pagetrail.cjs`, static controls and `tools/` for preview packaging and synthetic verification.

Modified upstream: manifest branding/version; `BrowserRecorder` makes unexpected debugger cleanup awaitable and avoids double stop during intentional detach; `ExtAPI` rejects cloud/IPFS routes; downloader type-only/CommonJS imports support the Node test runner without changing its archive algorithm; SW entry removes unused Flash/proxy injection; static entry pages and package scripts. The original `webpack.config.js` is retained and reused for an extension-only build without Electron or signing scripts. Dependencies and the upstream Yarn lockfile are retained.

The release ZIP includes both the recorder and separately served local reader, licenses and instructions. To redistribute a modified build, provide the corresponding source (including these changes and lockfile), upstream attribution and required AGPL license materials. Store publication, security review, dependency audit, automated real-extension tests and platform signing are not completed by this preview.
