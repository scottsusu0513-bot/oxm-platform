import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { parseLocalDate, formatLocalDate } from "@/lib/orderDateChain";

export type OrderDatePickerProps = {
  value?: string;
  minDate?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
};

/**
 * 合作確認單日期欄位共用的日期選擇器：桌面版與手機版共用同一顆 Popover + shadcn Calendar
 * （PopoverContent 本身用 Radix Portal 掛到 document.body，不會被父層 Dialog 的
 * overflow 裁切；z-[60] 確保疊在既有表單 Dialog 的 z-50 之上）。
 *
 * 早於 minDate 的日期一律視覺反灰＋disabled（react-day-picker 的 disabled matcher
 * 本身就會阻擋 onSelect 觸發，不只是 CSS 樣式），minDate 當天本身可以選
 * （{ before: minDate } 是嚴格早於，不含 minDate 當天）。
 *
 * 這裡只負責「選出合法日期範圍內的值」；呼叫端仍必須把 onChange 接到
 * handleOrderDateFieldChange()，不能因為換了元件就跳過第二層 state 驗證。
 */
export function OrderDatePicker({
  value,
  minDate,
  onChange,
  placeholder = "選擇日期",
  disabled,
  id,
  className,
}: OrderDatePickerProps) {
  const [open, setOpen] = useState(false);

  const selectedDate = parseLocalDate(value ?? "");
  const minDateObj = parseLocalDate(minDate ?? "");
  const defaultMonth = selectedDate ?? minDateObj ?? new Date();

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start text-left font-normal pr-8",
              !selectedDate && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            <span className="truncate">
              {selectedDate ? format(selectedDate, "yyyy/MM/dd") : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-0 z-[60] max-w-[calc(100vw-2rem)]"
          align="start"
        >
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={defaultMonth}
            onSelect={(date) => {
              if (!date) return;
              onChange(formatLocalDate(date));
              setOpen(false);
            }}
            disabled={minDateObj ? { before: minDateObj } : undefined}
            classNames={{
              // 只針對這裡（合作確認單日期選擇器）的 disabled 樣式加強，不改動
              // client/src/components/ui/calendar.tsx 的全站預設樣式
              disabled: "text-muted-foreground/50 opacity-40 line-through pointer-events-none",
            }}
          />
        </PopoverContent>
      </Popover>
      {!!value && !disabled && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="清除日期"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
