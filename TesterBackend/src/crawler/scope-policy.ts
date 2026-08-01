import { minimatch } from "minimatch";
import { canonicalizeUrl, looksLikeLoopUrl } from "./url-canonicalizer.js";

export interface ScopePolicyInput {
  targetOrigin: string;
  sameOriginOnly: boolean;
  includePatterns: string[];
  excludePatterns: string[];
}

export interface ScopeDecision {
  allowed: boolean;
  canonicalUrl?: string;
  reason?: string;
}

export class ScopePolicy {
  constructor(private readonly input: ScopePolicyInput) {}

  evaluate(rawUrl: string, baseUrl?: string): ScopeDecision {
    const canonical = canonicalizeUrl(rawUrl, baseUrl);
    if (!canonical.accepted || !canonical.url) {
      return { allowed: false, reason: canonical.reason ?? "canonicalization-failed" };
    }

    const url = new URL(canonical.url);
    if (this.input.sameOriginOnly && url.origin !== this.input.targetOrigin) {
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

  private matchesAny(url: string, patterns: string[]): boolean {
    const parsed = new URL(url);
    return patterns.some((pattern) => {
      if (!pattern) return false;
      return minimatch(parsed.pathname, pattern) || parsed.pathname.includes(pattern) || url.includes(pattern);
    });
  }
}
