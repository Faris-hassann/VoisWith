import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/env.js";

export class PromptLoader {
  private cached?: string;

  async load(): Promise<string> {
    if (this.cached) return this.cached;
    const promptPath = path.resolve(config.prompts.filePath);
    this.cached = await fs.readFile(promptPath, "utf8");
    return this.cached;
  }
}
