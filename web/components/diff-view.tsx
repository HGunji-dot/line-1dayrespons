import { diffChars } from "@/lib/diff";
import { cn } from "@/lib/utils";

/**
 * AI下書き(generated) と 送信文(sent) の差分を色分け表示。
 * 緑 = 送信時に足された部分 / 赤(取り消し線) = AI下書きから消された部分
 */
export function DiffView({
  generated,
  sent,
  className,
}: {
  generated: string;
  sent: string;
  className?: string;
}) {
  const segs = diffChars(generated, sent);
  return (
    <p className={cn("whitespace-pre-wrap text-sm leading-relaxed", className)}>
      {segs.map((s, i) => {
        if (s.type === "equal") return <span key={i}>{s.value}</span>;
        if (s.type === "added")
          return (
            <span key={i} className="rounded-sm bg-emerald-100 text-emerald-800">
              {s.value}
            </span>
          );
        return (
          <span key={i} className="rounded-sm bg-rose-100 text-rose-700 line-through">
            {s.value}
          </span>
        );
      })}
    </p>
  );
}

/** 凡例 */
export function DiffLegend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-sm bg-emerald-100" />
        送信で追加
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-sm bg-rose-100" />
        <span className="line-through">削除</span>
      </span>
    </div>
  );
}
