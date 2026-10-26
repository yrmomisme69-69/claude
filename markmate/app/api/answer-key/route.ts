import { ANSWER_KEY_SYSTEM_PROMPT } from "@/lib/prompts";
import { answerKeySchema } from "@/lib/schema";
import { callStructured, type ContentPart } from "@/lib/server/ai";
import { metered } from "@/lib/server/metered";
import type { AnswerKeyExtraction, AnswerKeyRequestBody } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_TOTAL_BASE64 = 4_300_000;
const MAX_IMAGES = 8;

export async function POST(req: Request) {
  let body: AnswerKeyRequestBody;
  try {
    body = (await req.json()) as AnswerKeyRequestBody;
  } catch {
    return Response.json({ error: "請求格式錯誤。" }, { status: 400 });
  }
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  if (!images.length) return Response.json({ error: "冇收到答案頁。" }, { status: 400 });
  const total = images.reduce((n, img) => n + (img.data?.length || 0), 0);
  if (total > MAX_TOTAL_BASE64) return Response.json({ error: "答案頁太大，請分開上載。" }, { status: 413 });

  const content: ContentPart[] = [];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `Answer key page ${body.startPage + i}:` });
    content.push({ type: "image", data: img.data });
  });
  content.push({ type: "text", text: "Transcribe every answer on these pages." });

  // Each answer-key page counts toward the person's daily pages as half a page, rounded up.
  const result = await metered(req, { pages: Math.ceil(images.length / 2), images: images.length }, () =>
    callStructured<AnswerKeyExtraction>({
      system: [{ text: ANSWER_KEY_SYSTEM_PROMPT, cache: true }],
      content,
      schema: answerKeySchema as unknown as Record<string, unknown>,
      maxTokens: 32000,
    }),
  );
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.data);
}
