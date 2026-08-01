import type { Page } from "playwright";
import type { EvidenceReference } from "../types/report.js";
import { ArtifactManager } from "../artifacts/artifact-manager.js";

export class EvidenceCollector {
  constructor(private readonly artifacts: ArtifactManager) {}

  async screenshotOnFailure(
    page: Page,
    name: string,
    description: string,
  ): Promise<EvidenceReference[]> {
    try {
      return [await this.artifacts.screenshot(page, name, description)];
    } catch {
      return [];
    }
  }
}
