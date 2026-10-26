import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL?.trim() || "claude-sonnet-5-5";

type Effort = "low" | "medium" | "high";
const rawEffort = process.env.CLAUDE_EFFORT?.trim();
export const EFFORT: Effort = rawEffort === "low" || rawEffort === "high" ? rawEffort : "medium";

export const ACCESS_CODE = process.env.ACCESS_CODE?.trim() || "";
export const ADMIN_CODE = process.env.ADMIN_CODE?.trim() || "";

/** Pages one person (IP address) may mark per day. */
export const DAILY_PAGE_LIMIT = Number(process.env.DAILY_PAGE_LIMIT) > 0 ? Number(process.env.DAILY_PAGE_LIMIT) : 40;

/** Most the whole site may spend on Claude per day, in US dollars. 0 turns the cap off. */
const rawBudget = process.env.DAILY_BUDGET_USD?.trim();
export const DAILY_BUDGET_USD = rawBudget !== undefined && rawBudget !== "" && Number.isFinite(Number(rawBudget)) ? Math.max(0, Number(rawBudget)) : 2;

/** Days reset at midnight in this time zone. */
export const TIMEZONE = process.env.APP_TIMEZONE?.trim() || "Asia/Hong_Kong";

export const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

/** Claude 4.7+ models use the high-resolution image tier; older ones the standard tier. */
const STANDARD_TIER_PREFIXES = [
  "claude-3",
  "claude-haiku-4-5",
  "claude-sonnet-4-",
  "claude-opus-4-0",
  "claude-opus-4-1",
  "claude-opus-4-5",
  "claude-opus-4-6",
];
export function modelImageTier(model = MODEL): "high" | "standard" {
  return STANDARD_TIER_PREFIXES.some((p) => model.startsWith(p)) ? "standard" : "high";
}

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}
