import { createHash, timingSafeEqual } from "node:crypto";
import { ACCESS_CODE, HAS_API_KEY } from "./config";

// Checks that run before any usage is counted. Daily limits live in usage.ts.

/** On Vercel these headers are set by the platform, not by the visitor. */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "local";
}

export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

export function checkRequest(req: Request): GuardResult {
  if (!HAS_API_KEY) {
    return {
      ok: false,
      status: 500,
      error: "伺服器未設定 ANTHROPIC_API_KEY。請喺 Vercel 嘅 Environment Variables 加返 API key，再 redeploy。",
    };
  }
  if (ACCESS_CODE) {
    const given = req.headers.get("x-access-code") || "";
    if (!sameSecret(given, ACCESS_CODE)) {
      return { ok: false, status: 401, error: "入場密碼唔啱。" };
    }
  }
  return { ok: true };
}

/** Compares secrets without leaking how many characters matched. */
export function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
