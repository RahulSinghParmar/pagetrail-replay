# PageTrail Replay 0.1.2-beta.1

Public beta of the PageTrail local session recorder, based on Webrecorder ArchiveWeb.page. This release adds a repeatable verification gate, an installed-browser acceptance checklist and structured learning exports for notes applications.

## Included

- Start / Pause / Resume / Finish for one selected Chromium/Edge tab and accessible frames.
- Self-contained website-session HTML with captured visual states, styles, images/fonts, shared assets and offline navigation.
- Frame-aware captured-text Markdown and clearly labelled text-only HTML.
- Native WACZ archive export and a separately bundled local replay reader.
- Direct local downloads, coverage warnings, input blanking in visual HTML and preservation of existing recordings.
- Controlled, bounded same-origin/path crawling with explicit consent, pause/resume/stop and visible failures.
- Portable learning ZIP with descriptive detailed notes, quick revision excerpts, images, PDF preservation, provenance and checksums.
- Course-outline ordering, dominant lesson-scope detection, explicit missing-section reporting and portal-page exclusion.
- Notes-friendly raster optimization with per-package media accounting; archival originals remain unchanged.
- Local privacy-minimised diagnostics and bounded/cancellable export workers.
- Reproducible source checks and beta packaging in GitHub Actions. No npm, browser-store or desktop signing publication.

## Known beta limits

Only visited, successfully captured content is included. Wait briefly after revealing each section. Original website scripts, server actions, quizzes, protected media, audio/video and unvisited destinations are not recreated by session HTML. Some canvas/WebGL, custom players and shadow-root interactions may not survive.

Old resource-only archives remain available but do not gain visual states retroactively. Do not uninstall or clear extension storage when upgrading. Keep the same installation folder, copy updated extension files there and Reload.

Current local verification: 97 automated tests, type checking, source lint and production-optimized builds pass. `npm run verify:beta` repeats those gates, packages the beta, validates checksums and ZIP integrity, and rejects private-file patterns or unexpected recordings. Synthetic browser checks cover styled nested course frames, offline original-link replay, controlled crawling, media optimization, single-file navigation and portable-note generation. An installed-Edge re-export of an authorised 11-section interactive workload retained all detected sections, resolved every packaged image reference and omitted no media reference after optimizing 40 large raster inputs. Its private content is not part of the repository. The source recording retained one disclosed visual-gap warning, so this remains a public beta rather than a production-readiness or security certification.

Preview limits: 60 MB per MIME capture, 500 visual states / approximately 100 MB referenced visual storage per session, and 100 MB final export. Failed/canceled exports do not delete stored recordings.

Archives can contain confidential data even with header filtering. Keep them local and review before sharing. Release fixtures contain invented content, not private recordings.

Run `npm run verify:beta`, then complete `BETA-ACCEPTANCE.md` using invented local content before any authorised private-site pilot.

## License

AGPL-3.0-or-later. Preserve Webrecorder attribution, the license and corresponding source when redistributing. See `LICENSE.md`, `UPSTREAM.md`, `PAGETRAIL.md` and `VERIFICATION.md` in the package.
