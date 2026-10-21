// SPDX-License-Identifier: AGPL-3.0-or-later
// Test-only, intentionally silent worker. No CPU spin, writes or network requests.
self.onmessage = () => {};
export {};
