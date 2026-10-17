// SPDX-License-Identifier: AGPL-3.0-or-later
// Strict reader for Chromium Page.captureSnapshot's multipart/related output.
export type CapturePart = {
  url: string;
  cid: string;
  mime: string;
  bytes: Uint8Array;
};
function headers(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.replace(/\n[\t ]+/g, " ").split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0)
      result[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  return result;
}
export function parseCapture(raw: string): CapturePart[] {
  if (raw.length > 60 * 1024 * 1024)
    throw new Error("A page capture exceeds the 60 MB preview limit.");
  const text = raw.replace(/\r\n/g, "\n"),
    end = text.indexOf("\n\n");
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(
    headers(text.slice(0, end))["content-type"] || "",
  );
  if (end < 0 || !boundary)
    throw new Error(
      "Browser returned an unsupported page capture; nothing was exported.",
    );
  const delimiter = "--" + (boundary[1] || boundary[2]);
  const chunks = text.slice(end + 2).split("\n" + delimiter);
  if (chunks[0].startsWith(delimiter))
    chunks[0] = chunks[0].slice(delimiter.length);
  else chunks.shift();
  const parts: CapturePart[] = [];
  let closed = false;
  for (let chunk of chunks) {
    if (chunk.startsWith("--")) {
      closed = true;
      break;
    }
    if (chunk.startsWith("\n")) chunk = chunk.slice(1);
    const separator = chunk.indexOf("\n\n");
    if (separator < 0) throw new Error("Incomplete page capture headers.");
    const h = headers(chunk.slice(0, separator));
    const body = chunk.slice(separator + 2).replace(/\n$/, "");
    const transfer = (h["content-transfer-encoding"] || "7bit").toLowerCase();
    let bytes: Uint8Array;
    if (transfer === "base64") {
      const decoded = atob(body.replace(/\s/g, ""));
      bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    } else if (transfer === "quoted-printable") {
      const decoded = body
        .replace(/=\n/g, "")
        .replace(/=([\da-f]{2})/gi, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        );
      bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    } else if (["7bit", "8bit", "binary"].includes(transfer)) {
      bytes = new TextEncoder().encode(body);
    } else throw new Error("Unsupported page capture encoding: " + transfer);
    const contentType = h["content-type"] || "application/octet-stream";
    const mime = contentType.split(";")[0].toLowerCase().trim();
    if (mime.startsWith("text/")) {
      const charset =
        /charset=["']?([^;\s"']+)/i.exec(contentType)?.[1] || "utf-8";
      bytes = new TextEncoder().encode(new TextDecoder(charset).decode(bytes));
    }
    parts.push({
      url: h["content-location"] || "",
      cid: (h["content-id"] || "").replace(/^<|>$/g, ""),
      mime,
      bytes,
    });
  }
  if (!closed || !parts.some((p) => p.mime === "text/html"))
    throw new Error(
      "Incomplete capture or no HTML document. Saved archives are unchanged.",
    );
  return parts;
}
