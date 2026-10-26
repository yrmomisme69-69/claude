import { ACCESS_CODE, DAILY_PAGE_LIMIT, HAS_API_KEY, MODEL, modelImageTier } from "@/lib/server/config";
import type { AppConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  const config: AppConfig = {
    needsAccessCode: Boolean(ACCESS_CODE),
    hasApiKey: HAS_API_KEY,
    model: MODEL,
    dailyPageLimit: DAILY_PAGE_LIMIT,
    imageTier: modelImageTier(),
  };
  return Response.json(config);
}
