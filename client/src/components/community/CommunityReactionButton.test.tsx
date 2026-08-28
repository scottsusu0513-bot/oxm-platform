// @vitest-environment jsdom
/**
 * Phase 7.1 Release Blocker regression test：CommunityReactionButton 在
 * reload／revisit 後顯示錯誤的「0 個讚、未按讚」，即使伺服器端資料正確。
 *
 * Root cause（已用原始碼＋直接呼叫 tRPC endpoint 確認，不是猜測）：
 * client/src/components/community/CommunityReactionButton.tsx 原本把
 * `initialData: { count: 0, viewerReacted: false }` 傳給
 * `trpc.community.reactionSummary.useQuery`。這個專案的全域 React Query
 * `staleTime` 是 60 秒（client/src/main.tsx），initialData 會被視為「剛剛才
 * 取得」的新鮮資料，導致 mount 後在 staleTime 內完全不會真的打 API 覆蓋掉
 * 這個寫死的假值——而且這個專案的 `refetchOnWindowFocus` 也被關掉，所以在
 * 同一次 mount 內幾乎不會自然轉為 stale 而重新 fetch。使用者重新整理／回訪
 * 時因此會看到「未按讚、0 個讚」，即使資料庫與 reactionSummary API 回傳的
 * 都是正確的 count／viewerReacted。
 *
 * 這裡跟 ConsentGate.test.tsx／OnboardingTour.test.tsx 一樣直接 mock
 * `@/lib/trpc`，不架設真正的 QueryClient——這樣才能直接斷言
 * CommunityReactionButton 呼叫 `useQuery` 時傳入的 options 本身不包含
 * `initialData`（regression 的真正成因），同時驗證元件在拿到伺服器資料後
 * 正確渲染，不會卡在任何寫死的預設值。
 *
 * 涵蓋範圍誠實聲明：這裡驗證的是元件呼叫 useQuery 的方式與 render 邏輯本身
 * （regression 的根因所在層級），不是真正 react-query 快取／staleTime 計時
 * 行為本身（那是 @tanstack/react-query 套件既有、未修改的邏輯，不需要在這個
 * repo 裡重新測 react-query 本身好不好用）；react-query 真正的 60 秒行為與
 * 「reload 後立即正確」已在 Phase 7.1 的 Browser Reproduction 段落用真瀏覽器
 * 驗證。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

let lastQueryInput: any = null;
let lastQueryOptions: any = null;
let mockQueryData: { count: number; viewerReacted: boolean } | undefined;
let mockQueryCallCount = 0;
const mockToggleMutate = vi.fn();
const mockInvalidate = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/trpc", () => ({
  trpc: {
    community: {
      reactionSummary: {
        useQuery: (input: any, options?: any) => {
          lastQueryInput = input;
          lastQueryOptions = options;
          mockQueryCallCount += 1;
          return { data: mockQueryData };
        },
      },
      toggleReaction: {
        useMutation: (opts: any) => ({
          mutate: (input: any) => {
            mockToggleMutate(input);
            opts?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      community: { reactionSummary: { invalidate: mockInvalidate } },
    }),
  },
}));

import CommunityReactionButton from "./CommunityReactionButton";

beforeEach(() => {
  lastQueryInput = null;
  lastQueryOptions = null;
  mockQueryData = undefined;
  mockQueryCallCount = 0;
  mockToggleMutate.mockReset();
  mockInvalidate.mockClear();
});

afterEach(() => {
  cleanup();
});

function getCount(): string | null {
  const btn = screen.getByRole("button");
  const span = btn.querySelector("span:not(.hidden)");
  return span?.textContent ?? null;
}

function isReacted(): boolean {
  const btn = screen.getByRole("button");
  return btn.className.includes("text-orange-500");
}

describe("CommunityReactionButton — Phase 7.1 reaction-state regression", () => {
  it("regression guard: useQuery 不可再傳入 initialData（本次 bug 的真正成因）", () => {
    mockQueryData = { count: 0, viewerReacted: false };
    render(<CommunityReactionButton targetType="post" targetId={3153} />);
    expect(lastQueryOptions == null || !("initialData" in lastQueryOptions)).toBe(true);
  });

  it("query key 正確帶入 targetType／targetId／reactionType，與 mutation 的 invalidate 對得上", () => {
    mockQueryData = { count: 0, viewerReacted: false };
    render(<CommunityReactionButton targetType="post" targetId={3153} />);
    expect(lastQueryInput).toEqual({ targetType: "post", targetId: 3153, reactionType: "helpful" });
  });

  it("已按讚狀態：伺服器回傳 count=3／viewerReacted=true，首次 mount 就要顯示 3、樣式為已按讚，不能停留在 0／未按讚", () => {
    mockQueryData = { count: 3, viewerReacted: true };
    render(<CommunityReactionButton targetType="post" targetId={3153} />);
    expect(getCount()).toBe("3");
    expect(isReacted()).toBe(true);
  });

  it("未按讚狀態：count=0／viewerReacted=false 時不顯示數字、樣式為未按讚", () => {
    mockQueryData = { count: 0, viewerReacted: false };
    render(<CommunityReactionButton targetType="post" targetId={3153} />);
    expect(getCount()).toBeNull();
    expect(isReacted()).toBe(false);
  });

  it("resolve 前（data 仍是 undefined）安全顯示 fallback，不會 crash、不會顯示 NaN／undefined", () => {
    mockQueryData = undefined;
    render(<CommunityReactionButton targetType="post" targetId={3153} />);
    expect(getCount()).toBeNull();
    expect(isReacted()).toBe(false);
    expect(screen.getByRole("button").textContent).not.toMatch(/NaN|undefined/);
  });

  it("reload／remount：unmount 後重新 mount 一定會重新呼叫 useQuery（不會沿用上一次 mount 遺留的假資料）", () => {
    mockQueryData = { count: 0, viewerReacted: false };
    const { unmount } = render(<CommunityReactionButton targetType="post" targetId={3153} />);
    expect(mockQueryCallCount).toBe(1);
    unmount();

    // 模擬「reload 後這次伺服器真實資料其實是已按讚」——重新 mount 必須反映
    // 這個新資料，不能因為前一次 mount 留下的任何狀態而顯示錯誤的 0／false。
    mockQueryData = { count: 5, viewerReacted: true };
    render(<CommunityReactionButton targetType="post" targetId={3153} />);
    expect(mockQueryCallCount).toBe(2);
    expect(getCount()).toBe("5");
    expect(isReacted()).toBe(true);
  });

  it("toggle：點擊會呼叫 mutate 並在成功後 invalidate 對應的 query key", () => {
    mockQueryData = { count: 0, viewerReacted: false };
    render(<CommunityReactionButton targetType="post" targetId={3153} />);
    fireEvent.click(screen.getByRole("button"));
    expect(mockToggleMutate).toHaveBeenCalledWith({ targetType: "post", targetId: 3153, reactionType: "helpful" });
    expect(mockInvalidate).toHaveBeenCalledWith({ targetType: "post", targetId: 3153, reactionType: "helpful" });
  });

  it("comment 也套用同一個元件與同一個修正：已按讚狀態同樣正確顯示", () => {
    mockQueryData = { count: 1, viewerReacted: true };
    render(<CommunityReactionButton targetType="comment" targetId={992} />);
    expect(lastQueryInput).toEqual({ targetType: "comment", targetId: 992, reactionType: "helpful" });
    expect(getCount()).toBe("1");
    expect(isReacted()).toBe(true);
  });
});
