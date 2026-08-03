const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "msclkid",
  "_ga",
  "session",
  "sid",
  "phpsessid",
]);

const UNSUPPORTED_PROTOCOLS = new Set(["mailto:", "tel:", "javascript:", "data:", "file:", "blob:"]);
const DOWNLOAD_EXTENSIONS = /\.(zip|rar|7z|exe|msi|dmg|pkg|iso|pdf|docx?|xlsx?|pptx?)$/i;
const LOGOUT_PATTERN = /(?:^|\/)(logout|log-out|signout|sign-out)(?:\/|$|\?)/i;

export interface CanonicalizeResult {
  accepted: boolean;
  url?: string;
  reason?: string;
}

export interface CanonicalizeOptions {
  ignoredQueryParameters?: string[];
}

export function canonicalizeUrl(rawUrl: string, baseUrl?: string, options: CanonicalizeOptions = {}): CanonicalizeResult {
  let url: URL;
  try {
    url = new URL(rawUrl, baseUrl);
  } catch {
    return { accepted: false, reason: "invalid-url" };
  }

  if (UNSUPPORTED_PROTOCOLS.has(url.protocol)) {
    return { accepted: false, reason: "unsupported-protocol" };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return { accepted: false, reason: "non-http-protocol" };
  }
  if (url.username || url.password) {
    return { accepted: false, reason: "url-credentials" };
  }
  if (DOWNLOAD_EXTENSIONS.test(url.pathname)) {
    return { accepted: false, reason: "download-url" };
  }
  if (LOGOUT_PATTERN.test(url.pathname)) {
    return { accepted: false, reason: "logout-url" };
  }

  url.hash = "";
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !ignoredParams(options).has(key.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, value] of params) {
    url.searchParams.append(key, value);
  }

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return { accepted: true, url: url.toString() };
}

export function looksLikeLoopUrl(url: string): boolean {
  const parsed = new URL(url);
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  const repeatedPath = pathParts.length > 5 && new Set(pathParts).size < pathParts.length / 2;
  const tooManyQueryParams = [...parsed.searchParams.keys()].length > 20;
  const paginationDepth =
    Number(parsed.searchParams.get("page") ?? parsed.searchParams.get("p") ?? "0") > 200;
  return repeatedPath || tooManyQueryParams || paginationDepth;
}

export function routeFamilyFor(url: URL | string): string {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const path = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) || /^[0-9a-f-]{12,}$/i.test(part) ? ":id" : part.toLowerCase()))
    .join("/");
  const queryKeys = [...parsed.searchParams.keys()].sort().join("&");
  return `${parsed.origin}/${path}${queryKeys ? `?${queryKeys}` : ""}`;
}

function ignoredParams(options: CanonicalizeOptions): Set<string> {
  return new Set([...(TRACKING_PARAMS), ...(options.ignoredQueryParameters ?? []).map((param) => param.toLowerCase())]);
}
