import { toast } from "sonner";
import { isNativeApp } from "@/lib/platform";

export interface ShareContent {
  title: string;
  text: string;
  url: string;
}

export interface ShareOptions {
  copySuccessMessage?: string;
  copyErrorMessage?: string;
  shareErrorMessage?: string;
}

function isUserCancelledNativeShare(err: unknown): boolean {
  const msg = String((err as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return msg.includes("cancel") || msg.includes("dismiss") || msg.includes("user");
}

/** Copies text via the Clipboard API, falling back to a hidden textarea + execCommand for browsers/contexts without it. */
async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy fallback below
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Shared share-to-* logic used by both the factory detail page and the
 * search results page: Capacitor native Share -> Web Share API -> clipboard
 * copy (with a legacy fallback), matching the OXM app's existing behavior.
 */
export async function shareContent(content: ShareContent, options: ShareOptions = {}): Promise<void> {
  const {
    copySuccessMessage = "連結已複製到剪貼簿",
    copyErrorMessage = "請手動複製網址分享",
    shareErrorMessage = "分享失敗，請稍後再試",
  } = options;

  if (isNativeApp()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share(content);
    } catch (err: unknown) {
      if (isUserCancelledNativeShare(err)) return;
      toast.error(shareErrorMessage);
    }
    return;
  }

  if (typeof navigator.share === "function") {
    try {
      await navigator.share(content);
      return;
    } catch (err: unknown) {
      if ((err as { name?: string } | null)?.name === "AbortError") return;
      // Non-abort error: fall through and try clipboard as a fallback.
    }
  }

  const copied = await copyToClipboard(content.url);
  if (copied) {
    toast.success(copySuccessMessage);
  } else {
    toast.error(copyErrorMessage);
  }
}
