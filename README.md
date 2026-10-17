# PageTrail Replay · 0.1.2-beta.1

Local-first Chromium/Edge extension for recording a browsing session and exporting one self-contained website-session HTML, captured-text Markdown, or a Webrecorder WACZ archive.

**Beta, not production-ready.** Only content visited and successfully captured while recording is included. A session HTML retains captured visual states, accessible frames, styles and images; it is not a live clone of a website's backend. Original scripts, quizzes, protected media, server-only actions and unvisited pages are not recreated. Real Edge capture and direct-from-disk acceptance testing remain release gates. See [verification boundaries](test/VERIFICATION.md).

## Install the beta

1. Download the beta ZIP from this repository's Releases and extract it.
2. In Edge, open `edge://extensions`, enable Developer mode, and load the extracted `extension` folder. In Chrome, use `chrome://extensions`.
3. To upgrade an existing installation, copy the beta's extension files into the **same existing folder**, then Reload that extension. Do not uninstall or clear storage: those actions can remove saved recordings.
4. Start a session on content you are allowed to save. Browse normally in that same tab, waiting briefly after opening each section. Finish, open the archive library, and choose **Save website session (.html)**.

The finished session HTML is designed to open without a companion folder, server or extension. Markdown and text-only HTML are secondary reading formats, not webpage copies or validated study notes. WACZ uses the separately bundled local reader. Older resource-only archives are preserved, but cannot retroactively gain visual states.

## Build from source

Use Node.js 24 and Corepack/Yarn 4; the lockfile is checked in. The beta packaging supports macOS and Linux with the system ZIP utility. No Electron installation, signing credentials, store account or deployment secrets are needed.

```sh
corepack enable
corepack yarn install --immutable --mode=skip-build
npm run typecheck
npm run lint:pagetrail
npm run test:pagetrail
npm run package:pagetrail
```

Load `dist/ext` for development. The packaged beta is `release/PageTrail-Replay-0.1.2-beta.1.zip`, with a per-file `SHA256SUMS` manifest. GitHub Actions repeats validation/builds on pushes and pull requests; matching `pagetrail-v*-beta.*` tags create a GitHub prerelease. The inherited upstream desktop, npm and Chrome-store publication jobs are restricted to the upstream repository.

## Privacy and licensing

Recordings remain in local browser storage until explicitly exported. Capture can contain confidential HTML, URLs and API responses; header filtering is not complete redaction. Review exports before sharing. No user recordings, personal course material, credentials, dependencies or generated local artifacts belong in Git. Checked-in fixtures contain invented content only.

PageTrail is a modified fork of [Webrecorder ArchiveWeb.page](https://github.com/webrecorder/archiveweb.page). The upstream license is **AGPL-3.0-or-later**, not MIT; retain corresponding source and attribution when redistributing. See [usage guide](PAGETRAIL.md), [upstream changes](UPSTREAM.md), and [license](LICENSE.md). The upstream package version is intentionally separate from the beta version in `pagetrail-release.json` and the browser manifest.

---

## Upstream documentation (preserved)

<h1>
    <div align="center">
        <img alt="ArchiveWebpage" src="src/assets/brand/archivewebpage-lockup-color-dynamic.svg" width="90%">
    </div>
</h1>

ArchiveWeb.page is a JavaScript based application for interactive, high-fidelity web archiving that runs directly in the browser. The system can be used as a Chrome/Chromium based browser extension and also as a standalone Electron app.

The system creates, stores, and replays high-fidelity web archives stored directly in the browser's storage (via IndexedDB).

For more detailed info on how to use the extension and standalone app, see the [ArchiveWeb.page User Guide](https://archiveweb.page/guide).

The browser extension is available on the [Chrome Web Store](https://chrome.google.com/webstore/detail/webrecorder/fpeoodllldobpkbkabpblcfaogecpndd).

Downloads for the desktop are are available on the [GitHub Releases page](https://github.com/webrecorder/archiveweb.page/releases).

## Architecture

The extension makes use of the Chrome debugging protocol to capture and save network traffic, and extends the [ReplayWeb.page](https://github.com/webrecorder/replayweb.page) UI and the [wabac.js](https://github.com/webrecorder/wabac.js) service worker system for replay and storage.

## Development

The Chromium extension and Electron app are built from the same source code for ease of development.

### Prerequisites

- Node >=12
- Yarn Classic (v1)

### Installation

To build the extension or Electron app locally for development, do the following:

1. Clone this repo:
   ```sh
   git clone https://github.com/webrecorder/archiveweb.page.git
   ```
2. Change the working directory:
   ```sh
   cd archiveweb.page
   ```
3. Install dependencies:
   ```sh
   yarn install
   ```
4. Make development build:
   ```sh
   yarn build-dev
   ```

The development build can now be used to develop the extension or Electron app.

### Developing the Chromium extension

To install the extension locally, load the development build as an unpacked extension:

1. Open the Chrome Extensions page ([chrome://extensions](chrome://extensions)).

2. Choose 'Load Unpacked Extension' and point to the `./dist/ext` directory in your local copy of this repo.

3. Click the extension icon to show the extension popup, start archiving, etc...

#### Update extension on code changes

To watch source code files and recompile the development build on change, run:

```sh
yarn run start-ext
```

Now, saving changes to source will automatically rebuild the `dist/ext` directory.

After making changes, the extension still needs to be reloaded in the browser.

1. From the Chrome extensions page, click the reload button to load the latest version.

2. Click the extension icon to show the extension popup, start recording, etc... The dev build of the extension will be a different color from the production version.

### Developing the Electron app

To start the Electron app using development build:

```sh
yarn run start-electron
```

The Electron app will open recording in a new window. It is is designed to support Flash, better support for IPFS sharing.

#### Update app on change

Currently, the dev workflow for the Electron app does not support automatically rebuilding on file changes.

After making changes, rerun `yarn run build-dev` and `yarn run start-electron` to view your changes in the app.

### Using a local wabac.js

If you're testing a local version of wabac.js, you can configure your local copy of archiveweb.page to use it.

1. In the wabac.js repo, run `yarn link`.
2. In the archiveweb.page repo, run `yarn link "@webrecorder/wabac"`

When you want to switch back to a release build of wabac.js, run these steps from the archiveweb.page repo:

1. `yarn unlink`
2. `yarn install --force`

## Standalone Build

To create a platform-specific binary, run:

```sh
yarn run pack
```

The standalone app will then be available in the `./dist/` directory.
