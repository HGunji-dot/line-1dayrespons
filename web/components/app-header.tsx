"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "会話" },
  { href: "/templates", label: "テンプレート管理" },
  { href: "/learning", label: "学習ログ" },
];

/** 全ページ共通のヘッダー（会話 ⇄ テンプレート管理 のナビ付き） */
export function AppHeader() {
  const pathname = usePathname();

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
      <span className="ml-auto whitespace-nowrap rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
        モック（ダミーデータ）
      </span>
    </header>
  );
}
