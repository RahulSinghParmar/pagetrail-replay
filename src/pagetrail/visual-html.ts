// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterMap,
} from "parse5";
import type { VisualArchive, VisualState } from "./visual-store";
import { escapeHtml, textFromHtml, type SavedPage } from "./reading";
import { OperationError } from "./operations";
import type { ExportProgress } from "./export-protocol";
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const utf8 = new TextDecoder();
const json = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function visualReadingPages(archive: VisualArchive): SavedPage[] {
  const assets = new Map(archive.assets.map((asset) => [asset.key, asset]));
  const textCache = new Map<string, string>();
  return archive.states.flatMap((state) =>
    state.documents.map((doc, i) => ({
      id: state.id + ":" + i,
      url: doc.url,
      title: state.title + (i ? " · embedded course" : ""),
      ts: Date.parse(state.time),
      text: (() => {
        if (!textCache.has(doc.key))
          textCache.set(
            doc.key,
            textFromHtml(utf8.decode(assets.get(doc.key)?.bytes)),
          );
        return textCache.get(doc.key)!;
      })(),
    })),
  );
}
// Only this small navigation bridge runs in archived documents. Original scripts never do.
function frameBridge(frame: string, token: string, index: number) {
  return `document.addEventListener('click',function(e){var n=e.target.closest('a,button,[role="button"],summary');if(!n)return;var p=[],v=n;while(v&&v.nodeType===1){var t=v.localName,i=1,s=v.previousElementSibling;while(s){if(s.localName===t)i++;s=s.previousElementSibling}p.unshift(t+':nth-of-type('+i+')');v=v.parentElement}if(n.localName==='summary')return;e.preventDefault();top.postMessage({pt:${json(
    token,
  )},index:${index},frame:${json(
    frame,
  )},selector:p.join('>'),url:n.getAttribute('data-pt-link')||'',label:(n.textContent||'').trim().slice(0,120)},'*')},true);document.addEventListener('submit',function(e){e.preventDefault()},true);`;
}
export function visualHtml(
  archive: VisualArchive,
  title: string,
  options: {
    progress?: (value: ExportProgress) => void;
    limitBytes?: number;
    coverage?: string;
  } = {},
): { html: string; missing: number } {
  if (!archive.states.length)
    throw new OperationError(
      "NO_VISUAL_STATES",
      "This older recording has no visual page states. A text-only file cannot become the webpage. Keep its WACZ; make a new recording with 0.1.2 for self-contained session HTML.",
    );
  const token = crypto.randomUUID(),
    nonce = crypto.randomUUID().replace(/-/g, ""),
    assets = new Map(archive.assets.map((asset) => [asset.key, asset]));
  const packed: Record<string, { mime: string; data: string }> =
      Object.create(null),
    missing = new Set<string>(),
    cssDedup = new Map<string, string>();
  const cssCache = new Map<VisualState, Map<string, string>>();
  let estimatedBytes = 0;
  const limit = options.limitBytes ?? 100 * 1024 * 1024;
  const budget = (bytes: number) => {
    estimatedBytes += bytes;
    if (estimatedBytes > limit)
      throw new OperationError(
        "EXPORT_TOO_LARGE",
        "The generated HTML exceeds the preview budget.",
      );
  };
  const csp = `default-src 'none';script-src 'nonce-${nonce}';style-src 'unsafe-inline' data:;img-src data:;font-src data:;frame-src about:;media-src 'none';connect-src 'none';object-src 'none';base-uri 'none';form-action 'none'`;
  function resolve(
    raw: string,
    base: string,
    state: VisualState,
  ): string | undefined {
    if (state.refs[raw]) return state.refs[raw];
    try {
      const url = new URL(raw, base);
      url.hash = "";
      return state.refs[url.href];
    } catch {
      return undefined;
    }
  }
  function resource(
    raw: string,
    base: string,
    state: VisualState,
    stack: Set<string>,
  ): string {
    if (/^#[\w:.-]+$/.test(raw)) return raw;
    // SVG data images may contain links/scripts; only raster inline formats pass through.
    if (
      /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(
        raw,
      )
    )
      return raw;
    const key = resolve(raw, base, state),
      asset = key && assets.get(key);
    if (!asset) {
      missing.add(raw || base);
      return "data:,";
    }
    if (stack.has(key)) {
      missing.add("cyclic resource: " + raw);
      return "data:,";
    }
    if (asset.mime === "text/css") {
      const cacheKey = key + "|" + base + "|" + raw;
      const cache = cssCache.get(state) || new Map<string, string>();
      cssCache.set(state, cache);
      if (cache.has(cacheKey)) return cache.get(cacheKey)!;
      const next = new Set(stack).add(key);
      const css = rewriteCss(
        utf8.decode(asset.bytes),
        raw.startsWith("cid:") ? base : new URL(raw, base).href,
        state,
        next,
      );
      let id = cssDedup.get(css);
      if (!id) {
        id = "css-" + cssDedup.size;
        cssDedup.set(css, id);
        packed[id] = {
          mime: "text/css;charset=utf-8",
          data: base64(new TextEncoder().encode(css)),
        };
        budget(packed[id].data.length);
      }
      const token = "__PT_ASSET_" + id + "__";
      cache.set(cacheKey, token);
      return token;
    }
    if (
      !/^(image\/(png|jpeg|gif|webp|avif|svg\+xml|x-icon|vnd.microsoft.icon)|font\/[\w.+-]+|application\/(font-[\w-]+|vnd.ms-fontobject|octet-stream))$/.test(
        asset.mime,
      )
    ) {
      missing.add("unsupported resource: " + raw);
      return "data:,";
    }
    const id = "bin-" + key.split(":").pop();
    if (packed[id]) return "__PT_ASSET_" + id + "__";
    let bytes = asset.bytes;
    if (asset.mime === "image/svg+xml") {
      // SVG is displayed only as an image; strip active/external content defensively too.
      const svg = utf8
        .decode(bytes)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
        .replace(/\s+on[\w-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\s+(?:xlink:)?href\s*=\s*(["'])(?!#)[\s\S]*?\1/gi, "")
        .replace(/url\(\s*["']?(?!#)[^)]*\)/gi, "none");
      bytes = new TextEncoder().encode(svg);
    }
    packed[id] ||= { mime: asset.mime, data: base64(bytes) };
    budget(packed[id].data.length);
    return "__PT_ASSET_" + id + "__";
  }
  function rewriteCss(
    css: string,
    base: string,
    state: VisualState,
    stack: Set<string>,
  ): string {
    return css
      .replace(/@charset\s+[^;]+;/gi, "")
      .replace(
        /@import\s+(['"])([^'"]+)\1/g,
        (_, _quote: string, raw: string) =>
          `@import url("${resource(raw, base, state, stack)}")`,
      )
      .replace(
        /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi,
        (whole, a: string, b: string, c: string) => {
          const raw = (a ?? b ?? c).trim();
          if (raw.startsWith("__PT_ASSET_")) return whole;
          return `url("${resource(raw, base, state, stack)}")`;
        },
      );
  }
  function documentHtml(
    key: string,
    source: string,
    state: VisualState,
    ancestors = new Set<string>(),
  ): string {
    const asset = assets.get(key);
    if (!asset || ancestors.has(key) || ancestors.size > 12) {
      missing.add("missing/recursive frame: " + source);
      return "<p>Embedded content was not captured.</p>";
    }
    const tree = parse(utf8.decode(asset.bytes)),
      next = new Set(ancestors).add(key);
    let base = source;
    function findBase(node: Node) {
      if ("tagName" in node && node.tagName === "base") {
        const href = node.attrs.find((a) => a.name === "href")?.value;
        if (href) {
          try {
            base = new URL(href, source).href;
          } catch {
            /* invalid base */
          }
        }
      }
      if ("childNodes" in node)
        for (const child of node.childNodes) findBase(child);
    }
    findBase(tree);
    function visit(node: Node) {
      if (!("childNodes" in node)) return;
      node.childNodes = node.childNodes.filter(
        (child) =>
          !(
            "tagName" in child &&
            (["script", "base", "object", "embed", "portal", "applet"].includes(
              child.tagName,
            ) ||
              (child.tagName === "meta" &&
                child.attrs.some((a) => a.name === "http-equiv")) ||
              (child.tagName === "link" &&
                !child.attrs.some(
                  (a) =>
                    a.name === "rel" && a.value.toLowerCase() === "stylesheet",
                )))
          ),
      );
      for (const child of node.childNodes) {
        if (!("tagName" in child)) continue;
        const el = child as Element,
          tag = el.tagName;
        const old = Object.fromEntries(
          el.attrs.map((attr) => [attr.name, attr.value]),
        );
        el.attrs = el.attrs.filter(
          (attr) =>
            !attr.name.startsWith("on") &&
            !attr.name.startsWith("data-pt-") &&
            ![
              "nonce",
              "integrity",
              "crossorigin",
              "ping",
              "target",
              "download",
              "srcdoc",
              "srcset",
              "imagesrcset",
              "action",
              "formaction",
              "manifest",
              "autofocus",
              "autoplay",
              "contenteditable",
              "form",
              "xlink:href",
            ].includes(attr.name) &&
            !["src", "href", "poster", "background", "data"].includes(
              attr.name,
            ),
        );
        const set = (name: string, value: string) => {
          el.attrs = el.attrs.filter((a) => a.name !== name);
          el.attrs.push({ name, value });
        };
        if (old.style)
          set("style", rewriteCss(old.style, base, state, new Set()));
        if (tag === "style")
          for (const text of el.childNodes)
            if (text.nodeName === "#text" && "value" in text)
              text.value = rewriteCss(text.value, base, state, new Set());
        if (tag === "a" || tag === "area") {
          let href = "";
          try {
            const url = new URL(old.href || "", base);
            if (["https:", "http:"].includes(url.protocol)) href = url.href;
          } catch {
            /* unsafe URL */
          }
          set("data-pt-link", href);
          set("href", "#");
        } else if (tag === "link")
          set("href", resource(old.href || "", base, state, new Set()));
        if (["iframe", "frame"].includes(tag)) {
          const frameKey = resolve(old.src || "", base, state);
          set("sandbox", "allow-scripts");
          set("referrerpolicy", "no-referrer");
          set(
            "srcdoc",
            frameKey
              ? documentHtml(
                  frameKey,
                  state.documents.find((d) => d.key === frameKey)?.url || base,
                  state,
                  next,
                )
              : "<p>Embedded frame was not captured. Revisit it while recording.</p>",
          );
          if (!frameKey) missing.add("frame: " + (old.src || base));
        } else if (tag === "img" || (tag === "input" && old.type === "image"))
          set("src", resource(old.src || "", base, state, new Set()));
        if (old.poster)
          set("poster", resource(old.poster, base, state, new Set()));
        if (old.background)
          set("background", resource(old.background, base, state, new Set()));
        if (tag === "input") {
          el.attrs = el.attrs.filter(
            (a) => !["value", "checked"].includes(a.name),
          );
          set("disabled", "");
        }
        if (tag === "textarea") {
          el.childNodes = [];
          set("disabled", "");
        }
        if (tag === "select") set("disabled", "");
        if (tag === "button") set("type", "button");
        visit(el);
        // Chromium serializes shadow roots as declarative template content.
        if ("content" in el) visit(el.content as Node);
      }
    }
    visit(tree);
    const bridge = `<script nonce="${nonce}">${frameBridge(
      source,
      token,
      state.index,
    )}</script>`;
    function appendBridge(node: Node) {
      if ("tagName" in node && node.tagName === "body") {
        for (const child of parseFragment(bridge).childNodes) {
          child.parentNode = node;
          node.childNodes.push(child);
        }
        return;
      }
      if ("childNodes" in node)
        for (const child of node.childNodes) appendBridge(child);
    }
    appendBridge(tree);
    let html = serialize(tree);
    // parse5 produces a head for all valid HTML documents. Put policy before site styles.
    html = html.replace(
      /<head([^>]*)>/i,
      `<head$1><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(
        csp,
      )}"><meta name="referrer" content="no-referrer">`,
    );
    return "<!doctype html>" + html;
  }
  const states = archive.states.map((state, index) => {
    options.progress?.({
      phase: "embedding",
      done: index,
      total: archive.states.length,
    });
    const html = documentHtml(state.root, state.url, state);
    budget(new TextEncoder().encode(json(html)).byteLength);
    cssCache.delete(state);
    return {
      url: state.url,
      title: state.title,
      time: state.time,
      action: state.action,
      html,
    };
  });
  options.progress?.({
    phase: "embedding",
    done: states.length,
    total: states.length,
  });
  const payload = {
    token,
    states,
    assets: packed,
    warnings: [...missing, ...(options.coverage ? [options.coverage] : [])],
    captureError: archive.meta.error,
  };
  const runtime = `
const book=JSON.parse(document.getElementById('archive').textContent),cache=new Map(),view=document.getElementById('site'),select=document.getElementById('pages'),notice=document.getElementById('notice');
let current=0;
function replace(s,stack=new Set()){return s.replace(/__PT_ASSET_([a-z0-9-]+)__/g,(_,id)=>asset(id,stack))}
function asset(id,stack){
  if(cache.has(id))return cache.get(id);if(stack.has(id))return 'data:,';
  const a=book.assets[id];if(!a)return 'data:,';let encoded=a.data;
  if(a.mime.startsWith('text/css')){
    const bytes=Uint8Array.from(atob(a.data),c=>c.charCodeAt(0));
    const css=replace(new TextDecoder().decode(bytes),new Set([...stack,id]));
    const output=new TextEncoder().encode(css);let binary='';
    for(let i=0;i<output.length;i+=8192)binary+=String.fromCharCode(...output.subarray(i,i+8192));
    encoded=btoa(binary);
  }
  const url='data:'+a.mime+';base64,'+encoded;cache.set(id,url);return url;
}
function show(i){
  if(i<0||i>=book.states.length)return;current=i;select.value=String(i);view.srcdoc=replace(book.states[i].html);
  document.getElementById('position').textContent=(i+1)+' / '+book.states.length;
  document.getElementById('previous').disabled=i===0;document.getElementById('next').disabled=i===book.states.length-1;
  notice.textContent=book.states[i].url;location.hash='state-'+(i+1);
}
book.states.forEach((s,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=(i+1)+'. '+s.title+' · '+s.time;select.append(o)});
select.onchange=()=>show(Number(select.value));document.getElementById('previous').onclick=()=>show(current-1);document.getElementById('next').onclick=()=>show(current+1);
window.addEventListener('message',e=>{
  const m=e.data;if(!m||m.pt!==book.token||m.index!==current)return;
  let to=book.states.findIndex(s=>s.action&&s.action.from===current&&s.action.frame===m.frame&&s.action.selector===m.selector);
  if(to<0&&m.url)to=book.states.findIndex((s,i)=>i!==current&&s.url===m.url);
  if(to>=0)show(to);else notice.textContent='This action or destination was not recorded. Use Previous / Next to explore captured content.';
});
const warnings=book.warnings.length;
document.getElementById('coverage').textContent='Only visited content is included. Original site scripts, server actions, audio/video and quizzes are not replayed.'+(warnings?' '+warnings+' missing or unsupported resource(s); see coverage details.':'')+(book.captureError?' Capture warning: '+book.captureError:'');
document.getElementById('details').textContent=book.warnings.join('\\n')||'No missing resource references detected. This does not prove every lesson was visited.';
show(Math.max(0,Math.min(book.states.length-1,Number(location.hash.replace('#state-',''))-1||0)));
window.addEventListener('hashchange',()=>{const i=Number(location.hash.replace('#state-',''))-1;if(Number.isInteger(i)&&i!==current)show(i)});
`;
  const result = {
    missing: missing.size,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(
      csp,
    )}"><title>${escapeHtml(
      title,
    )} · Offline session</title><style>html,body{margin:0;height:100%;font:14px system-ui;color:#173b31;background:#edf3f0}body{display:flex;flex-direction:column}header{padding:12px 18px;border-bottom:1px solid #bbcdc3}h1{font-size:18px;margin:0 0 8px}nav{display:flex;align-items:center;gap:10px}button,select{font:inherit;padding:8px;border:1px solid #98b5a6;border-radius:6px;background:white}select{flex:1;min-width:0}#notice{margin:8px 0 0;overflow-wrap:anywhere}#coverage{font-size:12px;margin:6px 0}iframe{flex:1;width:100%;border:0;background:white;min-height:200px}details{padding:6px 18px}pre{white-space:pre-wrap;max-height:150px;overflow:auto}</style></head><body><header><h1>${escapeHtml(
      title,
    )} · One-file offline session</h1><nav><button id="previous">Previous</button><select id="pages" aria-label="Recorded content"></select><button id="next">Next</button><span id="position"></span></nav><p id="notice" role="status"></p><p id="coverage"></p></header><details><summary>Coverage details · no companion folder, server or extension required</summary><pre id="details"></pre></details><iframe id="site" title="Captured website" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><script id="archive" type="application/json">${json(
      payload,
    )}</script><script nonce="${nonce}">${runtime}</script></body></html>`,
  };
  if (new Blob([result.html]).size > limit)
    throw new OperationError(
      "EXPORT_TOO_LARGE",
      "The generated HTML exceeds the preview budget.",
    );
  return result;
}
