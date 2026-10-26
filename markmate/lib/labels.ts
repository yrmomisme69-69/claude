import type { ErrorType, GradedQuestion, PageGrading, QuestionType, Verdict } from "./types";

export const verdictLabel: Record<Verdict, string> = {
  correct: "正確",
  partially_correct: "部分正確",
  incorrect: "錯誤",
  scored: "已評分",
  unanswered: "未作答",
  unreadable: "睇唔清",
  needs_review: "要你再確認",
};

export const errorTypeLabel: Record<ErrorType, string> = {
  none: "冇錯",
  concept: "概念唔清",
  method: "方法錯",
  calculation: "計數失誤",
  careless: "粗心",
  misread_question: "睇錯題目",
  incomplete: "答得唔完整",
  expression: "表達 / 文法",
  other: "其他",
};

export const questionTypeLabel: Record<QuestionType, string> = {
  mc: "選擇題",
  true_false: "是非題",
  fill_blank: "填充題",
  short_answer: "短答題",
  calculation: "計算題",
  long_answer: "長題目",
  essay: "作文 / 寫作",
  other: "其他",
};

/** Tailwind classes for the verdict chip. */
export function verdictTone(v: Verdict): string {
  switch (v) {
    case "correct":
      return "border border-redpen/40 text-redpen";
    case "partially_correct":
    case "scored":
      return "bg-ok-soft text-redpen";
    case "incorrect":
    case "unanswered":
      return "bg-redpen text-white";
    case "needs_review":
      return "border border-marker bg-marker-soft text-ink";
    default:
      return "bg-paper-2 text-ink-soft";
  }
}

export function verdictSymbol(v: Verdict): string {
  switch (v) {
    case "correct":
      return "✓";
    case "partially_correct":
      return "◐";
    case "incorrect":
    case "unanswered":
      return "✗";
    case "scored":
      return "★";
    default:
      return "?";
  }
}

export interface Totals {
  awarded: number;
  available: number;
  counts: Record<Verdict, number>;
  errors: Partial<Record<ErrorType, number>>;
  questions: number;
}

export function computeTotals(pages: (PageGrading | undefined)[]): Totals {
  const counts = {
    correct: 0,
    partially_correct: 0,
    incorrect: 0,
    scored: 0,
    unanswered: 0,
    unreadable: 0,
    needs_review: 0,
  } as Record<Verdict, number>;
  const errors: Partial<Record<ErrorType, number>> = {};
  let awarded = 0;
  let available = 0;
  let questions = 0;
  for (const p of pages) {
    if (!p) continue;
    for (const q of p.questions) {
      questions++;
      counts[q.verdict] = (counts[q.verdict] || 0) + 1;
      if (q.error_type && q.error_type !== "none") errors[q.error_type] = (errors[q.error_type] || 0) + 1;
      if (q.marks_available > 0 && q.verdict !== "needs_review" && q.verdict !== "unreadable") {
        available += q.marks_available;
        awarded += Math.max(0, q.marks_awarded);
      }
    }
  }
  return { awarded, available, counts, errors, questions };
}

export function formatMarks(q: GradedQuestion): string {
  if (q.marks_available <= 0) return "";
  const a = q.marks_awarded < 0 ? "?" : trimNum(q.marks_awarded);
  return `${a}/${trimNum(q.marks_available)}`;
}

export function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}
