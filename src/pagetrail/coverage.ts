// SPDX-License-Identifier: AGPL-3.0-or-later
import { sensitiveEndpoint } from "./privacy";
export type CoverageState =
  | "pending"
  | "saved"
  | "failed"
  | "excluded"
  | "unsupported"
  | "unavailable";
export type CoverageReason =
  | "CAPTURED"
  | "NETWORK_FAILED"
  | "HTTP_ERROR"
  | "AUTH_ENDPOINT"
  | "UNSUPPORTED_TYPE"
  | "ENGINE_SKIPPED"
  | "BODY_UNAVAILABLE"
  | "CACHE_BODY_UNAVAILABLE"
  | "STORAGE_FAILED"
  | "RESOURCE_LIMIT"
  | "SESSION_LIMIT"
  | "OUT_OF_SCOPE"
  | "INTERRUPTED"
  | "FINISH_TIMEOUT"
  | "SUPPLEMENTARY_DISABLED";
export type CoverageRequest = {
  url?: string;
  method?: string;
  resourceType?: string;
  status?: number;
  payload?: Uint8Array;
  ts?: number;
};
export type CoverageEntry = {
  id: string;
  session: string;
  source: string;
  method: string;
  type: string;
  state: CoverageState;
  reason?: CoverageReason;
  status?: number;
  bytes: number;
  time: string;
  archiveTime?: number;
};
export type CoverageSummary = {
  session: string;
  observed: number;
  counts: Record<CoverageState, number>;
  bytes: number;
  dropped: number;
  interrupted: boolean;
  persistenceFailed: boolean;
  finishing: boolean;
  settled: boolean;
  visualGaps: number;
  updated: string;
};
export type CoverageBatch = {
  summary: CoverageSummary;
  entries: CoverageEntry[];
};
export interface CaptureObserver {
  requested(request: object): void;
  bind(data: object, request: object): void;
  outcome(request: object, state: CoverageState, reason: CoverageReason): void;
  stored(data: object, success: boolean): void;
}
export const RESOURCE_LIMIT = 20 * 1024 * 1024;
export const SESSION_LIMIT = 100 * 1024 * 1024;
const STATES: CoverageState[] = [
  "pending",
  "saved",
  "failed",
  "excluded",
  "unsupported",
  "unavailable",
];

// Keep enough location information to diagnose gaps, but never query strings,
// URL credentials, fragments, headers, bodies, field values or raw errors.
function source(raw = ""): string {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "unsupported source";
    return url.origin + url.pathname.slice(0, 1000);
  } catch {
    return "unsupported source";
  }
}
export class CoverageLedger implements CaptureObserver {
  private readonly entries = new Map<string, CoverageEntry>();
  private readonly requests = new WeakMap<object, string>();
  private readonly resources = new WeakMap<object, string>();
  private readonly bodySizes = new WeakMap<object, number>();
  private readonly dirty = new Set<string>();
  private readonly summary: CoverageSummary;
  private sequence = 0;
  private reserved = 0;
  private readonly limit: number;
  constructor(session: string, restored?: CoverageBatch, limit = 10000) {
    this.limit = limit;
    this.summary = restored?.summary || {
      session,
      observed: 0,
      counts: Object.fromEntries(STATES.map((state) => [state, 0])) as Record<
        CoverageState,
        number
      >,
      bytes: 0,
      dropped: 0,
      interrupted: false,
      persistenceFailed: false,
      finishing: false,
      settled: false,
      visualGaps: 0,
      updated: new Date().toISOString(),
    };
    for (const entry of restored?.entries || []) {
      this.entries.set(entry.id, entry);
      this.sequence = Math.max(
        this.sequence,
        Number(entry.id.split(":").pop()) || 0,
      );
    }
    this.summary.finishing = false;
    this.summary.settled = false;
    this.unfinished("INTERRUPTED");
  }
  snapshot(): CoverageSummary {
    return structuredClone(this.summary);
  }
  private changed(entry?: CoverageEntry) {
    this.summary.updated = new Date().toISOString();
    if (entry) this.dirty.add(entry.id);
  }
  requested(request: object) {
    const value = request as CoverageRequest;
    if (!value.url) return;
    const id = this.summary.session + ":" + ++this.sequence;
    this.requests.set(request, id);
    this.summary.observed++;
    if (this.entries.size >= this.limit) {
      this.summary.dropped++;
      this.changed();
      return;
    }
    const entry: CoverageEntry = {
      id,
      session: this.summary.session,
      source: source(value.url),
      method: value.method || "GET",
      type: value.resourceType || "Other",
      state: "pending",
      bytes: 0,
      time: new Date().toISOString(),
    };
    this.entries.set(id, entry);
    this.summary.counts.pending++;
    this.changed(entry);
    if (sensitiveEndpoint(value.url))
      this.outcome(request, "excluded", "AUTH_ENDPOINT");
    else if (
      !/^https?:/.test(value.url) ||
      ["WebSocket", "EventSource", "Media", "Ping"].includes(entry.type)
    )
      this.outcome(request, "unsupported", "UNSUPPORTED_TYPE");
    else if (
      ["HEAD", "OPTIONS"].includes(entry.method) ||
      (entry.type === "Other" && entry.method === "POST")
    )
      this.outcome(request, "excluded", "ENGINE_SKIPPED");
  }
  private ensure(request: object) {
    if (!this.requests.has(request)) this.requested(request);
    return this.entries.get(this.requests.get(request) || "");
  }
  private settle(
    entry: CoverageEntry | undefined,
    state: CoverageState,
    reason: CoverageReason,
    status?: number,
  ) {
    if (!entry || entry.state !== "pending") return;
    this.summary.counts.pending--;
    this.summary.counts[state]++;
    Object.assign(entry, { state, reason, status });
    this.changed(entry);
  }
  outcome(request: object, state: CoverageState, reason: CoverageReason) {
    this.settle(
      this.ensure(request),
      state,
      reason,
      (request as CoverageRequest).status,
    );
  }
  bind(data: object, request: object) {
    const entry = this.ensure(request);
    if (entry) this.resources.set(data, entry.id);
    this.bodySizes.set(
      data,
      (data as CoverageRequest).payload?.byteLength || 0,
    );
  }
  resourceOutcome(data: object, state: CoverageState, reason: CoverageReason) {
    const entry = this.entries.get(this.resources.get(data) || "");
    this.settle(entry, state, reason, (data as CoverageRequest).status);
  }
  stored(data: object, success: boolean) {
    const entry = this.entries.get(this.resources.get(data) || "");
    const value = data as CoverageRequest;
    this.settle(
      entry,
      success
        ? value.status && value.status >= 400
          ? "failed"
          : "saved"
        : "failed",
      success
        ? value.status && value.status >= 400
          ? "HTTP_ERROR"
          : "CAPTURED"
        : "STORAGE_FAILED",
      value.status,
    );
    if (entry && success) {
      entry.bytes = this.bodySizes.get(data) ?? value.payload?.byteLength ?? 0;
      entry.archiveTime = value.ts;
      this.changed(entry);
    }
  }
  rejection(request: object, bytes = 0): CoverageReason | undefined {
    const value = request as CoverageRequest;
    if (sensitiveEndpoint(value.url || "")) return "AUTH_ENDPOINT";
    if (value.resourceType === "Media") return "UNSUPPORTED_TYPE";
    if (bytes > RESOURCE_LIMIT) return "RESOURCE_LIMIT";
    if (
      this.summary.bytes + this.reserved + bytes > SESSION_LIMIT ||
      this.summary.dropped
    )
      return "SESSION_LIMIT";
    return undefined;
  }
  reserve(bytes: number) {
    this.reserved += bytes;
  }
  release(bytes: number, saved: boolean) {
    this.reserved -= bytes;
    if (saved) this.summary.bytes += bytes;
    this.changed();
  }
  unfinished(reason: "INTERRUPTED" | "FINISH_TIMEOUT") {
    const pending = this.summary.counts.pending;
    for (const entry of this.entries.values())
      this.settle(entry, "unavailable", reason);
    if (reason === "INTERRUPTED" && pending) this.summary.interrupted = true;
    this.changed();
  }
  visualGap() {
    this.summary.visualGaps++;
    this.changed();
  }
  persistenceFailure() {
    this.summary.persistenceFailed = true;
    this.changed();
  }
  finish(settled: boolean) {
    this.summary.finishing = !settled;
    this.summary.settled = settled;
    this.changed();
  }
  batch(): CoverageBatch {
    const entries = [...this.dirty].map((id) =>
      structuredClone(this.entries.get(id)!),
    );
    this.dirty.clear();
    return { summary: this.snapshot(), entries };
  }
  restoreDirty(entries: CoverageEntry[]) {
    for (const entry of entries) this.dirty.add(entry.id);
  }
}
export function coverageText(summary?: CoverageSummary | null): string {
  if (!summary) return "Coverage unavailable for this older recording.";
  const c = summary.counts;
  return (
    `${c.saved} saved · ${c.failed} failed · ${c.unavailable} unavailable · ${c.excluded} excluded · ${c.unsupported} unsupported · ${c.pending} pending. ` +
    `${summary.visualGaps} visual gaps; ${summary.dropped} untracked after limit.` +
    (summary.persistenceFailed
      ? " Coverage storage failed; this report may be incomplete."
      : "") +
    (!summary.settled ? " Capture has not been confirmed settled." : "") +
    " Counts describe observed requests only, not every page or lesson on the site."
  );
}
export function coverageGaps(summary?: CoverageSummary | null): number {
  if (!summary) return 1; // Unknown coverage is not a clean bill of health.
  return (
    summary.counts.failed +
    summary.counts.unavailable +
    summary.counts.unsupported +
    summary.counts.excluded +
    summary.counts.pending +
    summary.visualGaps +
    summary.dropped +
    Number(summary.persistenceFailed) +
    Number(!summary.settled)
  );
}
