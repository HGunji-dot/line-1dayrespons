import { ReplyConsole } from "@/components/reply-console";
import { getConversations, hasRealBackend } from "@/lib/backend";

// 実DBを毎回反映するためキャッシュしない（env が無ければモックを返す）。
export const dynamic = "force-dynamic";

export default async function Page() {
  const conversations = await getConversations();
  return <ReplyConsole initialConversations={conversations} useRealBackend={hasRealBackend()} />;
}
