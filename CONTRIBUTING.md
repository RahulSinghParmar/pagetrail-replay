# Contributing to PageTrail Replay

Thank you for helping improve PageTrail Replay. Contributions are welcome for capture reliability, offline replay, export quality, accessibility, documentation and test coverage.

## Before opening an issue

- Search existing issues and release notes.
- Reproduce the problem with public or invented sample content whenever possible.
- Run the current release before reporting a problem already fixed on `main`.
- Use a private security advisory for vulnerabilities or anything that requires sharing sensitive details.

Never upload private recordings, workplace course material, credentials, browser profiles, signed URLs or diagnostic files that have not been reviewed.

## Development setup

```sh
git clone https://github.com/RahulSinghParmar/pagetrail-replay.git
cd pagetrail-replay
corepack enable
corepack yarn install --immutable --mode=skip-build
npm run verify:beta
```

Load `dist/ext` as an unpacked extension for manual testing. Preserve an existing installation’s folder and storage identity when testing upgrades.

## Pull requests

Keep each pull request focused. Include:

- the problem and intended behaviour;
- a concise description of the implementation;
- automated tests for changed logic;
- manual verification steps when browser behaviour changes;
- privacy and compatibility considerations;
- screenshots only when they contain invented or public material.

Run these checks before submitting:

```sh
npm run test:pagetrail
npm run typecheck
npm run lint:pagetrail
npm run build:pagetrail
```

Use `npm run verify:beta` for changes that affect packaging, exports, the reader or release files.

## Code and test expectations

- Preserve existing recordings and backwards-compatible export paths whenever possible.
- Make incomplete capture visible; do not silently claim completeness.
- Bound memory, storage, queue and export work.
- Keep missing resources local; exporters must not fetch them automatically.
- Exclude secrets, private URLs and captured content from logs and fixtures.
- Use invented fixtures under `test/fixtures/`.
- Keep upstream attribution and AGPL notices intact.

## Commit messages

Use a short imperative summary, for example:

```text
Improve lesson-scope detection
Optimize large note images before packaging
Document installed-browser acceptance
```

## Licence

By contributing, you agree that your contribution is distributed under the repository’s AGPL-3.0-or-later licence.
