// SPDX-License-Identifier: AGPL-3.0-or-later
// Synthetic test-only Chromium-format MIME capture. Never uses employer content.
export function fixtureCapture(step: number, cidSuffix = "test"): string {
  const root = `<!doctype html><html><head><title>Course player</title><link rel="stylesheet" href="https://fixture.example/course.css"></head><body><header class="banner"><b>Learning Lab</b><span>Completed course · Offline demonstration</span></header><main><h1>Physical tools · practice library</h1><p>This simulated outer player embeds its lesson from a different host.</p><iframe title="Embedded lesson" src="cid:lesson-${cidSuffix}" style="width:100%;height:440px;border:0"></iframe></main><script>fetch('https://must-not-run.example/')</script><input type="password" value="DO_NOT_EXPORT"></body></html>`;
  const lesson = `<!doctype html><html><head><title>Embedded lesson</title><link rel="stylesheet" href="https://fixture.example/course.css"></head><body><article class="lesson"><small>LESSON ${step} OF 2 · SYNTHETIC CONTENT</small><h1>${
    step === 1 ? "Inspect before use" : "Label both ends"
  }</h1><img alt="Embedded tool illustration" width="96" height="96" src="https://fixture.example/tool.svg"><p>${
    step === 1
      ? "Check a tool for damage before use. Choose the correct size for the task."
      : "Read the identifier at both ends before disconnecting a cable. Keep labels readable."
  }</p><aside>Quick revision: ${
    step === 1 ? "Inspect → Select → Use safely" : "Identify → Verify → Label"
  }</aside><p>हिन्दी · café · 日本語</p>${
    step === 1
      ? "<button>Continue lesson</button>"
      : "<h2>Practice complete</h2><button>Unvisited action</button>"
  }</article></body></html>`;
  const parts = [
    {
      mime: "text/html;charset=utf-8",
      url: "https://fixture.example/player",
      cid: "root-" + cidSuffix,
      data: root,
    },
    {
      mime: "text/html;charset=utf-8",
      url: "https://content.other.example/lesson",
      cid: "lesson-" + cidSuffix,
      data: lesson,
    },
    {
      mime: "text/css",
      url: "https://fixture.example/course.css",
      cid: "",
      data: "body{margin:0;font:17px/1.6 system-ui;color:#203e36;background:#eff5f1}.banner{display:flex;justify-content:space-between;background:#153f35;color:white;padding:18px 30px}main{padding:18px 30px;max-width:1000px;margin:auto}h1{line-height:1.25}.lesson{background:white;border:1px solid #c0d2c7;border-radius:14px;padding:24px;margin:12px auto;max-width:880px}.lesson img{float:right;margin:0 15px 10px}aside{background:#e3f0c9;padding:14px;border-left:4px solid #699843}button{font:inherit;background:#21624c;color:white;padding:12px 22px;border:0;border-radius:6px}small{font-size:12px;letter-spacing:1px}",
    },
    {
      mime: "image/svg+xml",
      url: "https://fixture.example/tool.svg",
      cid: "",
      data: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="#c6dfb0"/><path d="M27 68L62 33M51 24L68 23L74 40L62 43L53 34Z" fill="none" stroke="#285440" stroke-width="9" stroke-linecap="round"/></svg>',
    },
  ];
  const encode = (text: string) =>
    btoa(
      Array.from(new TextEncoder().encode(text), (byte) =>
        String.fromCharCode(byte),
      ).join(""),
    );
  return (
    'MIME-Version: 1.0\r\nContent-Type: multipart/related;\r\n boundary="fixture-boundary"\r\n\r\n' +
    parts
      .map(
        (part) =>
          "--fixture-boundary\r\nContent-Type: " +
          part.mime +
          "\r\nContent-Location: " +
          part.url +
          (part.cid ? "\r\nContent-ID: <" + part.cid + ">" : "") +
          "\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
          encode(part.data) +
          "\r\n",
      )
      .join("") +
    "--fixture-boundary--\r\n"
  );
}
