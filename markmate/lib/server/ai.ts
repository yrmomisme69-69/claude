import { PROVIDER } from "./config";

/** One piece of the user message: text, or a JPEG page image (base64). */
export type ContentPart = { type: "text"; text: string } | { type: "image"; data: string };

export type SystemBlock = { text: string; cache?: boolean };

/** Token counts of one request, in the shape the price table expects. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export class FriendlyError extends Error {
  status: number;
  /** Tokens already used (and paid for) before the error, if any. */
  usage?: TokenUsage;
  constructor(message: string, status = 500, usage?: TokenUsage) {
    super(message);
    this.status = status;
    this.usage = usage;
  }
}

export interface StructuredRequest {
  system: SystemBlock[];
  content: ContentPart[];
  schema: Record<string, unknown>;
  maxTokens: number;
}

/** Asks the configured AI (Claude or Gemini) for JSON matching `schema`. */
export async function callStructured<T>(opts: StructuredRequest): Promise<{ data: T; usage: TokenUsage }> {
  if (PROVIDER === "gemini") {
    const { callGemini } = await import("./gemini");
    return callGemini<T>(opts);
  }
  const { callClaude } = await import("./claude");
  return callClaude<T>(opts);
}
