import { describe, expect, it } from "vitest";
import { testingRunRequestSchema } from "../../src/schemas/testing-request.schema.js";
import {
  coverageLimitationSchema,
  findingsStatusSchema,
  reportStatusSchema,
  runStatusSchema,
  stoppedReasonSchema,
} from "../../src/schemas/report.schema.js";
import {
  DEFAULT_ENABLED_TEST_TYPES,
  IMPLEMENTED_TEST_TYPES,
  PARTIAL_TEST_TYPES,
  PLANNED_TEST_TYPES,
  TEST_TYPES,
  getTestTypeAvailability,
} from "../../src/testing/test-types.js";

const LEGACY_STATUSES = ["PASSED", "FAILED", "PARTIAL", "ERROR", "INCONCLUSIVE"];

describe("run and findings status split", () => {
  it("keeps runStatus to the three settled values", () => {
    expect(runStatusSchema.options).toEqual(["COMPLETED", "STOPPED", "ERRORED"]);
  });

  it("keeps findingsStatus to the three settled values", () => {
    expect(findingsStatusSchema.options).toEqual(["PASSED", "ISSUES_FOUND", "INCONCLUSIVE"]);
  });

  it("keeps the deprecated status alias to the five legacy strings", () => {
    expect(reportStatusSchema.options).toEqual(LEGACY_STATUSES);
  });

  it("excludes ai_budget from stoppedReason", () => {
    expect(stoppedReasonSchema.options).toEqual([
      "converged",
      "page_budget",
      "depth_budget",
      "time_budget",
      "user_stopped",
      "error",
    ]);
    expect(stoppedReasonSchema.options).not.toContain("ai_budget");
  });
});

describe("test type tiers", () => {
  it("defaults to exactly the 12 implemented types, with PASSIVE_SECURITY unchecked", () => {
    expect(DEFAULT_ENABLED_TEST_TYPES).toHaveLength(12);
    expect(DEFAULT_ENABLED_TEST_TYPES).not.toContain("PASSIVE_SECURITY");
    expect(IMPLEMENTED_TEST_TYPES).toContain("PASSIVE_SECURITY");
    for (const testType of DEFAULT_ENABLED_TEST_TYPES) {
      expect(IMPLEMENTED_TEST_TYPES).toContain(testType);
    }
  });

  it("partitions every test type into exactly one tier", () => {
    const tiers = [...IMPLEMENTED_TEST_TYPES, ...PARTIAL_TEST_TYPES, ...PLANNED_TEST_TYPES];
    expect(new Set(tiers).size).toBe(tiers.length);
    expect(new Set(tiers)).toEqual(new Set(TEST_TYPES));
  });

  it("reports 3 partial and 9 planned types", () => {
    expect(PARTIAL_TEST_TYPES).toHaveLength(3);
    expect(PLANNED_TEST_TYPES).toHaveLength(9);
  });

  it("derives availability consistently with the tier lists", () => {
    for (const testType of IMPLEMENTED_TEST_TYPES) expect(getTestTypeAvailability(testType)).toBe("implemented");
    for (const testType of PARTIAL_TEST_TYPES) expect(getTestTypeAvailability(testType)).toBe("partial");
    for (const testType of PLANNED_TEST_TYPES) expect(getTestTypeAvailability(testType)).toBe("planned");
  });
});

describe("coverage limitation rows", () => {
  it("requires the structured shape", () => {
    expect(
      coverageLimitationSchema.safeParse({
        testType: "SMOKE",
        availability: "implemented",
        executed: true,
        reason: "Selected and executed.",
      }).success,
    ).toBe(true);
  });

  it("rejects the legacy free-text shape", () => {
    expect(coverageLimitationSchema.safeParse({ area: "Security testing", reason: "Passive only." }).success).toBe(false);
  });
});

describe("write acknowledgment", () => {
  const base = {
    targetUrl: "https://example.com",
    authorizationConfirmed: true as const,
    testTypes: ["SMOKE"],
  };

  it("defaults allowFormSubmission to false", () => {
    expect(testingRunRequestSchema.parse(base).execution.allowFormSubmission).toBe(false);
  });

  it("requires acknowledgment for anonymous submission", () => {
    expect(() =>
      testingRunRequestSchema.parse({ ...base, execution: { allowFormSubmission: true } }),
    ).toThrow();
  });

  it("requires acknowledgment for credentialed submission", () => {
    expect(() =>
      testingRunRequestSchema.parse({
        ...base,
        credentials: { enabled: true, username: "admin@example.com", password: "pw" },
        execution: { allowFormSubmission: true },
      }),
    ).toThrow();
  });

  it("accepts submission once acknowledged", () => {
    const parsed = testingRunRequestSchema.parse({
      ...base,
      writeActionsAcknowledged: true,
      execution: { allowFormSubmission: true },
    });
    expect(parsed.execution.allowFormSubmission).toBe(true);
    expect(parsed.writeActionsAcknowledged).toBe(true);
  });

  it("does not require acknowledgment when submission stays disabled", () => {
    expect(testingRunRequestSchema.parse(base).writeActionsAcknowledged).toBeUndefined();
  });
});
