// 工廠公開頁「資料最後更新時間」的日期格式化——純函式，方便獨立測試。
//
// 刻意不用相對時間（「3 天前」）：使用者之後回來看數字會一直變動，固定
// 日期比較看得懂、也比較不會被誤解成「頁面剛剛才更新」。也刻意不顯示
// 時／分／秒／時區，只到「日」為止，符合台灣使用者習慣的日期格式。
export function formatPublicContentUpdatedAt(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return null;
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
