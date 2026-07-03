import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { WifiOff, Loader2, RefreshCw } from "lucide-react";

const isNativePlatform = Capacitor.isNativePlatform();

export default function NetworkStatusOverlay() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (!isNativePlatform) return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    // Re-sync in case the event fired before this effect ran
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleRecheck = () => {
    setIsChecking(true);
    setTimeout(() => {
      setIsOnline(navigator.onLine);
      setIsChecking(false);
    }, 700);
  };

  if (!isNativePlatform || isOnline) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <WifiOff className="w-14 h-14 text-orange-300 mb-5" strokeWidth={1.5} />
      <h2 className="text-lg font-bold text-gray-800 mb-2">目前沒有網路連線</h2>
      <p className="text-sm text-gray-500 text-center leading-relaxed px-10 mb-7">
        請確認 Wi-Fi 或行動網路後再試一次
      </p>
      <Loader2 className="w-7 h-7 text-orange-400 animate-spin mb-7" />
      <button
        onClick={handleRecheck}
        disabled={isChecking}
        className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 text-white text-sm font-semibold rounded-full shadow-md hover:bg-orange-600 active:scale-95 transition-all disabled:opacity-50 select-none"
      >
        {isChecking
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <RefreshCw className="w-4 h-4" />
        }
        重新檢查
      </button>
    </div>,
    document.body,
  );
}
