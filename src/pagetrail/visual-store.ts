// SPDX-License-Identifier: AGPL-3.0-or-later
import { openDB } from "idb";
import { parseCapture, type CapturePart } from "./mhtml";
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
  return openDB("pagetrail-visual-v1", 1, {
    upgrade(db) {
      db.createObjectStore("assets", { keyPath: "key" });
      db.createObjectStore("states", { keyPath: "id" }).createIndex(
        "session",
        "session",
      );
      db.createObjectStore("meta", { keyPath: "session" });
    },
  });
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
): Promise<VisualArchive> {
  const db = await database();
  try {
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
        ...Object.values(state.refs),
      ]),
    );
    for (const key of keys) {
      const asset = (await db.get("assets", key)) as VisualAsset;
      if (!asset)
        throw new Error(
          "A recorded visual resource is missing. Original archive preserved; no partial HTML was exported.",
        );
      assets.push(asset);
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
