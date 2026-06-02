export function AppLoading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-orange-50 text-stone-800">
      <div className="flex flex-col items-center gap-4">
        <div className="text-3xl font-bold tracking-wide text-orange-600">
          OXM
        </div>
        <div
          className="h-9 w-9 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin"
          aria-hidden="true"
        />
        <div className="text-sm text-stone-500">
          載入中
        </div>
      </div>
    </div>
  );
}
