import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactManager } from "../../src/artifacts/artifact-manager.js";

/**
 * Regression coverage for the "artifactsBytes always 0" bug: the manager must
 * actually record a size on every EvidenceReference it returns, not just sum
 * a field nothing ever populates. See DESIGN-DECISIONS.md's originating report.
 */
describe("ArtifactManager", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("records a non-zero sizeBytes when writing a JSON artifact", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-manager-test-"));
    const manager = new ArtifactManager(root, "run_1");
    await manager.initialize();

    const evidence = await manager.writeJson("reports", "report.json", { hello: "world" });

    expect(evidence.sizeBytes).toBeGreaterThan(0);
    const onDisk = await fs.stat(path.resolve(evidence.path));
    expect(evidence.sizeBytes).toBe(onDisk.size);
  });
});
