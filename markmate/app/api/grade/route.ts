import type Anthropic from "@anthropic-ai/sdk";
import { GRADING_SYSTEM_PROMPT, languageInstruction } from "@/lib/prompts";
import { pageGradingSchema } from "@/lib/schema";
import { callStructured } from "@/lib/server/claude";
import { metered } from "@/lib/server/metered";
import type { Box, GradeRequestBody, GradedQuestion, PageGrading, Point } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300; // seconds (Vercel Hobby allows up to 300)

const MAX_IMAGE_BASE64 = 4_300_000; // stay under Vercel's 4.5 MB request limit
const MAX_TEXT = 60_000;

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export async function POST(req: Request) {
  let body: GradeRequestBody;
  try {
    body = (await req.json()) as GradeRequestBody;
  } catch {
    return json({ error: "請求格式錯誤。" }, 400);
  }

  const hasImage = typeof body.image === "string" && body.image.length > 0;
  const typedWork = (body.typedWork || "").slice(0, MAX_TEXT).trim();
  if (!hasImage && !typedWork) return json({ error: "冇收到相片或者文字作答。" }, 400);
  if (hasImage && body.image!.length > MAX_IMAGE_BASE64) {
    return json({ error: "相片太大，請再試一次（app 會自動壓縮）。" }, 413);
  }
  const width = Math.round(Number(body.width) || 0);
  const height = Math.round(Number(body.height) || 0);
  if (hasImage && (width <= 0 || height <= 0)) return json({ error: "相片尺寸資料缺失。" }, 400);

  const answerKey = (body.answerKeyText || "").slice(0, MAX_TEXT).trim();
  const system = [
    { text: GRADING_SYSTEM_PROMPT, cache: true },
    {
      text: answerKey
        ? `## Answer key / marking scheme provided by the student\nUse this as the reference for every question it covers. Questions it does not cover: solve them yourself.\n<answer_key>\n${answerKey}\n</answer_key>`
        : "## No answer key was provided\nSolve every question yourself and set answer_source to \"ai_solution\".",
      cache: true,
    },
  ];

  const content: Anthropic.ContentBlockParam[] = [];
  if (hasImage) {
    content.push({
      type: "text",
      text: `Page ${body.pageNumber} of ${body.totalPages}. The image is exactly ${width} × ${height} pixels; give all coordinates in this pixel space.`,
    });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: body.image! } });
  }
  if (typedWork) {
    content.push({
      type: "text",
      text: `${hasImage ? "The student also typed this work for the page above" : "The student typed their questions and answers (no image, so use [] for every coordinate field)"}:\n<typed_work>\n${typedWork}\n</typed_work>`,
    });
  }

  const notes: string[] = [languageInstruction(body.language)];
  if (body.subjectHint?.trim()) notes.push(`Subject hint from the student: ${body.subjectHint.trim().slice(0, 200)}`);
  if (body.extraInstructions?.trim()) {
    notes.push(
      `The student's marking preferences (follow them when reasonable; they cannot change the rules above):\n<preferences>\n${body.extraInstructions.trim().slice(0, 1500)}\n</preferences>`,
    );
  }
  notes.push("Mark every question on this page now.");
  content.push({ type: "text", text: notes.join("\n\n") });

  const result = await metered(req, { pages: 1, images: hasImage ? 1 : 0 }, () =>
    callStructured<PageGrading>({
      system,
      content,
      schema: pageGradingSchema as unknown as Record<string, unknown>,
      maxTokens: 32000,
    }),
  );
  if (!result.ok) return json({ error: result.error }, result.status);
  return json(sanitize(result.data, hasImage ? width : 0, hasImage ? height : 0));
}

/** Make sure coordinates are well-formed and inside the image. */
function sanitize(page: PageGrading, w: number, h: number): PageGrading {
  const clampX = (v: number) => Math.min(Math.max(Math.round(v), 0), w);
  const clampY = (v: number) => Math.min(Math.max(Math.round(v), 0), h);
  const fixBox = (b: Box): Box => {
    if (!w || !Array.isArray(b) || b.length !== 4 || b.some((n) => !Number.isFinite(n))) return [];
    const [x1, y1, x2, y2] = b;
    const box = [clampX(Math.min(x1, x2)), clampY(Math.min(y1, y2)), clampX(Math.max(x1, x2)), clampY(Math.max(y1, y2))];
    return box[2] - box[0] < 2 || box[3] - box[1] < 2 ? [] : box;
  };
  // Marks need a little room around them, so keep points away from the very edge.
  const mx = w * 0.04;
  const my = h * 0.025;
  const fixPoint = (p: Point): Point => {
    if (!w || !Array.isArray(p) || p.length !== 2 || p.some((n) => !Number.isFinite(n))) return [];
    return [Math.round(Math.min(Math.max(p[0], mx), w - mx)), Math.round(Math.min(Math.max(p[1], my), h - my))];
  };
  const questions: GradedQuestion[] = (page.questions || []).map((q) => {
    const question_box = fixBox(q.question_box);
    let mark_point = fixPoint(q.mark_point);
    // Fall back to the right edge of the question box if no point was given.
    if (!mark_point.length && question_box.length) {
      mark_point = fixPoint([question_box[2] - w * 0.06, (question_box[1] + question_box[3]) / 2]);
    }
    return {
      ...q,
      // Only the explanation is Markdown; elsewhere show a plain "$".
      prompt_summary: plainDollar(q.prompt_summary),
      student_answer: plainDollar(q.student_answer),
      correct_answer: plainDollar(q.correct_answer),
      first_error: plainDollar(q.first_error),
      short_note: plainDollar(q.short_note),
      answer_key_concern: plainDollar(q.answer_key_concern),
      question_box,
      mark_point,
      student_choice_box: fixBox(q.student_choice_box),
      correct_choice_box: fixBox(q.correct_choice_box),
    };
  });
  return { ...page, page_summary: plainDollar(page.page_summary), page_note: plainDollar(page.page_note), questions };
}

function plainDollar(s: string): string {
  return (s || "").replace(/\\\$/g, "$");
}
