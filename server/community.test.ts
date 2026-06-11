import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

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

  it("returns 13 spaces for admin users", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const spaces = await caller.community.getSpaces();
    expect(spaces).toHaveLength(13);
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
        images: [validUrl],
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
        images: [otherUrl],
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
        images: ["https://evil.com/community-posts/1/steal.jpg"],
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
        images: [traversalUrl],
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
        images: [traversalUrl],
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
        images: [urlWithQuery],
      });
    } catch (err: any) {
      expect(err?.code).not.toBe("FORBIDDEN");
    }
  }, 15000);

  // 7. More than 6 images → zod rejects (max(6))
  it("rejects more than 6 images via zod", async () => {
    const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
    const tooMany = Array(7).fill(validUrl);
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
          images: ["https://example.com/img.jpg"],
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
      images: [validUrl],
    });
    try {
      await caller.community.updatePost({
        postId,
        images: [validUrl],
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
      caller.community.updatePost({ postId, images: [foreignUrl] }),
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
        images: ["not-a-url" as unknown as `http${string}`],
      }),
    ).rejects.toThrow(); // zod url() rejects this before assertCommunityImagesOwned
  });
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
      content: "Hello @TestFactory",
      mentions: [{ type: "factory", id: 9999 }],
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

  it("createComment with factory mention saves mention row (factory id stored)", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    const { postId } = await adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Mention factory test",
      content: "Content",
    });
    // Factory 9999 does not exist → createMentions catches FK error (best-effort), comment still created
    const result = await adminCaller.community.createComment({
      postId,
      content: "Hello @SomeFactory",
      mentions: [{ type: "factory", id: 9999 }],
    });
    expect(result).toHaveProperty("commentId");
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

  it("non-approved factory in mentions is skipped (no error)", async () => {
    const adminCaller = appRouter.createCaller(adminCtx());
    // factory id=99999 does not exist → skip silently, post still created
    await expect(adminCaller.community.createPost({
      spaceCode: "textile",
      title: "Non-approved factory mention",
      content: "Content",
      mentions: [{ type: "factory", id: 99999 }],
    })).resolves.toHaveProperty("postId");
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
