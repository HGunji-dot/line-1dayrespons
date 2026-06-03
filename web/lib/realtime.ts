"use client";

import * as React from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

// DB 側トリガーが public チャンネル 'conversation-updates' に流す
// 「変更があった」broadcast を購読する。受信したら onChange を呼ぶ
// （呼び出し側はそこで Next.js サーバから権威データを再取得する）。
// anon 鍵が未設定なら何もしない（同期なしでも画面は動く）。
export function useRealtimeSignal(onChange: () => void) {
  const cb = React.useRef(onChange);
  cb.current = onChange;

  React.useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;

    const channel = supabase
      .channel("conversation-updates", { config: { private: false } })
      .on("broadcast", { event: "changed" }, () => cb.current())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
