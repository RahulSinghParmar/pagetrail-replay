// SPDX-License-Identifier: AGPL-3.0-or-later
import { openDB } from "idb";
import { bounded } from "./operations";
import type { CoverageBatch, CoverageSummary } from "./coverage";
async function database() {
  const opening = openDB("pagetrail-coverage-v1", 1, {
    upgrade(db) {
      db.createObjectStore("summaries", { keyPath: "session" });
      db.createObjectStore("requests", { keyPath: "id" }).createIndex(
        "session",
        "session",
      );
    },
  });
  try {
    return await bounded(opening, { ms: 2000 });
  } catch (error) {
    void opening.then((db) => db.close()).catch(() => {});
    throw error;
  }
}
export async function saveCoverage(batch: CoverageBatch) {
  const db = await database();
  try {
    const tx = db.transaction(["summaries", "requests"], "readwrite");
    await Promise.all([
      ...batch.entries.map((entry) => tx.objectStore("requests").put(entry)),
      tx.objectStore("summaries").put(batch.summary),
      tx.done,
    ]);
  } finally {
    db.close();
  }
}
export async function readCoverage(
  session: string,
  details = false,
): Promise<CoverageBatch | null> {
  const db = await database();
  try {
    const tx = db.transaction(["summaries", "requests"], "readonly");
    const [summary, entries] = await Promise.all([
      tx.objectStore("summaries").get(session) as Promise<
        CoverageSummary | undefined
      >,
      details
        ? tx.objectStore("requests").index("session").getAll(session)
        : Promise.resolve([]),
      tx.done,
    ]);
    if (!summary) return null;
    return { summary, entries };
  } finally {
    db.close();
  }
}
