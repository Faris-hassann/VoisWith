/** Path only, numeric/UUID segments generalized, no origin and no query string. */
export function routeFamily(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => (/^\d+$/.test(part) || /^[0-9a-f-]{12,}$/i.test(part) ? ":id" : part.toLowerCase()))
      .join("/");
    return `/${path}`;
  } catch {
    return "/";
  }
}
