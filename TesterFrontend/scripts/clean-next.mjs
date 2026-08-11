import { existsSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";

const cwd = resolve(process.cwd());
const nextDir = resolve(process.cwd(), ".next");
const extraArtifacts = [
  resolve(process.cwd(), "tsconfig.tsbuildinfo"),
  resolve(process.cwd(), "tsconfig.typecheck.tsbuildinfo"),
];

if (!nextDir.startsWith(`${cwd}${sep}`) || !nextDir.endsWith(`${sep}.next`)) {
  throw new Error(`Refusing to clean unexpected path: ${nextDir}`);
}

if (existsSync(nextDir)) {
  rmSync(nextDir, { recursive: true, force: true });
  console.log("Removed stale .next cache");
}

for (const artifactPath of extraArtifacts) {
  if (!artifactPath.startsWith(`${cwd}${sep}`)) {
    throw new Error(`Refusing to clean unexpected path: ${artifactPath}`);
  }
  if (existsSync(artifactPath)) {
    rmSync(artifactPath, { force: true });
    console.log(`Removed stale build artifact ${artifactPath.split(sep).at(-1)}`);
  }
}
