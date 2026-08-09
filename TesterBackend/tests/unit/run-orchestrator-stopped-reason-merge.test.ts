import { describe, expect, it } from "vitest";
import { mergeStoppedReason } from "../../src/services/run-orchestrator.js";
import type { StoppedReason } from "../../src/types/report.js";

/**
 * The crawler records stoppedReason on the *local* matrix context. Before the
 * merge existed, that value was dropped on the way out and the aggregator fell
 * back to `converged` — so the Phase 3 fixture run reported a complete crawl
 * while `/contact` sat unvisited on the stack (DESIGN-DECISIONS.md §14).
 *
 * Precedence per run-context.ts: error > user_stopped > time_budget >
 * page_budget > depth_budget > converged.
 */
describe("mergeStoppedReason", () => {
  it("keeps a target's time_budget instead of letting it fall back to converged", () => {
    expect(mergeStoppedReason(undefined, "time_budget")).toBe("time_budget");
    expect(mergeStoppedReason("converged", "time_budget")).toBe("time_budget");
  });

  it("never downgrades a more severe reason recorded by an earlier target", () => {
    expect(mergeStoppedReason("time_budget", "converged")).toBe("time_budget");
    expect(mergeStoppedReason("error", "user_stopped")).toBe("error");
    expect(mergeStoppedReason("user_stopped", "page_budget")).toBe("user_stopped");
  });

  it("passes through when either side is absent", () => {
    expect(mergeStoppedReason(undefined, undefined)).toBeUndefined();
    expect(mergeStoppedReason("converged", undefined)).toBe("converged");
  });

  it("orders the full precedence chain, most severe first", () => {
    const mostSevereFirst: StoppedReason[] = [
      "error",
      "user_stopped",
      "time_budget",
      "page_budget",
      "depth_budget",
      "converged",
    ];

    // Every reason must win against every strictly less severe one, in both
    // argument positions — order of matrix targets must not change the result.
    for (let i = 0; i < mostSevereFirst.length; i += 1) {
      for (let j = i + 1; j < mostSevereFirst.length; j += 1) {
        const severe = mostSevereFirst[i]!;
        const mild = mostSevereFirst[j]!;
        expect(mergeStoppedReason(severe, mild)).toBe(severe);
        expect(mergeStoppedReason(mild, severe)).toBe(severe);
      }
    }
  });
});
