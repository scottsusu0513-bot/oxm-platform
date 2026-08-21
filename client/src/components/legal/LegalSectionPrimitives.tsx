// 服務條款／隱私權政策共用的最小排版元件（標題區塊、編號清單、次層編號清單）。
// TermsContent.tsx 與 PrivacyPolicyContent.tsx 都用同一份，避免兩邊各自定義
// 一套幾乎一樣的 Section/Items/SubItems，也避免未來排版調整只改到一邊。
// 這裡刻意只放版面結構，不放任何條款／政策文字內容。

export function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-lg font-semibold mb-3 text-foreground">{title}</h2>
      <div className="space-y-2 text-muted-foreground leading-relaxed text-sm">{children}</div>
    </section>
  );
}

export function Items({ items }: { items: string[] }) {
  return (
    <ol className="space-y-1.5 list-decimal list-inside pl-1">
      {items.map((item, i) => <li key={i} className="leading-relaxed">{item}</li>)}
    </ol>
  );
}

export function SubItems({ items }: { items: string[] }) {
  return (
    <ol className="space-y-1 list-decimal list-inside pl-4">
      {items.map((item, i) => <li key={i} className="leading-relaxed">{item}</li>)}
    </ol>
  );
}
