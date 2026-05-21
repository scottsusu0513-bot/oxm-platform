import type { GuideQA, CompareRow } from "@/lib/blog";

interface Props {
  qaBlocks: GuideQA[];
}

function CompareGrid({ rows, labels }: { rows: CompareRow[]; labels?: [string, string] }) {
  const leftLabel = labels?.[0] ?? "A";
  const rightLabel = labels?.[1] ?? "B";
  return (
    <div className="mt-3 space-y-2">
      <div className="hidden sm:flex gap-0 text-xs font-semibold">
        <div className="flex-1 invisible">label</div>
        <div className="w-36 text-center">
          <span className="inline-block bg-orange-100 text-orange-700 px-3 py-0.5 rounded-full">{leftLabel}</span>
        </div>
        <div className="w-36 text-center">
          <span className="inline-block bg-sky-100 text-sky-700 px-3 py-0.5 rounded-full">{rightLabel}</span>
        </div>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="rounded-xl border border-border bg-white/70 overflow-hidden text-sm">
          <div className="bg-muted/40 px-4 py-2 font-semibold text-foreground text-xs">{row.label}</div>
          <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-border">
            <div className="flex-1 px-4 py-2.5 text-muted-foreground">
              <span className="sm:hidden text-orange-600 font-medium mr-1">{leftLabel}：</span>
              {row.left}
            </div>
            <div className="flex-1 px-4 py-2.5 text-muted-foreground">
              <span className="sm:hidden text-sky-600 font-medium mr-1">{rightLabel}：</span>
              {row.right}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GuideConversation({ qaBlocks }: Props) {
  return (
    <div className="space-y-6">
      {qaBlocks.map((qa, i) => (
        <div key={i} className="space-y-2.5">
          {/* 提問泡泡（右側） */}
          <div className="flex justify-end">
            <div className="max-w-[82%] sm:max-w-[72%]">
              <p className="text-[11px] text-orange-400 font-medium text-right mb-1 mr-1">你可能會問</p>
              <div className="bg-gradient-to-br from-orange-500 to-amber-500 text-white rounded-2xl rounded-tr-sm px-5 py-3.5 shadow-sm">
                <p className="text-sm sm:text-[15px] font-medium leading-relaxed">{qa.question}</p>
              </div>
            </div>
          </div>

          {/* 回答泡泡（左側） */}
          <div className="flex justify-start">
            <div className="max-w-[90%] sm:max-w-[80%]">
              <p className="text-[11px] text-muted-foreground font-medium mb-1 ml-1">OXM 說明</p>
              <div className="bg-white border border-border/60 rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm">
                {qa.compareRows && qa.compareRows.length > 0 ? (
                  <>
                    {typeof qa.answer === "string" && (
                      <p className="text-sm text-muted-foreground leading-relaxed mb-0.5">{qa.answer}</p>
                    )}
                    <CompareGrid rows={qa.compareRows} labels={qa.compareLabels} />
                  </>
                ) : Array.isArray(qa.answer) ? (
                  <ul className="space-y-2">
                    {qa.answer.map((item, j) => (
                      <li key={j} className="flex items-start gap-2.5 text-sm text-muted-foreground leading-relaxed">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground leading-relaxed">{qa.answer}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
