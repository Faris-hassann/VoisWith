import { describe, expect, it } from "vitest";
import { batchFormSnapshots } from "../../src/ai/form-batcher.js";
import type { FormSnapshot } from "../../src/types/llm-contract.js";

describe("batchFormSnapshots", () => {
  it("flushes at 3 forms per batch", () => {
    const snapshots = [form("f1"), form("f2"), form("f3"), form("f4")];

    const batches = batchFormSnapshots(snapshots);

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(3);
    expect(batches[1]).toHaveLength(1);
  });

  it("flushes early when the ~4k estimated-token threshold is crossed", () => {
    // ~20k chars alone estimates to ~5k tokens — over the 4k-token threshold —
    // so it must flush both the batch before it and the batch after it.
    const huge = form("big", 20000);
    const snapshots = [form("f1"), huge, form("f2")];

    const batches = batchFormSnapshots(snapshots);

    expect(batches).toEqual([[snapshots[0]], [huge], [snapshots[2]]]);
  });

  it("ships a single oversized form alone rather than dropping it", () => {
    const huge = form("big", 20000);

    const batches = batchFormSnapshots([huge]);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([huge]);
  });

  it("returns no batches for an empty input", () => {
    expect(batchFormSnapshots([])).toEqual([]);
  });
});

function form(id: string, labelPadding = 0): FormSnapshot {
  return {
    formId: id,
    elementId: "element_1",
    fields: [
      {
        elementId: "element_2",
        kind: "input",
        required: false,
        disabled: false,
        label: "x".repeat(labelPadding),
      },
    ],
  };
}
