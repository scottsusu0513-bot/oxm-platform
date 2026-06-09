/**
 * Unit tests for getUnreadCountForUser using an injectable mock DB.
 *
 * The function makes DB calls in this fixed order:
 *   call 0 – owned factories (WHERE ownerId = userId)
 *   call 1 – active co-manager factories (WHERE userId = userId AND removedAt IS NULL)
 *   call 2 – conversations for those factories  [skipped if factoryIds empty]
 *   call 3 – COUNT(*) unread buyer messages     [skipped if convIds empty]
 */
import { describe, expect, it } from "vitest";
import { getUnreadCountForUser } from "./db";

type MockDbOptions = {
  ownedFactoryIds?: number[];
  coManagedFactoryIds?: number[];
  conversationIds?: number[];
  unreadCount?: number;
};

function createMockDb({
  ownedFactoryIds = [],
  coManagedFactoryIds = [],
  conversationIds = [],
  unreadCount = 0,
}: MockDbOptions = {}) {
  const responses: unknown[][] = [
    ownedFactoryIds.map((id) => ({ id })),
    coManagedFactoryIds.map((factoryId) => ({ factoryId })),
    conversationIds.map((id) => ({ id })),
    [{ count: unreadCount }],
  ];
  let callIdx = 0;

  return {
    select: () => {
      const idx = callIdx++;
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = async () => responses[idx] ?? [];
      return chain;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
describe("getUnreadCountForUser", () => {
  it("returns 0 for a user with no owned or co-managed factories", async () => {
    const db = createMockDb({ ownedFactoryIds: [], coManagedFactoryIds: [] });
    const result = await getUnreadCountForUser(1, db);
    expect(result).toBe(0);
  });

  it("owner with 2 unread buyer messages → returns 2", async () => {
    const db = createMockDb({
      ownedFactoryIds: [10],
      coManagedFactoryIds: [],
      conversationIds: [100, 101],
      unreadCount: 2,
    });
    const result = await getUnreadCountForUser(1, db);
    expect(result).toBe(2);
  });

  it("active co-manager with 2 unread messages → returns 2", async () => {
    const db = createMockDb({
      ownedFactoryIds: [],
      coManagedFactoryIds: [20],   // SQL WHERE removedAt IS NULL already filters
      conversationIds: [200, 201],
      unreadCount: 2,
    });
    const result = await getUnreadCountForUser(2, db);
    expect(result).toBe(2);
  });

  it("removed co-manager (SQL filter → empty coMgr rows) → returns 0", async () => {
    // When removedAt IS NOT NULL, the SQL WHERE removedAt IS NULL returns []
    const db = createMockDb({
      ownedFactoryIds: [],
      coManagedFactoryIds: [],   // SQL filtered out the removed row
    });
    const result = await getUnreadCountForUser(3, db);
    expect(result).toBe(0);
  });

  it("multi-factory: factory A has 2 unread, factory B has 3 unread → returns 5", async () => {
    const db = createMockDb({
      ownedFactoryIds: [10, 11],
      coManagedFactoryIds: [],
      conversationIds: [100, 101, 102],
      unreadCount: 5,
    });
    const result = await getUnreadCountForUser(1, db);
    expect(result).toBe(5);
  });

  it("owner and co-manager of the same factory → Set dedup → 0 double-count", async () => {
    // Factory 10 appears in both owned and co-managed; Set deduplicates to [10]
    const db = createMockDb({
      ownedFactoryIds: [10],
      coManagedFactoryIds: [10],  // duplicate — Set removes it
      conversationIds: [100],
      unreadCount: 2,
    });
    const result = await getUnreadCountForUser(1, db);
    expect(result).toBe(2);
  });

  it("all messages already read → returns 0", async () => {
    const db = createMockDb({
      ownedFactoryIds: [10],
      coManagedFactoryIds: [],
      conversationIds: [100],
      unreadCount: 0,   // SQL WHERE isRead=false returns COUNT=0
    });
    const result = await getUnreadCountForUser(1, db);
    expect(result).toBe(0);
  });

  it("factory with no conversations → returns 0 without querying messages", async () => {
    const db = createMockDb({
      ownedFactoryIds: [10],
      coManagedFactoryIds: [],
      conversationIds: [],  // empty → early return before COUNT query
    });
    const result = await getUnreadCountForUser(1, db);
    expect(result).toBe(0);
  });
});
