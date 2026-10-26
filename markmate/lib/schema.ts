// JSON schemas for Claude structured outputs (output_config.format).
// Rules from the docs: every object lists all its properties in `required`,
// sets additionalProperties: false, and avoids min/max constraints and nullable
// unions. "Unknown" values are therefore expressed as -1, "" or [].

const box = {
  type: "array",
  items: { type: "integer" },
  description:
    "Pixel box [x1, y1, x2, y2] (top-left and bottom-right corners) in the page image you were given. Use [] if it does not apply or you cannot locate it.",
} as const;

export const pageGradingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["page_readable", "page_note", "subject", "page_summary", "questions"],
  properties: {
    page_readable: {
      type: "boolean",
      description: "false if the image is too blurry, dark, cropped or rotated to mark reliably.",
    },
    page_note: {
      type: "string",
      description: "Short note to the student about the page itself (e.g. photo too blurry, page has no questions). Empty string if nothing to say.",
    },
    subject: { type: "string", description: "Subject / topic of this page, e.g. 'Corporate finance – bond pricing'." },
    page_summary: {
      type: "string",
      description: "1–3 sentences of overall feedback for this page: what the student did well and what to review.",
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "type",
          "prompt_summary",
          "student_answer",
          "correct_answer",
          "verdict",
          "marks_awarded",
          "marks_available",
          "answer_source",
          "confidence",
          "error_type",
          "first_error",
          "explanation",
          "short_note",
          "answer_key_concern",
          "question_box",
          "mark_point",
          "student_choice_box",
          "correct_choice_box",
        ],
        properties: {
          id: { type: "string", description: "Question number as printed, e.g. '3', '2(b)(ii)'." },
          type: {
            type: "string",
            enum: ["mc", "true_false", "fill_blank", "short_answer", "calculation", "long_answer", "essay", "other"],
          },
          prompt_summary: { type: "string", description: "One-line summary of what the question asks." },
          student_answer: { type: "string", description: "The student's final answer, transcribed. Empty if unanswered." },
          correct_answer: { type: "string", description: "The correct answer (final answer, concise)." },
          verdict: {
            type: "string",
            enum: ["correct", "partially_correct", "incorrect", "scored", "unanswered", "unreadable", "needs_review"],
          },
          marks_awarded: { type: "number", description: "Marks given. -1 if not applicable." },
          marks_available: { type: "number", description: "Marks available. -1 if not applicable." },
          answer_source: { type: "string", enum: ["answer_key", "ai_solution"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          error_type: {
            type: "string",
            enum: ["none", "concept", "calculation", "careless", "misread_question", "incomplete", "method", "expression", "other"],
          },
          first_error: {
            type: "string",
            description: "Where the student's work first goes wrong (quote the step). Empty if correct.",
          },
          explanation: {
            type: "string",
            description:
              "Explanation written for the student in Markdown. Math in LaTeX between $...$ or $$...$$. Explain why the correct answer is correct and, if the student is wrong, why their answer is wrong.",
          },
          short_note: {
            type: "string",
            description: "A very short teacher's pen note to write on the page next to the mark, max ~20 characters, e.g. 'Ans: B', '= $40', 'sign error'. Empty if correct.",
          },
          answer_key_concern: {
            type: "string",
            description: "If you believe the provided answer key is wrong for this question, explain briefly. Otherwise empty.",
          },
          question_box: box,
          mark_point: {
            type: "array",
            items: { type: "integer" },
            description:
              "Pixel point [x, y] where the tick or cross should be drawn: in empty space just to the right of (or below) the student's final answer, not covering any writing. [] if none.",
          },
          student_choice_box: {
            ...box,
            description: "For MC/true-false only: pixel box around the option the student chose. [] otherwise.",
          },
          correct_choice_box: {
            ...box,
            description: "For MC/true-false only: pixel box around the correct option's letter/label as printed on the page. [] otherwise.",
          },
        },
      },
    },
  },
} as const;

export const answerKeySchema = {
  type: "object",
  additionalProperties: false,
  required: ["entries", "general_notes"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question_id", "answer", "notes"],
        properties: {
          question_id: { type: "string", description: "Question number as printed, e.g. '4', '2(b)'." },
          answer: { type: "string", description: "The answer exactly as given in the key (final answer and key working)." },
          notes: { type: "string", description: "Marking-scheme details: method marks, acceptable alternatives, mark allocation. Empty if none." },
        },
      },
    },
    general_notes: {
      type: "string",
      description: "Any general marking instructions in the key (e.g. accept 3 s.f.). Empty if none.",
    },
  },
} as const;
