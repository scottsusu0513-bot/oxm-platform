import { describe, expect, it } from "vitest";
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
    openId: isAdmin ? "SWjqDMVNedahKJ4az5GpAs" : "test-user-1",
    email: "test@example.com",
    name: "Test User",
    loginMethod: isAdmin ? "google" : "manus",
    role: "user",
    isFactoryOwner: false,
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

describe("factory.search", () => {
  it("returns paginated results with total count", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.factory.search({ page: 1, pageSize: 10 });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe("number");
  }, 15000);

  it("accepts all filter parameters", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.factory.search({
      industry: "紡織",
      region: "台北市",
      capitalLevel: "100萬以下",
      mfgMode: "ODM",
      keyword: "測試",
      page: 1,
      pageSize: 5,
    });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
  }, 15000);
});

describe("factory.getById", () => {
  it("returns null for non-existent factory", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.factory.getById({ id: 999999 });
    expect(result).toBeNull();
  }, 15000);
});

describe("review.getByFactory", () => {
  it("returns empty reviews for non-existent factory", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.review.getByFactory({ factoryId: 999999, page: 1, pageSize: 10 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  }, 15000);
});

describe("ad.getActive", () => {
  it("returns array of active ads", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.ad.getActive({});
    expect(Array.isArray(result)).toBe(true);
  }, 15000);

  it("accepts filter parameters", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.ad.getActive({
      industry: "紡織",
      capitalLevel: "100萬以下",
      region: "台北市",
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(5);
  }, 15000);
});

describe("auth.me", () => {
  it("returns null for unauthenticated user", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user for authenticated user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).not.toBeNull();
    expect(result?.openId).toBe("test-user-1");
  });
});

describe("factory.getMine", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.factory.getMine()).rejects.toThrow();
  });

  it("returns null for user without factory", async () => {
    const ctx = createAuthContext({ id: 999888, openId: "no-factory-user" });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.factory.getMine();
    expect(result).toBeNull();
  }, 15000);
});

describe("chat.unreadCount", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.chat.unreadCount()).rejects.toThrow();
  });

  it("returns counts for authenticated user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.chat.unreadCount();
    expect(result).toHaveProperty("userCount");
    expect(result).toHaveProperty("factoryCount");
    expect(typeof result.userCount).toBe("number");
    expect(typeof result.factoryCount).toBe("number");
  }, 15000);
});

describe("chat.myConversations", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.chat.myConversations()).rejects.toThrow();
  });

  it("returns array for authenticated user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.chat.myConversations();
    expect(Array.isArray(result)).toBe(true);
  }, 15000);
});

describe("chat.deleteConversation", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.chat.deleteConversation({ conversationId: 999999 })).rejects.toThrow();
  });
});

describe("chat.getConversationMeta", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.chat.getConversationMeta({ conversationId: 999999 })).rejects.toThrow();
  });

  it("returns null for non-existent conversation", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.chat.getConversationMeta({ conversationId: 999999 });
    expect(result).toBeNull();
  }, 15000);
});

describe("product.getByFactory", () => {
  it("returns array for any factory id", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.product.getByFactory({ factoryId: 999999 });
    expect(Array.isArray(result)).toBe(true);
  }, 15000);
});

describe("product.create", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.product.create({
      factoryId: 1,
      name: "test product",
    })).rejects.toThrow();
  });

  it("rejects if user does not own the factory", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.product.create({
      factoryId: 999999,
      name: "test product",
      images: [],
    })).rejects.toThrow();
  }, 15000);
});

describe("product.uploadImage", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.product.uploadImage({
      factoryId: 1,
      base64: "dGVzdA==",
      mimeType: "image/jpeg",
    })).rejects.toThrow();
  });
});

describe("review.myReviews", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.review.myReviews({ page: 1, pageSize: 10 })).rejects.toThrow();
  });

  it("returns paginated reviews for authenticated user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.review.myReviews({ page: 1, pageSize: 10 });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.items)).toBe(true);
  }, 15000);
});


describe("admin.verifyPassword", () => {
  it("requires admin role", async () => {
    const ctx = createAuthContext({ role: "user" });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.verifyPassword({ password: "test" })).rejects.toThrow();
  });

  it("rejects incorrect password", async () => {
    const ctx = createAuthContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.verifyPassword({ password: "wrong-password" })).rejects.toThrow();
  });
});

describe("admin.getStats", () => {
  it("requires admin role", async () => {
    const ctx = createAuthContext({ role: "user" });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.getStats()).rejects.toThrow();
  });

  it("returns platform statistics", async () => {
    const ctx = createAuthContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.getStats();
    expect(result).toHaveProperty("totalUsers");
    expect(result).toHaveProperty("totalFactories");
    expect(result).toHaveProperty("totalProducts");
    expect(result).toHaveProperty("totalReviews");
    expect(result).toHaveProperty("totalAds");
    expect(result).toHaveProperty("totalMessages");
    expect(typeof result.totalUsers).toBe("number");
  }, 15000);
});

describe("admin.getFactories", () => {
  it("requires admin role", async () => {
    const ctx = createAuthContext({ role: "user" });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.getFactories({ page: 1, pageSize: 10 })).rejects.toThrow();
  });

  it("returns paginated factories", async () => {
    const ctx = createAuthContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.getFactories({ page: 1, pageSize: 10 });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("page");
    expect(result).toHaveProperty("pageSize");
    expect(Array.isArray(result.items)).toBe(true);
  }, 15000);
});

describe("admin.getUsers", () => {
  it("requires admin role", async () => {
    const ctx = createAuthContext({ role: "user" });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.getUsers({ page: 1, pageSize: 10 })).rejects.toThrow();
  });

  it("returns paginated users", async () => {
    const ctx = createAuthContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.getUsers({ page: 1, pageSize: 10 });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.items)).toBe(true);
  }, 15000);
});

describe("admin.getAds", () => {
  it("requires admin role", async () => {
    const ctx = createAuthContext({ role: "user" });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.getAds({ page: 1, pageSize: 10 })).rejects.toThrow();
  });

  it("returns paginated ads", async () => {
    const ctx = createAuthContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.getAds({ page: 1, pageSize: 10 });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.items)).toBe(true);
  }, 15000);
});

describe("admin.getReviews", () => {
  it("requires admin role", async () => {
    const ctx = createAuthContext({ role: "user" });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.getReviews({ page: 1, pageSize: 10 })).rejects.toThrow();
  });

  it("returns paginated reviews", async () => {
    const ctx = createAuthContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.getReviews({ page: 1, pageSize: 10 });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.items)).toBe(true);
  }, 15000);
});


describe("favorite.toggle", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.favorite.toggle({ factoryId: 1 })).rejects.toThrow();
  });

  it("toggles factory favorite status", async () => {
    const ctx = createAuthContext({ id: 1, openId: "test-user-1" });
    const caller = appRouter.createCaller(ctx);
    const result1 = await caller.favorite.toggle({ factoryId: 1 });
    expect(result1.isFavorited).toBe(true);
    const result2 = await caller.favorite.toggle({ factoryId: 1 });
    expect(result2.isFavorited).toBe(false);
  }, 15000);
});

describe("favorite.isLiked", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.favorite.isLiked({ factoryId: 1 })).rejects.toThrow();
  });

  it("returns false for non-favorited factory", async () => {
    const ctx = createAuthContext({ id: 1, openId: "test-user-1" });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.favorite.isLiked({ factoryId: 999999 });
    expect(result.isFavorited).toBe(false);
  }, 15000);
});

describe("favorite.getByUser", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.favorite.getByUser({ page: 1, pageSize: 10 })).rejects.toThrow();
  });

  it("returns paginated favorites", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.favorite.getByUser({ page: 1, pageSize: 10 });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.items)).toBe(true);
  }, 15000);
});
