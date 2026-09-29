/**
 * Batch 3.1：@builder.io/vite-plugin-jsx-loc 只在 dev server 載入。
 *
 * 它會在每個 JSX 元素加上 data-loc="檔案路徑:行號"（開發工具用），production
 * build 載入時 bundle 內有上萬個 data-loc 屬性並公開原始碼路徑。
 */
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";

async function pluginNames(env: { command: "build" | "serve"; mode: string }): Promise<string[]> {
  const cfg = await (viteConfig as unknown as (e: typeof env) => Promise<{ plugins: unknown[] }> | { plugins: unknown[] })(env);
  return (cfg.plugins as unknown[]).flat(5).filter(Boolean).map(p => (p as { name: string }).name);
}

describe("vite.config plugins", () => {
  it("K：production build 不載入 JSX location plugin（也不載入 dev debug collector）", async () => {
    const names = await pluginNames({ command: "build", mode: "production" });
    expect(names).not.toContain("vite-plugin-jsx-loc");
    expect(names).not.toContain("manus-debug-collector");
    expect(names.some(n => n.startsWith("vite:react"))).toBe(true);
    expect(names.some(n => n.startsWith("@tailwindcss/vite"))).toBe(true);
  });

  it("L：dev server 仍載入 JSX location plugin 與 debug collector", async () => {
    const names = await pluginNames({ command: "serve", mode: "development" });
    expect(names).toContain("vite-plugin-jsx-loc");
    expect(names).toContain("manus-debug-collector");
  });
});
