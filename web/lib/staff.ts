// 返信対応スタッフの一覧（まずは固定。フェーズBで staff テーブル化できる）
export const STAFF = ["酢崎", "水口", "小沼", "郡司", "他スタッフ"] as const;

export type Staff = (typeof STAFF)[number];
