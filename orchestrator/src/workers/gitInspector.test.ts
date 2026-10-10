import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitInspector } from "./gitInspector";
import { gitBlobId, gitMetadataDigest, normalizeRepoConfig, readContentIdentities } from "./gitIntegrity";
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

  // Live smoke #6: VS Code's Git extension cached branch.<task>.vscode-merge-base
  // ~1.4s after the trusted `git switch -c`, mid-run, and the digest refused the result.
  it("ignores VS Code's vscode-merge-base cache but still detects every other repo config change", async () => {
    const root = repo();
    const home = mkdtempSync(join(tmpdir(), "oxm-home-"));
    try {
      const env = { HOME: home, GIT_CONFIG_SYSTEM: join(home, "system-gitconfig") };
      const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
      const config = join(root, ".git", "config");
      const digest = () => gitMetadataDigest(root, env);
      git("config", "--local", "branch.main.remote", "origin");
      const baseline = await digest();

      git("config", "--local", "branch.agent/task-x.vscode-merge-base", "origin/main");
      git("config", "--local", "branch.main.vscode-merge-base", "origin/main");
      expect(await digest()).toBe(baseline);
      git("config", "--local", "branch.agent/task-x.vscode-merge-base", "origin/other");
      expect(await digest()).toBe(baseline);
      const benign = readFileSync(config, "utf8");

      const tampered = [
        `${benign}[branch "agent/task-x"]\n\tremote = evil\n`,
        benign.replace('[branch "agent/task-x"]\n', '[branch "agent/task-x"]\n\tdescription = x\n'),
        benign.replace("\tvscode-merge-base = origin/other\n", "\tvscode-merge-base = origin/other\n\tpushRemote = evil\n"),
        `${benign}[core]\n\thooksPath = /tmp/hooks\n`,
        `${benign}[core]\n\tvscode-merge-base = origin/main\n`,
        `${benign}[include]\n\tpath = ${join(home, "inc")}\n`,
        benign.replace("\tremote = origin\n", "\tremote = origin\\\n\tvscode-merge-base = origin/main\n"),
        benign.replace("\tvscode-merge-base = origin/other\n", "\tvscode-merge-base = origin/other ; x\n"),
        benign.replace("\tvscode-merge-base = origin/other\n", "\tvscode-merge-base = origin/other\r\n"),
      ];
      for (const text of tampered) {
        writeFileSync(config, text);
        expect(await digest()).not.toBe(baseline);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  // Live task failure: the GitHub Pull Requests extension (Codespaces) cached
  // branch.<task>.github-pr-base-branch mid-run and the digest refused the result.
  it("ignores the GitHub PR extension's github-pr-base-branch cache but detects every Git-relevant branch key", async () => {
    const root = repo();
    const home = mkdtempSync(join(tmpdir(), "oxm-home-"));
    try {
      const env = { HOME: home, GIT_CONFIG_SYSTEM: join(home, "system-gitconfig") };
      const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
      const config = join(root, ".git", "config");
      const digest = () => gitMetadataDigest(root, env);
      const task = "agent/task-t1-frontend-styling";
      git("config", "--local", "branch.main.remote", "origin");
      const baseline = await digest();

      // 1. extension adds the key on the task branch
      git("config", "--local", `branch.${task}.github-pr-base-branch`, "owner-1#oxm-platform#agent/base-branch");
      expect(readFileSync(config, "utf8")).toContain('\tgithub-pr-base-branch = "owner-1#oxm-platform#agent/base-branch"\n');
      expect(await digest()).toBe(baseline);
      // 2. cached value changes to another valid PR base
      git("config", "--local", `branch.${task}.github-pr-base-branch`, "other-org#repo_2.x#main");
      expect(await digest()).toBe(baseline);
      // 3. coexists with vscode-merge-base, in either order, on several branches
      git("config", "--local", `branch.${task}.vscode-merge-base`, "origin/main");
      git("config", "--local", "branch.main.github-pr-base-branch", "owner-1#oxm-platform#main");
      git("config", "--local", "branch.feature.vscode-merge-base", "origin/main");
      git("config", "--local", "branch.feature.github-pr-base-branch", "owner-1#oxm-platform#main");
      expect(await digest()).toBe(baseline);
      const benign = readFileSync(config, "utf8");
      const prLine = '\tgithub-pr-base-branch = "other-org#repo_2.x#main"\n';
      expect(benign).toContain(prLine);

      const mutations: [string, () => void][] = [
        ["4. branch.remote", () => git("config", "--local", `branch.${task}.remote`, "evil")],
        ["5. branch.merge", () => git("config", "--local", `branch.${task}.merge`, "refs/heads/evil")],
        ["6. branch.pushRemote", () => git("config", "--local", `branch.${task}.pushRemote`, "evil")],
        ["7. branch.description", () => git("config", "--local", `branch.${task}.description`, "x")],
        ["7b. branch.rebase", () => git("config", "--local", `branch.${task}.rebase`, "true")],
        ["8. key in [core]", () => git("config", "--local", "core.github-pr-base-branch", "owner#repo#main")],
        ["8b. key in [remote]", () => git("config", "--local", "remote.origin.github-pr-base-branch", "owner#repo#main")],
      ];
      for (const [name, mutate] of mutations) {
        writeFileSync(config, benign);
        expect(await digest(), "reset").toBe(baseline);
        mutate();
        expect(await digest(), name).not.toBe(baseline);
      }

      // 9. hand-written variants that are not the integration's exact shape stay hashed
      const variants = [
        prLine.replace('"other-org#repo_2.x#main"', "other-org#repo_2.x#main"), // unquoted: Git reads a comment
        prLine.replace('"other-org#repo_2.x#main"', "'other-org#repo_2.x#main'"),
        prLine.replace('main"', 'main" ; x'),
        prLine.replace('main"', 'main" # x'),
        prLine.replace("\n", "\r\n"),
        prLine.replace('main"', 'main\\"'),
        prLine.replace('main"\n', 'main"\\\n\tremote = evil\n'),
        prLine.replace("\t", "\t\t"),
        prLine.replace(" = ", "="),
        prLine.replace("github-pr-base-branch", "GitHub-PR-Base-Branch"),
        prLine.replace("github-pr-base-branch", "github-pr-base"),
        prLine.replace('"other-org#repo_2.x#main"', '"other-org#repo_2.x"'),
        prLine.replace('"other-org#repo_2.x#main"', '"-bad#repo#main"'),
        prLine.replace('"other-org#repo_2.x#main"', '"owner#repo#ma in"'),
        prLine.replace('"other-org#repo_2.x#main"', '"owner#repo#main"\tpushRemote = evil'),
      ];
      for (const line of variants) {
        writeFileSync(config, benign.replace(prLine, line));
        expect(await digest(), JSON.stringify(line)).not.toBe(baseline);
      }
      // a benign key glued after a continuation is part of the previous value, not a cache line
      writeFileSync(config, benign.replace("\tremote = origin\n", `\tremote = origin\\\n${prLine}`));
      expect(await digest()).not.toBe(baseline);
      // wrong section header shape (spaces / quotes) stays hashed
      writeFileSync(config, `${benign}[branch "a b"]\n${prLine}`);
      expect(await digest()).not.toBe(baseline);
      writeFileSync(config, `${benign}[branch]\n${prLine}`);
      expect(await digest()).not.toBe(baseline);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("normalizeRepoConfig", () => {
  const norm = (s: string) => normalizeRepoConfig(Buffer.from(s, "latin1")).toString("latin1");
  it("drops only the git-config-written vscode-merge-base shape", () => {
    expect(norm('[core]\n\tbare = false\n[branch "a/b"]\n\tvscode-merge-base = origin/main\n')).toBe("[core]\n\tbare = false\n");
    expect(norm('[branch "a"]\n\tremote = origin\n\tvscode-merge-base = origin/main\n')).toBe('[branch "a"]\n\tremote = origin\n');
    expect(norm('[branch "a"]\n\tvscode-merge-base = origin/main\n\tmerge = refs/heads/a\n')).toBe('[branch "a"]\n\tmerge = refs/heads/a\n');
    for (const kept of [
      '[core]\n\tvscode-merge-base = origin/main\n',
      '[branch "a"] vscode-merge-base = origin/main\n',
      '[branch "a"]\n\tvscode-merge-base = "origin/main"\n',
      '[branch "a"]\n\tx = y\\\n\tvscode-merge-base = origin/main\n',
      '[branch "a b"]\n\tvscode-merge-base = origin/main\n',
    ]) {
      expect(norm(kept)).toBe(kept);
    }
  });

  it("drops only the git-config-written github-pr-base-branch shape", () => {
    const pr = '\tgithub-pr-base-branch = "o#r#main"\n';
    expect(norm(`[core]\n\tbare = false\n[branch "a/b"]\n${pr}`)).toBe("[core]\n\tbare = false\n");
    expect(norm(`[branch "a"]\n${pr}\tvscode-merge-base = origin/main\n[core]\n\tbare = false\n`)).toBe("[core]\n\tbare = false\n");
    expect(norm(`[branch "a"]\n\tremote = origin\n${pr}`)).toBe('[branch "a"]\n\tremote = origin\n');
    for (const kept of [
      `[core]\n${pr}`,
      `[remote "origin"]\n${pr}`,
      '[branch "a"]\n\tgithub-pr-base-branch = o#r#main\n',
      '[branch "a"]\n\tgithub-pr-base-branch = "o#r#main" ; c\n',
      '[branch "a"]\n\tgithub-pr-base-branch = "o#r#main"\r\n',
      '[branch "a"]\n\tgithub-pr-base-branch = "o#r#ma\\"in"\n',
      `[branch "a"]\n\tx = y\\\n${pr}`,
      `[branch "a b"]\n${pr}`,
      '[branch "a"]\n\tgithub-pr-base-branch-x = "o#r#main"\n',
    ]) {
      expect(norm(kept)).toBe(kept);
    }
  });
});
