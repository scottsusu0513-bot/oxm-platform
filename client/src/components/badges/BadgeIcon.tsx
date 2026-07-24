import { useEffect, useState } from "react";
import { CERTIFICATION_BADGE_MAP } from "@shared/badges";

const SPRITE_URL = "/badges/oxm-certification-badges.svg";

// 跨檔案（cross-document）的 <use href="file.svg#id"> 載入成功／失敗事件在各瀏覽器
// 行為不一致，不能可靠拿來判斷 sprite 是否可用。改用一次性 fetch 把整份 sprite
// 原始內容（不修改任何一個位元）注入到頁面內一個隱藏節點，之後所有 <use href="#id">
// 就變成「同文件內參照」，這是瀏覽器都保證可靠解析的用法。fetch 本身失敗／逾時
// 才會被視為「sprite 不可用」。模組層級快取，全站只 fetch 一次。
let spriteInjectionPromise: Promise<boolean> | null = null;

function ensureSpriteInjected(): Promise<boolean> {
  if (spriteInjectionPromise) return spriteInjectionPromise;

  spriteInjectionPromise = (async () => {
    try {
      const res = await fetch(SPRITE_URL);
      if (!res.ok) return false;
      const svgText = await res.text();
      const container = document.createElement("div");
      container.setAttribute("aria-hidden", "true");
      container.style.position = "absolute";
      container.style.width = "0";
      container.style.height = "0";
      container.style.overflow = "hidden";
      container.innerHTML = svgText;
      document.body.appendChild(container);
      return true;
    } catch {
      return false;
    }
  })();

  return spriteInjectionPromise;
}

/** id → 簡短英數字縮寫（例如 "iso-9001" → "ISO9"），純圖示載入失敗時的文字 fallback 用。 */
function shortLabel(id: string): string {
  return id.replace(/-/g, "").toUpperCase().slice(0, 4);
}

/**
 * 單一徽章圖示。
 *
 * sprite 尚未確認可用（載入中）或確認載入失敗時：顯示簡短英數字縮寫文字 fallback，
 * 畫面不會空白。sprite 確認可用後：只渲染徽章圖示本身，不殘留任何文字 fallback，
 * 不會有疊圖或視覺干擾。
 */
export function BadgeIcon({ badgeId, size = 28, className }: { badgeId: string; size?: number; className?: string }) {
  const def = CERTIFICATION_BADGE_MAP[badgeId];
  const [spriteReady, setSpriteReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureSpriteInjected().then(ok => {
      if (!cancelled) setSpriteReady(ok);
    });
    return () => { cancelled = true; };
  }, []);

  if (!def) return null;

  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 ${className ?? ""}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={def.name}
      title={def.name}
    >
      {spriteReady ? (
        <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
          <use href={`#${def.spriteId}`} />
        </svg>
      ) : (
        <span
          aria-hidden="true"
          className="flex items-center justify-center w-full h-full rounded-full bg-muted text-muted-foreground font-semibold leading-none select-none"
          style={{ fontSize: Math.max(7, Math.round(size * 0.3)) }}
        >
          {shortLabel(badgeId)}
        </span>
      )}
      <span className="sr-only">{def.name}</span>
    </span>
  );
}
