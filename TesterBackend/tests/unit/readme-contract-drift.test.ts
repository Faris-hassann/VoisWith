import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findingsStatusSchema,
  runStatusSchema,
  stoppedReasonSchema,
} from "../../src/schemas/report.schema.js";
import {
  DEFAULT_ENABLED_TEST_TYPES,
  TEST_TYPES,
} from "../../src/testing/test-types.js";

/**
 * The contract tables are duplicated into both READMEs because they are
 * consumer-facing. These tests keep that duplication honest.
 */

const readmes = {
  backend: readFileSync(fileURLToPath(new URL("../../README.md", import.meta.url)), "utf8"),
  frontend: readFileSync(fileURLToPath(new URL("../../../TesterFrontend/README.md", import.meta.url)), "utf8"),
};

describe.each(Object.entries(readmes))("%s README", (_name, readme) => {
  it("documents every test type", () => {
    for (const testType of TEST_TYPES) {
      expect(readme).toContain(`\`${testType}\``);
    }
  });

  it("documents both status fields and the deprecated alias", () => {
    expect(readme).toContain("`runStatus`");
    expect(readme).toContain("`findingsStatus`");
    expect(readme).toMatch(/Deprecated/i);
  });

  it("documents every runStatus and findingsStatus value", () => {
    for (const value of [...runStatusSchema.options, ...findingsStatusSchema.options]) {
      expect(readme).toContain(value);
    }
  });

  it("documents every stoppedReason value", () => {
    expect(readme).toContain("`stoppedReason`");
    for (const value of stoppedReasonSchema.options) {
      expect(readme).toContain(`\`${value}\``);
    }
  });

  it("states that an exhausted AI budget never stops a run", () => {
    expect(readme).toMatch(/no `?ai_budget`? value|never stops a (run|crawl)/i);
  });

  it("documents the write acknowledgment and that it does not depend on credentials", () => {
    expect(readme).toContain("writeActionsAcknowledged");
    expect(readme).toMatch(/whether or not credentials|regardless of whether credentials/i);
  });

  it("no longer claims stoppedReason is absent", () => {
    expect(readme).not.toMatch(/There is no `?stopped_reason`? field/i);
  });
});

describe("frontend README default selection", () => {
  const table = readmes.frontend;

  it("marks exactly the 12 implemented-and-default types as checked by default", () => {
    const checkedRows = [...table.matchAll(/^\| `([A-Z_]+)` \| [^|]+ \| Yes \|$/gm)].map((match) => match[1]);
    expect(new Set(checkedRows)).toEqual(new Set(DEFAULT_ENABLED_TEST_TYPES));
    expect(checkedRows).toHaveLength(12);
  });

  it("leaves PASSIVE_SECURITY implemented but unchecked", () => {
    expect(table).toMatch(/^\| `PASSIVE_SECURITY` \| Implemented \| No \|$/m);
  });
});
