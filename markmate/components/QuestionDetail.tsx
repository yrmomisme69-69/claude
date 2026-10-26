"use client";

import Markdown from "./Markdown";
import { errorTypeLabel, formatMarks, questionTypeLabel, verdictLabel, verdictSymbol, verdictTone } from "@/lib/labels";
import type { GradedQuestion } from "@/lib/types";

interface Props {
  q: GradedQuestion;
  pageLabel: string;
  position: string;
  onPrev?: () => void;
  onNext?: () => void;
  onClose?: () => void;
}

const confidenceLabel = { high: "高", medium: "中", low: "低" } as const;

export default function QuestionDetail({ q, pageLabel, position, onPrev, onNext, onClose }: Props) {
  const marks = formatMarks(q);
  return (
    <article className="flex h-full flex-col">
      <header className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-faint">
            {pageLabel} <span className="px-1">／</span> {position}
          </p>
          <h2 className="mt-0.5 flex flex-wrap items-center gap-2 text-lg font-bold">
            第 {q.id} 題
            <span className="text-sm font-normal text-ink-soft">{questionTypeLabel[q.type]}</span>
          </h2>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold ${verdictTone(q.verdict)}`}>
          {verdictSymbol(q.verdict)} {verdictLabel[q.verdict]}
          {marks && <span className="ml-1 font-normal">{marks}</span>}
        </span>
        {onClose && (
          <button onClick={onClose} className="-mr-2 -mt-1 rounded-full p-2 text-ink-soft hover:bg-paper-2" aria-label="關閉">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {q.prompt_summary && <p className="text-[15px] text-ink-soft">{q.prompt_summary}</p>}

        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-lg bg-paper-2 px-3 py-2">
            <dt className="text-xs text-ink-faint">你的答案</dt>
            <dd className={`mt-0.5 break-words font-medium ${q.verdict === "incorrect" ? "text-redpen line-through decoration-1" : ""}`}>
              {q.student_answer || <span className="text-ink-faint">（冇作答）</span>}
            </dd>
          </div>
          <div className="rounded-lg bg-blue-soft px-3 py-2">
            <dt className="text-xs text-ink-faint">正確答案</dt>
            <dd className="mt-0.5 break-words font-medium text-bluepen">{q.correct_answer || "—"}</dd>
          </div>
        </dl>

        {q.first_error && (
          <div className="border-l-4 border-redpen pl-3">
            <p className="text-xs font-bold text-redpen">第一個出錯位</p>
            <p className="mt-0.5 text-[15px]">{q.first_error}</p>
          </div>
        )}

        {q.answer_key_concern && (
          <div className="rounded-lg border border-marker bg-marker-soft px-3 py-2 text-[15px]">
            <p className="text-xs font-bold">答案可能有問題</p>
            <p className="mt-0.5">{q.answer_key_concern}</p>
          </div>
        )}

        {q.explanation && <Markdown>{q.explanation}</Markdown>}

        <ul className="flex flex-wrap gap-2 pt-1 text-xs text-ink-soft">
          <li className="rounded-full border border-line px-2 py-0.5">
            {q.answer_source === "answer_key" ? "跟你提供嘅答案改" : "AI 自己計嘅答案"}
          </li>
          <li className={`rounded-full border px-2 py-0.5 ${q.confidence === "low" ? "border-marker bg-marker-soft text-ink" : "border-line"}`}>
            把握：{confidenceLabel[q.confidence]}
          </li>
          {q.error_type !== "none" && <li className="rounded-full border border-line px-2 py-0.5">{errorTypeLabel[q.error_type]}</li>}
        </ul>
      </div>

      {(onPrev || onNext) && (
        <footer className="flex gap-2 border-t border-line px-5 py-3">
          <button onClick={onPrev} disabled={!onPrev} className="flex-1 rounded-lg border border-line py-2 text-sm font-medium disabled:opacity-40">
            上一題
          </button>
          <button onClick={onNext} disabled={!onNext} className="flex-1 rounded-lg border border-line py-2 text-sm font-medium disabled:opacity-40">
            下一題
          </button>
        </footer>
      )}
    </article>
  );
}
