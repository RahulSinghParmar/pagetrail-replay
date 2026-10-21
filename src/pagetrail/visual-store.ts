// SPDX-License-Identifier: AGPL-3.0-or-later
import { openDB } from "idb";
import { parseCapture, type CapturePart } from "./mhtml";
import { OperationError } from "./operations";
import type { ExportProgress } from "./export-protocol";
export type RecordedAction = {
  frame: string;
  selector: string;
  label: string;
  from: number;
};
export type VisualState = {
  id: string;
  session: string;
  index: number;
  url: string;
  title: string;
  time: string;
  root: string;
  refs: Record<string, string>;
  documents: { key: string; url: string }[];
  action?: RecordedAction;
  signature: string;
};
export type VisualAsset = { key: string; mime: string; bytes: Uint8Array };
export type VisualMeta = {
  session: string;
  states: number;
  assets: number;
  bytes: number;
  documents: number;
  error: string;
};
export type VisualArchive = {
  meta: VisualMeta;
  states: VisualState[];
  assets: VisualAsset[];
};
const MAX_BYTES = 100 * 1024 * 1024;
async function database() {
  let rejectBlocked!: (error: unknown) => void;
  const blocked = new Promise<never>((_, reject) => {
    rejectBlocked = reject;
  });
  const opening = openDB("pagetrail-visual-v1", 1, {
    blocked() {
      rejectBlocked(
        new OperationError(
          "STORAGE_BLOCKED",
          "Local storage is blocked by another library tab.",
        ),
      );
    },
    blocking(_oldVersion, _newVersion, _event) {
      void opening.then((db) => db.close());
    },
    upgrade(db) {
      db.createObjectStore("assets", { keyPath: "key" });
      db.createObjectStore("states", { keyPath: "id" }).createIndex(
        "session",
        "session",
      );
      db.createObjectStore("meta", { keyPath: "session" });
    },
  });
  try {
    return await Promise.race([opening, blocked]);
  } catch (error) {
    void opening.then((db) => db.close()).catch(() => {});
    throw error;
  }
}
const empty = (session: string): VisualMeta => ({
  session,
  states: 0,
  assets: 0,
  bytes: 0,
  documents: 0,
  error: "",
});
export async function visualMeta(session: string): Promise<VisualMeta> {
  const db = await database();
  try {
    return (await db.get("meta", session)) || empty(session);
  } finally {
    db.close();
  }
}
export async function visualError(session: string, error: string) {
  const db = await database();
  try {
    const meta = (await db.get("meta", session)) || empty(session);
    meta.error = error;
    await db.put("meta", meta);
  } finally {
    db.close();
  }
}
export async function saveCapture(
  session: string,
  raw: string,
  page: { url: string; title: string },
  action?: RecordedAction,
) {
  return saveCaptureParts(session, parseCapture(raw), page, action);
}
export async function saveCaptureParts(
  session: string,
  parts: CapturePart[],
  page: { url: string; title: string },
  action?: RecordedAction,
): Promise<VisualMeta> {
  const assets: VisualAsset[] = [],
    refs: Record<string, string> = Object.create(null),
    documents: VisualState["documents"] = [];
  // Chromium generates new MIME frame IDs on each serialization. Normalize those IDs.
  const aliases = parts
    .filter((part) => part.cid)
    .map((part, i) => [part.cid, "pagetrail-frame-" + i]);
  let root = "";
  for (const part of parts) {
    let bytes = part.bytes;
    if (["text/html", "text/css"].includes(part.mime)) {
      let text = new TextDecoder().decode(bytes);
      for (const [before, after] of aliases)
        text = text.split("cid:" + before).join("cid:" + after);
      bytes = new TextEncoder().encode(text);
    }
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes as BufferSource),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const key = part.mime + ":" + hash;
    assets.push({ key, mime: part.mime, bytes });
    if (part.url) refs[part.url] = key;
    if (part.cid)
      refs["cid:" + aliases.find(([before]) => before === part.cid)![1]] = key;
    if (part.mime === "text/html") {
      root ||= key;
      documents.push({ key, url: part.url || page.url });
    }
  }
  if (!root) throw new Error("No captured HTML document.");
  const signature = JSON.stringify([
    page.url,
    Object.entries(refs).sort(),
    documents,
  ]);
  const db = await database();
  try {
    const tx = db.transaction(["assets", "states", "meta"], "readwrite"),
      states = tx.objectStore("states"),
      store = tx.objectStore("assets");
    const meta: VisualMeta =
      (await tx.objectStore("meta").get(session)) || empty(session);
    const last = meta.states
      ? ((await states.get(session + ":" + (meta.states - 1))) as VisualState)
      : null;
    if (last?.signature === signature) {
      await tx.done;
      return meta;
    }
    let added = 0,
      bytes = 0;
    const unique = new Map(assets.map((asset) => [asset.key, asset]));
    for (const asset of unique.values()) {
      // Per-session budget counts referenced resources even if another session shares them.
      const previouslyUsed =
        last && Object.values(last.refs).includes(asset.key);
      if (!previouslyUsed) bytes += asset.bytes.byteLength;
      if (!(await store.getKey(asset.key))) {
        await store.put(asset);
        added++;
      }
    }
    if (meta.states >= 500 || meta.bytes + bytes > MAX_BYTES) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new Error(
        "Visual capture reached the 500-state / 100 MB preview limit. Finish and export; no saved content was deleted.",
      );
    }
    const state: VisualState = {
      id: session + ":" + meta.states,
      session,
      index: meta.states,
      ...page,
      time: new Date().toISOString(),
      root,
      refs,
      documents,
      signature,
      ...(action ? { action } : {}),
    };
    await states.put(state);
    meta.states++;
    meta.assets += added;
    meta.bytes += bytes;
    meta.documents = documents.length;
    await tx.objectStore("meta").put(meta);
    await tx.done;
    return meta;
  } finally {
    db.close();
  }
}
export async function readVisualArchive(
  session: string,
  options: {
    progress?: (value: ExportProgress) => void;
    documentsOnly?: boolean;
  } = {},
): Promise<VisualArchive> {
  const db = await database();
  try {
    options.progress?.({ phase: "reading-states" });
    const states = (await db.getAllFromIndex(
      "states",
      "session",
      session,
    )) as VisualState[];
    states.sort((a, b) => a.index - b.index);
    const assets: VisualAsset[] = [];
    const keys = new Set(
      states.flatMap((state) => [
        state.root,
        ...state.documents.map((doc) => doc.key),
        ...(options.documentsOnly ? [] : Object.values(state.refs)),
      ]),
    );
    const pending = [...keys];
    let bytes = 0;
    for (let offset = 0; offset < pending.length; offset += 64) {
      const tx = db.transaction("assets", "readonly");
      const batch = (await Promise.all(
        pending.slice(offset, offset + 64).map((key) => tx.store.get(key)),
      )) as (VisualAsset | undefined)[];
      await tx.done;
      for (const asset of batch) {
        if (!asset)
          throw new OperationError(
            "MISSING_ASSET",
            "A recorded visual resource is missing; source archive preserved.",
          );
        bytes += asset.bytes.byteLength;
        if (bytes > 100 * 1024 * 1024)
          throw new OperationError(
            "EXPORT_TOO_LARGE",
            "Referenced resources exceed the 100 MB preview budget.",
          );
        assets.push(asset);
      }
      options.progress?.({
        phase: "reading-assets",
        done: assets.length,
        total: pending.length,
        bytes,
      });
    }
    return {
      meta: (await db.get("meta", session)) || empty(session),
      states,
      assets,
    };
  } finally {
    db.close();
  }
}
