import { minimatch } from "minimatch";
import { canonicalizeUrl, looksLikeLoopUrl } from "./url-canonicalizer.js";

export interface ScopePolicyInput {
  targetOrigin: string;
  allowedOrigins?: string[];
  includeSubdomains?: boolean;
  sameOriginOnly: boolean;
  includePatterns: string[];
  excludePatterns: string[];
  ignoredQueryParameters?: string[];
}

export interface ScopeDecision {
  allowed: boolean;
  canonicalUrl?: string;
  reason?: string;
}

export class ScopePolicy {
  constructor(private readonly input: ScopePolicyInput) {}

  evaluate(rawUrl: string, baseUrl?: string): ScopeDecision {
    const canonical = canonicalizeUrl(rawUrl, baseUrl, {
      ignoredQueryParameters: this.input.ignoredQueryParameters,
    });
    if (!canonical.accepted || !canonical.url) {
      return { allowed: false, reason: canonical.reason ?? "canonicalization-failed" };
    }

    const url = new URL(canonical.url);
    if (!this.isAllowedOrigin(url)) {
      return { allowed: false, canonicalUrl: canonical.url, reason: "outside-origin" };
    }
    if (this.input.includePatterns.length > 0 && !this.matchesAny(canonical.url, this.input.includePatterns)) {
      return { allowed: false, canonicalUrl: canonical.url, reason: "not-included" };
    }
    if (this.matchesAny(canonical.url, this.input.excludePatterns)) {
      return { allowed: false, canonicalUrl: canonical.url, reason: "excluded" };
    }
    if (looksLikeLoopUrl(canonical.url)) {
      return { allowed: false, canonicalUrl: canonical.url, reason: "loop-like-url" };
    }
    return { allowed: true, canonicalUrl: canonical.url };
  }

  private isAllowedOrigin(url: URL): boolean {
    const origins = this.input.allowedOrigins?.length ? this.input.allowedOrigins : [this.input.targetOrigin];
    return origins.some((origin) => {
      const allowed = new URL(origin);
      if (url.origin === allowed.origin) return true;
      return Boolean(
        this.input.includeSubdomains &&
          url.protocol === allowed.protocol &&
          url.hostname.endsWith(`.${allowed.hostname}`),
      );
    });
  }

  private matchesAny(url: string, patterns: string[]): boolean {
    const parsed = new URL(url);
    return patterns.some((pattern) => {
      if (!pattern) return false;
      return minimatch(parsed.pathname, pattern) || parsed.pathname.includes(pattern) || url.includes(pattern);
    });
  }
}
