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
