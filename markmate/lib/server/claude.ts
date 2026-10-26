import Anthropic from "@anthropic-ai/sdk";
import { FriendlyError, type ContentPart, type StructuredRequest, type TokenUsage } from "./ai";
import { EFFORT, MODEL, getClient } from "./config";

/**
 * Calls Claude with a JSON schema (structured outputs) and returns the parsed JSON.
 * Uses streaming under the hood so long answers never hit the SDK's
 * non-streaming timeout guard.
 */
export async function callClaude<T>(opts: StructuredRequest): Promise<{ data: T; usage: TokenUsage }> {
  const client = getClient();
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: opts.maxTokens,
      system: opts.system.map((b) =>
        b.cache ? { type: "text" as const, text: b.text, cache_control: { type: "ephemeral" as const } } : { type: "text" as const, text: b.text },
      ),
      messages: [{ role: "user", content: opts.content.map(toClaudeBlock) }],
      output_config: {
        effort: opts.effort ?? EFFORT,
        format: { type: "json_schema", schema: opts.schema },
      },
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new FriendlyError("AI 拒絕處理呢頁內容。請檢查上載嘅係咪功課或者試題。", 422, message.usage);
    }
    if (message.stop_reason === "max_tokens") {
      throw new FriendlyError("呢頁題目太多，AI 寫唔晒。試吓將頁面裁細啲或者分開兩次上載。", 422, message.usage);
    }
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    try {
      return { data: JSON.parse(text) as T, usage: message.usage };
    } catch {
      throw new FriendlyError("AI 回覆格式出錯，請再試一次。", 502, message.usage);
    }
  } catch (err) {
    if (err instanceof FriendlyError) throw err;
    if (err instanceof Anthropic.APIConnectionError) {
      throw new FriendlyError("伺服器連唔到 Claude，請稍後再試。", 503);
    }
    if (err instanceof Anthropic.APIError) {
      const status = err.status ?? 500;
      if (status === 401 || status === 403) throw new FriendlyError("API key 無效或者冇權限。請檢查 ANTHROPIC_API_KEY。", 500);
      if (status === 429) throw new FriendlyError("而家用緊嘅人太多（API 用量上限），等一陣再試。", 429);
      if (status === 529 || status === 503) throw new FriendlyError("Claude 而家太繁忙，等一陣再試。", 503);
      if (status === 400 && /credit|balance|billing/i.test(err.message)) {
        throw new FriendlyError("API 戶口餘額不足，請去 Claude Console 增值。", 402);
      }
      console.error("Anthropic API error", status, err.message);
      throw new FriendlyError(`AI 服務出錯（${status}）。請再試一次。`, 502);
    }
    console.error("Unexpected error", err);
    throw new FriendlyError("改卷時出咗未預期嘅錯誤，請再試一次。", 500);
  }
}

function toClaudeBlock(part: ContentPart): Anthropic.ContentBlockParam {
  return part.type === "text"
    ? { type: "text", text: part.text }
    : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: part.data } };
}
