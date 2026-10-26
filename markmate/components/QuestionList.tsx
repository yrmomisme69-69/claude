"use client";

import { formatMarks, verdictLabel, verdictSymbol, verdictTone } from "@/lib/labels";
import type { GradedQuestion } from "@/lib/types";

interface Props {
  questions: GradedQuestion[];
  selected: number | null;
  onSelect: (i: number) => void;
}

export default function QuestionList({ questions, selected, onSelect }: Props) {
  if (!questions.length) return null;
  return (
    <ol className="divide-y divide-line">
      {questions.map((q, i) => {
        const marks = formatMarks(q);
        return (
          <li key={i}>
            <button
              onClick={() => onSelect(i)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-2 ${selected === i ? "bg-blue-soft" : ""}`}
            >
              <span className={`mt-0.5 inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-1.5 text-sm font-bold ${verdictTone(q.verdict)}`} aria-label={verdictLabel[q.verdict]}>
                {verdictSymbol(q.verdict)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="font-bold">{q.id}</span>
                  <span className="truncate text-sm text-ink-soft">{q.prompt_summary}</span>
                </span>
                {q.verdict !== "correct" && q.correct_answer && (
                  <span className="mt-0.5 block truncate text-sm">
                    <span className="text-ink-faint">正確答案 </span>
                    <span className="font-medium text-bluepen">{q.correct_answer}</span>
                  </span>
                )}
              </span>
              {marks && <span className="shrink-0 pt-0.5 font-pen text-xl leading-none text-redpen">{marks}</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
