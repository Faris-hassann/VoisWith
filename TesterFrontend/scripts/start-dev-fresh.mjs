import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = process.env.FRONTEND_PORT ?? "3001";
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const nextDir = resolve(projectRoot, ".next-dev");

function killPortWindows() {
  let output = "";
  try {
    output = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
  } catch {
    return;
  }

  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.trim().split(/\s+/);
    const localAddress = parts[1] ?? "";
    const pid = parts.at(-1);
    if (localAddress.endsWith(`:${port}`) && pid && /^\d+$/.test(pid)) pids.add(pid);
  }

  for (const pid of pids) {
    try {
      execFileSync("taskkill", ["/PID", pid, "/F", "/T"], { stdio: "inherit" });
    } catch {
      // The process may already have exited.
    }
  }
}

function killPortUnix() {
  let output = "";
  try {
    output = execFileSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
  } catch {
    return;
  }

  for (const pid of output.split(/\s+/).filter(Boolean)) {
    try {
      execFileSync("kill", ["-9", pid], { stdio: "inherit" });
    } catch {
      // The process may already have exited.
    }
  }
}

if (process.platform === "win32") {
  killPortWindows();
} else {
  killPortUnix();
}

if (existsSync(nextDir)) {
  if (!nextDir.startsWith(projectRoot)) throw new Error(`Refusing to clean unexpected path: ${nextDir}`);
  rmSync(nextDir, { recursive: true, force: true });
}

const command = process.platform === "win32" ? "cmd.exe" : "npx";
const args = process.platform === "win32" ? ["/d", "/s", "/c", `npx next dev -p ${port}`] : ["next", "dev", "-p", port];
const child = spawn(command, args, {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
