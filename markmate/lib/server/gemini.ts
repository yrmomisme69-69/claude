import { ApiError, FinishReason, ThinkingLevel, type GenerateContentResponse, type Part } from "@google/genai";
import { FriendlyError, type StructuredRequest, type TokenUsage } from "./ai";
import { EFFORT, MODEL, getGeminiClient } from "./config";

const RETRYABLE = new Set([500, 503, 504]);
const RETRY_DELAYS_MS = [2_000, 6_000];

const LEVELS = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH } as const;

/** Gemini 3 and later take a thinking level; 2.x models only take a token budget, so leave it to them. */
function supportsThinkingLevel(model: string): boolean {
  const major = Number(/^gemini-(\d+)/.exec(model)?.[1]);
  return Number.isNaN(major) || major >= 3;
}

/**
 * Calls Gemini with a JSON schema (structured output) and returns the parsed JSON.
 * Gemini caches repeated prompt prefixes by itself, so the `cache` flags need no work here.
 */
export async function callGemini<T>(opts: StructuredRequest): Promise<{ data: T; usage: TokenUsage }> {
  const parts: Part[] = opts.content.map((p) =>
    p.type === "text" ? { text: p.text } : { inlineData: { mimeType: "image/jpeg", data: p.data } },
  );
  const started = Date.now();
  let response: GenerateContentResponse | undefined;
  for (let attempt = 0; !response; attempt++) {
    try {
      response = await getGeminiClient().models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: opts.system.map((b) => b.text).join("\n\n"),
          responseMimeType: "application/json",
          responseJsonSchema: opts.schema,
          maxOutputTokens: opts.maxTokens,
          ...(supportsThinkingLevel(MODEL) ? { thinkingConfig: { thinkingLevel: LEVELS[EFFORT] } } : {}),
          httpOptions: { timeout: 280_000 - (Date.now() - started) }, // finish before Vercel's 300 s limit
        },
      });
    } catch (err) {
      console.error(`Gemini error (attempt ${attempt + 1}, model ${MODEL}):`, err instanceof Error ? err.message : err);
      // Overloaded / internal errors are often gone a few seconds later; retry while there is time left.
      const retryable = err instanceof ApiError && RETRYABLE.has(err.status);
      if (!retryable || attempt >= RETRY_DELAYS_MS.length || Date.now() - started > 60_000) throw friendlyGeminiError(err);
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }

  const usage = usageOf(response);
  if (response.promptFeedback?.blockReason) {
    throw new FriendlyError("AI 拒絕處理呢頁內容。請檢查上載嘅係咪功課或者試題。", 422, usage);
  }
  const finish = response.candidates?.[0]?.finishReason;
  if (finish === FinishReason.MAX_TOKENS) {
    throw new FriendlyError("呢頁題目太多，AI 寫唔晒。試吓將頁面裁細啲或者分開兩次上載。", 422, usage);
  }
  if (finish && finish !== FinishReason.STOP) {
    throw new FriendlyError("AI 拒絕處理呢頁內容。請檢查上載嘅係咪功課或者試題。", 422, usage);
  }
  try {
    return { data: JSON.parse(response.text ?? "") as T, usage };
  } catch {
    throw new FriendlyError("AI 回覆格式出錯，請再試一次。", 502, usage);
  }
}

/** Thinking tokens are billed as output; cached prompt tokens are billed at the cache rate. */
function usageOf(response: GenerateContentResponse): TokenUsage {
  const m = response.usageMetadata;
  const cached = m?.cachedContentTokenCount || 0;
  return {
    input_tokens: Math.max((m?.promptTokenCount || 0) - cached, 0),
    cache_read_input_tokens: cached,
    output_tokens: (m?.candidatesTokenCount || 0) + (m?.thoughtsTokenCount || 0),
  };
}

function friendlyGeminiError(err: unknown): FriendlyError {
  if (err instanceof ApiError) {
    const status = err.status;
    if (status === 401 || status === 403 || (status === 400 && /api key/i.test(err.message))) {
      return new FriendlyError("API key 無效或者冇權限。請檢查 GEMINI_API_KEY。", 500);
    }
    if (status === 429) {
      return new FriendlyError("Gemini 用量到咗上限（免費版每分鐘同每日都有限制），等一陣或者聽日再試。", 429);
    }
    if (status === 503) return new FriendlyError("Gemini 而家太繁忙（503），等一陣再試。", 503);
    if (status === 500 || status === 504) return new FriendlyError(`Gemini 伺服器出錯（${status}），等一陣再試。`, 503);
    if (status === 404) return new FriendlyError(`搵唔到模型 ${MODEL}。請檢查 GEMINI_MODEL。`, 500);
    return new FriendlyError(`AI 服務出錯（${status}）。請再試一次。`, 502);
  }
  if (err instanceof Error && /fetch failed|network|ECONN|ETIMEDOUT|abort/i.test(err.message)) {
    return new FriendlyError("伺服器連唔到 Gemini，請稍後再試。", 503);
  }
  console.error("Unexpected error", err);
  return new FriendlyError("改卷時出咗未預期嘅錯誤，請再試一次。", 500);
}
