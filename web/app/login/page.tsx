"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `ログイン失敗 (${res.status})`);
        return;
      }
      // next パラメータがあればそこへ、無ければトップへ
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get("next") || "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "通信エラー");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">LINE返信管理（並行世界）</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          共有パスワードを入力してください。
        </p>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード"
          autoFocus
        />
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <Button type="submit" variant="line" className="w-full" disabled={submitting || !password}>
          {submitting ? "確認中…" : "ログイン"}
        </Button>
      </form>
    </div>
  );
}
