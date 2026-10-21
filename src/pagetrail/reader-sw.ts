// SPDX-License-Identifier: AGPL-3.0-or-later
// Separate from recorder SW: no RecProxy, live source, upload or extension API.
import {
  SWReplay,
  SWCollections,
  Collection,
  WorkerLoader,
  type ArchiveRequest,
} from "@webrecorder/wabac/swlib";
import { allowReplayRequest, REPLAY_CSP, REPLAY_BUILD } from "./replay-policy";
import READER_HTML from "@/static/offline-reader.html";
declare const self: ServiceWorkerGlobalScope;
class OfflineCollection extends Collection {
  override async getReplayResponse(request: ArchiveRequest, event: FetchEvent) {
    const response = await super.getReplayResponse(request, event);
    // Distinguish an actual captured HTTP 404 from a missing archive resource.
    if (response instanceof Response) {
      const headers = new Headers(response.headers);
      headers.set("X-PageTrail-Recorded", "1");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    response?.headers.set("X-PageTrail-Recorded", "1");
    return response;
  }
}
class OfflineCollections extends SWCollections {
  override _createCollection(
    opts: Parameters<SWCollections["_createCollection"]>[0],
  ) {
    const coll = new OfflineCollection(opts, this.prefixes, this.defaultConfig);
    coll.liveRedirectOnNotFound = false;
    coll.csp = REPLAY_CSP;
    return coll;
  }
}
class OfflineReplay extends SWReplay {
  override getIndexHtml() {
    return READER_HTML;
  }
  override async handleFetch(event: FetchEvent): Promise<Response> {
    const request = event.request;
    const client = event.clientId
      ? await self.clients.get(event.clientId)
      : undefined;
    const fromReplay =
      request.referrer.startsWith(this.replayPrefix) ||
      !!client?.url.startsWith(this.replayPrefix);
    if (!allowReplayRequest(request.url, fromReplay, this.prefix))
      return new Response("Not available in this offline reader.", {
        status: 403,
      });
    const response = await super.handleFetch(event);
    if (
      request.url.startsWith(this.replayPrefix) &&
      !request.url.startsWith(this.apiPrefix)
    ) {
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", REPLAY_CSP);
      if (
        response.status === 404 &&
        response.headers.get("X-PageTrail-Recorded") !== "1" &&
        ["document", "iframe", "frame"].includes(request.destination)
      ) {
        headers.set("Content-Type", "text/html; charset=utf-8");
        headers.delete("Content-Length");
        return new Response(
          '<!doctype html><html lang="en"><meta charset="utf-8"><title>Not captured · PageTrail</title><style>body{font:18px/1.6 system-ui;max-width:42rem;margin:12vh auto;padding:24px;color:#193f30}</style><h1>This page wasn’t captured</h1><p>It is not available in this recording. No live website was opened.</p><p>Use Back or Recorded pages in the reader to return to saved content.</p></html>',
          { status: 404, headers },
        );
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  }
}
if (self.registration) {
  self.addEventListener("install", (event: ExtendableEvent) =>
    event.waitUntil(self.skipWaiting()),
  );
  self.addEventListener("activate", (event: ExtendableEvent) =>
    event.waitUntil(self.clients.claim()),
  );
  self.addEventListener("message", (event: ExtendableMessageEvent) => {
    if (event.data?.type === "pagetrail-reader-status")
      event.source?.postMessage({
        type: "pagetrail-reader-status",
        build: REPLAY_BUILD,
      });
  });
  new OfflineReplay({
    CollectionsClass: OfflineCollections,
    defaultConfig: {
      liveRedirectOnNotFound: false,
      convertPostToGet: false,
      csp: REPLAY_CSP,
    },
  });
} else new WorkerLoader(self);
