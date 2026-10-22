# PageTrail practical beta acceptance

This checklist is for the unpacked local beta. Use invented sample content first. It does not authorise access to private courses, account pages or assessments.

## Automated gate

Run from the project root:

```sh
npm run verify:beta
```

Pass means the PageTrail tests, TypeScript, source lint, production builds, release-file checks, checksums and ZIP integrity passed. The JSON evidence is written to `test/artifacts/beta-verification/beta-verification.json`. This does not replace the installed-browser checks below.

## Installed Edge acceptance

Preserve existing recordings: finish any active recording, keep the same extension folder and use **Reload** on the existing Edge extension card. Do not uninstall the extension or clear its storage.

Record the result of each check as Pass, Fail or Not tested:

- Extension card shows `PageTrail Replay (Local Preview)`, version `0.1.2`, and the Phase 6 label.
- Existing recordings remain listed after Reload.
- On the invented local sample, Start creates one session and reloads only the selected tab.
- Pause detaches capture; Resume continues the same recording rather than creating another.
- Controlled crawl stays inside the explicitly selected path, pauses/resumes, and reports visited, queued, failed and skipped counts.
- Finish reaches stopped only after capture settles; failures retain the recording and explain the retry action.
- Website single-HTML export opens directly and navigates among captured states.
- Markdown, text-only HTML, coverage JSON and portable learning ZIP download without deleting the recording.
- WACZ opens in the bundled loopback reader; captured original links work and uncaptured destinations remain unavailable.
- Portable learning ZIP contains two descriptive Markdown notes, `index.html`, `README.txt`, `manifest.json` and `assets/`; AFFiNE import does not create a README note.
- AFFiNE uses the course-based filenames as document titles and preserves lesson headings. Assigning both imported documents to an AFFiNE collection/folder is recorded as a manual notes-app step.
- Detailed notes are organized by meaningful lessons/pages rather than recorder frames or `Embedded document` entries; repeated captures, player shells and technical warnings do not dominate the note.
- When a course outline is detected, unrelated portal/home/catalogue pages are excluded. `manifest.json` and Capture diagnostics report detected, captured and missing outline-section counts; an unvisited lesson is never silently presented as captured.
- Assessment results may appear as a labelled result section, but quiz questions, answers and completion are not inferred or reconstructed.
- Quick revision contains concise lesson review points without repeating source URLs and capture metadata for every point.
- Portable learning ZIP does not duplicate media inside `index.html`; no individual included asset exceeds 5 MB and included media totals at most 20 MB. Raster inputs over 768 KB are optimized before budget accounting when the conversion is materially smaller. `manifest.json` reports included, optimized and omitted media totals; image placeholders distinguish uncaptured media from size-policy omissions, and originals remain available through the source recording and archival exports.
- Canceling a large export leaves the recording intact and allows a retry.
- Reloading the extension and reader does not lose a completed recording or a fully imported local WACZ.
- Local diagnostics remain usable during a failure and contain no page text, URLs, titles, archive IDs, credentials or raw stack traces.

## Evidence to retain locally

- Edge and macOS versions.
- Extension card screenshot.
- One synthetic recording identifier or title, without credentials or private URLs.
- Export filenames, byte sizes and whether each reopened successfully.
- Diagnostic JSON only when needed; review it before sharing.
- Exact failed stage and visible message for every failure.

Do not publish, commit or upload recordings, AFFiNE exports, browser profiles, credentials, logs or diagnostic reports. A passing synthetic beta is not proof that a private learning portal is complete, safe to crawl or compatible.
