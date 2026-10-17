// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
const SECRET_HEADERS = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
  "x-amz-security-token",
  "x-wabac-preset-cookie",
]);
export function cleanHeaders(
  headers?: Record<string, string> | null,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers || {}).filter(
      ([key]) => !SECRET_HEADERS.has(key.toLowerCase()),
    ),
  );
}
export function sensitiveEndpoint(raw: string): boolean {
  try {
    return /\/(?:login|logout|signin|signout|oauth2?|saml|sso|token|password|credentials)(?:\/|$)/i.test(
      new URL(raw).pathname,
    );
  } catch {
    return true;
  }
}
