import { describe, expect, it } from "vitest";
import { openApiDocument } from "../../src/docs/openapi.js";
import {
  coverageLimitationSchema,
  findingsStatusSchema,
  reportStatusSchema,
  runStatusSchema,
  runSummarySchema,
  stoppedReasonSchema,
} from "../../src/schemas/report.schema.js";
import { TEST_TYPES } from "../../src/testing/test-types.js";

/**
 * The contract tables are duplicated across OpenAPI and both READMEs because they
 * are consumer-facing. These tests exist so the duplication cannot drift silently.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schemas = (openApiDocument as any).components.schemas;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const requestBody = (openApiDocument as any).paths["/api/v1/testing/run"].post.requestBody;

describe("OpenAPI response contract matches the Zod schemas", () => {
  it("documents the same runStatus values", () => {
    expect(schemas.TestingRunResponse.properties.runStatus.enum).toEqual(runStatusSchema.options);
  });

  it("documents the same findingsStatus values", () => {
    expect(schemas.TestingRunResponse.properties.findingsStatus.enum).toEqual(findingsStatusSchema.options);
  });

  it("documents the deprecated status alias and marks it deprecated", () => {
    expect(schemas.TestingRunResponse.properties.status.enum).toEqual(reportStatusSchema.options);
    expect(schemas.TestingRunResponse.properties.status.deprecated).toBe(true);
  });

  it("documents the same stoppedReason values", () => {
    expect(schemas.TestingRunResponse.properties.stoppedReason.enum).toEqual(stoppedReasonSchema.options);
  });

  it("documents every RunSummary field, including artifactsBytes", () => {
    const documented = Object.keys(schemas.RunSummary.properties).sort();
    const defined = Object.keys(runSummarySchema.shape).sort();
    expect(documented).toEqual(defined);
    expect(documented).toContain("artifactsBytes");
  });

  it("documents every CoverageLimitation field", () => {
    const documented = Object.keys(schemas.CoverageLimitation.properties).sort();
    const defined = Object.keys(coverageLimitationSchema.shape).sort();
    expect(documented).toEqual(defined);
  });

  it("documents the full test type list", () => {
    expect(schemas.CoverageLimitation.properties.testType.enum).toEqual([...TEST_TYPES]);
  });
});

describe("OpenAPI request contract matches the settled defaults", () => {
  it("defaults allowFormSubmission to false", () => {
    expect(schemas.ExecutionSettings.properties.allowFormSubmission.default).toBe(false);
  });

  it("documents writeActionsAcknowledged", () => {
    expect(schemas.TestingRunRequest.properties.writeActionsAcknowledged).toBeDefined();
  });

  it("keeps every request example internally consistent about write acknowledgment", () => {
    const examples = Object.values(requestBody.content["application/json"].examples) as Array<{
      value: Record<string, unknown>;
    }>;
    expect(examples.length).toBeGreaterThan(0);

    for (const example of examples) {
      const execution = example.value.execution as { allowFormSubmission?: boolean } | undefined;
      if (execution?.allowFormSubmission === true) {
        expect(example.value.writeActionsAcknowledged).toBe(true);
      }
    }
  });
});
