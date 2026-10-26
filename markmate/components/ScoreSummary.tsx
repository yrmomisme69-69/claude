"use client";

import { errorTypeLabel, trimNum, type Totals } from "@/lib/labels";
import type { ErrorType } from "@/lib/types";

interface Props {
  totals: Totals;
  progress: { done: number; total: number; label: string } | null;
}

/** The score a teacher writes at the top of the paper, plus a breakdown. */
export default function ScoreSummary({ totals, progress }: Props) {
  const { awarded, available, counts, errors, questions } = totals;
  const pct = available > 0 ? Math.round((awarded / available) * 100) : null;
  const errorEntries = (Object.entries(errors) as [ErrorType, number][]).sort((a, b) => b[1] - a[1]);
  const maxErr = errorEntries[0]?.[1] || 1;

  return (
    <section className="paper rounded-2xl p-5" aria-label="成績">
      <div className="flex items-center gap-5">
        <div className="relative shrink-0 px-3 py-1" aria-label={available > 0 ? `得分 ${trimNum(awarded)} / ${trimNum(available)}` : "改緊"}>
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden>
            <path
              d="M 8 34 C 6 12, 38 4, 62 6 C 88 8, 98 22, 94 38 C 90 54, 54 60, 30 54 C 12 50, 2 40, 14 22"
              fill="none"
              stroke="var(--redpen)"
              strokeWidth="2.2"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <p className="relative font-pen text-5xl leading-none text-redpen">
            {available > 0 ? (
              <>
                {trimNum(awarded)}
                <span className="text-3xl">/{trimNum(available)}</span>
              </>
            ) : (
              <span className="text-3xl">{questions ? `${questions} 題` : "…"}</span>
            )}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          {progress ? (
            <>
              <p className="font-medium">{progress.label}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <div className="h-full rounded-full bg-bluepen transition-[width] duration-500" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
            </>
          ) : (
            <p className="font-medium">{pct !== null ? `${pct}%，共 ${questions} 題` : `共 ${questions} 題`}</p>
          )}
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-soft">
            <li>
              <span className="font-bold text-redpen">✓</span> 正確 {counts.correct}
            </li>
            {counts.partially_correct > 0 && <li>◐ 部分正確 {counts.partially_correct}</li>}
            <li>
              <span className="font-bold text-redpen">✗</span> 錯誤 {counts.incorrect + counts.unanswered}
            </li>
            {counts.scored > 0 && <li>★ 已評分 {counts.scored}</li>}
            {counts.needs_review + counts.unreadable > 0 && (
              <li className="rounded bg-marker-soft px-1.5 text-ink">? 要你再確認 {counts.needs_review + counts.unreadable}</li>
            )}
          </ul>
        </div>
      </div>

      {errorEntries.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm font-medium">主要錯誤類型</p>
          <ul className="mt-2 space-y-1.5">
            {errorEntries.map(([type, n]) => (
              <li key={type} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-ink-soft">{errorTypeLabel[type]}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-paper-2">
                  <span className="block h-full rounded-full bg-redpen/70" style={{ width: `${(n / maxErr) * 100}%` }} />
                </span>
                <span className="w-6 text-right tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
