import { describe, expect, it, vi } from "vitest";
import type { AgentGatewayService } from "./types";
import { createGatewayTransport } from "./transport";

function fakeService() {
  const ok = () => vi.fn(async () => ({ ok: true }));
  const service = {
    submitTask: ok(),
    getTaskStatus: ok(),
    pauseTask: ok(),
    cancelTask: ok(),
    getPendingApproval: ok(),
    approveTask: ok(),
    rejectTask: ok(),
  } as unknown as AgentGatewayService;
  return { service };
}

const base = {
  requestId: "transport-1",
  source: "mobile",
  credentials: { bearer: "opaque-never-logged" },
};

describe("gateway HTTP-style transport", () => {
  it("maps all seven routes without binding a listener", async () => {
    const { service } = fakeService();
    const transport = createGatewayTransport(service);
    const requests = [
      ["POST", "/tasks", "submitTask", { idempotencyKey: "i", userInstruction: "x" }],
      ["GET", "/tasks/t1", "getTaskStatus", undefined],
      ["POST", "/tasks/t1/pause", "pauseTask", { idempotencyKey: "p" }],
      ["POST", "/tasks/t1/cancel", "cancelTask", { idempotencyKey: "c" }],
      ["GET", "/tasks/t1/approval", "getPendingApproval", undefined],
      ["POST", "/tasks/t1/approval/approve", "approveTask", { idempotencyKey: "a" }],
      ["POST", "/tasks/t1/approval/reject", "rejectTask", { idempotencyKey: "r" }],
    ] as const;
    for (const [method, path, methodName, body] of requests) {
      const result = await transport.handle({
        ...base,
        method,
        path,
        ...(body ? { contentType: "application/json", body: JSON.stringify(body) } : {}),
      });
      expect(result.status).toBe(methodName === "submitTask" ? 202 : method === "POST" ? (methodName === "pauseTask" || methodName === "cancelTask" ? 202 : 200) : 200);
      expect(service[methodName]).toHaveBeenCalledOnce();
    }
  });

  it("forbids GET mutation semantics and enforces JSON, shape, and bounded bodies", async () => {
    const { service } = fakeService();
    const transport = createGatewayTransport(service);
    expect((await transport.handle({ ...base, method: "GET", path: "/tasks/t1/pause" })).status).toBe(404);
    expect((await transport.handle({ ...base, method: "POST", path: "/tasks", contentType: "text/plain", body: "{}" })).status).toBe(415);
    expect((await transport.handle({ ...base, method: "POST", path: "/tasks", contentType: "application/json", body: "[1]" })).status).toBe(400);
    expect((await transport.handle({ ...base, method: "POST", path: "/tasks/t1/pause", contentType: "application/json", body: JSON.stringify({ taskId: "forged", idempotencyKey: "p" }) })).status).toBe(400);
    expect((await transport.handle({ ...base, method: "POST", path: "/tasks", contentType: "application/json", body: JSON.stringify({ value: "x".repeat(13_000) }) })).status).toBe(413);
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  });

  it("returns safe errors without stack traces or credentials", async () => {
    const { service } = fakeService();
    vi.mocked(service.submitTask).mockRejectedValueOnce(new Error("internal token=very-secret stack"));
    const result = await createGatewayTransport(service).handle({
      ...base,
      method: "POST",
      path: "/tasks",
      contentType: "application/json",
      body: "{}",
    });
    expect(result).toMatchObject({
      status: 500,
      body: { error: { code: "internal_error", message: "gateway request failed" } },
    });
    expect(JSON.stringify(result)).not.toMatch(/very-secret|stack/);
    expect(result.headers["cache-control"]).toBe("no-store");
  });
});
