/**
 * The single owner of route-family computation (DESIGN-DECISIONS.md §9).
 *
 * Strips ignored query params, replaces numeric and UUID path segments with
 * `:id`, and retains the origin. Two URLs that differ only by a record id or a
 * tracking param belong to the same family, which is what the crawl's
 * 3-instances-per-family budget is keyed on. Form identity is deliberately
 * route-independent (§7). Three copies previously disagreed about
 * whether the origin and the query string were part of the family.
 */

/** Always dropped, regardless of the run's own ignore list — they never identify a distinct page. */
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
]);

const NUMERIC_SEGMENT = /^\d+$/;
const UUID_LIKE_SEGMENT = /^[0-9a-f-]{12,}$/i;

export function routeFamily(url: URL | string, ignoredQueryParameters: string[] = []): string {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url) : url;
  } catch {
    return "/";
  }

  const path = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => (NUMERIC_SEGMENT.test(part) || UUID_LIKE_SEGMENT.test(part) ? ":id" : part.toLowerCase()))
    .join("/");

  const ignored = new Set([...TRACKING_PARAMS, ...ignoredQueryParameters.map((param) => param.toLowerCase())]);
  // Only the surviving parameter *names* matter: `?page=2` and `?page=3` are the
  // same route family, but `?page=` and `?sort=` are not.
  const queryKeys = [...new Set([...parsed.searchParams.keys()].map((key) => key.toLowerCase()))]
    .filter((key) => !ignored.has(key))
    .sort()
    .join("&");

  return `${parsed.origin}/${path}${queryKeys ? `?${queryKeys}` : ""}`;
}
