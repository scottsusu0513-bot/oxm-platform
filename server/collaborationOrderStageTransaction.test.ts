/**
 * Mock-connection tests for the transaction core of stage advancement / order
 * completion. These verify call order (beginTransaction -> execute(s) ->
 * commit/rollback) and rollback behavior without needing a real database —
 * the local dev DB schema in this environment can't run these as integration
 * tests, so we inject a fake TxConnection and assert on it directly.
 */
import { describe, expect, it, vi } from "vitest";
import {
  advanceCollaborationOrderStageOnConn,
  markCollaborationOrderCompleteOnConn,
  type TxConnection,
} from "./db";

type ExecuteResponder = (sql: string, values?: unknown[]) => [any, any];

function createMockConn(respond: ExecuteResponder): TxConnection & {
  calls: { sql: string; values?: unknown[] }[];
} {
  const calls: { sql: string; values?: unknown[] }[] = [];
  return {
    calls,
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    execute: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return respond(sql, values);
    }),
  };
}

const advanceParams = {
  orderId: 1,
  expectedCurrentStage: "awaiting_deposit",
  nextStage: "in_production",
  actorUserId: 10,
  actorNameSnapshot: "王小明",
  actorFactoryNameSnapshot: "測試工廠",
  note: "首款已確認入帳",
  isEarly: false,
  expectedDateAtTransition: "2026-07-01",
};

describe("advanceCollaborationOrderStageOnConn", () => {
  it("commits and inserts history when the conditional UPDATE succeeds", async () => {
    const conn = createMockConn((sql) => {
      if (sql.startsWith("UPDATE")) return [{ affectedRows: 1 }, undefined];
      return [{ affectedRows: 1 }, undefined];
    });
    await advanceCollaborationOrderStageOnConn(conn, advanceParams);

    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    const sqlKinds = conn.calls.map(c => c.sql.trim().split(" ")[0]);
    expect(sqlKinds).toEqual(["UPDATE", "INSERT"]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("rolls back and throws CONFLICT without writing history when affectedRows=0 (stale expectedCurrentStage)", async () => {
    const conn = createMockConn((sql) => {
      if (sql.startsWith("UPDATE")) return [{ affectedRows: 0 }, undefined];
      return [{ affectedRows: 1 }, undefined];
    });

    await expect(advanceCollaborationOrderStageOnConn(conn, advanceParams))
      .rejects.toMatchObject({ code: "CONFLICT" });

    const sqlKinds = conn.calls.map(c => c.sql.trim().split(" ")[0]);
    expect(sqlKinds).toEqual(["UPDATE"]); // INSERT 從未執行
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("rolls back the UPDATE when the history INSERT fails", async () => {
    const conn = createMockConn((sql) => {
      if (sql.startsWith("UPDATE")) return [{ affectedRows: 1 }, undefined];
      if (sql.startsWith("INSERT")) throw new Error("db write failed");
      return [{}, undefined];
    });

    await expect(advanceCollaborationOrderStageOnConn(conn, advanceParams))
      .rejects.toThrow("db write failed");

    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("simulates two rapid calls with the same expectedCurrentStage: only the first succeeds", async () => {
    // 模擬「currentStage 已經被第一次呼叫改掉」——第二次呼叫的 conditional UPDATE 對不上，affectedRows=0
    let stageInDb = "awaiting_deposit";
    const makeConn = () => createMockConn((sql, values) => {
      if (sql.startsWith("UPDATE")) {
        const [nextStage, , , expectedCurrentStage] = values as string[];
        if (stageInDb !== expectedCurrentStage) return [{ affectedRows: 0 }, undefined];
        stageInDb = nextStage;
        return [{ affectedRows: 1 }, undefined];
      }
      return [{ affectedRows: 1 }, undefined];
    });

    const firstConn = makeConn();
    const secondConn = makeConn();
    await advanceCollaborationOrderStageOnConn(firstConn, advanceParams);
    await expect(advanceCollaborationOrderStageOnConn(secondConn, advanceParams))
      .rejects.toMatchObject({ code: "CONFLICT" });

    expect(stageInDb).toBe("in_production"); // 只跳了一階，不是兩階
  });
});

const completeParams = {
  orderId: 5,
  completedByUserId: 20,
  completionNote: "已驗收完畢",
  actorNameSnapshot: "李小華",
  actorFactoryNameSnapshot: "測試工廠",
  isEarly: false,
  expectedDateAtTransition: "2026-07-20",
};

describe("markCollaborationOrderCompleteOnConn", () => {
  it("commits and inserts history (fromStage taken from the locked SELECT) on success", async () => {
    const conn = createMockConn((sql) => {
      if (sql.startsWith("SELECT")) return [[{ currentStage: "awaiting_final_payment" }], undefined];
      if (sql.startsWith("UPDATE")) return [{ affectedRows: 1 }, undefined];
      return [{ affectedRows: 1 }, undefined];
    });
    await markCollaborationOrderCompleteOnConn(conn, completeParams);

    const insertCall = conn.calls.find(c => c.sql.startsWith("INSERT"));
    expect(insertCall?.values).toContain("awaiting_final_payment"); // fromStage
    expect(insertCall?.values).toContain("completed"); // toStage
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("rejects re-completing an already-completed order (conditional UPDATE misses, no history written)", async () => {
    // status IN (...) 條件已經把 completed 排除在外，模擬 affectedRows=0
    const conn = createMockConn((sql) => {
      if (sql.startsWith("SELECT")) return [[{ currentStage: "completed" }], undefined];
      if (sql.startsWith("UPDATE")) return [{ affectedRows: 0 }, undefined];
      return [{ affectedRows: 1 }, undefined];
    });

    await expect(markCollaborationOrderCompleteOnConn(conn, completeParams))
      .rejects.toMatchObject({ code: "CONFLICT" });

    expect(conn.calls.some(c => c.sql.startsWith("INSERT"))).toBe(false);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("rejects completing when currentStage is not awaiting_final_payment (no skipping stages)", async () => {
    const conn = createMockConn((sql) => {
      if (sql.startsWith("SELECT")) return [[{ currentStage: "in_production" }], undefined];
      // WHERE 條件要求 currentStage IS NULL OR = awaiting_final_payment，"in_production" 不符合
      if (sql.startsWith("UPDATE")) return [{ affectedRows: 0 }, undefined];
      return [{ affectedRows: 1 }, undefined];
    });

    await expect(markCollaborationOrderCompleteOnConn(conn, completeParams))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(conn.calls.some(c => c.sql.startsWith("INSERT"))).toBe(false);
  });

  it("writes fromStage=null for legacy orders without fabricating a prior stage", async () => {
    const conn = createMockConn((sql) => {
      if (sql.startsWith("SELECT")) return [[{ currentStage: null }], undefined];
      if (sql.startsWith("UPDATE")) return [{ affectedRows: 1 }, undefined];
      return [{ affectedRows: 1 }, undefined];
    });
    await markCollaborationOrderCompleteOnConn(conn, completeParams);

    const insertCall = conn.calls.find(c => c.sql.startsWith("INSERT"));
    // fromStage 是第 5 個 value（orderId, completedByUserId, actorNameSnapshot, actorFactoryNameSnapshot, fromStage, ...）
    expect(insertCall?.values?.[4]).toBeNull();
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });
});
