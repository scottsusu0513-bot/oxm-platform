import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitInspector } from "./gitInspector";
import { gitBlobId, gitMetadataDigest, readContentIdentities } from "./gitIntegrity";
import { createNodeProcessRunner } from "./processRunner";

describe("git inspector against a real repository", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reports both sides of a committed rename so trusted path checks stay exact", async () => {
    dir = mkdtempSync(join(tmpdir(), "oxm-git-inspector-"));
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd: dir, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(dir, "old.ts"), "export const value = 1;\n".repeat(20));
    git("add", "--", "old.ts");
    git("commit", "-q", "--no-verify", "-m", "base");
    const base = git("rev-parse", "HEAD").trim();
    git("mv", "old.ts", "new.ts");
    git("commit", "-q", "--no-verify", "-m", "rename");

    const inspector = createGitInspector(createNodeProcessRunner(), dir);
    expect(await inspector.changedPathsSince(base)).toEqual(["new.ts", "old.ts"]);
  });
});

describe("trusted content identities and Git metadata digest (real filesystem)", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });
  const repo = () => {
    dir = mkdtempSync(join(tmpdir(), "oxm-git-integrity-"));
    execFileSync("git", ["init", "-q", dir]);
    return dir;
  };

  it("derives Git blob ids from raw bytes and detects one-byte, mode, and deletion drift", async () => {
    const root = repo();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "abc\n");
    const [first] = await readContentIdentities(root, ["src/a.ts"]);
    expect(first).toEqual({ path: "src/a.ts", mode: "100644", blob: execFileSync("git", ["hash-object", "--no-filters", "src/a.ts"], { cwd: root, encoding: "utf8" }).trim() });
    writeFileSync(join(root, "src", "a.ts"), "abd\n");
    expect((await readContentIdentities(root, ["src/a.ts"]))[0].blob).not.toBe(first.blob);
    chmodSync(join(root, "src", "a.ts"), 0o755);
    expect((await readContentIdentities(root, ["src/a.ts"]))[0].mode).toBe("100755");
    rmSync(join(root, "src", "a.ts"));
    expect(await readContentIdentities(root, ["src/a.ts", "gone/b.ts"])).toEqual([
      { path: "gone/b.ts", mode: "absent", blob: null },
      { path: "src/a.ts", mode: "absent", blob: null },
    ]);
  });

  it("fails closed on symlinked parents, directories, unsafe paths, and .git paths", async () => {
    const root = repo();
    const outside = mkdtempSync(join(tmpdir(), "oxm-outside-"));
    try {
      writeFileSync(join(outside, "x.ts"), "x");
      symlinkSync(outside, join(root, "linked"));
      await expect(readContentIdentities(root, ["linked/x.ts"])).rejects.toThrow();
      mkdirSync(join(root, "dir"));
      await expect(readContentIdentities(root, ["dir"])).rejects.toThrow();
      await expect(readContentIdentities(root, ["../x.ts"])).rejects.toThrow();
      await expect(readContentIdentities(root, [".git/config"])).rejects.toThrow();
      symlinkSync("target.ts", join(root, "link.ts"));
      expect((await readContentIdentities(root, ["link.ts"]))[0]).toEqual({ path: "link.ts", mode: "120000", blob: gitBlobId(Buffer.from("target.ts")) });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("covers config, includes, global config, hooks, replace refs, and alternates", async () => {
    const root = repo();
    const home = mkdtempSync(join(tmpdir(), "oxm-home-"));
    try {
      const env = { HOME: home, GIT_CONFIG_SYSTEM: join(home, "system-gitconfig") };
      const digest = () => gitMetadataDigest(root, env);
      const baseline = await digest();
      expect(await digest()).toBe(baseline);
      const changes: (() => void)[] = [
        () => writeFileSync(join(home, ".gitconfig"), "[core]\n\tfsmonitor = true\n"),
        () => writeFileSync(join(home, ".gitconfig"), `[include]\n\tpath = ${join(home, "inc")}\n`),
        () => writeFileSync(join(home, "inc"), "[filter \"x\"]\n\tclean = evil\n"),
        () => writeFileSync(join(root, ".git", "hooks", "prepare-commit-msg"), "#!/bin/sh\n"),
        () => {
          mkdirSync(join(root, ".git", "refs", "replace"), { recursive: true });
          writeFileSync(join(root, ".git", "refs", "replace", "a".repeat(40)), `${"b".repeat(40)}\n`);
        },
        () => writeFileSync(join(root, ".git", "objects", "info", "alternates"), "/tmp/objects\n"),
        () => writeFileSync(env.GIT_CONFIG_SYSTEM, "[core]\n\thooksPath = /tmp/hooks\n"),
      ];
      let previous = baseline;
      for (const change of changes) {
        change();
        const next = await digest();
        expect(next).not.toBe(previous);
        previous = next;
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
