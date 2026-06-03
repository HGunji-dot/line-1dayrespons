import { ReplyConsole } from "@/components/reply-console";
import { getConversations, hasRealBackend } from "@/lib/backend";
import { getCurrentStaff } from "@/lib/auth";

// 実DBを毎回反映するためキャッシュしない（env が無ければモックを返す）。
export const dynamic = "force-dynamic";

export default async function Page() {
  const [conversations, staff] = await Promise.all([
    getConversations(),
    getCurrentStaff(),
  ]);
  return (
    <ReplyConsole
      initialConversations={conversations}
      useRealBackend={hasRealBackend()}
      currentStaff={staff ? { displayName: staff.displayName, role: staff.role } : null}
    />
  );
}
