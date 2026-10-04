import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFakeRunner } from "./fake";
import { createGitInspector, parsePorcelainZ } from "./gitInspector";
import { createKillSwitch } from "./killSwitch";
import { createNodeProcessRunner } from "./processRunner";
import { createTempPromptFileStore } from "./promptFile";

// These tests start `node` itself (never Claude) to prove the real runner's
// exec-file semantics. Scratch files live in an OS temp dir, never the repo.
const scratch = mkdtempSync(join(tmpdir(), "oxm-runner-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const node = process.execPath;

describe("createNodeProcessRunner", () => {
  const runner = createNodeProcessRunner({ killGraceMs: 200 });

  it("passes shell metacharacters as literal argv data (no shell)", async () => {
    const marker = join(scratch, "pwned");
    const evil = `$(touch ${marker}); touch ${marker} && echo hi | cat \`touch ${marker}\``;
    const res = await runner.spawn({ command: node, args: ["-e", "process.stdout.write(process.argv[1])", evil], cwd: scratch }).exit;
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe(evil);
    expect(existsSync(marker)).toBe(false);
  });

  it("does not resolve a command string through a shell", async () => {
    const res = await runner.spawn({ command: `${node} -e "1"`, args: [], cwd: scratch }).exit;
    expect(res.exitCode).toBeNull(); // ENOENT: the whole string is treated as one executable name
  });

  it("streams stdinFile to the child", async () => {
    const f = join(scratch, "in.txt");
    writeFileSync(f, "hello prompt");
    const res = await runner.spawn({
      command: node,
      args: ["-e", "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(d.toUpperCase()))"],
      cwd: scratch,
      stdinFile: f,
    }).exit;
    expect(res.stdout).toBe("HELLO PROMPT");
  });

  it("kill() terminates a running process (and is idempotent)", async () => {
    const p = runner.spawn({ command: node, args: ["-e", "setInterval(()=>{},1000)"], cwd: scratch });
    const ks = createKillSwitch();
    ks.onTrigger(() => p.kill());
    setTimeout(() => ks.trigger("test"), 50);
    const res = await p.exit;
    p.kill();
    expect(res.exitCode).toBeNull();
    expect(res.signal).toBe("SIGTERM");
  });

  it("caps output and flags truncation", async () => {
    const small = createNodeProcessRunner({ maxOutputBytes: 1024, killGraceMs: 200 });
    const res = await small.spawn({ command: node, args: ["-e", "setInterval(()=>process.stdout.write('x'.repeat(4096)),5)"], cwd: scratch }).exit;
    expect(res.truncated).toBe(true);
    expect(res.stdout.length).toBeLessThanOrEqual(1024);
  });
});

describe("createTempPromptFileStore", () => {
  it("writes an owner-only file outside the repo and remove() deletes it", async () => {
    const store = createTempPromptFileStore();
    const f = await store.write("secret-free prompt");
    expect(f.path.startsWith(tmpdir())).toBe(true);
    expect(f.path.startsWith(process.cwd())).toBe(false);
    expect(readFileSync(f.path, "utf8")).toBe("secret-free prompt");
    expect(statSync(f.path).mode & 0o077).toBe(0);
    await f.remove();
    await f.remove();
    expect(existsSync(f.path)).toBe(false);
  });
});

describe("killSwitch", () => {
  it("first reason wins; late subscribers fire immediately; unsubscribe works", () => {
    const ks = createKillSwitch();
    const seen: string[] = [];
    const off = ks.onTrigger((r) => seen.push(`a:${r}`));
    ks.onTrigger(() => {
      throw new Error("listener failure");
    });
    ks.onTrigger((r) => seen.push(`b:${r}`));
    off();
    ks.trigger("one");
    ks.trigger("two");
    ks.onTrigger((r) => seen.push(`c:${r}`));
    expect(seen).toEqual(["b:one", "c:one"]);
    expect(ks.reason).toBe("one");
  });
});

describe("gitInspector", () => {
  it("issues only read-only git subcommands as argv arrays", async () => {
    const runner = createFakeRunner((spec) => {
      const a = spec.args.join(" ");
      if (a === "rev-parse --abbrev-ref HEAD") return { exit: { stdout: "agent/x\n" } };
      if (a === "rev-parse HEAD") return { exit: { stdout: `${"a".repeat(40)}\n` } };
      if (a.startsWith("status")) return { exit: { stdout: " M server/db.ts\0?? new.ts\0R  b.ts\0a.ts\0" } };
      if (a.startsWith("diff")) return { exit: { stdout: "server/db.ts\0x.ts\0" } };
      return { exit: { exitCode: 1 } };
    });
    const git = createGitInspector(runner, "/repo");
    expect(await git.status()).toEqual({ branch: "agent/x", headSha: "a".repeat(40), dirtyPaths: ["a.ts", "b.ts", "new.ts", "server/db.ts"] });
    expect(await git.changedPathsSince("a".repeat(40))).toEqual(["a.ts", "b.ts", "new.ts", "server/db.ts", "x.ts"]);
    await expect(git.changedPathsSince("HEAD; rm -rf /")).rejects.toThrow("invalid base SHA");
    expect(runner.specs.every((s) => s.command === "git" && ["rev-parse", "status", "diff"].includes(s.args[0]))).toBe(true);
  });

  it("parsePorcelainZ handles renames and empty output", () => {
    expect(parsePorcelainZ("")).toEqual([]);
    expect(parsePorcelainZ("R  new name.ts\0old name.ts\0")).toEqual(["new name.ts", "old name.ts"]);
  });
});
