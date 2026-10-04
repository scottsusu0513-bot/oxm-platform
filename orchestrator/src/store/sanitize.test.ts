import { describe, expect, it } from "vitest";
import { CIRCULAR, isDangerousKey, MAX_DEPTH, MAX_DEPTH_MARKER, REDACTED, sanitizeMetadata } from "./sanitize";

describe("sanitizeMetadata", () => {
  it("redacts every required dangerous key, case/format-insensitively", () => {
    const keys = [
      "password",
      "secret",
      "token",
      "authorization",
      "cookie",
      "apiKey",
      "accessKey",
      "refreshToken",
      "oauthCode",
      "databaseUrl",
      "API_KEY",
      "x-access-key",
      "Set-Cookie",
      "DATABASE_URL",
      "clientSecret",
      "githubToken",
      "oauth_code",
      "prompt",
      "fullPrompt",
    ];
    for (const key of keys) {
      expect(isDangerousKey(key), key).toBe(true);
      expect(sanitizeMetadata({ [key]: "value" })).toEqual({ [key]: REDACTED });
    }
    expect(isDangerousKey("promptHash")).toBe(false);
    expect(isDangerousKey("branch")).toBe(false);
  });

  it("recursively redacts nested objects and arrays", () => {
    const input = {
      branch: "agent/x",
      worker: { name: "claude", env: { DATABASE_URL: "mysql://u:p@h/db", nested: [{ apiKey: "k" }] } },
      steps: [{ ok: true }, { headers: { Authorization: "Bearer abc", accept: "json" } }, [{ refreshToken: "r" }]],
      tokens: { access: "a" },
    };
    expect(sanitizeMetadata(input)).toEqual({
      branch: "agent/x",
      steps: [{ ok: true }, { headers: { Authorization: REDACTED, accept: "json" } }, [{ refreshToken: REDACTED }]],
      tokens: REDACTED,
      worker: { env: { DATABASE_URL: REDACTED, nested: [{ apiKey: REDACTED }] }, name: "claude" },
    });
    const serialized = JSON.stringify(sanitizeMetadata(input));
    for (const leaked of ["mysql://u:p@h", "Bearer abc", '"k"', '"r"', '"a"']) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("redacts credential-looking values under innocuous keys", () => {
    expect(
      sanitizeMetadata({
        note: "Bearer eyJhbGciOi",
        url: "postgres://admin:hunter2@db.internal:5432/x",
        gh: "ghp_ABCDEFGHIJKLMNOP1234",
        anthropic: "sk-ant-api03-abcdefghijkl",
        plain: "https://github.com/org/repo/pull/5",
      }),
    ).toEqual({
      anthropic: REDACTED,
      gh: REDACTED,
      note: REDACTED,
      plain: "https://github.com/org/repo/pull/5",
      url: REDACTED,
    });
  });

  it("is deterministic, does not mutate input, and emits plain JSON", () => {
    const input = { b: 1, a: { password: "x", list: [1, undefined, () => 1] }, fn: () => 1, n: Number.NaN };
    const snapshot = JSON.stringify(input);
    const a = sanitizeMetadata(input);
    const b = sanitizeMetadata(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.keys(a)).toEqual(["a", "b", "n"]);
    expect(a).toEqual({ a: { list: [1, null, null], password: REDACTED }, b: 1, n: null });
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(input.a.password).toBe("x");
  });

  it("handles cycles, shared references, depth limits, and non-object input", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(sanitizeMetadata(cyclic)).toEqual({ name: "loop", self: CIRCULAR });

    const shared = { v: 1 };
    expect(sanitizeMetadata({ x: shared, y: shared })).toEqual({ x: { v: 1 }, y: { v: 1 } });

    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < MAX_DEPTH + 2; i++) deep = { d: deep };
    expect(JSON.stringify(sanitizeMetadata(deep))).toContain(MAX_DEPTH_MARKER);

    expect(sanitizeMetadata(undefined)).toEqual({});
    expect(sanitizeMetadata(null)).toEqual({});
    expect(sanitizeMetadata("Bearer zzz")).toEqual({ value: REDACTED });
    expect(sanitizeMetadata([{ token: "t" }])).toEqual({ value: [{ token: REDACTED }] });
  });
});
