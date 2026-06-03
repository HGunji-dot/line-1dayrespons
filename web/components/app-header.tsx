"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAFF } from "@/lib/staff";
import { useOperator, setOperator } from "@/lib/operator-store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type HeaderStaff = { displayName: string; role: "staff" | "master" };

/** 全ページ共通のヘッダー（ナビ＋対応者表示）
 *  - 実モード(currentStaff あり)：対応者＝ログイン本人に固定。ログアウト可。
 *  - モックモード(currentStaff なし)：従来どおりクリックで対応者を選択。 */
export function AppHeader({ currentStaff }: { currentStaff?: HeaderStaff | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const operator = useOperator();
  const realMode = !!currentStaff;

  // 実モードでは operator をログイン本人に固定（返信ドラフトはこれを参照して送信可否を判定）。
  React.useEffect(() => {
    if (currentStaff) setOperator(currentStaff.displayName);
  }, [currentStaff]);

  // master だけ /coaching を見られる（育成評価ページ）。
  const nav = [
    { href: "/", label: "会話" },
    ...(currentStaff?.role === "master"
      ? [{ href: "/coaching", label: "育成評価" }]
      : []),
  ];

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-card px-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-line text-xs font-bold text-line-foreground">
          L
        </span>
        <h1 className="whitespace-nowrap text-sm font-semibold">LINE返信管理</h1>
      </div>
      <nav className="flex items-center gap-1">
        {nav.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "whitespace-nowrap rounded px-3 py-1 text-sm transition-colors",
                active
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {realMode ? (
          <>
            <span className="whitespace-nowrap text-xs text-muted-foreground">対応者</span>
            <span className="whitespace-nowrap rounded-full border border-line bg-line px-2.5 py-0.5 text-xs font-medium text-line-foreground">
              {currentStaff!.displayName}
            </span>
            <button
              onClick={logout}
              className="flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
            >
              <LogOut className="h-3.5 w-3.5" />
              ログアウト
            </button>
          </>
        ) : (
          <>
            <span
              className={cn(
                "whitespace-nowrap text-xs",
                operator ? "text-muted-foreground" : "font-medium text-amber-600"
              )}
            >
              対応者
            </span>
            <div className="flex items-center gap-1">
              {STAFF.map((s) => (
                <button
                  key={s}
                  onClick={() => setOperator(operator === s ? null : s)}
                  aria-pressed={operator === s}
                  className={cn(
                    "whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    operator === s
                      ? "border-line bg-line text-line-foreground"
                      : "bg-background text-foreground hover:bg-accent"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <span className="whitespace-nowrap rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              モック
            </span>
          </>
        )}
      </div>
    </header>
  );
}
