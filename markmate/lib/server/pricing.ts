import type { TokenUsage } from "./ai";

// USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing
// (5-minute cache writes, which is what this app uses). Check that page when prices change.
interface Price {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  "claude-sonnet-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  "claude-opus-5-5": { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  "claude-opus-5": { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  "claude-fable-5-1": { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 },
  "claude-haiku-4-5": { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
  // Gemini paid-tier prices (https://ai.google.dev/gemini-api/docs/pricing). On the free tier the real cost
  // is US$0, so the daily budget over-counts. 3.8 Flash uses its price from 1 Jan 2027 (its launch price is
  // half that), and the alias is priced the same. Cached reads are priced as normal input to stay on the safe side.
  "gemini-3.8-flash": { input: 1.5, cacheWrite: 1.5, cacheRead: 1.5, output: 7.5 },
  "gemini-flash-latest": { input: 1.5, cacheWrite: 1.5, cacheRead: 1.5, output: 7.5 },
  "gemini-2.5-flash": { input: 0.3, cacheWrite: 0.3, cacheRead: 0.3, output: 2.5 },
};

/** Claude Haiku 5.5 costs more once a prompt passes 100k tokens. */
const HAIKU_55_LONG: Price = { input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 };

/** Unknown models are priced like the most expensive model, so the budget never under-counts. */
const FALLBACK: Price = PRICES["claude-fable-5-1"];

export function priceFor(model: string): Price {
  const exact = PRICES[model];
  if (exact) return exact;
  const prefix = Object.keys(PRICES).find((k) => model.startsWith(k + "-")); // dated snapshot IDs
  return prefix ? PRICES[prefix] : FALLBACK;
}

/** Real cost in USD of one finished request. */
export function costOf(model: string, usage: TokenUsage): number {
  const input = usage.input_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const out = usage.output_tokens || 0;
  let p = priceFor(model);
  if (model.startsWith("claude-haiku-5-5") && input + write + read > 100_000) p = HAIKU_55_LONG;
  return (input * p.input + write * p.cacheWrite + read * p.cacheRead + out * p.output) / 1_000_000;
}

/**
 * A generous upper estimate reserved before a request starts, so many requests
 * arriving at once cannot run far past the daily budget.
 */
export function estimateCost(model: string, images: number): number {
  const p = priceFor(model);
  const inputTokens = 4_000 + images * 5_000; // instructions + answer key + images
  const outputTokens = 10_000; // results, explanations and thinking
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
