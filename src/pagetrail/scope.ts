// SPDX-License-Identifier: AGPL-3.0-or-later
export function scopePath(value = ""): string | undefined {
  const path = value.trim();
  if (!path || path === "/") return undefined;
  if (!path.startsWith("/") || /[?#\\]|%(?:2f|5c)/i.test(path))
    throw new Error(
      "Use a path such as /learn/course, without a query or fragment.",
    );
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error("The recording path contains invalid URL encoding.");
  }
  if (decoded.split("/").some((part) => part === "." || part === ".."))
    throw new Error(
      "The recording path cannot contain parent-directory segments.",
    );
  return decoded.replace(/\/+$/, "");
}

export function inScope(
  origin: string,
  raw: string,
  pathPrefix?: string,
): boolean {
  try {
    const base = new URL(origin),
      next = new URL(raw);
    if (
      next.username ||
      next.password ||
      !["http:", "https:"].includes(next.protocol) ||
      next.origin !== base.origin
    )
      return false;
    const prefix = scopePath(pathPrefix);
    if (!prefix) return true;
    if (/%(?:2f|5c)/i.test(next.pathname)) return false;
    const path = decodeURIComponent(next.pathname);
    return path === prefix || path.startsWith(prefix + "/");
  } catch {
    return false;
  }
}
