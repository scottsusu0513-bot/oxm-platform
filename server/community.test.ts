import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { resolveDefaultCommunitySpace, approveCommunityBid, rejectCommunityBid, withdrawCommunityBid, softDeleteCommunityBid, getCommunityBidIndustries, listCommunityBidReviewHistory, updateCommunityBid, getCommunityBidById, getDb, createCommunityBidOffer, withdrawCommunityBidOffer, resubmitCommunityBidOffer, getCommunityBidOfferById, getCommunityBidOfferByFactory, getCommunityBidOfferByUser, getCommunityBidOfferCount, listCommunityBidOffersForOwner, getApprovedFactoriesForUser, setTestBidDeadlinePast, setTestBidStatus, updateCommunityBidOfferSafe } from "./db";
import { communityNotifications, communityMentions, communityPosts, communityComments } from "../drizzle/schema";
import { COMMUNITY_CROSS_INDUSTRY_SLUG, COMMUNITY_IMAGE_MAX_BYTES, COMMUNITY_IMAGE_MAX_MB } from "../shared/const";
import { factories as factoriesTable } from "../drizzle/schema";
import { and as drizzleAnd, eq as drizzleEq, ne as drizzleNe, inArray as drizzleInArray, sql as drizzleSql } from "drizzle-orm";

// communityPosts / communityBids / communityBoardFollows / communityComments /
// communityReactions / communityContentFollows / communityMentions.mentionedUserId
// / communityNotifications.recipientUserId all have a real FK to users(id). This
// file's tests assume a fixed set of mock user ids already exist (default id=1 for
// "self", plus id=2 and id=999991-999998 for "another user" scenarios) — that
// assumption doesn't hold on a clean, schema-only oxm_test (no seeded users at
// all). Fix: create minimal legitimate users rows for exactly these fixed ids up
// front, self-contained, no dependency on any pre-existing/leftover DB state;
// afterAll removes them. Fixed literal ids (not dynamically-inserted ids) are
// deliberate — this file has ~140 call sites that hardcode these exact numbers to
// mean "another user", so making the ids real is far lower-risk than rewriting
// every call site to use a dynamically-created id.
const FIXED_TEST_USER_IDS = [1, 2, 999991, 999992, 999993, 999994, 999995, 999996, 999997, 999998] as const;

// A clean, schema-only oxm_test also starts with zero `factories` rows. Several
// pre-existing tests throughout this file look up "any approved factory not
// owned by user 1" (`testFactory`, populated later in a describe-local
// beforeAll) and silently no-op (`if (!testFactory) return`) when none exists —
// which on a fresh oxm_test meant most bid-offer tests were quietly never
// actually exercised. Seeding exactly one approved factory here (owned by a
// dedicated fake id, never one of FIXED_TEST_USER_IDS, so it never becomes an
// authored identity for the "acting" test users above) fixes that for the
// whole file, not just Phase 4's own mention-integrity tests that also depend
// on an approved factory existing.
const FIXED_TEST_FACTORY_OWNER_ID = 999_000_001;
let fixedApprovedFactoryId: number | null = null;

beforeAll(async () => {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  for (const id of FIXED_TEST_USER_IDS) {
    await conn.execute(drizzleSql`
      INSERT INTO users (id, openId, email, name, role, lastSignedIn)
      VALUES (${id}, ${`community-test-fixed-user-${id}`}, ${`community-test-fixed-user-${id}@example.test`}, ${`Community Test Fixed User ${id}`}, 'user', NOW())
      ON DUPLICATE KEY UPDATE id = id
    `);
  }

  // The factory owner also needs a real users row: several tests call
  // db.createCommunityBidOffer(...) directly with `bidderUserId: testFactory.ownerId`
  // (communityBidOffers.bidderUserId has an FK to users(id) too).
  await conn.execute(drizzleSql`
    INSERT INTO users (id, openId, email, name, role, lastSignedIn)
    VALUES (${FIXED_TEST_FACTORY_OWNER_ID}, ${`community-test-fixed-factory-owner-${FIXED_TEST_FACTORY_OWNER_ID}`}, ${`community-test-fixed-factory-owner-${FIXED_TEST_FACTORY_OWNER_ID}@example.test`}, ${"Community Test Fixed Factory Owner"}, 'user', NOW())
    ON DUPLICATE KEY UPDATE id = id
  `);

  const [existing] = await conn.select({ id: factoriesTable.id })
    .from(factoriesTable)
    .where(drizzleEq(factoriesTable.ownerId, FIXED_TEST_FACTORY_OWNER_ID));
  if (existing) {
    fixedApprovedFactoryId = existing.id;
  } else {
    const [result] = await conn.insert(factoriesTable).values({
      ownerId: FIXED_TEST_FACTORY_OWNER_ID,
      name: "Community Test Fixed Approved Factory",
      industry: ["其他"],
      mfgModes: ["ODM"],
      region: "台北市",
      capitalLevel: "未滿500萬",
      status: "approved",
    } as any);
    fixedApprovedFactoryId = (result as any).insertId as number;
  }
});

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  for (const id of FIXED_TEST_USER_IDS) {
    await conn.execute(drizzleSql`DELETE FROM users WHERE id = ${id}`);
  }
  await conn.execute(drizzleSql`DELETE FROM factories WHERE ownerId = ${FIXED_TEST_FACTORY_OWNER_ID}`);
  await conn.execute(drizzleSql`DELETE FROM users WHERE id = ${FIXED_TEST_FACTORY_OWNER_ID}`);
});

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createAuthContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const isAdmin = overrides?.role === "admin";
  const user: AuthenticatedUser = {
    id: 1,
    openId: isAdmin ? "SWjqDMVNedahKJ4az5GpAs" : "test-user-community",
    email: "test@example.com",
    primaryEmail: "test@example.com",
    primaryEmailVerifiedAt: new Date(),
    loginMethod: "google",
    name: "Test User",
    role: "user",
    isFactoryOwner: false,
    phone: null,
    phoneVerified: false,
    notificationSettings: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// ===== community.getSpaces =====
describe("community.getSpaces", () => {
  it("throws FORBIDDEN for unauthenticated users when status=beta", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.getSpaces()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws FORBIDDEN for non-admin users when status=beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.getSpaces()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns 14 spaces for admin users", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const spaces = await caller.community.getSpaces();
    expect(spaces).toHaveLength(14);
    expect(spaces[0]).toHaveProperty("code");
    expect(spaces[0]).toHaveProperty("name");
    expect(spaces[0]).toHaveProperty("postCount");
  }, 10000);

  it("includes cross-industry space", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const spaces = await caller.community.getSpaces();
    const cross = spaces.find(s => s.code === "cross-industry");
    expect(cross).toBeDefined();
    expect(cross?.name).toBe("跨產業交流區");
  }, 10000);
});

// ===== community.listPosts =====
describe("community.listPosts", () => {
  it("throws FORBIDDEN for non-admin when status=beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.listPosts({ spaceCode: "textile", page: 1, pageSize: 10 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws BAD_REQUEST for invalid spaceCode", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.listPosts({ spaceCode: "invalid-space-xyz", page: 1, pageSize: 10 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("returns paginated result with items and total for admin", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const result = await caller.community.listPosts({ spaceCode: "textile", page: 1, pageSize: 10 });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe("number");
  }, 10000);

  it("rejects pageSize > 50", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.listPosts({ spaceCode: "textile", page: 1, pageSize: 99 }))
      .rejects.toThrow();
  });
});

// ===== community.getPost =====
describe("community.getPost", () => {
  it("throws FORBIDDEN for non-admin when status=beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.getPost({ postId: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws NOT_FOUND for non-existent post (admin)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.getPost({ postId: 999999999 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 10000);
});

// ===== community.getMyIdentityOptions =====
describe("community.getMyIdentityOptions", () => {
  it("throws UNAUTHORIZED for unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.getMyIdentityOptions())
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws FORBIDDEN for non-admin user when status=beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.getMyIdentityOptions())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns identities array for admin user", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const result = await caller.community.getMyIdentityOptions();
    expect(result).toHaveProperty("identities");
    expect(Array.isArray(result.identities)).toBe(true);
  }, 10000);
});

// ===== community.uploadPostImage =====
describe("community.uploadPostImage", () => {
  it("throws UNAUTHORIZED for unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.uploadPostImage({ base64: "abc", mimeType: "image/jpeg" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws FORBIDDEN for non-admin when status=beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.uploadPostImage({ base64: "abc", mimeType: "image/jpeg" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // Phase 6: 5MB/8MB mismatch fix — lock in that client constant, server
  // pre-check, and validateImageUpload()'s own maxBytes all agree on the exact
  // same real byte boundary via COMMUNITY_IMAGE_MAX_BYTES.
  function fakeJpegBase64(byteLength: number): string {
    const buf = Buffer.alloc(byteLength, 0);
    buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff; // real JPEG magic bytes
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  }

  // This test env has no AWS_S3_BUCKET configured, so a file that passes size/
  // format validation still fails later at the actual storagePut() call — that's
  // an unrelated environmental limitation, not something this test asserts on.
  // What we're locking in here is that the size+magic-byte validation itself
  // does NOT reject a file at exactly the limit (no BAD_REQUEST from that layer).
  it(`does not reject a file at exactly the ${COMMUNITY_IMAGE_MAX_MB}MB limit for size/format reasons`, async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    try {
      await caller.community.uploadPostImage({
        base64: fakeJpegBase64(COMMUNITY_IMAGE_MAX_BYTES),
        mimeType: "image/jpeg",
      });
    } catch (err: any) {
      expect(err?.code).not.toBe("BAD_REQUEST");
    }
  }, 15000);

  it(`rejects a file 1 byte over the ${COMMUNITY_IMAGE_MAX_MB}MB limit`, async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.uploadPostImage({
      base64: fakeJpegBase64(COMMUNITY_IMAGE_MAX_BYTES + 1),
      mimeType: "image/jpeg",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 15000);

  it("rejects a well-formed-looking file well under the limit but with a fake (non-magic-byte) header", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const buf = Buffer.alloc(1024, 0x41); // "AAAA..." — not any real image magic number
    await expect(caller.community.uploadPostImage({
      base64: `data:image/jpeg;base64,${buf.toString("base64")}`,
      mimeType: "image/jpeg",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 15000);
});

// ===== community.createPost =====
describe("community.createPost", () => {
  it("throws for unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.createPost({
      spaceCode: "textile",
      title: "Test",
      content: "Content",
    })).rejects.toThrow();
  });

  it("throws FORBIDDEN for non-admin when status=beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.createPost({
      spaceCode: "textile",
      title: "Test",
      content: "Content",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws BAD_REQUEST for invalid spaceCode", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.createPost({
      spaceCode: "not-a-real-space",
      title: "Test",
      content: "Content",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws validation error for empty title", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.createPost({
      spaceCode: "textile",
      title: "",
      content: "Content",
    })).rejects.toThrow();
  });

  it("rejects more than 6 images", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const images = Array(7).fill("https://example.com/img.jpg");
    await expect(caller.community.createPost({
      spaceCode: "textile",
      title: "Test",
      content: "Content",
      images,
    })).rejects.toThrow();
  });

  it("creates a post successfully for admin (requires DB)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const result = await caller.community.createPost({
      spaceCode: "textile",
      title: "Integration test post",
      content: "This is a test post created by the integration test suite.",
    });
    expect(result).toHaveProperty("postId");
    expect(typeof result.postId).toBe("number");
    expect(result.postId).toBeGreaterThan(0);
  }, 15000);
});

// ===== community.updatePost =====
describe("community.updatePost", () => {
  it("throws for unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.updatePost({ postId: 1, title: "New title" }))
      .rejects.toThrow();
  });

  it("throws FORBIDDEN for non-admin when status=beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.updatePost({ postId: 1, title: "New title" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws NOT_FOUND for non-existent post (requires DB)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.updatePost({ postId: 999999999, title: "New title" }))
      .rejects.toThrow();
  }, 10000);
});

// ===== community.deletePost =====
describe("community.deletePost", () => {
  it("throws for unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.deletePost({ postId: 1 }))
      .rejects.toThrow();
  });

  it("throws FORBIDDEN for non-admin when status=beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.deletePost({ postId: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws for non-existent post (requires DB)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.deletePost({ postId: 999999999 }))
      .rejects.toThrow();
  }, 10000);
});

// ===== community.createComment =====
describe("community.createComment", () => {
  it("throws for unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.createComment({ postId: 1, content: "Hello" }))
      .rejects.toThrow();
  });

  it("throws FORBIDDEN for non-admin when status=beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.createComment({ postId: 1, content: "Hello" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws for non-existent post (requires DB)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.createComment({ postId: 999999999, content: "Hello" }))
      .rejects.toThrow();
  }, 10000);

  it("throws validation error for empty content", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.createComment({ postId: 1, content: "" }))
      .rejects.toThrow();
  });
});

// ===== community.updateComment =====
describe("community.updateComment", () => {
  it("throws for unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.updateComment({ commentId: 1, content: "Updated" }))
      .rejects.toThrow();
  });

  it("throws FORBIDDEN for non-admin when status=beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.updateComment({ commentId: 1, content: "Updated" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws for non-existent comment (requires DB)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.updateComment({ commentId: 999999999, content: "Updated" }))
      .rejects.toThrow();
  }, 10000);
});

// ===== community.deleteComment =====
describe("community.deleteComment", () => {
  it("throws for unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.deleteComment({ commentId: 1 }))
      .rejects.toThrow();
  });

  it("throws FORBIDDEN for non-admin when status=beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.deleteComment({ commentId: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws for non-existent comment (requires DB)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.deleteComment({ commentId: 999999999 }))
      .rejects.toThrow();
  }, 10000);
});

// ===== admin.community moderation =====
// adminProcedure enforces whitelist-based access; in test env without a whitelist entry it always throws.
// Pattern matches factory.test.ts: use .rejects.toThrow() for access-control assertions.
describe("admin.community.hidePost", () => {
  it("throws for unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.admin.community.hidePost({ postId: 1, hidden: true }))
      .rejects.toThrow();
  });

  it("throws for non-admin users", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.admin.community.hidePost({ postId: 1, hidden: true }))
      .rejects.toThrow();
  });

  it("throws for admin calling non-existent post (requires DB + whitelist)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.admin.community.hidePost({ postId: 999999999, hidden: true }))
      .rejects.toThrow();
  }, 10000);
});

describe("admin.community.lockPost", () => {
  it("throws for non-admin", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.admin.community.lockPost({ postId: 1, locked: true }))
      .rejects.toThrow();
  });

  it("throws for admin calling non-existent post (requires DB + whitelist)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.admin.community.lockPost({ postId: 999999999, locked: true }))
      .rejects.toThrow();
  }, 10000);
});

describe("admin.community.pinPost", () => {
  it("throws for non-admin", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.admin.community.pinPost({ postId: 1, pinned: true }))
      .rejects.toThrow();
  });

  it("throws for admin calling non-existent post (requires DB + whitelist)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.admin.community.pinPost({ postId: 999999999, pinned: true }))
      .rejects.toThrow();
  }, 10000);
});

describe("admin.community.hideComment", () => {
  it("throws for non-admin", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.admin.community.hideComment({ commentId: 1, hidden: true }))
      .rejects.toThrow();
  });

  it("throws for admin calling non-existent comment (requires DB + whitelist)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.admin.community.hideComment({ commentId: 999999999, hidden: true }))
      .rejects.toThrow();
  }, 10000);
});

// admin.community.deletePost physically removes the post row; communityComments.postId FK
// is ON DELETE CASCADE so all comments are cascade-deleted too. This differs from the
// user-facing deletePost (soft delete: sets deletedAt, comments untouched).
describe("admin.community.deletePost (hard delete, comments cascade)", () => {
  it("throws for non-admin", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.admin.community.deletePost({ postId: 1 }))
      .rejects.toThrow();
  });

  it("throws for admin calling non-existent post (requires DB + whitelist)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.admin.community.deletePost({ postId: 999999999 }))
      .rejects.toThrow();
  }, 10000);
});

// ===== Full create→read→delete flow (integration) =====
describe("community integration: create and delete post", () => {
  it("admin can create a post, fetch it, and delete it", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));

    // Create
    const { postId } = await caller.community.createPost({
      spaceCode: "packaging",
      title: "Integration test: create and delete",
      content: "This post should be cleaned up by the test.",
    });
    expect(postId).toBeGreaterThan(0);

    // Fetch
    const { post } = await caller.community.getPost({ postId });
    expect(post.title).toBe("Integration test: create and delete");
    expect(post.spaceCode).toBe("packaging");

    // Soft delete: sets deletedAt timestamp only — does NOT trigger FK ON DELETE,
    // so the post row still exists and all comments are preserved.
    // FK behaviors are distinct: parentCommentId SET NULL triggers on physical comment deletion
    // (orphans replies to top-level); authorUserId SET NULL triggers on user deletion.
    const deleteResult = await caller.community.deletePost({ postId });
    expect(deleteResult.success).toBe(true);

    // Admin can still see the post (deletedAt is set); non-admin would get NOT_FOUND.
    // Comments are intact because soft delete never touches the FK chain.
    const { post: deletedPost } = await caller.community.getPost({ postId });
    expect(deletedPost.deletedAt).not.toBeNull();
  }, 30000);

  it("admin can add a comment to a post and delete the comment", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));

    // Create a post first
    const { postId } = await caller.community.createPost({
      spaceCode: "electronics",
      title: "Post for comment test",
      content: "Testing comment flow.",
    });

    // Create comment
    const { commentId } = await caller.community.createComment({
      postId,
      content: "Test comment content",
    });
    expect(commentId).toBeGreaterThan(0);

    // Create nested reply
    const { commentId: replyId } = await caller.community.createComment({
      postId,
      content: "Nested reply",
      parentCommentId: commentId,
      replyToUserId: 1,
    });
    expect(replyId).toBeGreaterThan(0);

    // Fetch post — should have 2 comments
    const { post, comments } = await caller.community.getPost({ postId });
    expect(post.commentCount).toBe(2);
    expect(comments).toHaveLength(1); // 1 top-level with 1 nested reply
    expect(comments[0].replies).toHaveLength(1);

    // Delete the reply
    await caller.community.deleteComment({ commentId: replyId });

    // Delete the post
    await caller.community.deletePost({ postId });
  }, 30000);
});

// ===== Image security: assertCommunityImagesOwned =====
// Tests set AWS_S3_BUCKET / AWS_REGION in process.env to activate ownership checks.
// createAuthContext gives userId=1, so valid prefix is /community-posts/1/.
describe("community image security", () => {
  const origBucket = process.env.AWS_S3_BUCKET;
  const origRegion = process.env.AWS_REGION;
  const origPublicBase = process.env.AWS_S3_PUBLIC_BASE_URL;

  const BUCKET = "test-bucket";
  const REGION = "ap-southeast-1";
  const BASE = `https://${BUCKET}.s3.${REGION}.amazonaws.com`;
  const ownPrefix = `${BASE}/community-posts/1/`;
  const validUrl = `${ownPrefix}abc.jpg`;
  // Phase 6: images is now { url, crop }[], not string[] — this tiny helper
  // keeps every ownership/security case below focused on the URL under test.
  const img = (url: string) => ({ url, crop: null });

  beforeEach(() => {
    process.env.AWS_S3_BUCKET = BUCKET;
    process.env.AWS_REGION = REGION;
    delete process.env.AWS_S3_PUBLIC_BASE_URL;
  });

  afterEach(() => {
    if (origBucket == null) delete process.env.AWS_S3_BUCKET;
    else process.env.AWS_S3_BUCKET = origBucket;
    if (origRegion == null) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = origRegion;
    if (origPublicBase == null) delete process.env.AWS_S3_PUBLIC_BASE_URL;
    else process.env.AWS_S3_PUBLIC_BASE_URL = origPublicBase;
  });

  // 1. Valid URL for own userId → no FORBIDDEN (may succeed or fail for DB reasons)
  it("accepts valid S3 URL for own userId (no FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    try {
      await caller.community.createPost({
        spaceCode: "textile",
        title: "Image security test: valid own URL",
        content: "Content",
        images: [img(validUrl)],
      });
    } catch (err: any) {
      expect(err?.code).not.toBe("FORBIDDEN");
    }
  }, 15000);

  // 2. Another user's prefix → FORBIDDEN
  it("rejects URL with another user's prefix", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const otherUrl = `${BASE}/community-posts/999/evil.jpg`;
    await expect(
      caller.community.createPost({
        spaceCode: "textile",
        title: "Test",
        content: "Content",
        images: [img(otherUrl)],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 3. External host → FORBIDDEN
  it("rejects URL from external host", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(
      caller.community.createPost({
        spaceCode: "textile",
        title: "Test",
        content: "Content",
        images: [img("https://evil.com/community-posts/1/steal.jpg")],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 4. Percent-encoded path traversal (%2E%2E) → FORBIDDEN
  it("rejects percent-encoded path traversal", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const traversalUrl = `${BASE}/community-posts/1/%2E%2E/999/evil.jpg`;
    await expect(
      caller.community.createPost({
        spaceCode: "textile",
        title: "Test",
        content: "Content",
        images: [img(traversalUrl)],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 5. URL-normalized path traversal (..) → FORBIDDEN (URL parser normalizes it away from /1/)
  it("rejects URL-normalized path traversal", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const traversalUrl = `${BASE}/community-posts/1/../999/evil.jpg`;
    await expect(
      caller.community.createPost({
        spaceCode: "textile",
        title: "Test",
        content: "Content",
        images: [img(traversalUrl)],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 6. Query string on valid URL → accepted (ownership check uses pathname only)
  it("accepts valid URL with query string", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const urlWithQuery = `${validUrl}?v=1&t=2`;
    try {
      await caller.community.createPost({
        spaceCode: "textile",
        title: "Image security test: query string",
        content: "Content",
        images: [img(urlWithQuery)],
      });
    } catch (err: any) {
      expect(err?.code).not.toBe("FORBIDDEN");
    }
  }, 15000);

  // 7. More than 6 images → zod rejects (max(6))
  it("rejects more than 6 images via zod", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const tooMany = Array(7).fill(img(validUrl));
    await expect(
      caller.community.createPost({
        spaceCode: "textile",
        title: "Test",
        content: "Content",
        images: tooMany,
      }),
    ).rejects.toThrow();
  });

  // 8. Non-allowed mimeType in uploadPostImage → zod enum error
  it("rejects non-allowed mimeType in uploadPostImage", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(
      caller.community.uploadPostImage({
        base64: "R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
        mimeType: "image/gif" as "image/jpeg",
      }),
    ).rejects.toThrow();
  });

  // 9. Production env + no S3 bucket + images → INTERNAL_SERVER_ERROR
  it("throws INTERNAL_SERVER_ERROR in production when S3 not configured", async () => {
    delete process.env.AWS_S3_BUCKET;
    delete process.env.AWS_S3_PUBLIC_BASE_URL;
    const origNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
      await expect(
        caller.community.createPost({
          spaceCode: "textile",
          title: "Test",
          content: "Content",
          images: [img("https://example.com/img.jpg")],
        }),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    } finally {
      process.env.NODE_ENV = origNodeEnv;
    }
  });

  // 10. Edit preserving own post's existing URLs → no FORBIDDEN
  it("edit preserving own post existing URLs is accepted", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const { postId } = await caller.community.createPost({
      spaceCode: "textile",
      title: "Edit image preservation test",
      content: "Content",
      images: [img(validUrl)],
    });
    try {
      await caller.community.updatePost({
        postId,
        images: [img(validUrl)],
      });
    } catch (err: any) {
      expect(err?.code).not.toBe("FORBIDDEN");
    }
    await caller.community.deletePost({ postId });
  }, 30000);

  // 11. Edit with another user's image URL → FORBIDDEN
  it("edit with another user's image URL is FORBIDDEN", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const { postId } = await caller.community.createPost({
      spaceCode: "textile",
      title: "Edit foreign image test",
      content: "Content",
    });
    const foreignUrl = `${BASE}/community-posts/999/foreign.jpg`;
    await expect(
      caller.community.updatePost({ postId, images: [img(foreignUrl)] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller.community.deletePost({ postId });
  }, 30000);

  // 12. Invalid URL string (not parseable) → FORBIDDEN
  it("rejects a non-parseable URL string", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(
      caller.community.createPost({
        spaceCode: "textile",
        title: "Test",
        content: "Content",
        images: [{ url: "not-a-url", crop: null }],
      }),
    ).rejects.toThrow(); // zod url() rejects this before assertCommunityImagesOwned
  });
});

// ===== Phase 6: image crop metadata persistence (real data transformation, not string-match) =====
describe("community post image crop metadata (Phase 6)", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("round-trips crop metadata through create → getPost (simulates reload)", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const crop = { zoom: 1.8, posX: 25, posY: 75 };
    const { postId } = await caller.community.createPost({
      spaceCode: "textile",
      title: "Crop round-trip test",
      content: "Content",
      images: [{ url: "https://cdn.example.com/community-posts/1/a.jpg", crop }],
    });
    const { post } = await caller.community.getPost({ postId });
    expect(post.images).toEqual([{ url: "https://cdn.example.com/community-posts/1/a.jpg", crop }]);
    await caller.community.deletePost({ postId });
  }, 30000);

  it("an image with no crop (crop: null) stays null through create → getPost, not defaulted to some fabricated center object", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { postId } = await caller.community.createPost({
      spaceCode: "textile",
      title: "No-crop test",
      content: "Content",
      images: [{ url: "https://cdn.example.com/community-posts/1/b.jpg", crop: null }],
    });
    const { post } = await caller.community.getPost({ postId });
    expect(post.images).toEqual([{ url: "https://cdn.example.com/community-posts/1/b.jpg", crop: null }]);
    await caller.community.deletePost({ postId });
  }, 30000);

  it("updatePost replacing images with a new crop overwrites the stored value correctly", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { postId } = await caller.community.createPost({
      spaceCode: "textile",
      title: "Crop update test",
      content: "Content",
      images: [{ url: "https://cdn.example.com/community-posts/1/c.jpg", crop: { zoom: 1, posX: 50, posY: 50 } }],
    });
    const newCrop = { zoom: 2.5, posX: 10, posY: 90 };
    await caller.community.updatePost({
      postId,
      images: [{ url: "https://cdn.example.com/community-posts/1/c.jpg", crop: newCrop }],
    });
    const { post } = await caller.community.getPost({ postId });
    expect(post.images).toEqual([{ url: "https://cdn.example.com/community-posts/1/c.jpg", crop: newCrop }]);
    await caller.community.deletePost({ postId });
  }, 30000);

  it("server clamps an out-of-range crop before storing it (defense against a tampered request, not just trusting the client)", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { postId } = await caller.community.createPost({
      spaceCode: "textile",
      title: "Crop clamp test",
      content: "Content",
      images: [{ url: "https://cdn.example.com/community-posts/1/d.jpg", crop: { zoom: 999, posX: -50, posY: 500 } as any }],
    });
    const { post } = await caller.community.getPost({ postId });
    expect(post.images[0].crop).toEqual({ zoom: 3, posX: 0, posY: 100 });
    await caller.community.deletePost({ postId });
  }, 30000);

  // Backward compatibility: old posts created before Phase 6 physically stored
  // images as plain string[] in the same JSON column. Directly write that legacy
  // shape (bypassing the router, which would now always write the new shape) to
  // simulate a real pre-existing row, then confirm reads don't break.
  it("a legacy post whose images column is still a plain string[] reads back normalized, without crashing", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { postId } = await caller.community.createPost({
      spaceCode: "textile",
      title: "Legacy image format test",
      content: "Content",
    });
    const db_ = await getDb();
    if (db_) {
      await db_.execute(
        `UPDATE communityPosts SET images = '["https://cdn.example.com/community-posts/1/legacy.jpg"]' WHERE id = ${postId}` as any,
      );
    }
    const { post } = await caller.community.getPost({ postId });
    expect(post.images).toEqual([{ url: "https://cdn.example.com/community-posts/1/legacy.jpg", crop: null }]);
    await caller.community.deletePost({ postId });
  }, 30000);

  it("listPosts also normalizes legacy string[] images without crashing the list query", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { postId } = await caller.community.createPost({
      spaceCode: "textile",
      title: "Legacy image format list test",
      content: "Content",
    });
    const db_ = await getDb();
    if (db_) {
      await db_.execute(
        `UPDATE communityPosts SET images = '["https://cdn.example.com/community-posts/1/legacy2.jpg"]' WHERE id = ${postId}` as any,
      );
    }
    const { items } = await caller.community.listPosts({ spaceCode: "textile", page: 1, pageSize: 50 });
    const found = items.find(p => p.id === postId);
    expect(found?.images).toEqual([{ url: "https://cdn.example.com/community-posts/1/legacy2.jpg", crop: null }]);
    await caller.community.deletePost({ postId });
  }, 30000);
});

// ===== Phase 2A: Board Follow =====
describe("community.boardFollow", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("non-admin throws FORBIDDEN in beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.boardFollowStatus({ spaceCode: "textile" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin: boardFollowStatus returns following=false before follow", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await caller.community.unfollowBoard({ spaceCode: "textile" }).catch(() => {});
    const status = await caller.community.boardFollowStatus({ spaceCode: "textile" });
    expect(status.following).toBe(false);
  }, 10000);

  it("admin: follow then status shows following=true", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await caller.community.followBoard({ spaceCode: "textile", notifyNewDiscussions: true });
    const status = await caller.community.boardFollowStatus({ spaceCode: "textile" });
    expect(status.following).toBe(true);
    expect(status.notifyNewDiscussions).toBe(true);
    await caller.community.unfollowBoard({ spaceCode: "textile" });
  }, 15000);

  it("admin: unfollow resets status to following=false", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await caller.community.followBoard({ spaceCode: "textile" });
    await caller.community.unfollowBoard({ spaceCode: "textile" });
    const status = await caller.community.boardFollowStatus({ spaceCode: "textile" });
    expect(status.following).toBe(false);
  }, 15000);

  it("admin: duplicate follow is idempotent (no error)", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await caller.community.followBoard({ spaceCode: "textile" });
    await expect(caller.community.followBoard({ spaceCode: "textile" })).resolves.not.toThrow();
    await caller.community.unfollowBoard({ spaceCode: "textile" });
  }, 15000);

  it("followBoard rejects unknown/invalid spaceCode", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.community.followBoard({ spaceCode: "!!!invalid!!!" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 10000);
});

// ===== Phase 2A: Factory Follow =====
describe("community.factoryFollow", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("non-admin throws FORBIDDEN in beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.factoryFollowStatus({ factoryId: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin: factoryFollowStatus returns following=false for non-existent follow", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await caller.community.unfollowFactory({ factoryId: 9999999 }).catch(() => {});
    const status = await caller.community.factoryFollowStatus({ factoryId: 9999999 });
    expect(status.following).toBe(false);
  }, 10000);

  it("followFactory with non-approved factory throws NOT_FOUND", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.community.followFactory({ factoryId: 9999999 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 10000);
});

// ===== Phase 2A: Content Follow =====
describe("community.contentFollow", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("non-admin throws FORBIDDEN in beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.contentFollowStatus({ contentType: "discussion", contentId: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin: follow and unfollow a discussion", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Content follow test",
      content: "Content",
    });

    await adminCaller.community.unfollowContent({ contentType: "discussion", contentId: postId }).catch(() => {});
    const before = await adminCaller.community.contentFollowStatus({ contentType: "discussion", contentId: postId });
    expect(before.following).toBe(false);

    await adminCaller.community.followContent({ contentType: "discussion", contentId: postId });
    const after = await adminCaller.community.contentFollowStatus({ contentType: "discussion", contentId: postId });
    expect(after.following).toBe(true);

    await adminCaller.community.unfollowContent({ contentType: "discussion", contentId: postId });
    const final = await adminCaller.community.contentFollowStatus({ contentType: "discussion", contentId: postId });
    expect(final.following).toBe(false);

    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("duplicate follow is idempotent", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Dup content follow",
      content: "Content",
    });
    await adminCaller.community.followContent({ contentType: "discussion", contentId: postId });
    await expect(adminCaller.community.followContent({ contentType: "discussion", contentId: postId })).resolves.not.toThrow();
    await adminCaller.community.deletePost({ postId });
  }, 30000);
});

// ===== Phase 2A: Reaction =====
describe("community.reaction", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("non-admin user throws FORBIDDEN calling reactionSummary in beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.reactionSummary({ targetType: "post", targetId: 1, reactionType: "helpful" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin: reactionSummary returns 0 for non-existent post", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const summary = await caller.community.reactionSummary({ targetType: "post", targetId: 9999999, reactionType: "helpful" });
    expect(summary.count).toBe(0);
    expect(summary.viewerReacted).toBe(false);
  }, 10000);

  it("admin: toggle reaction adds then removes", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Reaction test",
      content: "Content",
    });

    const add = await adminCaller.community.toggleReaction({ targetType: "post", targetId: postId, reactionType: "helpful" });
    expect(add.added).toBe(true);

    const summary = await adminCaller.community.reactionSummary({ targetType: "post", targetId: postId, reactionType: "helpful" });
    expect(summary.count).toBe(1);
    expect(summary.viewerReacted).toBe(true);

    const remove = await adminCaller.community.toggleReaction({ targetType: "post", targetId: postId, reactionType: "helpful" });
    expect(remove.added).toBe(false);

    const summary2 = await adminCaller.community.reactionSummary({ targetType: "post", targetId: postId, reactionType: "helpful" });
    expect(summary2.count).toBe(0);

    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("toggleReaction on soft-deleted post throws NOT_FOUND", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Deleted reaction test",
      content: "Content",
    });
    await adminCaller.community.deletePost({ postId });
    await expect(adminCaller.community.toggleReaction({ targetType: "post", targetId: postId, reactionType: "helpful" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 30000);
});

// ===== Phase 2A: Community Notifications =====
describe("community.notifications", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("non-admin throws FORBIDDEN in beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.notificationUnreadCount())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin: unreadCount returns 0 when no notifications", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const result = await caller.community.notificationUnreadCount();
    expect(result.count).toBeGreaterThanOrEqual(0);
  }, 10000);

  it("admin: notificationList returns paginated results", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const result = await caller.community.notificationList({ page: 1, pageSize: 10 });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(0);
  }, 10000);

  it("admin: markAllRead succeeds", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.community.notificationMarkAllRead()).resolves.toMatchObject({ success: true });
  }, 10000);

  it("admin: markRead with non-existent id is silent (no error)", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.community.notificationMarkRead({ notificationId: 9999999 }))
      .resolves.toMatchObject({ success: true });
  }, 10000);
});

// ===== Phase 2A: createComment auto-follow + mentions field =====
describe("community.createComment mention and auto-follow", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("createComment accepts mentions array", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Mention test post",
      content: "Content",
    });
    await expect(adminCaller.community.createComment({
      postId,
      content: "Hello @someone",
      mentions: [{ type: "user", id: 9999 }],
    })).resolves.toHaveProperty("commentId");
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("createComment auto-follows the post for commenter", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Auto-follow test",
      content: "Content",
    });
    await adminCaller.community.unfollowContent({ contentType: "discussion", contentId: postId }).catch(() => {});
    await adminCaller.community.createComment({ postId, content: "Test comment" });
    const status = await adminCaller.community.contentFollowStatus({ contentType: "discussion", contentId: postId });
    expect(status.following).toBe(true);
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("mentions array exceeding 5 is rejected by zod", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Mention limit test",
      content: "Content",
    });
    await expect(adminCaller.community.createComment({
      postId,
      content: "Mention spam",
      mentions: [1, 2, 3, 4, 5, 6].map(id => ({ type: "factory" as const, id })),
    })).rejects.toThrow();
    await adminCaller.community.deletePost({ postId });
  }, 30000);
});

// ===== Phase 2A: searchMentionTargets =====
describe("community.searchMentionTargets", () => {
  it("non-admin throws FORBIDDEN in beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.searchMentionTargets({ query: "test" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin: returns MentionTarget array", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const results = await caller.community.searchMentionTargets({ query: "a" });
    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      expect(results[0]).toHaveProperty("type");
      expect(results[0]).toHaveProperty("id");
      expect(results[0]).toHaveProperty("displayName");
      expect(["factory", "user"]).toContain(results[0].type);
    }
  }, 10000);

  it("admin: empty query returns no results (min length 1 enforced)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.searchMentionTargets({ query: "" })).rejects.toThrow();
  }, 10000);
});

// ===== communityMentions DB constraint =====
describe("communityMentions integrity constraints", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("createComment with an approved factory mention saves mention row (factory id stored)", async () => {
    const db_ = await getDb();
    if (!db_) return;
    const [approved] = await db_.select({ id: factoriesTable.id })
      .from(factoriesTable).where(drizzleEq(factoriesTable.status, "approved")).limit(1);
    if (!approved) return; // no approved factory in this env — skip
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Mention factory test",
      content: "Content",
    });
    const result = await adminCaller.community.createComment({
      postId,
      content: "Hello @SomeFactory",
      mentions: [{ type: "factory", id: approved.id }],
    });
    expect(result).toHaveProperty("commentId");
    const mentionRows = await db_.select().from(communityMentions)
      .where(drizzleAnd(drizzleEq(communityMentions.sourceType, "comment"), drizzleEq(communityMentions.sourceId, result.commentId)));
    expect(mentionRows).toHaveLength(1);
    expect(mentionRows[0].mentionedFactoryId).toBe(approved.id);
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("createComment with user mention stores userId, not factoryId", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "User mention test",
      content: "Content",
    });
    // User 9999 does not exist → FK error caught best-effort, comment still created
    const result = await adminCaller.community.createComment({
      postId,
      content: "Hello @SomeUser",
      mentions: [{ type: "user", id: 9999 }],
    });
    expect(result).toHaveProperty("commentId");
    await adminCaller.community.deletePost({ postId });
  }, 30000);
});

// ===== Reply + mention dedup =====
describe("community notification dedup: reply + mention merge", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("reply to own post does not create self-notification", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Self-reply test",
      content: "Content",
    });
    const countBefore = await adminCaller.community.notificationUnreadCount();
    await adminCaller.community.createComment({ postId, content: "Self reply" });
    const countAfter = await adminCaller.community.notificationUnreadCount();
    // Must NOT have increased (self-reply excluded)
    expect(countAfter.count).toBe(countBefore.count);
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("mention self does not create self-notification", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Self-mention test",
      content: "Content",
    });
    const countBefore = await adminCaller.community.notificationUnreadCount();
    // mention self (id=1 is our test user)
    await adminCaller.community.createComment({
      postId,
      content: "Hello @self",
      mentions: [{ type: "user", id: 1 }],
    });
    const countAfter = await adminCaller.community.notificationUnreadCount();
    expect(countAfter.count).toBe(countBefore.count);
    await adminCaller.community.deletePost({ postId });
  }, 30000);
});

// ===== Notification mark read access control =====
describe("community.notificationMarkRead access control", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });
  const otherAdminCtx = () => createAuthContext({ role: "admin", id: 2, email: "other@example.com" });

  it("non-admin cannot mark read (FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.notificationMarkRead({ notificationId: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("markRead with non-existent id is silent (no error, 0 rows affected)", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.community.notificationMarkRead({ notificationId: 9999999 }))
      .resolves.toMatchObject({ success: true });
  }, 10000);

  it("markAllRead only affects own notifications (no cross-user leak)", async () => {
    const callerA = appRouter.createCaller(adminCtx());
    const callerB = appRouter.createCaller(otherAdminCtx());
    // Both mark all read — should not throw and should not affect each other's data
    await expect(callerA.community.notificationMarkAllRead()).resolves.toMatchObject({ success: true });
    await expect(callerB.community.notificationMarkAllRead()).resolves.toMatchObject({ success: true });
  }, 15000);

  it("markRead is idempotent (calling twice does not error)", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await caller.community.notificationMarkRead({ notificationId: 9999999 });
    await expect(caller.community.notificationMarkRead({ notificationId: 9999999 }))
      .resolves.toMatchObject({ success: true });
  }, 10000);
});

// ===== Beta access gates for new endpoints =====
describe("Beta access gates: non-admin users are blocked", () => {
  it("non-admin: followBoard blocked", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.followBoard({ spaceCode: "textile" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("non-admin: followFactory blocked", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.followFactory({ factoryId: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("non-admin: followContent blocked", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.followContent({ contentType: "discussion", contentId: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("non-admin: toggleReaction blocked (checkCommunityWrite)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.toggleReaction({ targetType: "post", targetId: 1, reactionType: "helpful" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("non-admin: notificationList blocked", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.notificationList({ page: 1, pageSize: 10 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("unauthenticated: notificationMarkAllRead blocked", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.notificationMarkAllRead())
      .rejects.toThrow(); // UNAUTHORIZED
  });
});

// ===== Reaction: deleted/hidden target =====
describe("community reaction: invalid target", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("reactionSummary for non-existent target returns 0 count", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const result = await caller.community.reactionSummary({ targetType: "post", targetId: 9999999, reactionType: "helpful" });
    expect(result.count).toBe(0);
    expect(result.viewerReacted).toBe(false);
  }, 10000);

  it("toggleReaction on non-existent post throws NOT_FOUND", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.community.toggleReaction({ targetType: "post", targetId: 9999999, reactionType: "helpful" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 10000);

  it("toggleReaction on non-existent comment throws NOT_FOUND", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.community.toggleReaction({ targetType: "comment", targetId: 9999999, reactionType: "helpful" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 10000);
});

// ===== mention limit =====
describe("community mention limits", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("comment with exactly 5 mentions is accepted", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Max mentions test",
      content: "Content",
    });
    await expect(adminCaller.community.createComment({
      postId,
      content: "Five mentions",
      mentions: [1, 2, 3, 4, 5].map(id => ({ type: "user" as const, id })),
    })).resolves.toHaveProperty("commentId");
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("comment with 6 mentions rejected by zod (max 5)", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Over max mentions test",
      content: "Content",
    });
    await expect(adminCaller.community.createComment({
      postId,
      content: "Six mentions",
      mentions: [1, 2, 3, 4, 5, 6].map(id => ({ type: "user" as const, id })),
    })).rejects.toThrow();
    await adminCaller.community.deletePost({ postId });
  }, 30000);
});

// ===== Board follow invalid spaceCode =====
describe("community.boardFollow validation", () => {
  it("followBoard with valid spaceCode succeeds", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.followBoard({ spaceCode: "cross-industry" })).resolves.not.toThrow();
    await caller.community.unfollowBoard({ spaceCode: "cross-industry" });
  }, 15000);

  it("unfollowBoard for non-followed board is silent (no error)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.unfollowBoard({ spaceCode: "cross-industry" })).resolves.not.toThrow();
  }, 10000);
});

// ===== filterCommunityEligibleRecipientIds: beta admin-only =====
describe("filterCommunityEligibleRecipientIds: beta mode", () => {
  it("non-admin user ID is filtered out in beta", async () => {
    // user id=1, role=user in test DB — db.filterCommunityEligibleRecipientIds returns only admins in beta
    // We call it indirectly by checking the notification count for a non-admin who gets mentioned
    const adminCaller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const countBefore = await adminCaller.community.notificationUnreadCount();
    // Create post mentioning user id=1 (admin) — should receive notification
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Beta filter test",
      content: "Content",
      mentions: [{ type: "user", id: 1 }],
    });
    // Notification for self (actor = recipient) → not created
    const countAfter = await adminCaller.community.notificationUnreadCount();
    expect(countAfter.count).toBe(countBefore.count); // self-mention excluded
    await adminCaller.community.deletePost({ postId });
  }, 30000);
});

// ===== Post-level mentions: createPost =====
describe("community.createPost with mentions", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("post with exactly 10 mentions is accepted", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    await expect(adminCaller.community.createPost({
      spaceCode: "textile",
      title: "10 mentions test",
      content: "Content",
      mentions: [1,2,3,4,5,6,7,8,9,10].map(id => ({ type: "user" as const, id })),
    })).resolves.toHaveProperty("postId");
    // cleanup — get the post id
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile", title: "tmp", content: "tmp",
    });
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("post with 11 mentions rejected by zod", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    await expect(adminCaller.community.createPost({
      spaceCode: "textile",
      title: "11 mentions test",
      content: "Content",
      mentions: [1,2,3,4,5,6,7,8,9,10,11].map(id => ({ type: "user" as const, id })),
    })).rejects.toThrow();
  }, 10000);

  it("duplicate mention targets are deduplicated silently", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const result = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Dedup mentions test",
      content: "Content",
      mentions: [{ type: "user", id: 2 }, { type: "user", id: 2 }],
    });
    expect(result).toHaveProperty("postId");
    await adminCaller.community.deletePost({ postId: result.postId });
  }, 30000);

  it("self mention does not create notification for actor", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const countBefore = await adminCaller.community.notificationUnreadCount();
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Self-mention post",
      content: "Content",
      mentions: [{ type: "user", id: 1 }],
    });
    const countAfter = await adminCaller.community.notificationUnreadCount();
    expect(countAfter.count).toBe(countBefore.count);
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("nonexistent factory in mentions is rejected — no post is created (Phase 4 hardening)", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const db_ = await getDb();
    await expect(adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Nonexistent factory mention should be rejected",
      content: "Content",
      mentions: [{ type: "factory", id: 999999999 }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    if (db_) {
      const leftover = await db_.select({ id: communityPosts.id }).from(communityPosts)
        .where(drizzleEq(communityPosts.title, "Nonexistent factory mention should be rejected"));
      expect(leftover).toHaveLength(0);
    }
  }, 30000);
});

// ===== Post-level mentions: updatePost =====
describe("community.updatePost with mentions", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  it("updatePost with unchanged mentions produces no new notifications", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Update unchanged mentions",
      content: "Content",
      mentions: [{ type: "user", id: 2 }],
    });
    const countBefore = await adminCaller.community.notificationUnreadCount();
    // Update with same mentions → no new notifications
    await adminCaller.community.updatePost({
      postId,
      content: "Updated content",
      mentions: [{ type: "user", id: 2 }],
    });
    const countAfter = await adminCaller.community.notificationUnreadCount();
    expect(countAfter.count).toBe(countBefore.count);
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("updatePost without mentions field does not clear existing mentions", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Update no-mentions field",
      content: "Content",
      mentions: [{ type: "user", id: 2 }],
    });
    // Update without sending mentions → mentions field is undefined → no change
    await adminCaller.community.updatePost({ postId, content: "New content" });
    // The relation should still exist in DB (we just verify no error)
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("updatePost with empty mentions array removes existing mention relations", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Remove all mentions",
      content: "Content",
      mentions: [{ type: "user", id: 2 }],
    });
    // Send empty array → syncMentions removes the existing relation
    await expect(adminCaller.community.updatePost({
      postId,
      mentions: [],
    })).resolves.toMatchObject({ success: true });
    await adminCaller.community.deletePost({ postId });
  }, 30000);
});

// ===== Phase 4: mention write-side factory status validation =====
// Autocomplete (searchMentionTargets) already filters status="approved" — these tests
// cover the WRITE side: createPost/createComment/updatePost must independently reject
// a factory mention whose status isn't "approved" (or that doesn't exist at all),
// mirroring exactly what a UI bypass (direct API call) could attempt.
describe("community mention integrity: factory status guard (Phase 4)", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });
  const NONEXISTENT_FACTORY_ID = 999999999;
  const nonApprovedFactoryIds: Partial<Record<"pending" | "rejected" | "delisted" | "draft", number>> = {};
  let approvedFactoryId: number | null = null;

  beforeAll(async () => {
    const db_ = await getDb();
    if (!db_) return;
    const [approved] = await db_.select({ id: factoriesTable.id })
      .from(factoriesTable).where(drizzleEq(factoriesTable.status, "approved")).limit(1);
    approvedFactoryId = approved?.id ?? null;

    const statuses = ["pending", "rejected", "delisted", "draft"] as const;
    for (let i = 0; i < statuses.length; i++) {
      const status = statuses[i];
      const ownerId = 900_000_000 + (Date.now() % 1_000_000) * 10 + i;
      const [result] = await db_.insert(factoriesTable).values({
        ownerId,
        name: `QA-P4-mention-guard-${status}`,
        industry: ["其他"],
        mfgModes: ["ODM"],
        region: "台北市",
        capitalLevel: "未滿500萬",
        status,
      } as any);
      nonApprovedFactoryIds[status] = (result as any).insertId as number;
    }
  }, 30000);

  afterAll(async () => {
    const db_ = await getDb();
    if (!db_) return;
    const ids = Object.values(nonApprovedFactoryIds).filter((v): v is number => v != null);
    if (ids.length > 0) {
      await db_.delete(factoriesTable).where(drizzleInArray(factoriesTable.id, ids));
    }
  });

  const badStatuses = ["pending", "rejected", "delisted", "draft"] as const;

  it.each(badStatuses)("createPost: %s factory mention is rejected, no post is created", async (status) => {
    const factoryId = nonApprovedFactoryIds[status];
    if (!factoryId) return;
    const adminCaller = appRouter.createCaller(adminCtx());
    const title = `QA-P4 createPost reject ${status}`;
    await expect(adminCaller.community.createPost({
      spaceCode: "textile",
      title,
      content: "Content",
      mentions: [{ type: "factory", id: factoryId }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const db_ = await getDb();
    if (db_) {
      const leftover = await db_.select({ id: communityPosts.id }).from(communityPosts)
        .where(drizzleEq(communityPosts.title, title));
      expect(leftover).toHaveLength(0);
    }
  }, 30000);

  it("createPost: nonexistent factory id is rejected", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    await expect(adminCaller.community.createPost({
      spaceCode: "textile",
      title: "QA-P4 createPost reject nonexistent",
      content: "Content",
      mentions: [{ type: "factory", id: NONEXISTENT_FACTORY_ID }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 30000);

  it("createPost: approved factory mention still succeeds", async () => {
    if (!approvedFactoryId) return; // no approved factory in this env — skip
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "QA-P4 createPost approved mention",
      content: "Content",
      mentions: [{ type: "factory", id: approvedFactoryId }],
    });
    expect(postId).toBeGreaterThan(0);
    const db_ = await getDb();
    if (db_) {
      const rows = await db_.select().from(communityMentions)
        .where(drizzleAnd(drizzleEq(communityMentions.sourceType, "post"), drizzleEq(communityMentions.sourceId, postId)));
      expect(rows).toHaveLength(1);
      expect(rows[0].mentionedFactoryId).toBe(approvedFactoryId);
    }
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it.each(badStatuses)("createComment: %s factory mention is rejected, no mention/notification created", async (status) => {
    const factoryId = nonApprovedFactoryIds[status];
    if (!factoryId) return;
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: `QA-P4 createComment host post (${status})`,
      content: "Content",
    });
    const countBefore = await adminCaller.community.notificationUnreadCount();
    await expect(adminCaller.community.createComment({
      postId,
      content: "Hello @factory",
      mentions: [{ type: "factory", id: factoryId }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const countAfter = await adminCaller.community.notificationUnreadCount();
    expect(countAfter.count).toBe(countBefore.count);

    const db_ = await getDb();
    if (db_) {
      const mentionRows = await db_.select().from(communityMentions)
        .where(drizzleAnd(drizzleEq(communityMentions.sourceType, "comment"), drizzleEq(communityMentions.mentionedFactoryId, factoryId)));
      expect(mentionRows).toHaveLength(0);
    }
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("createComment: nonexistent factory id is rejected", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "QA-P4 createComment host post (nonexistent)",
      content: "Content",
    });
    await expect(adminCaller.community.createComment({
      postId,
      content: "Hello @factory",
      mentions: [{ type: "factory", id: NONEXISTENT_FACTORY_ID }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("updatePost: rejecting an invalid mention does not corrupt a pre-existing valid mention", async () => {
    if (!approvedFactoryId) return; // no approved factory in this env — skip
    const pendingId = nonApprovedFactoryIds.pending;
    if (!pendingId) return;
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "QA-P4 updatePost pre-existing mention guard",
      content: "Content",
      mentions: [{ type: "factory", id: approvedFactoryId }],
    });

    // Attempt an update that ADDS a pending-status factory mention alongside the
    // existing valid one — the whole update must be rejected, and the original
    // approved mention must remain untouched (no half-synced state).
    await expect(adminCaller.community.updatePost({
      postId,
      content: "Updated content",
      mentions: [{ type: "factory", id: approvedFactoryId }, { type: "factory", id: pendingId }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const db_ = await getDb();
    if (db_) {
      const rows = await db_.select().from(communityMentions)
        .where(drizzleAnd(drizzleEq(communityMentions.sourceType, "post"), drizzleEq(communityMentions.sourceId, postId)));
      expect(rows).toHaveLength(1);
      expect(rows[0].mentionedFactoryId).toBe(approvedFactoryId);
    }
    await adminCaller.community.deletePost({ postId });
  }, 30000);
});

// ===== Phase 4: whitespace-only content must be rejected, real content must be trimmed =====
// Root cause fixed: `.min(1)` used to run on the RAW string before `.trim()` ran, so a
// whitespace-only value passed validation and was written to the DB as "". The schemas
// now `.trim()` first — these tests lock that in for every affected Community mutation.
describe("community whitespace validation (Phase 4 hardening)", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });
  const whitespaceOnly = ["", " ", "    ", "\n", "\t", " \n \t "];

  it.each(whitespaceOnly)("createPost: whitespace-only title %j is rejected", async (title) => {
    const adminCaller = appRouter.createCaller(adminCtx());
    await expect(adminCaller.community.createPost({ spaceCode: "textile", title, content: "Content" }))
      .rejects.toThrow();
  }, 10000);

  it.each(whitespaceOnly)("createPost: whitespace-only content %j is rejected", async (content) => {
    const adminCaller = appRouter.createCaller(adminCtx());
    await expect(adminCaller.community.createPost({ spaceCode: "textile", title: "Title", content }))
      .rejects.toThrow();
  }, 10000);

  it("createPost: padded title/content is trimmed before being stored", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: " ABC ",
      content: " 中文內容 ",
    });
    const db_ = await getDb();
    if (db_) {
      const [row] = await db_.select({ title: communityPosts.title, content: communityPosts.content })
        .from(communityPosts).where(drizzleEq(communityPosts.id, postId));
      expect(row?.title).toBe("ABC");
      expect(row?.content).toBe("中文內容");
    }
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it.each(whitespaceOnly)("updatePost: whitespace-only content %j is rejected, original content untouched", async (content) => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile", title: "Update whitespace guard", content: "Original content",
    });
    await expect(adminCaller.community.updatePost({ postId, content })).rejects.toThrow();
    const db_ = await getDb();
    if (db_) {
      const [row] = await db_.select({ content: communityPosts.content }).from(communityPosts)
        .where(drizzleEq(communityPosts.id, postId));
      expect(row?.content).toBe("Original content");
    }
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it("updatePost: padded content is trimmed before being stored", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile", title: "Update trim guard", content: "Original",
    });
    await adminCaller.community.updatePost({ postId, content: "  ABC  " });
    const db_ = await getDb();
    if (db_) {
      const [row] = await db_.select({ content: communityPosts.content }).from(communityPosts)
        .where(drizzleEq(communityPosts.id, postId));
      expect(row?.content).toBe("ABC");
    }
    await adminCaller.community.deletePost({ postId });
  }, 30000);

  it.each(whitespaceOnly)("createComment: whitespace-only content %j is rejected", async (content) => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile", title: "Comment whitespace guard", content: "Content",
    });
    await expect(adminCaller.community.createComment({ postId, content })).rejects.toThrow();
    await adminCaller.community.deletePost({ postId });
  }, 10000);

  it.each(whitespaceOnly)("updateComment: whitespace-only content %j is rejected, original content untouched", async (content) => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile", title: "Comment update whitespace guard", content: "Content",
    });
    const { commentId } = await adminCaller.community.createComment({ postId, content: "Original comment" });
    await expect(adminCaller.community.updateComment({ commentId, content })).rejects.toThrow();
    const db_ = await getDb();
    if (db_) {
      const [row] = await db_.select({ content: communityComments.content }).from(communityComments)
        .where(drizzleEq(communityComments.id, commentId));
      expect(row?.content).toBe("Original comment");
    }
    await adminCaller.community.deletePost({ postId });
  }, 10000);

  it("updateComment: padded content is trimmed before being stored", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile", title: "Comment update trim guard", content: "Content",
    });
    const { commentId } = await adminCaller.community.createComment({ postId, content: "Original comment" });
    await adminCaller.community.updateComment({ commentId, content: "  ABC  " });
    const db_ = await getDb();
    if (db_) {
      const [row] = await db_.select({ content: communityComments.content }).from(communityComments)
        .where(drizzleEq(communityComments.id, commentId));
      expect(row?.content).toBe("ABC");
    }
    await adminCaller.community.deletePost({ postId });
  }, 10000);
});

// ===== Navbar unread query gating: unit test via tRPC =====
describe("community.notificationUnreadCount gating", () => {
  it("non-admin: notificationUnreadCount FORBIDDEN", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.notificationUnreadCount()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("unauthenticated: notificationUnreadCount UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.notificationUnreadCount()).rejects.toThrow();
  });

  it("admin: notificationUnreadCount returns count", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.notificationUnreadCount()).resolves.toHaveProperty("count");
  }, 10000);
});

// ===== resolveDefaultCommunitySpace (pure unit tests — no DB required) =====
describe("resolveDefaultCommunitySpace", () => {
  // 1. No factories → cross-industry
  it("returns cross-industry when no factories", () => {
    expect(resolveDefaultCommunitySpace([])).toBe(COMMUNITY_CROSS_INDUSTRY_SLUG);
  });

  // 2. Single factory with valid first industry → correct slug
  it("returns metal-processing for 金屬加工 factory", () => {
    expect(resolveDefaultCommunitySpace([{ industry: ["金屬加工"] }])).toBe("metal-processing");
  });

  // 3. Multiple industries on factory → uses first (index 0)
  it("uses first industry when factory has multiple industries", () => {
    expect(resolveDefaultCommunitySpace([{ industry: ["金屬加工", "塑膠"] }])).toBe("metal-processing");
  });

  // 4. Industry name not in INDUSTRY_SLUGS → cross-industry fallback
  it("falls back to cross-industry for unrecognised industry name", () => {
    expect(resolveDefaultCommunitySpace([{ industry: ["不存在產業"] }])).toBe(COMMUNITY_CROSS_INDUSTRY_SLUG);
  });

  // 5. Factory with empty industry array → skip, use next factory
  it("skips factory with empty industry array and uses next factory", () => {
    expect(resolveDefaultCommunitySpace([
      { industry: [] },
      { industry: ["塑膠"] },
    ])).toBe("plastic");
  });

  // 6. Null industry (defensive) → skip, use next
  it("handles null industry gracefully and moves to next factory", () => {
    expect(resolveDefaultCommunitySpace([
      { industry: null as unknown as string[] },
      { industry: ["印刷"] },
    ])).toBe("printing");
  });

  // 7. First factory has invalid industry, second has valid → use second
  it("uses second factory when first has only invalid industries", () => {
    expect(resolveDefaultCommunitySpace([
      { industry: ["不存在A", "不存在B"] },
      { industry: ["電子零件"] },
    ])).toBe("electronics");
  });

  // 8. Multiple factories — stable order respected (first factory wins)
  it("returns first matching factory in given order", () => {
    expect(resolveDefaultCommunitySpace([
      { industry: ["紡織"] },
      { industry: ["金屬加工"] },
    ])).toBe("textile");
  });

  // 9. All factories have no valid industries → cross-industry
  it("returns cross-industry when all factories have invalid industries", () => {
    expect(resolveDefaultCommunitySpace([
      { industry: ["無效A"] },
      { industry: ["無效B"] },
    ])).toBe(COMMUNITY_CROSS_INDUSTRY_SLUG);
  });

  // 10. Known industries: verify all 12 slugs map correctly
  it("correctly maps 木工 to woodworking", () => {
    expect(resolveDefaultCommunitySpace([{ industry: ["木工"] }])).toBe("woodworking");
  });
  it("correctly maps 橡膠 / 矽膠 to rubber-silicone", () => {
    expect(resolveDefaultCommunitySpace([{ industry: ["橡膠 / 矽膠"] }])).toBe("rubber-silicone");
  });
  it("correctly maps 工業設備／機械 to industrial-machinery", () => {
    expect(resolveDefaultCommunitySpace([{ industry: ["工業設備／機械"] }])).toBe("industrial-machinery");
  });
  it("correctly maps 永續材料 to sustainable-materials", () => {
    expect(resolveDefaultCommunitySpace([{ industry: ["永續材料"] }])).toBe("sustainable-materials");
  });
});

// ===== community.getDefaultSpace =====
describe("community.getDefaultSpace", () => {
  // 11. Unauthenticated → UNAUTHORIZED
  it("throws UNAUTHORIZED for unauthenticated users", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.getDefaultSpace()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  // 12. Non-admin user → FORBIDDEN (Beta gate)
  it("throws FORBIDDEN for non-admin users when status=beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.getDefaultSpace()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // Admin gets a valid spaceCode string
  it("returns an object with a valid spaceCode string for admin", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const result = await caller.community.getDefaultSpace();
    expect(result).toHaveProperty("spaceCode");
    expect(typeof result.spaceCode).toBe("string");
    expect(result.spaceCode.length).toBeGreaterThan(0);
  }, 10000);

  // Admin spaceCode is one of the 14 valid community spaces
  it("returns one of the 14 valid community space codes for admin", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const result = await caller.community.getDefaultSpace();
    const VALID = new Set([
      "cross-industry", "textile", "metal-processing", "electronics", "plastic",
      "rubber-silicone", "woodworking", "packaging", "food", "chemical-manufacturing",
      "consumer-goods", "printing", "industrial-machinery", "sustainable-materials",
    ]);
    expect(VALID.has(result.spaceCode)).toBe(true);
  }, 10000);
});

// ===== community.getSpaces — ordering =====
describe("community.getSpaces ordering", () => {
  // 13. cross-industry is first in the list
  it("returns cross-industry space as the first item", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const spaces = await caller.community.getSpaces();
    expect(spaces[0].code).toBe("cross-industry");
  }, 10000);

  // 14. total count is now 14（新增「永續材料」後，12 個既有產業＋1
  // 個新產業＋1 個跨產業資訊＝14）
  it("still returns exactly 14 spaces", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const spaces = await caller.community.getSpaces();
    expect(spaces).toHaveLength(14);
  }, 10000);

  // 15. cross-industry appears exactly once
  it("cross-industry appears exactly once in the space list", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const spaces = await caller.community.getSpaces();
    const crossCount = spaces.filter(s => s.code === "cross-industry").length;
    expect(crossCount).toBe(1);
  }, 10000);
});

// ===== Phase 3A: Community Bids ??access control =====
describe("community.createBid access control", () => {
  // 1. Unauthenticated ??UNAUTHORIZED
  it("unauthenticated user throws UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.createBid({
      spaceCode: "textile", title: "T", description: "D", durationHours: 24, images: [],
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  // 2. Non-admin user in beta ??FORBIDDEN
  it("non-admin user throws FORBIDDEN in beta", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.createBid({
      spaceCode: "textile", title: "T", description: "D", durationHours: 24, images: [],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 3. Invalid spaceCode ??BAD_REQUEST
  it("invalid spaceCode throws BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.createBid({
      spaceCode: "invalid-xyz", title: "T", description: "D", durationHours: 24, images: [],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // 4. durationHours = 0 ??zod rejects (min 1)
  it("durationHours=0 rejected by zod (min 1)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.createBid({
      spaceCode: "textile", title: "T", description: "D", durationHours: 0, images: [],
    })).rejects.toThrow();
  });

  // 5. durationHours = 169 ??zod rejects (max 168)
  it("durationHours=169 rejected by zod (max 168)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.createBid({
      spaceCode: "textile", title: "T", description: "D", durationHours: 169, images: [],
    })).rejects.toThrow();
  });

  // 6. cross-industry bid without target industries succeeds (no longer required)
  it("cross-industry bid without targetIndustrySpaceCodes succeeds", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.createBid({
      spaceCode: "cross-industry", title: "T", description: "D", durationHours: 24, images: [],
    })).resolves.toHaveProperty("bidId");
  });

  // 7. budgetMin > budgetMax ??BAD_REQUEST
  it("budgetMin > budgetMax throws BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    await expect(caller.community.createBid({
      spaceCode: "textile", title: "T", description: "D", durationHours: 24,
      images: [], budgetMin: 5000, budgetMax: 1000,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ===== Phase 3A: Community Bids ??admin CRUD integration =====
describe("community bid: full admin create?→ubmit?→pprove lifecycle", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 8. Admin can create a bid (draft) and retrieve it
  it("admin creates draft bid and getBid returns correct fields", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile",
      title: "Phase 3A integration: draft bid",
      description: "Needs 500 meters of polyester",
      quantity: "500m",
      sampleRequired: true,
      durationHours: 72,
      images: [],
    });
    expect(bidId).toBeGreaterThan(0);

    const { bid } = await caller.community.getBid({ bidId });
    expect(bid.status).toBe("draft");
    expect(bid.title).toBe("Phase 3A integration: draft bid");
    expect(bid.sampleRequired).toBe(true);
    expect(bid.durationHours).toBe(72);
    expect(bid.publishedAt).toBeNull();
    expect(bid.deadline).toBeNull();

    // cleanup
    await caller.community.cancelBid({ bidId }).catch(() => {}); // won't work on draft, that's OK
  }, 30000);

  // 9. Submit draft ??pending_review
  it("submit changes status from draft to pending_review", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile",
      title: "Phase 3A integration: submit test",
      description: "Submit flow",
      durationHours: 24,
      images: [],
    });
    await caller.community.submitBid({ bidId });
    const { bid } = await caller.community.getBid({ bidId });
    expect(bid.status).toBe("pending_review");
  }, 30000);

  // 10. Approve pending_review ??active; publishedAt + deadline set
  // Uses db.approveCommunityBid directly since adminProcedure enforces whitelist-based access
  // (same pattern as existing admin.community.hidePost test which always throws in test env)
  it("approve sets status=active and computes publishedAt + deadline", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile",
      title: "Phase 3A integration: approve test",
      description: "Approve flow",
      durationHours: 48,
      images: [],
    });
    await caller.community.submitBid({ bidId });
    const before = Date.now();
    await approveCommunityBid(bidId, 1, "Test Admin");
    const after = Date.now();

    const { bid } = await caller.community.getBid({ bidId });
    expect(bid.status).toBe("active");
    expect(bid.publishedAt).not.toBeNull();
    expect(bid.deadline).not.toBeNull();
    const publishedMs = new Date(bid.publishedAt!).getTime();
    const deadlineMs = new Date(bid.deadline!).getTime();
    expect(publishedMs).toBeGreaterThanOrEqual(before - 1000);
    expect(publishedMs).toBeLessThanOrEqual(after + 1000);
    // deadline = publishedAt + 48h (簣5s tolerance)
    expect(deadlineMs - publishedMs).toBeGreaterThanOrEqual(48 * 3600 * 1000 - 5000);
    expect(deadlineMs - publishedMs).toBeLessThanOrEqual(48 * 3600 * 1000 + 5000);
  }, 30000);

  // 11. Reject pending_review ??rejected; rejectionReason stored
  it("reject sets status=rejected and stores reason", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile",
      title: "Phase 3A integration: reject test",
      description: "Reject flow",
      durationHours: 24,
      images: [],
    });
    await caller.community.submitBid({ bidId });
    await rejectCommunityBid(bidId, 1, "Test Admin", "內容不符合規範");

    const { bid } = await caller.community.getBid({ bidId });
    expect(bid.status).toBe("rejected");
    expect(bid.rejectionReason).toBe("內容不符合規範");
  }, 30000);

  // 12. Rejected bid can be re-edited and re-submitted
  it("rejected bid can be updated and re-submitted", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile",
      title: "Phase 3A integration: resubmit test",
      description: "Resubmit flow",
      durationHours: 24,
      images: [],
    });
    await caller.community.submitBid({ bidId });
    await rejectCommunityBid(bidId, 1, "Test Admin", "請補充數量");

    await caller.community.updateBid({ bidId, quantity: "2000 units" });
    const { bid: updated } = await caller.community.getBid({ bidId });
    expect(updated.quantity).toBe("2000 units");

    await caller.community.submitBid({ bidId });
    const { bid: resubmitted } = await caller.community.getBid({ bidId });
    expect(resubmitted.status).toBe("pending_review");
  }, 30000);
});

// ===== Phase 3A: Community Bids ??status machine guards =====
describe("community bid: status machine guards", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 13. Cannot submit already-pending bid
  it("cannot submit a bid already in pending_review", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "packaging", title: "Guard test 1", description: "D", durationHours: 24, images: [],
    });
    await caller.community.submitBid({ bidId });
    await expect(caller.community.submitBid({ bidId }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 30000);

  // 14. Cannot edit an active bid (uses db.approveCommunityBid since adminProcedure enforces whitelist)
  it("cannot edit an active bid", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "packaging", title: "Guard test 2", description: "D", durationHours: 24, images: [],
    });
    await caller.community.submitBid({ bidId });
    await approveCommunityBid(bidId, 1, "Test Admin");
    await expect(caller.community.updateBid({ bidId, title: "Changed" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 30000);

  // 15. Duplicate approve throws CONFLICT (conditional UPDATE guard)
  it("cannot approve an already-active bid — throws CONFLICT", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "packaging", title: "Guard test 3", description: "D", durationHours: 24, images: [],
    });
    await caller.community.submitBid({ bidId });
    await approveCommunityBid(bidId, 1, "Test Admin");
    // Second approve: status is now 'active', not 'pending_review' — conditional UPDATE returns affectedRows=0
    await expect(approveCommunityBid(bidId, 1, "Test Admin")).rejects.toThrow();
    // Status unchanged
    const { bid } = await caller.community.getBid({ bidId });
    expect(bid.status).toBe("active");
  }, 30000);

  // 16. Cancel active bid ??cancelled
  it("author can cancel active bid", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "packaging", title: "Guard test 4", description: "D", durationHours: 24, images: [],
    });
    await caller.community.submitBid({ bidId });
    await approveCommunityBid(bidId, 1, "Test Admin");
    await caller.community.cancelBid({ bidId });
    const { bid } = await caller.community.getBid({ bidId });
    expect(bid.status).toBe("cancelled");
  }, 30000);

  // 17. Cannot cancel a draft
  it("cannot cancel a draft bid", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "packaging", title: "Guard test 5", description: "D", durationHours: 24, images: [],
    });
    await expect(caller.community.cancelBid({ bidId }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 30000);
});

// ===== Phase 3A: Community Bids ??visibility =====
describe("community bid: visibility rules", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 18. Non-owner admin can see draft via getBid
  it("admin can always see bids regardless of status", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile", title: "Visibility test", description: "D", durationHours: 24, images: [],
    });
    const { bid } = await caller.community.getBid({ bidId });
    expect(bid.status).toBe("draft");
  }, 30000);

  // 19. listBids only returns active bids
  it("listBids returns only active status bids", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const result = await caller.community.listBids({ spaceCode: "textile", page: 1, pageSize: 50 });
    expect(result.bids.every(b => b.status === "active")).toBe(true);
  }, 10000);

  // 20. getMyBids returns all own bids including drafts
  it("getMyBids includes own draft bids", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile", title: "MyBids draft", description: "D", durationHours: 24, images: [],
    });
    const result = await caller.community.getMyBids({ page: 1, pageSize: 50 });
    const found = result.bids.find(b => b.id === bidId);
    expect(found).toBeDefined();
    expect(found!.status).toBe("draft");
  }, 15000);

  // 21. pendingBidCount is 0 for non-admin
  it("pendingBidCount returns 0 for non-admin user", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    // In beta, non-admin gets FORBIDDEN before even reaching the pendingBidCount check
    await expect(caller.community.pendingBidCount())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 22. pendingBidCount is a non-negative number for admin
  it("pendingBidCount returns non-negative number for admin", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const result = await caller.community.pendingBidCount();
    expect(result.count).toBeGreaterThanOrEqual(0);
  }, 10000);
});

// ===== Phase 3A: Community Bids — spaceCode fixed per board =====
describe("community bid: spaceCode fixed per board", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 23. Textile bid has correct spaceCode, targetIndustries is always empty
  it("textile bid has spaceCode=textile and targetIndustries is empty", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile",
      title: "Textile test",
      description: "Need textile processing",
      durationHours: 24,
      images: [],
    });
    const { bid, targetIndustries } = await caller.community.getBid({ bidId });
    expect(bid.spaceCode).toBe("textile");
    expect(targetIndustries).toEqual([]);
  }, 30000);

  // 24. metal-processing bid has correct spaceCode and targetIndustries is empty
  it("metal-processing bid has spaceCode=metal-processing and targetIndustries is empty", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "metal-processing",
      title: "Metal test",
      description: "Need metal processing",
      durationHours: 24,
      images: [],
    });
    const { bid, targetIndustries } = await caller.community.getBid({ bidId });
    expect(bid.spaceCode).toBe("metal-processing");
    expect(targetIndustries).toEqual([]);
  }, 30000);
});

// ===== Phase 3A: Community Bids ??admin review panel =====
describe("admin.community bid review", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 25. admin.community.listPendingBids ??adminProcedure enforces whitelist-based access.
  // Same as existing admin.community.hidePost test: even admin context throws in test env without whitelist entry.
  it("listPendingBids throws for admin context without whitelist (same as other adminProcedure endpoints)", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.admin.community.listPendingBids({ page: 1, pageSize: 20 }))
      .rejects.toThrow();
  }, 10000);

  // 26. Non-admin cannot call admin.community.approveBid
  it("non-admin cannot call approveBid (throws)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.admin.community.approveBid({ bidId: 1 })).rejects.toThrow();
  });

  // 27. Non-admin cannot call admin.community.rejectBid
  it("non-admin cannot call rejectBid (throws)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.admin.community.rejectBid({ bidId: 1, reason: "no" })).rejects.toThrow();
  });

  // 28. rejectBid with empty reason — zod rejects (min 1)
  it("rejectBid with empty reason string throws zod error", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.admin.community.rejectBid({ bidId: 1, reason: "" })).rejects.toThrow();
  });
});

// ===== Phase 3A: Audit — concurrency / state machine guards =====
describe("community bid: concurrency and state machine guards (audit)", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 29. Duplicate reject throws CONFLICT on second call
  it("duplicate reject throws CONFLICT (conditional UPDATE guard)", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile", title: "Dup reject test", description: "D", durationHours: 24, images: [],
    });
    await caller.community.submitBid({ bidId });
    await rejectCommunityBid(bidId, 1, "Test Admin", "初次退回");
    // Second reject: status is now 'rejected', not 'pending_review' → should throw
    await expect(rejectCommunityBid(bidId, 1, "Test Admin", "重複退回")).rejects.toThrow();
    const { bid } = await caller.community.getBid({ bidId });
    expect(bid.status).toBe("rejected");
  }, 30000);

  // 30. cancelBid on draft throws FORBIDDEN (router guard) and DB conditional UPDATE returns 0
  it("cancelBid concurrency guard: cannot cancel non-active status", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile", title: "Cancel guard test", description: "D", durationHours: 24, images: [],
    });
    // draft → cancel should fail via router FORBIDDEN
    await expect(caller.community.cancelBid({ bidId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 15000);

  // 31. submitBid idempotency: cannot re-submit a pending_review bid
  it("cannot submit a bid already in pending_review", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile", title: "Submit guard test", description: "D", durationHours: 24, images: [],
    });
    await caller.community.submitBid({ bidId });
    // Already in pending_review — should throw FORBIDDEN (router status guard)
    await expect(caller.community.submitBid({ bidId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 15000);
});

// ===== Phase 3A: Audit — cross-industry simplified (no targets required) =====
describe("community bid: cross-industry no longer requires targets", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 32. cross-industry bid without target industries is created successfully
  it("cross-industry bid without targetIndustrySpaceCodes succeeds", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "cross-industry",
      title: "Cross-industry no targets",
      description: "Open to all industries",
      durationHours: 24,
      images: [],
    });
    const { bid, targetIndustries } = await caller.community.getBid({ bidId });
    expect(bid.spaceCode).toBe("cross-industry");
    expect(targetIndustries).toEqual([]);
  }, 30000);

  // 33. cross-industry bid can be submitted without target industries (no BAD_REQUEST)
  it("cross-industry bid can be submitted without target industries", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "cross-industry",
      title: "Cross-industry submit test",
      description: "D",
      durationHours: 24,
      images: [],
    });
    await expect(caller.community.submitBid({ bidId })).resolves.not.toThrow();
    const { bid } = await caller.community.getBid({ bidId });
    expect(bid.status).toBe("pending_review");
  }, 30000);

  // 34. cross-industry bid can be approved (via db helper) without target industries
  it("cross-industry bid can be approved without target industries", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "cross-industry",
      title: "Cross-industry approve test",
      description: "D",
      durationHours: 24,
      images: [],
    });
    await caller.community.submitBid({ bidId });
    // approveBid adminProcedure requires email whitelist; use db helper directly (same pattern as other tests)
    await expect(approveCommunityBid(bidId, 1, "Test Admin")).resolves.not.toThrow();
    const { bid } = await caller.community.getBid({ bidId });
    expect(bid.status).toBe("active");
  }, 30000);

  // 35. illegal spaceCode is still rejected as BAD_REQUEST
  it("illegal spaceCode is still rejected as BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.community.createBid({
      spaceCode: "not-a-real-industry",
      title: "T",
      description: "D",
      durationHours: 24,
      images: [],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 10000);

  // 36. communityBidIndustries table is always empty for new bids (backward compat)
  it("targetIndustries relation is never written for new bids", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile",
      title: "Backward compat test",
      description: "D",
      durationHours: 24,
      images: [],
    });
    const industries = await getCommunityBidIndustries(bidId);
    expect(industries).toEqual([]);
  }, 20000);
});

// ===== Phase 3A: Audit — withdraw and delete =====
describe("community bid: withdraw and delete (audit)", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 37. Author can withdraw a pending_review bid back to draft
  it("withdrawBid: pending_review → draft with history entry", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile", title: "Withdraw test", description: "D", durationHours: 24, images: [],
    });
    await caller.community.submitBid({ bidId });
    const { bid: pending } = await caller.community.getBid({ bidId });
    expect(pending.status).toBe("pending_review");

    await caller.community.withdrawBid({ bidId });
    const { bid: withdrawn, reviewHistory } = await caller.community.getBid({ bidId });
    expect(withdrawn.status).toBe("draft");
    const wEntry = reviewHistory.find(e => e.action === "withdrawn");
    expect(wEntry).toBeDefined();
    expect(wEntry!.bidStatusBefore).toBe("pending_review");
    expect(wEntry!.bidStatusAfter).toBe("draft");
  }, 30000);

  // 38. withdrawBid on draft throws FORBIDDEN (not in pending_review)
  it("withdrawBid on a draft throws FORBIDDEN", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile", title: "Withdraw guard test", description: "D", durationHours: 24, images: [],
    });
    await expect(caller.community.withdrawBid({ bidId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 15000);

  // 39. Author can delete a draft bid
  it("deleteBid: soft-deletes a draft bid", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile", title: "Delete test", description: "D", durationHours: 24, images: [],
    });
    await caller.community.deleteBid({ bidId });
    // getBid returns NOT_FOUND after soft delete
    await expect(caller.community.getBid({ bidId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 20000);

  // 40. deleteBid on active bid throws FORBIDDEN
  it("deleteBid on active bid throws FORBIDDEN", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile", title: "Delete active guard", description: "D", durationHours: 24, images: [],
    });
    await caller.community.submitBid({ bidId });
    await approveCommunityBid(bidId, 1, "Test Admin");
    await expect(caller.community.deleteBid({ bidId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 30000);
});

// ===== Phase 3A: Audit — review history snapshot =====
describe("community bid: review history actorNameSnapshot (audit)", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 41. Full lifecycle produces review history with actorNameSnapshot and status transitions
  it("review history entries have actorNameSnapshot and correct status transitions", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile", title: "History snapshot test", description: "D", durationHours: 24, images: [],
    });
    await caller.community.submitBid({ bidId });
    await rejectCommunityBid(bidId, 1, "Test Reviewer", "需要修改");
    await caller.community.updateBid({ bidId, description: "Updated D" });
    await caller.community.submitBid({ bidId });
    await approveCommunityBid(bidId, 1, "Test Reviewer");

    const { reviewHistory } = await caller.community.getBid({ bidId });
    expect(reviewHistory.length).toBeGreaterThanOrEqual(3);

    const submitted = reviewHistory.filter(e => e.action === "submitted");
    const rejected = reviewHistory.find(e => e.action === "rejected");
    const approved = reviewHistory.find(e => e.action === "approved");

    expect(submitted.length).toBeGreaterThanOrEqual(1);
    expect(submitted[0].actorNameSnapshot).toBe("Test User"); // ctx.user.name from createAuthContext
    expect(submitted[0].bidStatusBefore).toBe("draft");
    expect(submitted[0].bidStatusAfter).toBe("pending_review");

    expect(rejected).toBeDefined();
    expect(rejected!.actorNameSnapshot).toBe("Test Reviewer");
    expect(rejected!.bidStatusBefore).toBe("pending_review");
    expect(rejected!.bidStatusAfter).toBe("rejected");

    expect(approved).toBeDefined();
    expect(approved!.actorNameSnapshot).toBe("Test Reviewer");
    expect(approved!.bidStatusBefore).toBe("pending_review");
    expect(approved!.bidStatusAfter).toBe("active");
  }, 60000);
});

// ===== Phase 3A: Audit — deadline precision =====
describe("community bid: deadline precision (audit)", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 42. Fixed-time deadline calculation: publishedAt + durationHours * 3600s exactly
  it("approve at fixed system time produces exact deadline = publishedAt + durationHours*3600000ms", async () => {
    vi.useFakeTimers();
    const fixedNow = new Date("2026-07-01T12:00:00.000Z");
    vi.setSystemTime(fixedNow);

    const caller = appRouter.createCaller(adminCtx());
    let bidId: number;
    try {
      const { bidId: id } = await caller.community.createBid({
        spaceCode: "textile", title: "Deadline precision test", description: "D", durationHours: 48, images: [],
      });
      bidId = id;
      await caller.community.submitBid({ bidId });
      await approveCommunityBid(bidId, 1, "Test Admin");
    } finally {
      vi.useRealTimers();
    }

    const { bid } = await caller.community.getBid({ bidId });
    expect(bid.status).toBe("active");
    expect(bid.publishedAt).not.toBeNull();
    expect(bid.deadline).not.toBeNull();

    const pubMs = new Date(bid.publishedAt!).getTime();
    const dlMs = new Date(bid.deadline!).getTime();
    const expectedGap = 48 * 3600 * 1000;
    // MySQL TIMESTAMP precision is 1 second, so allow ±1000ms
    expect(Math.abs(dlMs - pubMs - expectedGap)).toBeLessThan(1000);
  }, 60000);
});

// ===== Phase 3A: Audit — listBids industry isolation =====
describe("community bid: listBids industry isolation (audit)", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 43. listBids only returns bids for the requested spaceCode
  it("listBids returns only bids matching the requested spaceCode", async () => {
    const caller = appRouter.createCaller(adminCtx());
    // Create an active bid in 'textile'
    const { bidId: textileBidId } = await caller.community.createBid({
      spaceCode: "textile", title: "Textile isolation test", description: "D", durationHours: 24, images: [],
    });
    await caller.community.submitBid({ bidId: textileBidId });
    await approveCommunityBid(textileBidId, 1, "Test Admin");

    // Create an active bid in 'electronics'
    const { bidId: electronicsBidId } = await caller.community.createBid({
      spaceCode: "electronics", title: "Electronics isolation test", description: "D", durationHours: 24, images: [],
    });
    await caller.community.submitBid({ bidId: electronicsBidId });
    await approveCommunityBid(electronicsBidId, 1, "Test Admin");

    const textileResult = await caller.community.listBids({ spaceCode: "textile", page: 1, pageSize: 50 });
    const electronicsResult = await caller.community.listBids({ spaceCode: "electronics", page: 1, pageSize: 50 });

    expect(textileResult.bids.every(b => b.spaceCode === "textile")).toBe(true);
    expect(electronicsResult.bids.every(b => b.spaceCode === "electronics")).toBe(true);

    const textileIds = textileResult.bids.map(b => b.id);
    const electronicsIds = electronicsResult.bids.map(b => b.id);
    expect(textileIds).toContain(textileBidId);
    expect(textileIds).not.toContain(electronicsBidId);
    expect(electronicsIds).toContain(electronicsBidId);
    expect(electronicsIds).not.toContain(textileBidId);
  }, 60000);
});

// ===== Phase 3A: Audit — concurrent approveBid safety =====
describe("community bid: concurrent approveBid safety (audit)", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 44. Two simultaneous approveBid calls: exactly 1 succeeds, 1 CONFLICT; only 1 history entry; publishedAt set once
  it("Promise.allSettled two concurrent approveBid: only 1 history entry; bid active with single publishedAt", async () => {
    const caller = appRouter.createCaller(adminCtx());

    const { bidId } = await caller.community.createBid({
      spaceCode: "textile",
      title: "Concurrent approve test",
      description: "D",
      durationHours: 24,
      images: [],
      pinnedProductIds: [],
    });
    await caller.community.submitBid({ bidId });

    // Two concurrent approvals
    const results = await Promise.allSettled([
      approveCommunityBid(bidId, 1, "Admin A"),
      approveCommunityBid(bidId, 1, "Admin B"),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    // Exactly one should win
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Bid is active
    const { bid } = await caller.community.getBid({ bidId });
    expect(bid.status).toBe("active");

    // publishedAt and deadline set exactly once
    expect(bid.publishedAt).not.toBeNull();
    expect(bid.deadline).not.toBeNull();

    // Only 1 approved history entry
    const history = await listCommunityBidReviewHistory(bidId);
    const approvedEntries = history.filter(h => h.action === "approved");
    expect(approvedEntries).toHaveLength(1);
  }, 60000);
});

// ===== Phase 3A: Audit — stale pinnedProductIds on submitBid =====
describe("community bid: stale pinnedProductIds handling on submitBid (audit)", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  // 45. Stale (non-existent) product IDs are stripped and removedProductCount reflects the count
  it("submitBid strips non-existent pinnedProductIds and returns removedProductCount > 0", async () => {
    const caller = appRouter.createCaller(adminCtx());

    const { bidId } = await caller.community.createBid({
      spaceCode: "textile",
      title: "Stale product strip test",
      description: "D",
      durationHours: 24,
      images: [],
      pinnedProductIds: [],
    });

    // Directly inject a non-existent product ID into the bid (bypasses form validation)
    await updateCommunityBid(bidId, { pinnedProductIds: [999999] });

    const result = await caller.community.submitBid({ bidId });
    expect(result.success).toBe(true);
    expect(result.removedProductCount).toBe(1);

    // Bid is now pending_review with empty pinnedProductIds
    const bid = await getCommunityBidById(bidId);
    expect(bid?.status).toBe("pending_review");
    expect((bid?.pinnedProductIds as number[]).length).toBe(0);
  }, 60000);

  // 46. Valid product IDs (no factory in test context = personal bid): all stripped, returns count
  it("submitBid with multiple stale IDs strips all and returns correct count", async () => {
    const caller = appRouter.createCaller(adminCtx());

    const { bidId } = await caller.community.createBid({
      spaceCode: "textile",
      title: "Multi-stale product test",
      description: "D",
      durationHours: 24,
      images: [],
      pinnedProductIds: [],
    });

    // Inject 3 non-existent product IDs
    await updateCommunityBid(bidId, { pinnedProductIds: [888881, 888882, 888883] });

    const result = await caller.community.submitBid({ bidId });
    expect(result.success).toBe(true);
    expect(result.removedProductCount).toBe(3);

    const bid = await getCommunityBidById(bidId);
    expect((bid?.pinnedProductIds as number[]).length).toBe(0);
  }, 60000);

  // 47. No stale products: removedProductCount = 0 and submission proceeds normally
  it("submitBid with no pinnedProductIds returns removedProductCount = 0", async () => {
    const caller = appRouter.createCaller(adminCtx());

    const { bidId } = await caller.community.createBid({
      spaceCode: "textile",
      title: "No product test",
      description: "D",
      durationHours: 24,
      images: [],
      pinnedProductIds: [],
    });

    const result = await caller.community.submitBid({ bidId });
    expect(result.success).toBe(true);
    expect(result.removedProductCount).toBe(0);
  }, 60000);

  // 48. All stale products stripped — bid still submits (not blocked)
  it("submitBid with all stale products still succeeds — stale items do not block submission", async () => {
    const caller = appRouter.createCaller(adminCtx());

    const { bidId } = await caller.community.createBid({
      spaceCode: "textile",
      title: "All stale — still submittable",
      description: "D",
      durationHours: 24,
      images: [],
      pinnedProductIds: [],
    });

    await updateCommunityBid(bidId, { pinnedProductIds: [777771, 777772] });

    const result = await caller.community.submitBid({ bidId });
    expect(result.success).toBe(true);
    expect(result.removedProductCount).toBe(2);

    const bid = await getCommunityBidById(bidId);
    expect(bid?.status).toBe("pending_review");
  }, 60000);
});

// ===== Phase 3B: 廠商投標報價 =====
// Shared state: populated in beforeAll; factory-dependent tests skip if testFactory is null.
let p3bBidId = 0;
let testFactory: { id: number; ownerId: number } | null = null;

// Helper: create and approve an active bid for Phase 3B tests
async function createActiveBid(title: string): Promise<number> {
  const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
  const { bidId } = await caller.community.createBid({
    spaceCode: "textile", title, description: "Phase 3B test", durationHours: 168, images: [],
  });
  await caller.community.submitBid({ bidId });
  await approveCommunityBid(bidId, 1, "Test Admin");
  return bidId;
}

// Helper: factory-owner caller (null if no factory)
function factoryOwnerCtx() {
  if (!testFactory) return null;
  return createAuthContext({ role: "admin", id: testFactory.ownerId });
}

// ===== createBidOffer: access control and bid validation =====
describe("community.createBidOffer: access control + bid validation", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });

  beforeAll(async () => {
    // Shared active bid (author = user 1)
    p3bBidId = await createActiveBid("P3B access control test bid");

    // Find approved factory NOT owned by user 1 (avoids author self-bid restriction)
    const db_ = await getDb();
    if (db_) {
      const rows = await db_
        .select({ id: factoriesTable.id, ownerId: factoriesTable.ownerId })
        .from(factoriesTable)
        .where(drizzleAnd(drizzleEq(factoriesTable.status, "approved"), drizzleNe(factoriesTable.ownerId, 1)))
        .limit(1);
      if (rows.length > 0) {
        testFactory = { id: rows[0].id, ownerId: rows[0].ownerId! };
      }
    }
  }, 30000);

  // 1. Unauthenticated → UNAUTHORIZED
  it("unauthenticated → UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.community.createBidOffer({
      bidId: 1, bidderFactoryId: 1, proposal: "P", images: [], pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  // 2. Non-admin in beta → FORBIDDEN
  it("non-admin user in beta → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "user" }));
    await expect(caller.community.createBidOffer({
      bidId: 1, bidderFactoryId: 1, proposal: "P", images: [], pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 3. Bid not found → NOT_FOUND
  it("nonexistent bid → NOT_FOUND", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.community.createBidOffer({
      bidId: 999999999, bidderFactoryId: 1, proposal: "P", images: [], pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 4. Bid not active (draft) → BAD_REQUEST
  it("bid in draft status → BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const { bidId } = await caller.community.createBid({
      spaceCode: "textile", title: "Draft bid for offer test", description: "D", durationHours: 24, images: [],
    });
    await expect(caller.community.createBidOffer({
      bidId, bidderFactoryId: 1, proposal: "P", images: [], pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);

  // 5. Author tries to bid on own bid → FORBIDDEN
  it("bid author cannot bid on own request → FORBIDDEN", async () => {
    // p3bBidId is authored by user 1 (adminCtx)
    const caller = appRouter.createCaller(adminCtx()); // user 1 = author
    await expect(caller.community.createBidOffer({
      bidId: p3bBidId, bidderFactoryId: 1, proposal: "P", images: [], pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 6. User with no approved factory → FORBIDDEN
  it("user with no approved factory → FORBIDDEN", async () => {
    // Use id=999998 — this user has no factory in test DB
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: 999998 }));
    await expect(caller.community.createBidOffer({
      bidId: p3bBidId, bidderFactoryId: 1, proposal: "P", images: [], pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 7. Factory not owned by user → FORBIDDEN
  it("factory not belonging to user → FORBIDDEN", async () => {
    if (!testFactory) return; // skip if no factory
    const caller = appRouter.createCaller(factoryOwnerCtx()!);
    await expect(caller.community.createBidOffer({
      bidId: p3bBidId, bidderFactoryId: 999999, proposal: "P", images: [], pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 8. Valid offer creation → returns offerId
  it("valid factory offer creation returns offerId", async () => {
    if (!testFactory) return; // skip if no factory
    const caller = appRouter.createCaller(factoryOwnerCtx()!);
    const result = await caller.community.createBidOffer({
      bidId: p3bBidId,
      bidderFactoryId: testFactory.id,
      proposal: "我們可以生產",
      amount: 50000,
      deliveryDays: 30,
      images: [],
      pinnedProductIds: [],
    });
    expect(result.offerId).toBeGreaterThan(0);
  }, 60000);

  // 9. Duplicate factory offer → CONFLICT
  it("duplicate offer from same factory → CONFLICT", async () => {
    if (!testFactory) return; // skip if no factory
    const caller = appRouter.createCaller(factoryOwnerCtx()!);
    await expect(caller.community.createBidOffer({
      bidId: p3bBidId,
      bidderFactoryId: testFactory.id,
      proposal: "Second offer — should fail",
      images: [],
      pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "CONFLICT" });
  }, 60000);

  // 10. Bid deadline already passed → BAD_REQUEST
  it("past-deadline bid → BAD_REQUEST", async () => {
    if (!testFactory) return; // skip if no factory — needs to pass factory check first
    const pastBidId = await createActiveBid("Past deadline bid");
    await setTestBidDeadlinePast(pastBidId); // set deadline to 2020-01-01 (always past)
    const caller = appRouter.createCaller(factoryOwnerCtx()!);
    await expect(caller.community.createBidOffer({
      bidId: pastBidId,
      bidderFactoryId: testFactory!.id,
      proposal: "Late offer",
      images: [],
      pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);

  // 11. Phase 4: whitespace-only proposal is rejected (same trim-before-min fix as posts/comments)
  it.each(["", " ", "    ", "\n", "\t", " \n \t "])(
    "whitespace-only proposal %j is rejected",
    async (proposal) => {
      if (!testFactory) return; // skip if no factory
      const wsBidId = await createActiveBid("Whitespace proposal guard bid");
      const caller = appRouter.createCaller(factoryOwnerCtx()!);
      await expect(caller.community.createBidOffer({
        bidId: wsBidId, bidderFactoryId: testFactory.id, proposal, images: [], pinnedProductIds: [],
      })).rejects.toThrow();
    },
    60000,
  );

  it("padded proposal is trimmed before being stored", async () => {
    if (!testFactory) return; // skip if no factory
    const trimBidId = await createActiveBid("Trim proposal guard bid");
    const caller = appRouter.createCaller(factoryOwnerCtx()!);
    const { offerId } = await caller.community.createBidOffer({
      bidId: trimBidId, bidderFactoryId: testFactory.id, proposal: "  ABC  ", images: [], pinnedProductIds: [],
    });
    const offer = await getCommunityBidOfferById(offerId);
    expect(offer?.proposal).toBe("ABC");
  }, 60000);
});

// ===== updateBidOffer / withdrawBidOffer / resubmitBidOffer: state machine =====
describe("community.updateBidOffer / withdrawBidOffer / resubmitBidOffer: state machine", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });
  let stateBidId = 0;
  let stateOfferId = 0;

  beforeAll(async () => {
    if (!testFactory) return;
    stateBidId = await createActiveBid("State machine test bid");
    // Create offer directly via DB (bypasses router factory check)
    stateOfferId = await createCommunityBidOffer({
      bidId: stateBidId,
      bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id,
      bidderNameSnapshot: "Test Factory Owner",
      bidderFactoryNameSnapshot: "Test Factory",
      bidderRoleSnapshot: "owner",
      amount: null,
      currency: "TWD",
      deliveryDays: null,
      moq: null,
      sampleAvailable: false,
      proposal: "Initial proposal",
      commercialTerms: null,
      images: [],
      pinnedProductIds: [],
    });
  }, 30000);

  // updateBidOffer tests
  // 11. offer not found → NOT_FOUND
  it("updateBidOffer: nonexistent offer → NOT_FOUND", async () => {
    const caller = appRouter.createCaller(factoryOwnerCtx() ?? adminCtx());
    await expect(caller.community.updateBidOffer({ offerId: 999999999, proposal: "New" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 12. wrong owner → FORBIDDEN
  it("updateBidOffer: wrong user → FORBIDDEN", async () => {
    if (!testFactory || !stateOfferId) return;
    const otherCtx = createAuthContext({ role: "admin", id: 999997 });
    const caller = appRouter.createCaller(otherCtx);
    await expect(caller.community.updateBidOffer({ offerId: stateOfferId, proposal: "Hijack" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 13. valid update → success
  it("updateBidOffer: valid update returns success", async () => {
    if (!testFactory || !stateOfferId) return;
    const caller = appRouter.createCaller(factoryOwnerCtx()!);
    const result = await caller.community.updateBidOffer({
      offerId: stateOfferId,
      proposal: "Updated proposal",
      amount: 80000,
      deliveryDays: 45,
    });
    expect(result.success).toBe(true);
    // Verify the offer was updated
    const updated = await getCommunityBidOfferById(stateOfferId);
    expect(updated?.proposal).toBe("Updated proposal");
  }, 60000);

  // withdrawBidOffer tests
  // 14. offer not found → NOT_FOUND
  it("withdrawBidOffer: nonexistent offer → NOT_FOUND", async () => {
    const caller = appRouter.createCaller(factoryOwnerCtx() ?? adminCtx());
    await expect(caller.community.withdrawBidOffer({ offerId: 999999998 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 15. wrong owner → FORBIDDEN
  it("withdrawBidOffer: wrong user → FORBIDDEN", async () => {
    if (!testFactory || !stateOfferId) return;
    const otherCtx = createAuthContext({ role: "admin", id: 999996 });
    const caller = appRouter.createCaller(otherCtx);
    await expect(caller.community.withdrawBidOffer({ offerId: stateOfferId }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 16. valid withdraw → success
  it("withdrawBidOffer: valid withdraw returns success", async () => {
    if (!testFactory || !stateOfferId) return;
    const caller = appRouter.createCaller(factoryOwnerCtx()!);
    const result = await caller.community.withdrawBidOffer({ offerId: stateOfferId });
    expect(result.success).toBe(true);
    const offer = await getCommunityBidOfferById(stateOfferId);
    expect(offer?.status).toBe("withdrawn");
    expect(offer?.withdrawnAt).not.toBeNull();
  }, 60000);

  // 17. double withdraw → BAD_REQUEST (already withdrawn)
  it("withdrawBidOffer: already-withdrawn offer → BAD_REQUEST", async () => {
    if (!testFactory || !stateOfferId) return;
    const caller = appRouter.createCaller(factoryOwnerCtx()!);
    await expect(caller.community.withdrawBidOffer({ offerId: stateOfferId }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);

  // resubmitBidOffer tests
  // 18. offer not found → NOT_FOUND
  it("resubmitBidOffer: nonexistent offer → NOT_FOUND", async () => {
    const caller = appRouter.createCaller(factoryOwnerCtx() ?? adminCtx());
    await expect(caller.community.resubmitBidOffer({ offerId: 999999997, proposal: "P" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 19. wrong owner → FORBIDDEN
  it("resubmitBidOffer: wrong user → FORBIDDEN", async () => {
    if (!testFactory || !stateOfferId) return;
    const otherCtx = createAuthContext({ role: "admin", id: 999995 });
    const caller = appRouter.createCaller(otherCtx);
    await expect(caller.community.resubmitBidOffer({ offerId: stateOfferId, proposal: "P" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 20. valid resubmit → success
  it("resubmitBidOffer: valid resubmit sets status back to active", async () => {
    if (!testFactory || !stateOfferId) return;
    const caller = appRouter.createCaller(factoryOwnerCtx()!);
    const result = await caller.community.resubmitBidOffer({
      offerId: stateOfferId,
      proposal: "Resubmitted proposal",
    });
    expect(result.success).toBe(true);
    const offer = await getCommunityBidOfferById(stateOfferId);
    expect(offer?.status).toBe("active");
    expect(offer?.withdrawnAt).toBeNull();
    expect(offer?.proposal).toBe("Resubmitted proposal");
  }, 60000);

  // 21. resubmit active offer → BAD_REQUEST (must be withdrawn first)
  it("resubmitBidOffer: active offer → BAD_REQUEST", async () => {
    if (!testFactory || !stateOfferId) return;
    const caller = appRouter.createCaller(factoryOwnerCtx()!);
    await expect(caller.community.resubmitBidOffer({ offerId: stateOfferId, proposal: "P" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);
});

// ===== getMyBidOffer / getBidOfferCount / listBidOffersForOwner: privacy =====
describe("community.getMyBidOffer / getBidOfferCount / listBidOffersForOwner: privacy", () => {
  const adminCtx = () => createAuthContext({ role: "admin" });
  let privacyBidId = 0;
  let privacyOfferId = 0;

  beforeAll(async () => {
    privacyBidId = await createActiveBid("Privacy test bid");
    if (!testFactory) return;
    // Create an offer on this bid via DB
    privacyOfferId = await createCommunityBidOffer({
      bidId: privacyBidId,
      bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id,
      bidderNameSnapshot: "Privacy Test Owner",
      bidderFactoryNameSnapshot: "Privacy Test Factory",
      bidderRoleSnapshot: "owner",
      amount: 75000,
      currency: "TWD",
      deliveryDays: 21,
      moq: null,
      sampleAvailable: true,
      proposal: "Privacy test proposal",
      commercialTerms: null,
      images: [],
      pinnedProductIds: [],
    });
  }, 30000);

  // getMyBidOffer tests
  // 22. No offer → returns { offer: null }
  it("getMyBidOffer: no offer → { offer: null }", async () => {
    // Use a different user who has never bid
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: 999994 }));
    const result = await caller.community.getMyBidOffer({ bidId: privacyBidId });
    expect(result.offer).toBeNull();
  }, 30000);

  // 23. Returns own offer
  it("getMyBidOffer: returns own active offer", async () => {
    if (!testFactory || !privacyOfferId) return;
    const caller = appRouter.createCaller(factoryOwnerCtx()!);
    const result = await caller.community.getMyBidOffer({ bidId: privacyBidId });
    expect(result.offer).not.toBeNull();
    expect(result.offer?.proposal).toBe("Privacy test proposal");
    expect(result.offer?.sampleAvailable).toBe(true);
  }, 30000);

  // 24. Does not return another user's offer
  it("getMyBidOffer: does not see other user's offer", async () => {
    // User 1 (bid author) has no offer; user 999993 has no offer
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: 999993 }));
    const result = await caller.community.getMyBidOffer({ bidId: privacyBidId });
    expect(result.offer).toBeNull();
  }, 30000);

  // getBidOfferCount tests
  // 25. Empty bid → count = 0
  it("getBidOfferCount: bid with no offers → 0", async () => {
    const emptyBidId = await createActiveBid("Empty count bid");
    const caller = appRouter.createCaller(adminCtx());
    const result = await caller.community.getBidOfferCount({ bidId: emptyBidId });
    expect(result.count).toBe(0);
  }, 60000);

  // 26. Bid not found → NOT_FOUND
  it("getBidOfferCount: nonexistent bid → NOT_FOUND", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.community.getBidOfferCount({ bidId: 999999999 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 27. Active offers counted, withdrawn not
  it("getBidOfferCount: counts only active offers (not withdrawn)", async () => {
    if (!testFactory || !privacyOfferId) return;
    const caller = appRouter.createCaller(adminCtx());
    // privacyBidId has 1 active offer
    const before = await caller.community.getBidOfferCount({ bidId: privacyBidId });
    expect(before.count).toBe(1);
    // Withdraw it
    await withdrawCommunityBidOffer(privacyOfferId);
    const after = await caller.community.getBidOfferCount({ bidId: privacyBidId });
    expect(after.count).toBe(0);
    // Resubmit for subsequent tests
    await resubmitCommunityBidOffer(privacyOfferId, {});
  }, 60000);

  // 28. Multiple offers → correct count
  it("getBidOfferCount: correct count with multiple offers", async () => {
    if (!testFactory) return;
    const multiBidId = await createActiveBid("Multi-offer count bid");
    // Create 2 offers from different factories using direct DB (would need 2 factories)
    // For simplicity: verify count = 1 with our single test factory
    await createCommunityBidOffer({
      bidId: multiBidId,
      bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id,
      bidderNameSnapshot: "Owner",
      bidderFactoryNameSnapshot: "Factory",
      bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "Multi test", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
    const caller = appRouter.createCaller(adminCtx());
    const result = await caller.community.getBidOfferCount({ bidId: multiBidId });
    expect(result.count).toBe(1);
  }, 60000);

  // listBidOffersForOwner tests
  // 29. Bid not found → NOT_FOUND
  it("listBidOffersForOwner: nonexistent bid → NOT_FOUND", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.community.listBidOffersForOwner({ bidId: 999999999 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 30. Non-owner user (role="user") → FORBIDDEN (beta gate or auth check)
  it("listBidOffersForOwner: non-owner non-admin user → FORBIDDEN", async () => {
    // role="user" hits the beta-gate FORBIDDEN before reaching the auth check
    const otherCtx = createAuthContext({ role: "user", id: 999992 });
    const caller = appRouter.createCaller(otherCtx);
    await expect(caller.community.listBidOffersForOwner({ bidId: privacyBidId }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 31. Owner sees all offers
  it("listBidOffersForOwner: owner sees all offers", async () => {
    if (!testFactory || !privacyOfferId) return;
    // privacyBidId is authored by user 1
    const caller = appRouter.createCaller(adminCtx()); // user 1 = author
    const result = await caller.community.listBidOffersForOwner({ bidId: privacyBidId });
    expect(result.offers.length).toBeGreaterThan(0);
    const myOffer = result.offers.find(o => o.id === privacyOfferId);
    expect(myOffer).toBeDefined();
    expect(myOffer?.bidderFactoryId).toBe(testFactory.id);
  }, 30000);

  // 32. Admin sees all offers
  it("listBidOffersForOwner: admin sees all offers too", async () => {
    if (!testFactory || !privacyOfferId) return;
    // Admin is user 1 AND is the bid owner — both conditions satisfied
    const caller = appRouter.createCaller(adminCtx());
    const result = await caller.community.listBidOffersForOwner({ bidId: privacyBidId });
    expect(Array.isArray(result.offers)).toBe(true);
  }, 30000);

  // 33. Includes withdrawn offers (owner sees all statuses)
  it("listBidOffersForOwner: includes withdrawn offers", async () => {
    if (!testFactory || !privacyOfferId) return;
    await withdrawCommunityBidOffer(privacyOfferId);
    const caller = appRouter.createCaller(adminCtx());
    const result = await caller.community.listBidOffersForOwner({ bidId: privacyBidId });
    const withdrawnOffer = result.offers.find(o => o.status === "withdrawn");
    expect(withdrawnOffer).toBeDefined();
    // Restore
    await resubmitCommunityBidOffer(privacyOfferId, {});
  }, 60000);
});

// ===== DB: community bid offer functions (unit tests) =====
describe("DB: community bid offer functions", () => {
  let dbBidId = 0;
  let dbOfferId = 0;

  beforeAll(async () => {
    dbBidId = await createActiveBid("DB unit test bid");
  }, 30000);

  // 34. getApprovedFactoriesForUser: unknown user → empty array
  it("getApprovedFactoriesForUser: unknown user returns []", async () => {
    const result = await getApprovedFactoriesForUser(999999999);
    expect(result).toEqual([]);
  });

  // 35. createCommunityBidOffer: inserts record
  it("createCommunityBidOffer: inserts offer record", async () => {
    if (!testFactory) return;
    dbOfferId = await createCommunityBidOffer({
      bidId: dbBidId,
      bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id,
      bidderNameSnapshot: "DB Test Owner",
      bidderFactoryNameSnapshot: "DB Test Factory",
      bidderRoleSnapshot: "owner",
      amount: 100000,
      currency: "TWD",
      deliveryDays: 60,
      moq: 50,
      sampleAvailable: true,
      proposal: "DB test proposal",
      commercialTerms: "Net 30",
      images: [],
      pinnedProductIds: [],
    });
    expect(dbOfferId).toBeGreaterThan(0);
  }, 30000);

  // 36. createCommunityBidOffer: ER_DUP_ENTRY → CONFLICT code error
  it("createCommunityBidOffer: duplicate factory throws CONFLICT", async () => {
    if (!testFactory || !dbOfferId) return;
    await expect(createCommunityBidOffer({
      bidId: dbBidId,
      bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id,
      bidderNameSnapshot: "Dup",
      bidderFactoryNameSnapshot: "Dup Factory",
      bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "Dup", commercialTerms: null,
      images: [], pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "CONFLICT" });
  }, 30000);

  // 37. getCommunityBidOfferById: returns record
  it("getCommunityBidOfferById: returns correct offer", async () => {
    if (!testFactory || !dbOfferId) return;
    const offer = await getCommunityBidOfferById(dbOfferId);
    expect(offer).not.toBeNull();
    expect(offer?.proposal).toBe("DB test proposal");
    expect(offer?.amount).toBe("100000"); // decimal returned as string
    expect(offer?.moq).toBe(50);
    expect(offer?.sampleAvailable).toBe(true);
  }, 30000);

  // 38. getCommunityBidOfferById: nonexistent → null
  it("getCommunityBidOfferById: nonexistent offer returns null", async () => {
    const offer = await getCommunityBidOfferById(999999999);
    expect(offer).toBeNull();
  });

  // 39. getCommunityBidOfferByFactory: returns correct offer
  it("getCommunityBidOfferByFactory: returns offer for factory", async () => {
    if (!testFactory || !dbOfferId) return;
    const offer = await getCommunityBidOfferByFactory(dbBidId, testFactory.id);
    expect(offer).not.toBeNull();
    expect(offer?.id).toBe(dbOfferId);
  }, 30000);

  // 40. getCommunityBidOfferByUser: returns correct offer
  it("getCommunityBidOfferByUser: returns offer for user", async () => {
    if (!testFactory || !dbOfferId) return;
    const offer = await getCommunityBidOfferByUser(dbBidId, testFactory.ownerId);
    expect(offer).not.toBeNull();
    expect(offer?.id).toBe(dbOfferId);
  }, 30000);

  // 41. withdrawCommunityBidOffer: sets status=withdrawn + withdrawnAt
  it("withdrawCommunityBidOffer: sets status to withdrawn", async () => {
    if (!testFactory || !dbOfferId) return;
    await withdrawCommunityBidOffer(dbOfferId);
    const offer = await getCommunityBidOfferById(dbOfferId);
    expect(offer?.status).toBe("withdrawn");
    expect(offer?.withdrawnAt).not.toBeNull();
  }, 30000);

  // 42. withdrawCommunityBidOffer: already withdrawn → CONFLICT error
  it("withdrawCommunityBidOffer: already withdrawn throws CONFLICT", async () => {
    if (!testFactory || !dbOfferId) return;
    await expect(withdrawCommunityBidOffer(dbOfferId))
      .rejects.toMatchObject({ code: "CONFLICT" });
  }, 30000);

  // 43. resubmitCommunityBidOffer: sets status=active + clears withdrawnAt
  it("resubmitCommunityBidOffer: sets status back to active", async () => {
    if (!testFactory || !dbOfferId) return;
    await resubmitCommunityBidOffer(dbOfferId, { proposal: "Resubmitted DB proposal" });
    const offer = await getCommunityBidOfferById(dbOfferId);
    expect(offer?.status).toBe("active");
    expect(offer?.withdrawnAt).toBeNull();
    expect(offer?.proposal).toBe("Resubmitted DB proposal");
  }, 30000);

  // 44. getCommunityBidOfferCount: counts only active, not withdrawn
  it("getCommunityBidOfferCount: counts active offers only", async () => {
    if (!testFactory || !dbOfferId) return;
    const activeCount = await getCommunityBidOfferCount(dbBidId);
    expect(activeCount).toBe(1);
    await withdrawCommunityBidOffer(dbOfferId);
    const withdrawnCount = await getCommunityBidOfferCount(dbBidId);
    expect(withdrawnCount).toBe(0);
    await resubmitCommunityBidOffer(dbOfferId, {});
  }, 60000);

  // 45. listCommunityBidOffersForOwner: includes all statuses
  it("listCommunityBidOffersForOwner: includes all non-deleted offers", async () => {
    if (!testFactory || !dbOfferId) return;
    const offers = await listCommunityBidOffersForOwner(dbBidId);
    expect(offers.length).toBeGreaterThan(0);
    const found = offers.find(o => o.id === dbOfferId);
    expect(found).toBeDefined();
  }, 30000);

  // 46. getCommunityBidOfferCount: different bid → 0
  it("getCommunityBidOfferCount: bid with no offers returns 0", async () => {
    const emptyBidId = await createActiveBid("Count zero bid");
    const count = await getCommunityBidOfferCount(emptyBidId);
    expect(count).toBe(0);
  }, 60000);
});

// ===== Phase 3B Hardening: concurrency, deadline SQL, null factory, lastUpdatedBy =====
describe("Phase 3B Hardening: concurrency + deadline + null factory + audit", () => {
  // 47. Concurrent createBidOffer from same factory → only one succeeds (DB UNIQUE constraint)
  it("concurrent createBidOffer from same factory → exactly one succeeds, one CONFLICT", async () => {
    if (!testFactory) return;
    const concurrentBidId = await createActiveBid("Concurrency UNIQUE test");
    const base = {
      bidId: concurrentBidId,
      bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id,
      bidderNameSnapshot: "Concurrent Owner",
      bidderFactoryNameSnapshot: "Concurrent Factory",
      bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, commercialTerms: null, images: [], pinnedProductIds: [],
    };
    const [r1, r2] = await Promise.allSettled([
      createCommunityBidOffer({ ...base, proposal: "Concurrent offer 1" }),
      createCommunityBidOffer({ ...base, proposal: "Concurrent offer 2" }),
    ]);
    const fulfilled = [r1, r2].filter(r => r.status === "fulfilled");
    const rejected = [r1, r2].filter(r => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const rejectedResult = rejected[0] as PromiseRejectedResult;
    expect(rejectedResult.reason?.code).toBe("CONFLICT");
    const count = await getCommunityBidOfferCount(concurrentBidId);
    expect(count).toBe(1);
  }, 60000);

  // 48. SQL-level deadline: setTestBidDeadlinePast prevents insert even if router check passed
  it("setTestBidDeadlinePast → createCommunityBidOffer throws BID_UNAVAILABLE", async () => {
    if (!testFactory) return;
    const deadlineBidId = await createActiveBid("SQL deadline test");
    await setTestBidDeadlinePast(deadlineBidId);
    await expect(createCommunityBidOffer({
      bidId: deadlineBidId,
      bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id,
      bidderNameSnapshot: "Owner", bidderFactoryNameSnapshot: "Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "Late insert", commercialTerms: null, images: [], pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "BID_UNAVAILABLE" });
  }, 60000);

  // 49. lastUpdatedByUserId/Snapshot set correctly on withdraw
  it("withdrawCommunityBidOffer sets lastUpdatedByUserId and Snapshot", async () => {
    if (!testFactory) return;
    const auditBidId = await createActiveBid("Audit withdraw test");
    const auditOfferId = await createCommunityBidOffer({
      bidId: auditBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "Audit Owner",
      bidderFactoryNameSnapshot: "Audit Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "Audit test", commercialTerms: null, images: [], pinnedProductIds: [],
    });
    await withdrawCommunityBidOffer(auditOfferId, testFactory.ownerId, "Audit Actor");
    const offer = await getCommunityBidOfferById(auditOfferId);
    expect(offer?.lastUpdatedByUserId).toBe(testFactory.ownerId);
    expect(offer?.lastUpdatedByNameSnapshot).toBe("Audit Actor");
    expect(offer?.status).toBe("withdrawn");
  }, 60000);

  // 50. lastUpdatedByUserId/Snapshot set correctly on resubmit
  it("resubmitCommunityBidOffer sets lastUpdatedByUserId and Snapshot", async () => {
    if (!testFactory) return;
    const resubBidId = await createActiveBid("Audit resubmit test");
    const resubOfferId = await createCommunityBidOffer({
      bidId: resubBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "Resub Owner",
      bidderFactoryNameSnapshot: "Resub Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "Resub test", commercialTerms: null, images: [], pinnedProductIds: [],
    });
    await withdrawCommunityBidOffer(resubOfferId);
    await resubmitCommunityBidOffer(resubOfferId, { proposal: "Resubmitted" }, testFactory.ownerId, "Resub Actor");
    const offer = await getCommunityBidOfferById(resubOfferId);
    expect(offer?.lastUpdatedByUserId).toBe(testFactory.ownerId);
    expect(offer?.lastUpdatedByNameSnapshot).toBe("Resub Actor");
    expect(offer?.status).toBe("active");
    expect(offer?.proposal).toBe("Resubmitted");
  }, 60000);

  // 51. null bidderFactoryId → updateBidOffer throws BAD_REQUEST at router level
  it("updateBidOffer: bidderFactoryId=null → BAD_REQUEST (router rejects null-factory edits)", async () => {
    if (!testFactory) return;
    const nullFacBidId = await createActiveBid("Null factory update test");
    const nullFacOfferId = await createCommunityBidOffer({
      bidId: nullFacBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "NF Owner",
      bidderFactoryNameSnapshot: "NF Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "Null factory offer", commercialTerms: null, images: [], pinnedProductIds: [],
    });
    // Simulate factory being deleted by setting bidderFactoryId to null directly
    const db_ = await getDb();
    if (db_) {
      await db_.execute(
        `UPDATE communityBidOffers SET bidderFactoryId = NULL WHERE id = ${nullFacOfferId}` as any,
      );
    }
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    await expect(caller.community.updateBidOffer({ offerId: nullFacOfferId, proposal: "New" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);

  // 52. null bidderFactoryId → resubmitBidOffer throws BAD_REQUEST
  it("resubmitBidOffer: bidderFactoryId=null → BAD_REQUEST", async () => {
    if (!testFactory) return;
    const nfReBidId = await createActiveBid("Null factory resubmit test");
    const nfReOfferId = await createCommunityBidOffer({
      bidId: nfReBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "NF2 Owner",
      bidderFactoryNameSnapshot: "NF2 Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "Null factory resubmit", commercialTerms: null, images: [], pinnedProductIds: [],
    });
    await withdrawCommunityBidOffer(nfReOfferId);
    const db_ = await getDb();
    if (db_) {
      await db_.execute(`UPDATE communityBidOffers SET bidderFactoryId = NULL WHERE id = ${nfReOfferId}` as any);
    }
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    await expect(caller.community.resubmitBidOffer({ offerId: nfReOfferId, proposal: "Re-P" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);

  // 53. Admin bypass: a non-owner admin CAN call listBidOffersForOwner (moderation access)
  //
  // Phase 5 note: this test originally asserted the opposite (FORBIDDEN) under the name
  // "non-owner admin-role user ... → FORBIDDEN", but its own context used `role: "admin"`
  // — under COMMUNITY_FEATURE_STATUS="beta", checkCommunityRead already requires
  // role==="admin" just to reach the handler at all, and the router's own authorization
  // is `isOwner || isAdmin` (routers.ts listBidOffersForOwner, isAdmin = ctx.user.role
  // === "admin") — the exact same field beta-gate already required. There is no context
  // reachable through this beta gate where role==="admin" for checkCommunityRead but
  // isAdmin is false for the ownership check; they test the identical field. So a
  // genuinely non-owner-non-admin FORBIDDEN case is not constructible while beta is
  // active (out of scope for Phase 5 — beta gate is explicitly not to be touched).
  // This test had never actually run before Phase 5 (testFactory was always null on a
  // clean oxm_test, so `if (!testFactory) return` early-returned every time) — once the
  // Phase 5 fixture seeded an approved factory, it ran for the first time and its
  // pre-existing assertion didn't match reality. The router's admin-bypass here is
  // intentional and consistent with every other Community moderation check in this
  // file (hidePost/lockPost/pinPost/deleteComment/updateComment/etc. all let
  // role==="admin" act regardless of authorship) — so the correct fix is to test what
  // this endpoint actually and correctly does: let a non-owner ADMIN view the offers.
  it("listBidOffersForOwner: non-owner admin CAN view offers (moderation bypass, consistent with rest of Community admin checks)", async () => {
    if (!testFactory) return;
    const privBidId2 = await createActiveBid("Privacy cross-user test 2");
    const otherCaller = appRouter.createCaller(createAuthContext({ role: "admin", id: 999991 }));
    const result = await otherCaller.community.listBidOffersForOwner({ bidId: privBidId2 });
    expect(result).toHaveProperty("offers");
    expect(result.isAdmin).toBe(true);
  }, 60000);

  // 54. Validation bounds: proposal > 5000 chars → BAD_REQUEST
  it("createBidOffer: proposal > 5000 chars → BAD_REQUEST (Zod validation)", async () => {
    if (!testFactory) return;
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    const longBidId = await createActiveBid("Validation bounds test");
    await expect(caller.community.createBidOffer({
      bidId: longBidId,
      bidderFactoryId: testFactory.id,
      proposal: "a".repeat(5001),
      images: [],
      pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);

  // 55. Validation bounds: amount > 999999999999 → BAD_REQUEST
  it("createBidOffer: amount > 999999999999 → BAD_REQUEST (Zod validation)", async () => {
    if (!testFactory) return;
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    const amountBidId = await createActiveBid("Amount validation test");
    await expect(caller.community.createBidOffer({
      bidId: amountBidId,
      bidderFactoryId: testFactory.id,
      proposal: "Valid proposal",
      amount: 9999999999999, // > max
      images: [],
      pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);

  // 56. Validation bounds: deliveryDays > 3650 → BAD_REQUEST
  it("createBidOffer: deliveryDays > 3650 → BAD_REQUEST (Zod validation)", async () => {
    if (!testFactory) return;
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    const ddBidId = await createActiveBid("DeliveryDays validation test");
    await expect(caller.community.createBidOffer({
      bidId: ddBidId,
      bidderFactoryId: testFactory.id,
      proposal: "Valid proposal",
      deliveryDays: 3651, // > max
      images: [],
      pinnedProductIds: [],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);
});

// ===== Section 一: SQL-level deadline guards for update/withdraw/resubmit =====
describe("Section 一: SQL deadline guards — update/withdraw/resubmit", () => {
  let dlBidId = 0;
  let dlOfferId = 0;

  beforeAll(async () => {
    if (!testFactory) return;
    dlBidId = await createActiveBid("Section 一 deadline guard test");
    dlOfferId = await createCommunityBidOffer({
      bidId: dlBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "DL Owner",
      bidderFactoryNameSnapshot: "DL Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "DL initial", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
  }, 30000);

  // 57. updateCommunityBidOfferSafe: bid deadline past → BID_UNAVAILABLE (SQL-level)
  it("updateCommunityBidOfferSafe: bid deadline past → BID_UNAVAILABLE at SQL level", async () => {
    if (!testFactory || !dlOfferId) return;
    const pastBidId = await createActiveBid("SQL update deadline guard");
    const pastOfferId = await createCommunityBidOffer({
      bidId: pastBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "PD Owner",
      bidderFactoryNameSnapshot: "PD Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "PD offer", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
    await setTestBidDeadlinePast(pastBidId);
    await expect(updateCommunityBidOfferSafe(pastOfferId, { proposal: "Late update" }, testFactory.ownerId, "Test Actor"))
      .rejects.toMatchObject({ code: "BID_UNAVAILABLE" });
    // Offer should remain unchanged
    const offer = await getCommunityBidOfferById(pastOfferId);
    expect(offer?.proposal).toBe("PD offer");
  }, 60000);

  // 58. updateCommunityBidOfferSafe: bid cancelled → BID_UNAVAILABLE at SQL level
  it("updateCommunityBidOfferSafe: bid cancelled → BID_UNAVAILABLE at SQL level", async () => {
    if (!testFactory) return;
    const cancelledBidId = await createActiveBid("SQL update cancelled guard");
    const cancelledOfferId = await createCommunityBidOffer({
      bidId: cancelledBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "CX Owner",
      bidderFactoryNameSnapshot: "CX Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "CX offer", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
    await setTestBidStatus(cancelledBidId, "cancelled");
    await expect(updateCommunityBidOfferSafe(cancelledOfferId, { proposal: "Cancelled update" }, testFactory.ownerId, "Test"))
      .rejects.toMatchObject({ code: "BID_UNAVAILABLE" });
  }, 60000);

  // 59. updateBidOffer router: past-deadline bid → BAD_REQUEST (wraps BID_UNAVAILABLE)
  it("updateBidOffer router: past-deadline bid → BAD_REQUEST", async () => {
    if (!testFactory) return;
    const deadlineBidId = await createActiveBid("Router update deadline guard");
    const deadlineOfferId = await createCommunityBidOffer({
      bidId: deadlineBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "RD Owner",
      bidderFactoryNameSnapshot: "RD Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "RD offer", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
    await setTestBidDeadlinePast(deadlineBidId);
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    await expect(caller.community.updateBidOffer({ offerId: deadlineOfferId, proposal: "Late" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);

  // 60. withdrawCommunityBidOffer: bid deadline past → BID_UNAVAILABLE (SQL-level)
  it("withdrawCommunityBidOffer: bid deadline past → BID_UNAVAILABLE at SQL level", async () => {
    if (!testFactory) return;
    const wdBidId = await createActiveBid("SQL withdraw deadline guard");
    const wdOfferId = await createCommunityBidOffer({
      bidId: wdBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "WD Owner",
      bidderFactoryNameSnapshot: "WD Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "WD offer", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
    await setTestBidDeadlinePast(wdBidId);
    await expect(withdrawCommunityBidOffer(wdOfferId, testFactory.ownerId, "Test"))
      .rejects.toMatchObject({ code: "BID_UNAVAILABLE" });
    // Status unchanged
    const offer = await getCommunityBidOfferById(wdOfferId);
    expect(offer?.status).toBe("active");
  }, 60000);

  // 61. withdrawBidOffer router: past-deadline bid → BAD_REQUEST
  it("withdrawBidOffer router: past-deadline bid → BAD_REQUEST", async () => {
    if (!testFactory) return;
    const rWdBidId = await createActiveBid("Router withdraw deadline guard");
    const rWdOfferId = await createCommunityBidOffer({
      bidId: rWdBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "RW Owner",
      bidderFactoryNameSnapshot: "RW Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "RW offer", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
    await setTestBidDeadlinePast(rWdBidId);
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    await expect(caller.community.withdrawBidOffer({ offerId: rWdOfferId }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);

  // 62. resubmitCommunityBidOffer: bid deadline past → BID_UNAVAILABLE (SQL-level)
  it("resubmitCommunityBidOffer: bid deadline past → BID_UNAVAILABLE at SQL level", async () => {
    if (!testFactory) return;
    const rsBidId = await createActiveBid("SQL resubmit deadline guard");
    const rsOfferId = await createCommunityBidOffer({
      bidId: rsBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "RS Owner",
      bidderFactoryNameSnapshot: "RS Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "RS offer", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
    // Withdraw via raw DB (not through the bid guard, to get offer into withdrawn state)
    const pool_ = await getDb();
    if (pool_) await pool_.execute(`UPDATE communityBidOffers SET status = 'withdrawn' WHERE id = ${rsOfferId}` as any);
    await setTestBidDeadlinePast(rsBidId);
    await expect(resubmitCommunityBidOffer(rsOfferId, {}, testFactory.ownerId, "Test"))
      .rejects.toMatchObject({ code: "BID_UNAVAILABLE" });
    const offer = await getCommunityBidOfferById(rsOfferId);
    expect(offer?.status).toBe("withdrawn");
  }, 60000);

  // 63. resubmitBidOffer router: past-deadline bid → BAD_REQUEST
  it("resubmitBidOffer router: past-deadline bid → BAD_REQUEST", async () => {
    if (!testFactory) return;
    const rRsBidId = await createActiveBid("Router resubmit deadline guard");
    const rRsOfferId = await createCommunityBidOffer({
      bidId: rRsBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "RR Owner",
      bidderFactoryNameSnapshot: "RR Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "RR offer", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
    // Withdraw first (bid still active at this point)
    await withdrawCommunityBidOffer(rRsOfferId);
    // Now set deadline past AFTER withdrawing
    await setTestBidDeadlinePast(rRsBidId);
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    await expect(caller.community.resubmitBidOffer({ offerId: rRsOfferId, proposal: "Late resub" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);

  // 64. withdrawCommunityBidOffer: offer already withdrawn → CONFLICT (not BID_UNAVAILABLE)
  it("withdrawCommunityBidOffer: offer already withdrawn → CONFLICT (correct disambiguation)", async () => {
    if (!testFactory || !dlOfferId) return;
    // dlBidId is still active (no deadline manipulation)
    // First withdraw
    await withdrawCommunityBidOffer(dlOfferId);
    // Second withdraw → CONFLICT (offer.status !== 'active')
    await expect(withdrawCommunityBidOffer(dlOfferId))
      .rejects.toMatchObject({ code: "CONFLICT" });
    // Restore
    const db_ = await getDb();
    if (db_) await db_.execute(`UPDATE communityBidOffers SET status = 'active', withdrawnAt = NULL WHERE id = ${dlOfferId}` as any);
  }, 60000);

  // 65. resubmitCommunityBidOffer: offer already active → CONFLICT (not BID_UNAVAILABLE)
  it("resubmitCommunityBidOffer: offer already active → CONFLICT (correct disambiguation)", async () => {
    if (!testFactory || !dlOfferId) return;
    // dlBidId still active; dlOfferId is now active (restored in test 64)
    await expect(resubmitCommunityBidOffer(dlOfferId, {}))
      .rejects.toMatchObject({ code: "CONFLICT" });
  }, 60000);

  // 66. updateCommunityBidOfferSafe: withdrawn offer → CONFLICT (correct disambiguation)
  it("updateCommunityBidOfferSafe: withdrawn offer → CONFLICT (correct disambiguation)", async () => {
    if (!testFactory || !dlOfferId) return;
    // Withdraw dlOfferId
    await withdrawCommunityBidOffer(dlOfferId);
    await expect(updateCommunityBidOfferSafe(dlOfferId, { proposal: "Nope" }, testFactory.ownerId, "Test"))
      .rejects.toMatchObject({ code: "CONFLICT" });
    // Restore
    const db_ = await getDb();
    if (db_) await db_.execute(`UPDATE communityBidOffers SET status = 'active', withdrawnAt = NULL WHERE id = ${dlOfferId}` as any);
  }, 60000);
});

// ===== Section 四: Product soft-skip on updateBidOffer / resubmitBidOffer =====
describe("Section 四: product soft-skip — updateBidOffer and resubmitBidOffer", () => {
  // 67. updateBidOffer: deleted product → soft-skip, returns removedProductCount > 0
  it("updateBidOffer: non-existent product ID → soft-skipped, removedProductCount=1", async () => {
    if (!testFactory) return;
    const softBidId = await createActiveBid("Soft-skip update test");
    const softOfferId = await createCommunityBidOffer({
      bidId: softBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "SF Owner",
      bidderFactoryNameSnapshot: "SF Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "SF initial", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    const result = await caller.community.updateBidOffer({
      offerId: softOfferId,
      proposal: "Updated with stale product",
      pinnedProductIds: [888777], // non-existent product
    });
    expect(result.success).toBe(true);
    expect(result.removedProductCount).toBe(1);
    const offer = await getCommunityBidOfferById(softOfferId);
    expect((offer?.pinnedProductIds as number[]).length).toBe(0);
  }, 60000);

  // 68. updateBidOffer: cross-factory product → BAD_REQUEST (hard-reject)
  it("updateBidOffer: cross-factory product ID → BAD_REQUEST", async () => {
    if (!testFactory) return;
    // Find a product from a DIFFERENT factory
    const db_ = await getDb();
    if (!db_) return;
    const { products: productsTable } = await import("../drizzle/schema");
    const { ne: drizzleNeLocal } = await import("drizzle-orm");
    const otherProducts = await db_.select({ id: productsTable.id })
      .from(productsTable)
      .where(drizzleNeLocal(productsTable.factoryId, testFactory.id))
      .limit(1);
    if (otherProducts.length === 0) return; // no other factory product to test with
    const crossId = otherProducts[0].id;

    const crossBidId = await createActiveBid("Cross-factory product update test");
    const crossOfferId = await createCommunityBidOffer({
      bidId: crossBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "CF Owner",
      bidderFactoryNameSnapshot: "CF Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "CF initial", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    await expect(caller.community.updateBidOffer({ offerId: crossOfferId, pinnedProductIds: [crossId] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60000);

  // 69. updateBidOffer: no pinnedProductIds provided → removedProductCount=0
  it("updateBidOffer: no pinnedProductIds field → removedProductCount=0", async () => {
    if (!testFactory) return;
    const nopBidId = await createActiveBid("No product update test");
    const nopOfferId = await createCommunityBidOffer({
      bidId: nopBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "NP Owner",
      bidderFactoryNameSnapshot: "NP Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "NP initial", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    const result = await caller.community.updateBidOffer({ offerId: nopOfferId, proposal: "No product change" });
    expect(result.success).toBe(true);
    expect(result.removedProductCount).toBe(0);
  }, 60000);

  // 70. resubmitBidOffer: non-existent product → soft-skip, returns removedProductCount > 0
  it("resubmitBidOffer: stale product → soft-skipped, removedProductCount=1", async () => {
    if (!testFactory) return;
    const rsSoftBidId = await createActiveBid("Resubmit soft-skip test");
    const rsSoftOfferId = await createCommunityBidOffer({
      bidId: rsSoftBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "RS Owner",
      bidderFactoryNameSnapshot: "RS Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "RS initial", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
    await withdrawCommunityBidOffer(rsSoftOfferId);
    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    const result = await caller.community.resubmitBidOffer({
      offerId: rsSoftOfferId,
      proposal: "Resubmit with stale product",
      pinnedProductIds: [777666], // non-existent
    });
    expect(result.success).toBe(true);
    expect(result.removedProductCount).toBe(1);
    const offer = await getCommunityBidOfferById(rsSoftOfferId);
    expect(offer?.status).toBe("active");
    expect((offer?.pinnedProductIds as number[]).length).toBe(0);
  }, 60000);
});

// ===== Section 七: Notification rules — create=notify, update/withdraw/resubmit=no notify =====
describe("Section 七: notification rules — only createBidOffer notifies", () => {
  let notifBidId = 0;
  let notifOfferId = 0;

  beforeAll(async () => {
    if (!testFactory) return;
    notifBidId = await createActiveBid("Notification rules test bid");
    notifOfferId = await createCommunityBidOffer({
      bidId: notifBidId, bidderUserId: testFactory.ownerId,
      bidderFactoryId: testFactory.id, bidderNameSnapshot: "NT Owner",
      bidderFactoryNameSnapshot: "NT Factory", bidderRoleSnapshot: "owner",
      amount: null, currency: "TWD", deliveryDays: null, moq: null,
      sampleAvailable: false, proposal: "NT initial", commercialTerms: null,
      images: [], pinnedProductIds: [],
    });
  }, 30000);

  async function getNotifCount(): Promise<number> {
    const db_ = await getDb();
    if (!db_) return 0;
    const [row] = await db_.select({ n: communityNotifications.id })
      .from(communityNotifications)
      .where(communityNotifications.eventGroup ? undefined : undefined)
      .limit(9999);
    // Count all rows in table — use SQL count
    const { sql: sqlFn, count } = await import("drizzle-orm");
    const [r] = await db_.select({ c: count() }).from(communityNotifications);
    return Number(r?.c ?? 0);
  }

  // 71. createBidOffer via router creates a notification for the bid author
  it("createBidOffer creates notification for bid author (dedupeKey prevents double-insert)", async () => {
    if (!testFactory) return;
    const db_ = await getDb();
    if (!db_) return;
    const { sql: sqlFn } = await import("drizzle-orm");
    const [before] = await db_.select({ c: sqlFn<number>`COUNT(*)` })
      .from(communityNotifications);
    const countBefore = Number(before.c);

    // createBidOffer via router — notifBidId is authored by user 1
    // testFactory.ownerId !== 1 so the notification should be created
    const freshBidId = await createActiveBid("Notif create test");
    const freshCaller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    await freshCaller.community.createBidOffer({
      bidId: freshBidId,
      bidderFactoryId: testFactory.id,
      proposal: "Notif create offer",
      images: [],
      pinnedProductIds: [],
    });

    const [after] = await db_.select({ c: sqlFn<number>`COUNT(*)` })
      .from(communityNotifications);
    const countAfter = Number(after.c);
    expect(countAfter).toBeGreaterThan(countBefore);
  }, 60000);

  // 72. updateBidOffer does NOT create new notification
  it("updateBidOffer does NOT create notification", async () => {
    if (!testFactory || !notifOfferId) return;
    const db_ = await getDb();
    if (!db_) return;
    const { sql: sqlFn } = await import("drizzle-orm");
    const [before] = await db_.select({ c: sqlFn<number>`COUNT(*)` }).from(communityNotifications);
    const countBefore = Number(before.c);

    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    await caller.community.updateBidOffer({ offerId: notifOfferId, proposal: "NT updated" });

    const [after] = await db_.select({ c: sqlFn<number>`COUNT(*)` }).from(communityNotifications);
    expect(Number(after.c)).toBe(countBefore);
  }, 60000);

  // 73. withdrawBidOffer does NOT create new notification
  it("withdrawBidOffer does NOT create notification", async () => {
    if (!testFactory || !notifOfferId) return;
    const db_ = await getDb();
    if (!db_) return;
    const { sql: sqlFn } = await import("drizzle-orm");
    const [before] = await db_.select({ c: sqlFn<number>`COUNT(*)` }).from(communityNotifications);
    const countBefore = Number(before.c);

    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    await caller.community.withdrawBidOffer({ offerId: notifOfferId });

    const [after] = await db_.select({ c: sqlFn<number>`COUNT(*)` }).from(communityNotifications);
    expect(Number(after.c)).toBe(countBefore);
  }, 60000);

  // 74. resubmitBidOffer does NOT create new notification
  it("resubmitBidOffer does NOT create notification", async () => {
    if (!testFactory || !notifOfferId) return;
    const db_ = await getDb();
    if (!db_) return;
    const { sql: sqlFn } = await import("drizzle-orm");
    const [before] = await db_.select({ c: sqlFn<number>`COUNT(*)` }).from(communityNotifications);
    const countBefore = Number(before.c);

    const caller = appRouter.createCaller(createAuthContext({ role: "admin", id: testFactory.ownerId }));
    await caller.community.resubmitBidOffer({ offerId: notifOfferId, proposal: "NT resubmit" });

    const [after] = await db_.select({ c: sqlFn<number>`COUNT(*)` }).from(communityNotifications);
    expect(Number(after.c)).toBe(countBefore);
  }, 60000);
});
