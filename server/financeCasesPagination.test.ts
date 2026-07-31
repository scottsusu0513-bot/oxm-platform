/**
 * client/src/pages/financeCasesPagination.ts 的行為測試。
 *
 * 這是純函式（無 React／DOM／trpc 依賴），因此可以直接 import 並用一般
 * vitest 驗證真實邏輯行為，不是 readFileSync 字串比對或 Tailwind class 檢查。
 * 對應第五輪驗收「修正載入更多分頁」需求：
 *   - 同一頁重新 refetch 不會重複（取代而不是疊加）
 *   - 兩頁有重疊 id 不會重複
 *   - 較新的案件資料蓋掉較舊的資料
 *   - mutation 觸發的 RESET 只保留頁一、丟棄其他已載入頁面
 *   - createdAt 相同時用 id 穩定排序
 *   - 案件 #201（第二頁）可以被正常取得
 */
import { describe, expect, it } from "vitest";
import {
  createInitialFinanceCasesPaginationState,
  financeCasesPaginationReducer,
  selectMergedFinanceCases,
  type FinanceCaseLike,
} from "../client/src/pages/financeCasesPagination";

interface TestCase extends FinanceCaseLike {
  id: number;
  createdAt: string;
  status?: string;
}

function makeCase(id: number, createdAt: string, extra?: Partial<TestCase>): TestCase {
  return { id, createdAt, ...extra };
}

describe("financeCasesPaginationReducer + selectMergedFinanceCases: PAGE_LOADED", () => {
  it("同一個 offset 重新 dispatch PAGE_LOADED 會整頁取代，不會疊加重複", () => {
    let state = createInitialFinanceCasesPaginationState<TestCase>();
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 0,
      items: [makeCase(3, "2026-01-03"), makeCase(2, "2026-01-02"), makeCase(1, "2026-01-01")],
    });
    expect(selectMergedFinanceCases(state)).toHaveLength(3);

    // 對同一個 offset=0 重新 dispatch（模擬 mutation invalidate 後同一頁 refetch）
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 0,
      items: [makeCase(3, "2026-01-03"), makeCase(2, "2026-01-02"), makeCase(1, "2026-01-01")],
    });
    const merged = selectMergedFinanceCases(state);
    expect(merged).toHaveLength(3);
    expect(merged.map(c => c.id)).toEqual([3, 2, 1]);
  });

  it("兩個 offset 頁面有重疊 id（資料在併發修改下排序移動）時，合併結果不會重複出現該 id", () => {
    let state = createInitialFinanceCasesPaginationState<TestCase>();
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 0,
      items: [makeCase(5, "2026-01-05"), makeCase(4, "2026-01-04")],
    });
    // offset=200 這頁重新排序後意外也包含 id=4（理論上不該發生，但要證明去重有效）
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 200,
      items: [makeCase(4, "2026-01-04"), makeCase(3, "2026-01-03")],
    });
    const merged = selectMergedFinanceCases(state);
    const ids = merged.map(c => c.id);
    expect(ids).toEqual([5, 4, 3]);
    expect(ids.filter(id => id === 4)).toHaveLength(1);
  });

  it("案件 #201（第二頁，offset=200）可以被正常取得並出現在合併結果中", () => {
    let state = createInitialFinanceCasesPaginationState<TestCase>();
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 0,
      items: Array.from({ length: 200 }, (_, i) => makeCase(200 - i, `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`)),
    });
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 200,
      items: [makeCase(201, "2025-12-31T00:00:00Z")],
    });
    const merged = selectMergedFinanceCases(state);
    expect(merged).toHaveLength(201);
    expect(merged.map(c => c.id)).toContain(201);
  });

  it("同一個 id 出現在較晚 dispatch 的頁面（fetchSeq 較大）時，較新的資料（例如狀態被更新）蓋掉較舊的版本", () => {
    let state = createInitialFinanceCasesPaginationState<TestCase>();
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 0,
      items: [makeCase(1, "2026-01-01", { status: "new" })],
    });
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 200,
      items: [makeCase(1, "2026-01-01", { status: "evaluating" })],
    });
    const merged = selectMergedFinanceCases(state);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("evaluating");
  });
});

describe("financeCasesPaginationReducer: RESET（mutation 成功後觸發）", () => {
  it("RESET 時帶 keepOffset：只保留該 offset 的頁面，其他已載入頁面（例如按過載入更多累積的頁）全部丟棄", () => {
    let state = createInitialFinanceCasesPaginationState<TestCase>();
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 0, items: [makeCase(1, "2026-01-01")],
    });
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 200, items: [makeCase(2, "2025-12-31")],
    });
    expect(selectMergedFinanceCases(state)).toHaveLength(2);

    state = financeCasesPaginationReducer(state, { type: "RESET", keepOffset: 0 });
    const merged = selectMergedFinanceCases(state);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(1);
  });

  it("RESET 不帶 keepOffset：完全清空，之後重新載入只會看到最新一次 fetch 的資料，不會殘留舊頁面", () => {
    let state = createInitialFinanceCasesPaginationState<TestCase>();
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 0, items: [makeCase(1, "2026-01-01")],
    });
    state = financeCasesPaginationReducer(state, { type: "RESET" });
    expect(selectMergedFinanceCases(state)).toHaveLength(0);

    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 0, items: [makeCase(1, "2026-01-01", { status: "won" })],
    });
    const merged = selectMergedFinanceCases(state);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("won");
  });
});

describe("selectMergedFinanceCases: 穩定排序", () => {
  it("依 createdAt DESC 排序，最新案件排最前面", () => {
    let state = createInitialFinanceCasesPaginationState<TestCase>();
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 0,
      items: [makeCase(1, "2026-01-01"), makeCase(2, "2026-01-03"), makeCase(3, "2026-01-02")],
    });
    expect(selectMergedFinanceCases(state).map(c => c.id)).toEqual([2, 3, 1]);
  });

  it("createdAt 完全相同時，用 id DESC 當 tie-breaker，排序結果確定、不會每次不同", () => {
    let state = createInitialFinanceCasesPaginationState<TestCase>();
    state = financeCasesPaginationReducer(state, {
      type: "PAGE_LOADED", offset: 0,
      items: [makeCase(5, "2026-01-01T00:00:00Z"), makeCase(9, "2026-01-01T00:00:00Z"), makeCase(1, "2026-01-01T00:00:00Z")],
    });
    const result1 = selectMergedFinanceCases(state).map(c => c.id);
    const result2 = selectMergedFinanceCases(state).map(c => c.id);
    expect(result1).toEqual([9, 5, 1]);
    expect(result2).toEqual([9, 5, 1]);
  });
});
