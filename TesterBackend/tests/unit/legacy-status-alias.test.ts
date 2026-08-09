import { describe, expect, it } from "vitest";
import { toLegacyStatus } from "../../src/reporting/report-aggregator.js";
import { findingsStatusSchema, reportStatusSchema, runStatusSchema } from "../../src/schemas/report.schema.js";
import type { FindingsStatus, RunStatus } from "../../src/types/report.js";

const runStatuses = runStatusSchema.options as RunStatus[];
const findingsStatuses = findingsStatusSchema.options as FindingsStatus[];
const legacyStatuses = new Set<string>(reportStatusSchema.options);

const combinations = runStatuses.flatMap((runStatus) =>
  findingsStatuses.map((findingsStatus) => [runStatus, findingsStatus] as const),
);

describe("deprecated status alias", () => {
  it("covers all nine status combinations", () => {
    expect(combinations).toHaveLength(9);
  });

  it.each(combinations)("maps %s + %s onto a legacy string", (runStatus, findingsStatus) => {
    expect(legacyStatuses.has(toLegacyStatus(runStatus, findingsStatus))).toBe(true);
  });

  it("introduces no value outside the five legacy strings", () => {
    const produced = new Set(combinations.map(([runStatus, findingsStatus]) => toLegacyStatus(runStatus, findingsStatus)));
    for (const value of produced) {
      expect(legacyStatuses.has(value)).toBe(true);
    }
  });

  it("reports every errored run as ERROR regardless of findings", () => {
    for (const findingsStatus of findingsStatuses) {
      expect(toLegacyStatus("ERRORED", findingsStatus)).toBe("ERROR");
    }
  });

  it("reports a clean completed run as PASSED and a stopped run of any findings as PARTIAL", () => {
    expect(toLegacyStatus("COMPLETED", "PASSED")).toBe("PASSED");
    for (const findingsStatus of findingsStatuses) {
      expect(toLegacyStatus("STOPPED", findingsStatus)).toBe("PARTIAL");
    }
  });

  it("reports findings as FAILED for a completed run that found issues", () => {
    expect(toLegacyStatus("COMPLETED", "ISSUES_FOUND")).toBe("FAILED");
  });
});
