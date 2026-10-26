import { ADMIN_CODE, MODEL } from "@/lib/server/config";
import { sameSecret } from "@/lib/server/guard";
import { stats, today } from "@/lib/server/usage";

export const dynamic = "force-dynamic";

/** Owner-only usage figures for the /admin page. */
export async function GET(req: Request) {
  if (!ADMIN_CODE) {
    return Response.json({ error: "未設定 ADMIN_CODE。喺 Vercel 加一個 ADMIN_CODE 環境變數，再 redeploy。" }, { status: 404 });
  }
  if (!sameSecret(req.headers.get("x-admin-code") || "", ADMIN_CODE)) {
    return Response.json({ error: "管理員密碼唔啱。" }, { status: 401 });
  }
  const days = await Promise.all(Array.from({ length: 7 }, (_, i) => stats(today(i))));
  return Response.json({ model: MODEL, days });
}
