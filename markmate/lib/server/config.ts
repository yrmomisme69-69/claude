import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

const hasClaudeKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());

/** Which AI marks the pages. AI_PROVIDER wins; otherwise Gemini when only a Gemini key is set. */
const rawProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
export const PROVIDER: "claude" | "gemini" =
  rawProvider === "gemini" || rawProvider === "claude" ? rawProvider : hasGeminiKey && !hasClaudeKey ? "gemini" : "claude";

export const MODEL =
  PROVIDER === "gemini"
    ? process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash"
    : process.env.CLAUDE_MODEL?.trim() || "claude-sonnet-5-5";

/** Gemini model to switch to when MODEL is overloaded. Set GEMINI_FALLBACK_MODEL=none to turn it off. */
const rawFallback = process.env.GEMINI_FALLBACK_MODEL?.trim();
export const GEMINI_FALLBACK_MODEL = rawFallback === "none" ? "" : rawFallback || "gemini-2.5-flash";

type Effort = "low" | "medium" | "high";
const rawEffort = process.env.AI_EFFORT?.trim() || process.env.CLAUDE_EFFORT?.trim();
export const EFFORT: Effort = rawEffort === "low" || rawEffort === "high" ? rawEffort : "medium";

export const ACCESS_CODE = process.env.ACCESS_CODE?.trim() || "";
export const ADMIN_CODE = process.env.ADMIN_CODE?.trim() || "";

/** Pages one person (IP address) may mark per day. */
export const DAILY_PAGE_LIMIT = Number(process.env.DAILY_PAGE_LIMIT) > 0 ? Number(process.env.DAILY_PAGE_LIMIT) : 40;

/** Most the whole site may spend on AI per day, in US dollars. 0 turns the cap off. */
const rawBudget = process.env.DAILY_BUDGET_USD?.trim();
export const DAILY_BUDGET_USD = rawBudget !== undefined && rawBudget !== "" && Number.isFinite(Number(rawBudget)) ? Math.max(0, Number(rawBudget)) : 2;

/** Days reset at midnight in this time zone. */
export const TIMEZONE = process.env.APP_TIMEZONE?.trim() || "Asia/Hong_Kong";

export const HAS_API_KEY = PROVIDER === "gemini" ? hasGeminiKey : hasClaudeKey;

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
  // Gemini returns coordinates on a 0–1000 scale, so any image size works.
  if (PROVIDER === "gemini") return "high";
  return STANDARD_TIER_PREFIXES.some((p) => model.startsWith(p)) ? "standard" : "high";
}

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

let geminiClient: GoogleGenAI | null = null;
export function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY?.trim() });
  return geminiClient;
}
