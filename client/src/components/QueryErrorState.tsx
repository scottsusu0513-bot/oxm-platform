import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getQueryErrorMessage } from "@/lib/queryErrorMessage";

/** 查詢失敗的共用畫面：使用者可理解的訊息＋重新嘗試，不顯示原始錯誤內容。 */
export function QueryErrorState({ error, onRetry, retrying = false }: {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-4 py-12 px-4 text-center">
      <AlertTriangle className="w-10 h-10 text-destructive" aria-hidden="true" />
      <p className="text-muted-foreground break-words">{getQueryErrorMessage(error)}</p>
      <Button type="button" variant="outline" onClick={onRetry} disabled={retrying}>
        {retrying
          ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />重新載入中…</>
          : <><RotateCcw className="w-4 h-4 mr-2" />重新嘗試</>}
      </Button>
    </div>
  );
}
