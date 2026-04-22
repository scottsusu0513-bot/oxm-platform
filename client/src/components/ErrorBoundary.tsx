import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";


interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-4 bg-background">
          <div className="flex flex-col items-center text-center gap-4 max-w-sm w-full">
            <AlertTriangle size={40} className="text-destructive" />
            <p className="text-base font-medium text-foreground">發生錯誤，請重新整理頁面</p>
            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm",
                "bg-primary text-primary-foreground hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={15} />
              重新載入
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
