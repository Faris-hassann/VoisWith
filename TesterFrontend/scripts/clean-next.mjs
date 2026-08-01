import { existsSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";

const cwd = resolve(process.cwd());
const nextDir = resolve(process.cwd(), ".next");

if (!nextDir.startsWith(`${cwd}${sep}`) || !nextDir.endsWith(`${sep}.next`)) {
  throw new Error(`Refusing to clean unexpected path: ${nextDir}`);
}

if (existsSync(nextDir)) {
  rmSync(nextDir, { recursive: true, force: true });
  console.log("Removed stale .next cache");
}
