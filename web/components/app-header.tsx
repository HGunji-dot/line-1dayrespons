"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAFF } from "@/lib/staff";
import { useOperator, setOperator } from "@/lib/operator-store";

const NAV = [
  { href: "/", label: "会話" },
  { href: "/templates", label: "テンプレート管理" },
  { href: "/learning", label: "学習ログ" },
];

/** 全ページ共通のヘッダー（ナビ＋対応者セレクタ） */
export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const operator = useOperator();

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-card px-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-line text-xs font-bold text-line-foreground">
          L
        </span>
        <h1 className="whitespace-nowrap text-sm font-semibold">LINE返信管理</h1>
      </div>
      <nav className="flex items-center gap-1">
        {NAV.map((n) => {
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
        {/* 対応者：クリックで選択。選ぶと返信ドラフトの編集・送信が可能になる */}
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
        <button
          onClick={logout}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
          title="ログアウト"
        >
          <LogOut className="h-3 w-3" />
          ログアウト
        </button>
      </div>
    </header>
  );
}
