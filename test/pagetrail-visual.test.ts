// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { parseCapture } from "../src/pagetrail/mhtml.ts";
import { fixtureCapture } from "../src/pagetrail/visual-fixture.ts";
import {
  visualHtml,
  visualReadingPages,
} from "../src/pagetrail/visual-html.ts";
import { captureLoop } from "../src/pagetrail/visual-capture.ts";
import type {
  VisualArchive,
  VisualState,
} from "../src/pagetrail/visual-store.ts";
function archive(): VisualArchive {
  const assets = new Map(),
    states: VisualState[] = [];
  for (const step of [1, 2]) {
    const parts = parseCapture(fixtureCapture(step)),
      refs: Record<string, string> = {},
      documents = [];
    for (const part of parts) {
      const hash =
        Buffer.from(part.bytes).toString("hex").slice(0, 5) + "-" + assets.size;
      const key = part.mime + ":" + hash;
      assets.set(key, { key, mime: part.mime, bytes: part.bytes });
      refs[part.url] = key;
      if (part.cid) refs["cid:" + part.cid] = key;
      if (part.mime === "text/html") documents.push({ key, url: part.url });
    }
    states.push({
      id: "test:" + step,
      index: step - 1,
      session: "test",
      root: documents[0].key,
      refs,
      documents,
      url: "https://fixture.example/player",
      title: "Test lesson " + step,
      time: new Date().toISOString(),
      signature: "step-" + step,
    });
  }
  return {
    states,
    assets: [...assets.values()],
    meta: {
      session: "test",
      states: 2,
      assets: assets.size,
      bytes: 1000,
      documents: 2,
      error: "",
    },
  };
}
test("Chromium MIME includes outer page, cross-host frame, stylesheet and image", () => {
  const parts = parseCapture(fixtureCapture(1));
  assert.equal(parts.length, 4);
  assert.equal(parts.filter((part) => part.mime === "text/html").length, 2);
  assert.match(
    new TextDecoder().decode(parts[1].bytes),
    /हिन्दी · café · 日本語/,
  );
});
test("MIME parser handles folded headers / quoted-printable and rejects truncated captures", () => {
  const raw =
    'Content-Type: multipart/related;\r\n boundary="x"\r\n\r\n--x\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>caf=C3=A9=\r\n lesson</p>\r\n--x--\r\n';
  assert.match(
    new TextDecoder().decode(parseCapture(raw)[0].bytes),
    /café lesson/,
  );
  assert.throws(
    () => parseCapture(raw.replace("--x--", "--not-closed")),
    /Incomplete/,
  );
  assert.throws(() => parseCapture("<html>not MIME</html>"), /unsupported/);
});
test("visual HTML embeds frame, assets and original layout, strips original scripts / input values", () => {
  const result = visualHtml(archive(), "Test <course>");
  assert.equal(result.missing, 0);
  assert.match(result.html, /One-file offline session/);
  assert.match(result.html, /srcdoc/);
  assert.match(result.html, /Inspect before use/);
  assert.match(result.html, /Label both ends/);
  assert.match(result.html, /image\/svg\+xml/);
  assert.match(result.html, /text\/css/);
  assert.doesNotMatch(result.html, /DO_NOT_EXPORT|must-not-run\.example/);
  assert.match(result.html, /sandbox="allow-scripts"/);
  assert.doesNotMatch(result.html, /allow-same-origin/);
});
test("Markdown source includes lesson frames and both same-URL states, not only shell", () => {
  const pages = visualReadingPages(archive());
  assert.equal(pages.length, 4);
  assert(pages.some((page) => page.text?.includes("Inspect before use")));
  assert(pages.some((page) => page.text?.includes("Label both ends")));
  assert(!pages.some((page) => page.text?.includes("DO_NOT_EXPORT")));
});
test("navigation bridges are inserted into each body, not into escaped child srcdoc markup", () => {
  const output = visualHtml(archive(), "Nested frames").html;
  const payload = JSON.parse(
    output.match(
      /<script id="archive" type="application\/json">([\s\S]*?)<\/script>/,
    )![1],
  );
  const nodes = (
    root: DefaultTreeAdapterMap["node"],
    tag: string,
  ): DefaultTreeAdapterMap["element"][] => {
    const result: DefaultTreeAdapterMap["element"][] = [];
    if ("tagName" in root && root.tagName === tag) result.push(root);
    if ("childNodes" in root)
      for (const child of root.childNodes) result.push(...nodes(child, tag));
    return result;
  };
  const root = parse(payload.states[0].html);
  assert.equal(nodes(root, "script").length, 1);
  const frame = nodes(root, "iframe")[0];
  assert(!frame.attrs.some((attr) => attr.name.includes("postmessage")));
  const child = parse(
    frame.attrs.find((attr) => attr.name === "srcdoc")!.value,
  );
  assert.equal(nodes(child, "script").length, 1);
  const script = nodes(child, "script")[0];
  assert.match(
    JSON.stringify(script.childNodes, (key, value) =>
      key === "parentNode" ? undefined : value,
    ),
    /content.other.example/,
  );
});
test("older archives cannot silently export a text-only document as website HTML", () => {
  const old = archive();
  old.states = [];
  assert.throws(() => visualHtml(old, "Old archive"), /no visual page states/);
});
test("visual HTML reports per-state progress and rejects oversized output before buffering it all", () => {
  const phases: string[] = [];
  const result = visualHtml(archive(), "Progress fixture", {
    progress: (value) =>
      phases.push(`${value.phase}:${value.done}/${value.total}`),
  });
  assert(result.html.length);
  assert.deepEqual(phases, ["embedding:0/2", "embedding:1/2", "embedding:2/2"]);
  assert.throws(
    () => visualHtml(archive(), "Small budget", { limitBytes: 64 }),
    /preview budget/,
  );
});
test("standalone runtime builds inline assets and follows a recorded embedded-frame action", () => {
  const input = archive();
  input.states[1].action = {
    from: 0,
    frame: "https://content.other.example/lesson",
    selector: "lesson-button",
    label: "Continue",
  };
  const output = visualHtml(input, "Runtime test").html;
  const payload = output.match(
    /<script id="archive" type="application\/json">([\s\S]*?)<\/script>/,
  )![1];
  const runtime = output.match(
    /<script nonce="[^"]+">([\s\S]*?)<\/script><\/body>/,
  )![1];
  const elements: Record<
    string,
    {
      textContent: string;
      srcdoc?: string;
      disabled?: boolean;
      value: string;
      append: () => void;
      onclick?: () => void;
    }
  > = {};
  for (const id of [
    "archive",
    "site",
    "pages",
    "notice",
    "position",
    "previous",
    "next",
    "coverage",
    "details",
  ])
    elements[id] = {
      textContent: id === "archive" ? payload : "",
      value: "",
      append() {},
    };
  const listeners: Record<string, (data: unknown) => void> = {};
  runInNewContext(runtime, {
    document: {
      getElementById: (id: string) => elements[id],
      createElement: () => ({}),
    },
    window: {
      addEventListener: (name: string, fn: (data: unknown) => void) => {
        listeners[name] = fn;
      },
    },
    location: { hash: "" },
    TextDecoder,
    TextEncoder,
    atob,
    btoa,
    Uint8Array,
  });
  assert.equal(elements.position.textContent, "1 / 2");
  assert.match(elements.site.srcdoc!, /data:text\/css;charset=utf-8;base64,/);
  assert.doesNotMatch(elements.site.srcdoc!, /__PT_ASSET_|blob:/);
  listeners.message({
    data: {
      pt: JSON.parse(payload).token,
      index: 0,
      frame: "https://content.other.example/lesson",
      selector: "lesson-button",
    },
  });
  assert.equal(elements.position.textContent, "2 / 2");
  assert.match(elements.site.srcdoc!, /Label both ends/);
  elements.previous.onclick!();
  assert.equal(elements.position.textContent, "1 / 2");
  listeners.message({
    data: {
      pt: JSON.parse(payload).token,
      index: 0,
      frame: "unknown",
      selector: "uncaptured",
    },
  });
  assert.match(elements.notice.textContent, /not recorded/);
  assert.equal(elements.position.textContent, "1 / 2");
});
test("slow capture work is coalesced, never queued without bound", async () => {
  let release!: () => void,
    calls = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loop = captureLoop({
    capture: async () => {
      calls++;
      await gate;
    },
    error: async (error) => {
      throw error;
    },
    delay: 1,
    maxDelay: 2,
  });
  loop.changed();
  await new Promise((resolve) => setTimeout(resolve, 5));
  for (let i = 0; i < 10; i++) {
    loop.changed();
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(calls, 1);
  const stopped = loop.stop(false);
  release();
  await stopped;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 1);
});
test("missing frame / image references are reported, never fetched online", () => {
  const input = archive();
  input.states[0].refs = {};
  const result = visualHtml(input, "Coverage test");
  assert(result.missing > 0);
  assert.match(result.html, /Embedded frame was not captured/);
  assert.match(result.html, /connect-src &#39;none&#39;/);
});
test("capture loop coalesces rapid changes and stops capture before Pause", async () => {
  let captures = 0;
  const loop = captureLoop({
    capture: async () => {
      captures++;
    },
    error: async (error) => {
      throw error;
    },
    delay: 5,
    maxDelay: 20,
  });
  loop.changed();
  loop.changed();
  loop.changed();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(captures, 1);
  await loop.stop(true);
  assert.equal(captures, 2);
  loop.changed();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(captures, 2);
});
test("capture failure is reported and final capture is awaited", async () => {
  const errors: unknown[] = [];
  const loop = captureLoop({
    capture: async () => {
      throw new Error("capture blocked");
    },
    error: async (error) => {
      errors.push(error);
    },
  });
  await loop.stop(true);
  assert.equal(errors.length, 1);
});
