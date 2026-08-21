import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Accordion({
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b last:border-b-0", className)}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      // data-[state=closed]:hidden（見對話中「Hotfix 2」）：Radix 的
      // AccordionContent／CollapsibleContent 平常靠內建的 `hidden={!isOpen}`
      // HTML attribute 收合關閉項目，但 forceMount（見 client/src/pages/
      // FAQ.tsx，全站唯一使用 forceMount 的地方，為了 SEO 讓收合內容仍留在
      // 初始 HTML）會讓 Presence 的 present 永遠是 true，連帶讓
      // CollapsibleContentImpl 內部的 isOpen 永遠是 true，原生 hidden
      // attribute 因此完全失效——這個專案從未定義過
      // accordion-down／accordion-up 這兩個 keyframe 動畫（data-[state=
      // closed]:animate-accordion-up 只是失效的 class，沒有對應動畫），所以
      // 完全沒有其他機制收合已關閉的項目，forceMount 的頁面會呈現所有題目同時
      // 展開。這裡直接用 data-[state=closed]:hidden 明確收合，不依賴（也不
      // 重寫）任何動畫；沒有用 forceMount 的頁面本來就靠原生 hidden attribute
      // 正確收合，這個 class 對它們是安全的重複保險，不改變既有行為。
      className="data-[state=closed]:hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm"
      {...props}
    >
      <div className={cn("pt-0 pb-4", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
