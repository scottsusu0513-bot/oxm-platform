/**
 * Unit tests for the notification-center type classification and visibility logic.
 *
 * These tests are pure (no DB): they verify that every eventType in both Sets
 * is correctly classified, and that getVisibleTypesForUser (indirectly, via
 * the exported Sets) returns the right filter for each user role.
 */
import { describe, expect, it } from "vitest";
import {
  PLATFORM_NOTIFICATION_TYPES,
  COMMUNITY_NOTIFICATION_TYPES,
  COMMUNITY_PUBLIC_ENTRY_ENABLED,
} from "@shared/const";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Mirrors the helper in server/routers.ts so we can test it in isolation. */
function getVisibleTypesForUser(role: string): string[] | null {
  return (role === "admin" || COMMUNITY_PUBLIC_ENTRY_ENABLED)
    ? null
    : Array.from(PLATFORM_NOTIFICATION_TYPES);
}

// ── PLATFORM_NOTIFICATION_TYPES membership ────────────────────────────────────

describe("PLATFORM_NOTIFICATION_TYPES", () => {
  const expected = [
    "factory_approved",
    "factory_rejected",
    "chat_message",
    "review_reply",
    "co_manager_invitation",
    "co_manager_invitation_accepted",
    "co_manager_invitation_rejected",
    "admin_announcement",
    "report_status_changed",
    "support_ticket_updated",
  ];

  it.each(expected)("contains '%s'", (type) => {
    expect(PLATFORM_NOTIFICATION_TYPES.has(type)).toBe(true);
  });

  it("does not contain community-only types", () => {
    expect(PLATFORM_NOTIFICATION_TYPES.has("community_post_reply")).toBe(false);
    expect(PLATFORM_NOTIFICATION_TYPES.has("followed_factory_new_discussion")).toBe(false);
    expect(PLATFORM_NOTIFICATION_TYPES.has("board_new_discussion")).toBe(false);
  });

  it("has exactly the expected count", () => {
    expect(PLATFORM_NOTIFICATION_TYPES.size).toBe(expected.length);
  });
});

// ── COMMUNITY_NOTIFICATION_TYPES membership ───────────────────────────────────

describe("COMMUNITY_NOTIFICATION_TYPES", () => {
  const expected = [
    "community_post_reply",
    "community_comment_reply",
    "community_mention",
    "community_reply_and_mention",
    "bid_review_approved",
    "bid_review_rejected",
    "bid_new_offer",
    "followed_factory_new_discussion",
    "board_new_discussion",
  ];

  it.each(expected)("contains '%s'", (type) => {
    expect(COMMUNITY_NOTIFICATION_TYPES.has(type)).toBe(true);
  });

  it("does not contain platform-only types", () => {
    expect(COMMUNITY_NOTIFICATION_TYPES.has("factory_approved")).toBe(false);
    expect(COMMUNITY_NOTIFICATION_TYPES.has("chat_message")).toBe(false);
    expect(COMMUNITY_NOTIFICATION_TYPES.has("admin_announcement")).toBe(false);
  });

  it("has exactly the expected count", () => {
    expect(COMMUNITY_NOTIFICATION_TYPES.size).toBe(expected.length);
  });
});

// ── No overlap between the two Sets ───────────────────────────────────────────

describe("type Set disjointness", () => {
  it("PLATFORM and COMMUNITY types share no eventType", () => {
    const overlap = [...PLATFORM_NOTIFICATION_TYPES].filter(t =>
      COMMUNITY_NOTIFICATION_TYPES.has(t),
    );
    expect(overlap).toEqual([]);
  });
});

// ── getVisibleTypesForUser ─────────────────────────────────────────────────────

describe("getVisibleTypesForUser", () => {
  it("returns null for admin (no filter — admin sees all)", () => {
    expect(getVisibleTypesForUser("admin")).toBeNull();
  });

  it("returns platform types array for regular user when COMMUNITY_PUBLIC_ENTRY_ENABLED=false", () => {
    // COMMUNITY_PUBLIC_ENTRY_ENABLED is hardcoded false in const.ts (beta mode)
    if (COMMUNITY_PUBLIC_ENTRY_ENABLED) return; // skip when flag is live
    const result = getVisibleTypesForUser("user");
    expect(Array.isArray(result)).toBe(true);
    expect(result).not.toBeNull();
  });

  it("visible array for regular user contains all PLATFORM types", () => {
    if (COMMUNITY_PUBLIC_ENTRY_ENABLED) return;
    const result = getVisibleTypesForUser("user") as string[];
    for (const type of PLATFORM_NOTIFICATION_TYPES) {
      expect(result).toContain(type);
    }
  });

  it("visible array for regular user does NOT contain community types", () => {
    if (COMMUNITY_PUBLIC_ENTRY_ENABLED) return;
    const result = getVisibleTypesForUser("user") as string[];
    for (const type of COMMUNITY_NOTIFICATION_TYPES) {
      expect(result).not.toContain(type);
    }
  });
});
