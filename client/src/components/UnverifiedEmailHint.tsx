import { useState, useRef } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export default function UnverifiedEmailHint() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleClose() {
    closeTimerRef.current = setTimeout(() => setOpen(false), 120);
  }

  function cancelClose() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="帳號尚未完成驗證"
          className="flex items-center justify-center w-6 h-6 rounded-full text-amber-500 hover:text-amber-600 focus:outline-none"
          onMouseEnter={() => { cancelClose(); setOpen(true); }}
          onMouseLeave={scheduleClose}
          onClick={() => setOpen((v) => !v)}
        >
          <AlertTriangle className="w-4 h-4" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="center"
          sideOffset={8}
          className="z-[60] w-[290px] max-w-[calc(100vw-2rem)] rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-lg text-sm outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <PopoverPrimitive.Arrow className="fill-amber-300" width={14} height={7} />
          <p className="font-semibold text-amber-900 mb-1">帳號尚未完成驗證</p>
          <p className="text-amber-800 leading-relaxed mb-3">
            請驗證您的主要信箱，未驗證帳號無法使用詢價、評價等功能。
          </p>
          <Button
            size="sm"
            className="w-full bg-amber-500 hover:bg-amber-600 text-white border-0"
            onClick={() => { setOpen(false); navigate("/member"); }}
          >
            前往驗證
          </Button>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
