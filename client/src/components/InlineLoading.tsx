export function InlineLoading({ label = "載入中" }: { label?: string }) {
  return (
    <div className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <span
        className="h-4 w-4 rounded-full border-2 border-orange-200 border-t-orange-500 animate-spin"
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  );
}
