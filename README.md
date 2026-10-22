# PageTrail Replay

[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE.md)
[![Beta verification](https://github.com/RahulSinghParmar/pagetrail-replay/actions/workflows/pagetrail-beta.yaml/badge.svg)](https://github.com/RahulSinghParmar/pagetrail-replay/actions/workflows/pagetrail-beta.yaml)

PageTrail Replay is a local-first Chromium extension for recording authorised browsing sessions and turning captured material into portable offline archives and structured notes.

The project is designed for documentation, research and personal learning workflows where the source may be dynamic, frame-based or difficult to preserve with a normal “Save page” command. Recordings stay in browser storage until you explicitly export them.

> **Current release:** `0.1.2-beta.1`. PageTrail is a beta tool, not a completeness, compliance or security certification. Only visited content that finished loading and was successfully captured can be exported.

## Features

- Start, pause, resume and finish one local recording session without creating a file for every click.
- Capture the selected tab, accessible embedded frames and observed network resources.
- Export one self-contained website-session HTML with recorded-state navigation.
- Export standards-based WACZ for higher-fidelity replay in the bundled local reader.
- Export structured Markdown and a portable learning ZIP for notes applications.
- Consolidate repeated player states and recorder shells into meaningful lesson sections.
- Detect repeated course outlines, preserve their order and report sections that were not captured.
- Exclude unrelated portal pages when a dominant lesson route is detected.
- Preserve supported images and PDF attachments without duplicating media in the HTML reader.
- Optimize large raster images for notes packages while retaining originals in archival exports.
- Run bounded, explicitly enabled same-origin/path crawling for ordinary links.
- Keep diagnostics local and avoid page text, full URLs, credentials and archive identifiers in diagnostic events.

## Export formats

| Format | Best for | Important boundary |
| --- | --- | --- |
| Website session HTML | A single portable reading file | Recorded visual states; not a live backend clone |
| Portable learning ZIP | Detailed notes, quick revision and notes-app migration | Source-derived reading copy; not interactive replay |
| WACZ | Replaying captured links, scripts and responses | Requires the bundled local reader |
| Markdown / text HTML | Lightweight extraction and conversion | Styling and interactive behaviour are not reproduced |
| Coverage JSON | Troubleshooting capture gaps | Describes observed requests, not total site completeness |

## Install the beta

1. Download the latest PageTrail ZIP from [Releases](https://github.com/RahulSinghParmar/pagetrail-replay/releases) and extract it.
2. Open `edge://extensions` or `chrome://extensions`.
3. Enable **Developer mode** and choose **Load unpacked**.
4. Select the extracted `extension` directory.
5. Pin **PageTrail Replay** if you want quick access to recording controls.

When upgrading an existing unpacked installation, replace the files in the same installation directory and click **Reload** on the existing extension card. Do not uninstall the extension or clear its storage before exporting recordings you want to keep.

## Record and export

1. Open content you are authorised to preserve.
2. Start a new PageTrail session. The selected tab reloads so the initial document and resources can be observed.
3. Browse normally in that tab. Wait for each meaningful section to settle before moving on.
4. Expand relevant tabs, accordions or cards when their content should appear in the recording.
5. Finish the session before navigating into unrelated account or catalogue pages.
6. Open the archive library and choose an export format.
7. Review the exported coverage and warnings before relying on or sharing the result.

PageTrail does not answer assessments, submit forms, infer unvisited material or certify course completion. Result pages may be retained when they were explicitly visited.

## Portable learning packages

A portable learning ZIP contains:

- `PageTrail - <course> - Detailed notes.md`
- `PageTrail - <course> - Quick revision.md`
- `index.html`
- `assets/`
- `manifest.json`
- `README.txt`

The course title is used for filenames and top-level headings. Captured lesson headings determine note sections and their order. `manifest.json` records provenance, extraction mode, detected/captured/missing outline counts, media optimization, warnings and SHA-256 checksums.

AFFiNE’s Markdown-with-media importer preserves the tested headings, lists, tables, code blocks and supported images. Imported files use their descriptive filenames as document titles. Assigning the resulting documents to an AFFiNE collection or folder remains a manual notes-app step; PageTrail does not connect to an AFFiNE account or workspace.

Large raster images are converted to bounded static WebP previews when the browser supports it. Included notes media is capped at 20 MB and individual included files at 5 MB. Omitted or unavailable assets are labelled explicitly. Original captured media remains in the recording and archival exports.

## Privacy and safety

Web archives can contain confidential page content, URLs, API responses and signed resource references. Header and endpoint filtering reduces common credential exposure but is not complete redaction.

- Record only content you are authorised to preserve.
- Review every export before sharing it.
- Never attach private recordings, browser profiles, credentials or confidential course material to a public issue.
- Use invented or public sample content when reporting reproducible problems.
- Keep an archival export before uninstalling the extension, clearing browser data or changing profiles.

PageTrail has no upload or sharing workflow. Missing resources are not fetched during learning-package generation.

## Build from source

Requirements:

- Node.js 24
- Corepack with Yarn 4
- macOS or Linux for the current packaging script

```sh
git clone https://github.com/RahulSinghParmar/pagetrail-replay.git
cd pagetrail-replay
corepack enable
corepack yarn install --immutable --mode=skip-build
npm run verify:beta
```

The unpacked extension is written to `dist/ext`. The packaging task writes a versioned ZIP under `release/`; both directories are ignored by Git.

Useful commands:

```sh
npm run test:pagetrail
npm run typecheck
npm run lint:pagetrail
npm run build:pagetrail
npm run build:reader
npm run package:pagetrail
```

`npm run verify:beta` runs tests, type checking, source lint, synthetic builds, extension and reader packaging, privacy checks, checksums and ZIP-integrity validation. Installed-browser acceptance remains separate; see [BETA-ACCEPTANCE.md](BETA-ACCEPTANCE.md).

## Project documentation

- [Usage and technical guide](PAGETRAIL.md)
- [Beta acceptance checklist](BETA-ACCEPTANCE.md)
- [Current release notes](BETA-RELEASE.md)
- [Verification record](test/VERIFICATION.md)
- [Contribution guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Upstream attribution and changes](UPSTREAM.md)

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first and use synthetic or public fixtures for reproductions. Security-sensitive reports belong in a private GitHub security advisory, not a public issue.

## Origin and license

PageTrail Replay is a modified fork of [Webrecorder ArchiveWeb.page](https://github.com/webrecorder/archiveweb.page). The original recording, storage, WARC/WACZ and replay foundations remain credited to Webrecorder and its contributors. PageTrail-specific changes and retained upstream source are distributed under **AGPL-3.0-or-later**.

See [LICENSE.md](LICENSE.md) and [UPSTREAM.md](UPSTREAM.md) before redistributing modified builds.
