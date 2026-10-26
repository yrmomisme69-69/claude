import { DAILY_BUDGET_USD, DAILY_PAGE_LIMIT, TIMEZONE } from "./config";

// Usage counters for the daily limits.
//
// With Upstash Redis connected (Vercel → Storage / Marketplace → Upstash Redis),
// counters are shared by every server instance and survive redeploys.
// Without it, they live in this server instance's memory: still a useful speed
// bump, but they reset on redeploy and each instance counts separately.
//
// Either way, also set a monthly spend limit in the Claude Console. That is the
// hard guarantee; these counters are the first line of defence.

type Cmd = (string | number)[];

const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").replace(/\/$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
export const STORE_KIND: "redis" | "memory" = REDIS_URL && REDIS_TOKEN ? "redis" : "memory";

const TTL_SECONDS = 8 * 24 * 3600; // keep a week of history for the admin page

// ---- memory store ----
const mem = new Map<string, number>();
function memExec(cmds: Cmd[]): unknown[] {
  return cmds.map(([op, key, arg]) => {
    const k = String(key);
    switch (op) {
      case "INCRBY":
      case "INCRBYFLOAT": {
        const v = (mem.get(k) || 0) + Number(arg);
        mem.set(k, v);
        return v;
      }
      case "GET":
        return mem.has(k) ? mem.get(k) : null;
      default:
        return 1; // EXPIRE: memory keys are pruned by day instead
    }
  });
}
function pruneMemory(day: string) {
  for (const k of mem.keys()) if (!k.startsWith(`mm:${day}:`)) mem.delete(k);
}

// ---- redis store (Upstash REST API, no extra package needed) ----
async function redisExec(cmds: Cmd[]): Promise<unknown[]> {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmds.map((c) => c.map(String))),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: string }[];
  return data.map((d) => {
    if (d.error) throw new Error(d.error);
    return d.result;
  });
}

let lastStoreError = 0;

async function exec(cmds: Cmd[]): Promise<unknown[]> {
  if (STORE_KIND === "redis") {
    try {
      return await redisExec(cmds);
    } catch (err) {
      lastStoreError = Date.now();
      console.error("Usage store unreachable, falling back to memory for this request:", err);
    }
  }
  return memExec(cmds);
}

export function today(offsetDays = 0): string {
  // en-CA formats as YYYY-MM-DD
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const keys = (day: string, ip?: string) => ({
  spend: `mm:${day}:spend`,
  pages: `mm:${day}:pages`,
  requests: `mm:${day}:requests`,
  ip: ip ? `mm:${day}:ip:${ip}` : "",
});

export interface Reservation {
  day: string;
  ip: string;
  pages: number;
  estimate: number;
}

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; status: number; error: string };

/**
 * Called before contacting Claude. Counts the pages against the per-IP limit and
 * reserves an upper-bound cost against the daily budget.
 */
export async function reserve(ip: string, pages: number, estimate: number): Promise<ReserveResult> {
  const day = today();
  if (STORE_KIND === "memory") pruneMemory(day);
  const k = keys(day, ip);
  const [ipCount, spend] = (await exec([
    ["INCRBY", k.ip, pages],
    ["INCRBYFLOAT", k.spend, estimate.toFixed(6)],
    ["EXPIRE", k.ip, TTL_SECONDS],
    ["EXPIRE", k.spend, TTL_SECONDS],
  ])).map(Number);

  const rollback = () =>
    exec([
      ["INCRBY", k.ip, -pages],
      ["INCRBYFLOAT", k.spend, (-estimate).toFixed(6)],
    ]);

  if (ipCount > DAILY_PAGE_LIMIT) {
    await rollback();
    return {
      ok: false,
      status: 429,
      error: `今日已經改咗 ${Math.max(0, ipCount - pages)} 頁，到咗每人每日上限 ${DAILY_PAGE_LIMIT} 頁。聽日再試。`,
    };
  }
  if (DAILY_BUDGET_USD > 0 && spend > DAILY_BUDGET_USD) {
    await rollback();
    return {
      ok: false,
      status: 429,
      error: "今日全站嘅改卷額度已經用完，聽日（香港時間凌晨 12 點後）再試。",
    };
  }
  return { ok: true, reservation: { day, ip, pages, estimate } };
}

/**
 * Called after Claude answers (or fails). Replaces the reserved estimate with the
 * real cost. Failed requests give the pages back to the person's daily allowance.
 */
export async function settle(r: Reservation, actualCost: number, succeeded: boolean): Promise<void> {
  const k = keys(r.day, r.ip);
  const cmds: Cmd[] = [["INCRBYFLOAT", k.spend, (actualCost - r.estimate).toFixed(6)]];
  if (succeeded) {
    cmds.push(["INCRBY", k.pages, r.pages], ["INCRBY", k.requests, 1], ["EXPIRE", k.pages, TTL_SECONDS], ["EXPIRE", k.requests, TTL_SECONDS]);
  } else {
    cmds.push(["INCRBY", k.ip, -r.pages]);
  }
  try {
    await exec(cmds);
  } catch (err) {
    console.error("Could not record usage:", err);
  }
}

export async function stats(day = today()) {
  const k = keys(day);
  const [spend, pages, requests] = (await exec([["GET", k.spend], ["GET", k.pages], ["GET", k.requests]])).map((v) => Number(v) || 0);
  return {
    day,
    spendUsd: Math.max(0, spend),
    pages,
    requests,
    budgetUsd: DAILY_BUDGET_USD,
    perPersonPageLimit: DAILY_PAGE_LIMIT,
    store: STORE_KIND,
    storeError: STORE_KIND === "redis" && Date.now() - lastStoreError < 15 * 60_000,
  };
}
