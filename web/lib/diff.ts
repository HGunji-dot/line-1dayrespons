// AI下書き(generated)と送信文(sent)の差分を計算する。
// 日本語は単語区切りが無いので「文字単位」のLCS差分が安定する。
// テキストは短い(〜数百文字)ので O(n*m) で十分。

export type DiffSegType = "equal" | "added" | "removed";
export interface DiffSeg {
  type: DiffSegType;
  value: string;
}

/**
 * 文字単位の差分。
 * a=generated(元のAI下書き) / b=sent(実際に送った文)
 * removed = AI下書きにあって送信文で消された部分
 * added   = 送信文で新たに足された部分
 */
export function diffChars(a: string, b: string): DiffSeg[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i..], b[j..] の最長共通部分列長
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segs: DiffSeg[] = [];
  const push = (type: DiffSegType, ch: string) => {
    const last = segs[segs.length - 1];
    if (last && last.type === type) last.value += ch;
    else segs.push({ type, value: ch });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("removed", a[i]);
      i++;
    } else {
      push("added", b[j]);
      j++;
    }
  }
  while (i < n) push("removed", a[i++]);
  while (j < m) push("added", b[j++]);
  return segs;
}

/** 0..1 の類似度（1=完全一致）。共通部分の割合（Dice係数ベース） */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  let eq = 0;
  for (const s of diffChars(a, b)) if (s.type === "equal") eq += s.value.length;
  return (2 * eq) / ((a.length + b.length) || 1);
}

/** 編集率(%)。大きいほど人が多く直した＝AIの精度が低い */
export function editRatePct(generated: string, sent: string): number {
  return Math.round((1 - similarity(generated, sent)) * 100);
}
