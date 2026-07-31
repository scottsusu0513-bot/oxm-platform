/**
 * 財務優化顧問案件看板「載入更多」分頁的純狀態邏輯，抽出成獨立、可測試的
 * reducer + selector，不依賴 React/元件生命週期。
 *
 * 修正前的問題：component 用 `offset === 0 ? replace : append` 這種寫法，
 * 任何「同一個 offset 重新 refetch」（例如 mutation 觸發 invalidate 後，
 * 目前 offset > 0 那一頁重新拉取）都會被無條件 append 一次，造成畫面上同一筆
 * 案件重複出現、React key 重複。
 *
 * 修正後：每一頁用 offset 當 key 存成獨立 slot（PAGE_LOADED 對同一個 offset
 * 重新 dispatch 會整頁「取代」而不是「疊加」）；合併所有 slot 時用案件 id
 * 去重——同一個 id 如果出現在多個 slot（理論上不該發生，但資料在併發修改下
 * 排序可能移動），保留「最近一次被 fetch 到」的版本（fetchSeq 較大者），確保
 * 「較新的資料蓋掉較舊的資料」而不是相反。RESET 用來在 mutation 成功後把
 * 所有已載入的頁面清空，讓呼叫端把 offset 歸零、從第一頁重新載入，不會殘留
 * 舊頁面的過期資料。最後用 createdAt DESC、id DESC 兩層排序穩定排序，
 * createdAt 相同時也有確定、不會抖動的顯示順序。
 */

export interface FinanceCaseLike {
  id: number;
  createdAt: string | Date;
  [key: string]: unknown;
}

interface PageSlot<T extends FinanceCaseLike> {
  items: T[];
  fetchSeq: number;
}

export interface FinanceCasesPaginationState<T extends FinanceCaseLike> {
  pagesByOffset: Record<number, PageSlot<T>>;
  nextFetchSeq: number;
}

export type FinanceCasesPaginationAction<T extends FinanceCaseLike> =
  | { type: "PAGE_LOADED"; offset: number; items: T[] }
  /**
   * keepOffset：mutation 成功後呼叫端會把 offset 設回 0 並重新觸發第一頁的
   * query——如果第一頁（通常是 offset=0）目前已經有資料，保留它的 slot 讓
   * 畫面在背景重新 fetch 的期間不會閃成空白；其他所有頁面（例如按過幾次
   * 「載入更多」累積的頁面）一律丟棄，避免殘留在下一次合併結果裡。
   * 不傳 keepOffset 則整個清空（用於例如登出等需要完全重置的情境）。
   */
  | { type: "RESET"; keepOffset?: number };

export function createInitialFinanceCasesPaginationState<T extends FinanceCaseLike>(): FinanceCasesPaginationState<T> {
  return { pagesByOffset: {}, nextFetchSeq: 0 };
}

export function financeCasesPaginationReducer<T extends FinanceCaseLike>(
  state: FinanceCasesPaginationState<T>,
  action: FinanceCasesPaginationAction<T>,
): FinanceCasesPaginationState<T> {
  switch (action.type) {
    case "RESET": {
      const keep = action.keepOffset != null ? state.pagesByOffset[action.keepOffset] : undefined;
      return {
        nextFetchSeq: state.nextFetchSeq,
        pagesByOffset: keep && action.keepOffset != null ? { [action.keepOffset]: keep } : {},
      };
    }
    case "PAGE_LOADED": {
      // 對同一個 offset 重新 dispatch 會直接取代整個 slot（含裡面的 items
      // 陣列），不是疊加在舊資料後面——這是修正「同頁 refetch 造成重複」的
      // 關鍵：舊的 items 陣列整個被丟棄，不會有任何一筆殘留。
      return {
        nextFetchSeq: state.nextFetchSeq + 1,
        pagesByOffset: {
          ...state.pagesByOffset,
          [action.offset]: { items: action.items, fetchSeq: state.nextFetchSeq },
        },
      };
    }
    default:
      return state;
  }
}

/** 依 createdAt DESC、id DESC 兩層排序——createdAt 相同時也有穩定、不重複的順序。 */
function compareFinanceCases(a: FinanceCaseLike, b: FinanceCaseLike): number {
  const at = new Date(a.createdAt).getTime();
  const bt = new Date(b.createdAt).getTime();
  if (bt !== at) return bt - at;
  return b.id - a.id;
}

/**
 * 合併目前已載入的所有頁面：先用 id 去重（同一個 id 只留下 fetchSeq 較大、
 * 也就是「最近一次被 fetch 到」的版本，讓較新的資料蓋掉較舊的資料——例如
 * 狀態、備註、承辦顧問被更新後，只要那一頁曾經重新 fetch 過，畫面就會反映
 * 最新內容），再依 createdAt DESC、id DESC 穩定排序，確保同一筆案件只會
 * 出現一次、React key 不會重複。
 */
export function selectMergedFinanceCases<T extends FinanceCaseLike>(
  state: FinanceCasesPaginationState<T>,
): T[] {
  const latestById = new Map<number, { item: T; fetchSeq: number }>();
  for (const page of Object.values(state.pagesByOffset)) {
    for (const item of page.items) {
      const existing = latestById.get(item.id);
      if (!existing || page.fetchSeq >= existing.fetchSeq) {
        latestById.set(item.id, { item, fetchSeq: page.fetchSeq });
      }
    }
  }
  return Array.from(latestById.values())
    .map((v) => v.item)
    .sort(compareFinanceCases);
}
