// 現在ログイン中のスタッフを解決する（サーバー側専用）。
//
// 設計: セッション（ログイン本人 = auth.users）は @supabase/ssr で確認し、
//       staff 行（display_name / role）は RLS を書かない方針なので
//       service_role の素のfetchで引く（lib/backend.ts と同じ信頼境界）。
//
// env が無いモックモードでは null を返す（呼び出し側でモック挙動にフォールバック）。
import { createSupabaseServerClient, hasAuth } from "@/lib/supabase/server";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";

export type StaffRole = "staff" | "master";

export interface CurrentStaff {
  id: string; // staff.id (uuid)
  authUserId: string; // auth.users.id
  displayName: string; // staff.display_name（担当者表示・通知に使う名前）
  role: StaffRole;
}

interface StaffRow {
  id: string;
  display_name: string;
  role: StaffRole;
  active: boolean;
}

/** ログイン本人の staff 行を返す。未ログイン/未登録/退職(active=false)/モックモードでは null。 */
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  if (!hasAuth() || !SERVICE_KEY) return null;

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const url =
    `${SUPABASE_URL}/rest/v1/staff` +
    `?select=id,display_name,role,active&auth_user_id=eq.${user.id}&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) return null;

  const rows = (await res.json()) as StaffRow[];
  const row = rows[0];
  if (!row || row.active === false) return null;

  return {
    id: row.id,
    authUserId: user.id,
    displayName: row.display_name,
    role: row.role,
  };
}
