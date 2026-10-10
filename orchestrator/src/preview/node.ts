import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PreviewPort } from "../delivery/types";
import type { ProcessRunner } from "../workers/types";
import { createCodespacesPreviewController } from "./codespacesPreview";

/** Node adapters for the Codespaces preview controller. State lives in the runtime's state directory. */
export function createNodePreviewController(input: {
  runner: ProcessRunner;
  repoRoot: string;
  stateDir: string;
  env: Readonly<Record<string, string | undefined>>;
}): PreviewPort | null {
  const codespaceName = input.env.CODESPACE_NAME ?? "";
  const forwardingDomain = input.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "";
  if (!codespaceName || !forwardingDomain) return null;
  const ownershipPath = join(input.stateDir, "preview-server.json");
  return createCodespacesPreviewController({
    runner: input.runner,
    repoRoot: input.repoRoot,
    codespaceName,
    forwardingDomain,
    env: input.env,
    logPath: join(input.stateDir, "preview-server.log"),
    readTextFile(path) {
      try {
        return existsSync(path) ? readFileSync(path, "utf8") : null;
      } catch {
        return null;
      }
    },
    spawnDetached({ command, args, cwd, env, logPath }) {
      const fd = openSync(logPath, "a", 0o600);
      try {
        const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd], shell: false });
        child.unref();
        if (typeof child.pid !== "number") throw new Error("spawn failed");
        return child.pid;
      } finally {
        closeSync(fd);
      }
    },
    isAlive(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    killGroup(pid) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    },
    async probe(url) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3_000);
      try {
        const res = await fetch(url, { method: "GET", signal: controller.signal, redirect: "manual" });
        return res.status;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ownership: {
      load() {
        try {
          const v = JSON.parse(readFileSync(ownershipPath, "utf8")) as { pid?: unknown; port?: unknown; taskId?: unknown };
          return Number.isInteger(v.pid) && Number.isInteger(v.port) && typeof v.taskId === "string" ? { pid: v.pid as number, port: v.port as number, taskId: v.taskId } : null;
        } catch {
          return null;
        }
      },
      save(v) {
        if (!v) return rmSync(ownershipPath, { force: true });
        const tmp = `${ownershipPath}.tmp`;
        writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 });
        renameSync(tmp, ownershipPath);
      },
    },
  });
}
