import { FriendlyError, type TokenUsage } from "./ai";
import { MODEL } from "./config";
import { checkRequest, clientIp } from "./guard";
import { costOf, estimateCost } from "./pricing";
import { reserve, settle } from "./usage";

export type MeteredResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/**
 * Runs one AI call inside the safety checks:
 * access code → per-person daily pages → whole-site daily budget → call → record real cost.
 */
export async function metered<T>(
  req: Request,
  opts: { pages: number; images: number },
  run: () => Promise<{ data: T; usage: TokenUsage }>,
): Promise<MeteredResult<T>> {
  const guard = checkRequest(req);
  if (!guard.ok) return guard;

  const reserved = await reserve(clientIp(req), opts.pages, estimateCost(MODEL, opts.images));
  if (!reserved.ok) return reserved;

  try {
    const { data, usage } = await run();
    await settle(reserved.reservation, costOf(MODEL, usage), true);
    return { ok: true, data };
  } catch (err) {
    const e = err instanceof FriendlyError ? err : new FriendlyError("處理失敗，請再試一次。");
    await settle(reserved.reservation, e.usage ? costOf(MODEL, e.usage) : 0, false);
    return { ok: false, status: e.status, error: e.message };
  }
}
