# PageTrail Replay 0.1.2-beta.1

First private beta of the PageTrail local session recorder, based on Webrecorder ArchiveWeb.page.

## Included

- Start / Pause / Resume / Finish for one selected Chromium/Edge tab and accessible frames.
- Self-contained website-session HTML with captured visual states, styles, images/fonts, shared assets and offline navigation.
- Frame-aware captured-text Markdown and clearly labelled text-only HTML.
- Native WACZ archive export and a separately bundled local replay reader.
- Direct local downloads, coverage warnings, input blanking in visual HTML and preservation of existing recordings.
- Reproducible source checks and beta packaging in GitHub Actions. No npm, browser-store or desktop signing publication.

## Known beta limits

Only visited, successfully captured content is included. Wait briefly after revealing each section. Original website scripts, server actions, quizzes, protected media, audio/video and unvisited destinations are not recreated by session HTML. Some canvas/WebGL, custom players and shadow-root interactions may not survive.

Old resource-only archives remain available but do not gain visual states retroactively. Do not uninstall or clear extension storage when upgrading. Keep the same installation folder, copy updated extension files there and Reload.

Local verification: 33 automated tests, type checking, source lint and production-optimized builds passed. Synthetic browser checks showed styled nested course frames, an embedded illustration and same-file Next navigation. **Actual Edge debugger capture, the intended site's course player and direct opening from disk still need acceptance testing.** This is not a production-readiness or security certification.

Preview limits: 60 MB per MIME capture, 500 visual states / approximately 100 MB referenced visual storage per session, and 100 MB final export. Failed/canceled exports do not delete stored recordings.

Archives can contain confidential data even with header filtering. Keep them local and review before sharing. Release fixtures contain invented content, not private recordings.

## License

AGPL-3.0-or-later. Preserve Webrecorder attribution, the license and corresponding source when redistributing. See `LICENSE.md`, `UPSTREAM.md`, `PAGETRAIL.md` and `VERIFICATION.md` in the package.
