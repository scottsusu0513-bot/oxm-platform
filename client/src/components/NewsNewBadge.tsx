// 找消息（News）全站唯一的 NEW 徽章元件——消息卡片、桌面左側分類側欄、手機
// 五個分頁、手機產業選擇器全部共用同一份視覺（橘紅漸層、白字、粗體、圓角
// pill），不得各自刻意接文字字串（例如「全部最新 NEW」）或另外寫一份樣式。
// `size="compact"` 只縮小 padding／字級給手機分頁／產業選單這種空間有限的
// 位置用，視覺語言（漸層色、字重、圓角）跟 "default" 完全一致，不是另一套
// 設計；顯示條件（NEW 出現與消失的邏輯）不在這個元件裡，由呼叫端決定要不要
// render 它，這個元件只負責畫面。
export function NewsNewBadge({ size = "default", className = "" }: { size?: "default" | "compact"; className?: string }) {
  const sizeClass = size === "compact" ? "text-[8px] px-1 py-[1px]" : "text-[10px] px-1.5 py-0.5";
  return (
    <span
      className={`shrink-0 font-bold leading-none text-white bg-gradient-to-r from-orange-500 to-red-500 rounded ${sizeClass} ${className}`}
    >
      NEW
    </span>
  );
}
