// SPDX-License-Identifier: AGPL-3.0-or-later
export const REPLAY_BUILD = "Phase 3 · durable local replay v2";

// Each picker import gets its own collection. Full import persists resources,
// not just an index pointing at a Blob URL which expires on reload.
export function localImportOptions() {
  return { newFullImport: true, customColl: "import-" + crypto.randomUUID() };
}

export function localCollectionId(source: string): string | null {
  return /^local:\/\/([a-z0-9]{16,64})$/.exec(source)?.[1] || null;
}

export const REPLAY_CSP =
  "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline' data:; connect-src 'self'; object-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'self'; sandbox allow-scripts allow-same-origin";

export function localArchiveSource(source: string, base: string): boolean {
  try {
    // Native fully imported archives use this opaque database identity.
    if (localCollectionId(source)) return true;
    // Upstream uses this synthetic key for an already imported local file.
    // It is a database identity, not permission to fetch filesystem contents.
    if (
      /^file:\/\/[^/\\?#]+\.(wacz(?:\.zip)?|warc(?:\.gz)?|har)$/i.test(source)
    )
      return true;
    const url = new URL(source, base);
    return (
      url.origin === new URL(base).origin &&
      /\.(wacz(?:\.zip)?|warc(?:\.gz)?|har)$/i.test(url.pathname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function allowReplayRequest(
  url: string,
  fromReplay: boolean,
  prefix: string,
): boolean {
  if (!url.startsWith(prefix)) return false;
  if (!fromReplay) return true;
  if (url.startsWith(prefix + "w/api/")) return false;
  return (
    url.startsWith(prefix + "w/") ||
    url === prefix + "static/wombat.js" ||
    url === prefix + "static/wombatWorkers.js"
  );
}
