// Shared types between the API routes and the browser.

export type QuestionType =
  | "mc"
  | "true_false"
  | "fill_blank"
  | "short_answer"
  | "calculation"
  | "long_answer"
  | "essay"
  | "other";

export type Verdict =
  | "correct"
  | "partially_correct"
  | "incorrect"
  | "scored" // essay / writing marked on a rubric (e.g. IELTS band)
  | "unanswered"
  | "unreadable"
  | "needs_review";

export type ErrorType =
  | "none"
  | "concept"
  | "calculation"
  | "careless"
  | "misread_question"
  | "incomplete"
  | "method"
  | "expression"
  | "other";

/** Pixel box [x1, y1, x2, y2] in the page image, or [] when unknown. */
export type Box = number[];
/** Pixel point [x, y] in the page image, or [] when unknown. */
export type Point = number[];

export interface GradedQuestion {
  id: string;
  type: QuestionType;
  prompt_summary: string;
  student_answer: string;
  correct_answer: string;
  verdict: Verdict;
  marks_awarded: number; // -1 = unknown
  marks_available: number; // -1 = unknown
  answer_source: "answer_key" | "ai_solution";
  confidence: "high" | "medium" | "low";
  error_type: ErrorType;
  first_error: string;
  explanation: string; // Markdown + LaTeX
  short_note: string; // very short pen note shown on the page
  answer_key_concern: string;
  question_box: Box;
  mark_point: Point;
  student_choice_box: Box;
  correct_choice_box: Box;
}

export interface PageGrading {
  page_readable: boolean;
  page_note: string;
  subject: string;
  page_summary: string;
  questions: GradedQuestion[];
}

export interface AnswerKeyEntry {
  question_id: string;
  answer: string;
  notes: string;
}

export interface AnswerKeyExtraction {
  entries: AnswerKeyEntry[];
  general_notes: string;
}

export type ExplanationLanguage = "zh-HK" | "en" | "auto";

export interface GradeRequestBody {
  /** base64 JPEG without the data: prefix. Omit for typed-only mode. */
  image?: string;
  width?: number;
  height?: number;
  /** Typed questions + answers (typed mode), or extra typed answers for this page. */
  typedWork?: string;
  pageNumber: number;
  totalPages: number;
  answerKeyText?: string;
  subjectHint?: string;
  language: ExplanationLanguage;
  extraInstructions?: string;
}

export interface AnswerKeyRequestBody {
  images: { data: string; width: number; height: number }[];
  startPage: number;
}

export interface AppConfig {
  needsAccessCode: boolean;
  hasApiKey: boolean;
  model: string;
  dailyPageLimit: number;
  imageTier: "high" | "standard";
}
