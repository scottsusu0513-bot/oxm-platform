import { describe, expect, it } from "vitest";
import { getEffectiveBidStatus } from "./community-types";

describe("getEffectiveBidStatus", () => {
  it("active bid with a future deadline stays active", () => {
    const future = new Date(Date.now() + 3600_000);
    expect(getEffectiveBidStatus({ status: "active", deadline: future })).toBe("active");
  });

  it("active bid with a past deadline is derived as ended", () => {
    const past = new Date(Date.now() - 3600_000);
    expect(getEffectiveBidStatus({ status: "active", deadline: past })).toBe("ended");
  });

  it("active bid with no deadline stays active", () => {
    expect(getEffectiveBidStatus({ status: "active", deadline: null })).toBe("active");
  });

  it("already-ended bid stays ended", () => {
    const past = new Date(Date.now() - 3600_000);
    expect(getEffectiveBidStatus({ status: "ended", deadline: past })).toBe("ended");
  });

  it("does not override a real human/admin status even if deadline has passed", () => {
    const past = new Date(Date.now() - 3600_000);
    expect(getEffectiveBidStatus({ status: "rejected", deadline: past })).toBe("rejected");
    expect(getEffectiveBidStatus({ status: "pending_review", deadline: past })).toBe("pending_review");
    expect(getEffectiveBidStatus({ status: "draft", deadline: past })).toBe("draft");
    expect(getEffectiveBidStatus({ status: "cancelled", deadline: past })).toBe("cancelled");
  });

  it("accepts a string deadline (as returned by superjson/JSON before Date revival)", () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    expect(getEffectiveBidStatus({ status: "active", deadline: past })).toBe("ended");
  });
});
