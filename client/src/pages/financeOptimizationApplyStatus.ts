/**
 * client/src/pages/FinanceOptimizationApply.tsx 的「多工廠狀態判斷」邏輯 —
 * 刻意抽成不依賴 React／DOM 的純函式，讓 server/*.test.ts 可以直接 import
 * 並用一般 vitest 驗證實際輸入輸出行為，不必用 readFileSync 比對元件原始碼
 * 裡的迴圈寫法字串。
 *
 * 依「全部工廠」（owner + 所有共管工廠）的狀態決定顯示原因，不是只看
 * ownedFactory 或 coManaged 的第一筆——例如使用者名下工廠是 rejected，但
 * 共管的第二間工廠其實是 pending 時，仍應顯示「審核中」而非誤導成
 * 「已駁回」。優先序：pending（審核中，最接近完成）＞ rejected（已駁回，
 * 需要使用者採取行動修正）＞ 其他（draft／unregistered／unknown）。
 */

export interface FactoryStatusLike {
  status: string;
}

export function resolveAnyFactoryStatus(
  ownedFactory: FactoryStatusLike | null | undefined,
  coManaged: FactoryStatusLike[] | undefined,
): string | null {
  const statuses: string[] = [];
  if (ownedFactory) statuses.push(ownedFactory.status);
  for (const f of coManaged ?? []) statuses.push(f.status);
  if (statuses.length === 0) return null;
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("rejected")) return "rejected";
  return statuses[0];
}
