"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageView, { type Offsets } from "@/components/PageView";
import QuestionDetail from "@/components/QuestionDetail";
import QuestionList from "@/components/QuestionList";
import ScoreSummary from "@/components/ScoreSummary";
import UploadPanel, { type Settings } from "@/components/UploadPanel";
import Markdown from "@/components/Markdown";
import { answerKeyToText, fetchConfig, gradePage, readAnswerKey } from "@/lib/client/api";
import { downloadMarkedPage } from "@/lib/client/exportImage";
import { chunkBySize, filesToPages, type PageImage } from "@/lib/client/files";
import { DEMO_IMAGE, DEMO_RESULT } from "@/lib/demo";
import { computeTotals, verdictLabel } from "@/lib/labels";
import type { AppConfig, PageGrading } from "@/lib/types";

interface PageState {
  image: PageImage | null; // null = typed work
  label: string;
  status: "waiting" | "grading" | "done" | "error";
  result?: PageGrading;
  error?: string;
}

type Selected = { page: number; q: number } | null;

const CONCURRENCY = 2;
const DEFAULT_SETTINGS: Settings = { subject: "", language: "zh-HK", extra: "" };

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings just won't be remembered */
  }
}

export default function Home() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [phase, setPhase] = useState<"setup" | "results">("setup");

  const [workMode, setWorkMode] = useState<"files" | "typed">("files");
  const [workFiles, setWorkFiles] = useState<File[]>([]);
  const [workText, setWorkText] = useState("");
  const [keyFiles, setKeyFiles] = useState<File[]>([]);
  const [keyText, setKeyText] = useState("");
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [accessCode, setAccessCodeState] = useState("");
  const [error, setError] = useState("");

  const [pages, setPages] = useState<PageState[]>([]);
  const [prepMessage, setPrepMessage] = useState<string | null>(null);
  const [extractedKey, setExtractedKey] = useState("");
  const [selected, setSelected] = useState<Selected>(null);
  const [showNotes, setShowNotes] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [offsets, setOffsets] = useState<Offsets>({});
  const [isDemo, setIsDemo] = useState(false);

  const runKeyText = useRef("");
  const svgRefs = useRef<Record<number, SVGSVGElement | null>>({});

  useEffect(() => {
    fetchConfig().then(setConfig).catch(() => setConfig(null));
    setSettingsState(load("mm.settings", DEFAULT_SETTINGS));
    setAccessCodeState(load<{ code: string }>("mm.access", { code: "" }).code);
  }, []);

  const setSettings = (s: Settings) => {
    setSettingsState(s);
    save("mm.settings", s);
  };
  const setAccessCode = (code: string) => {
    setAccessCodeState(code);
    save("mm.access", { code });
  };

  const updatePage = (i: number, patch: Partial<PageState>) =>
    setPages((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const gradeOne = useCallback(
    async (i: number, page: PageState, total: number) => {
      updatePage(i, { status: "grading", error: undefined });
      try {
        const result = await gradePage(
          {
            image: page.image?.base64 || undefined,
            width: page.image?.width,
            height: page.image?.height,
            typedWork: page.image ? undefined : workText,
            pageNumber: i + 1,
            totalPages: total,
            answerKeyText: runKeyText.current,
            subjectHint: settings.subject.trim(),
            language: settings.language,
            extraInstructions: settings.extra,
          },
          accessCode,
        );
        updatePage(i, { status: "done", result });
      } catch (e) {
        updatePage(i, { status: "error", error: (e as Error).message });
      }
    },
    [accessCode, settings, workText],
  );

  const start = async () => {
    setError("");
    setIsDemo(false);
    setSelected(null);
    setOffsets({});
    setExtractedKey("");
    setPages([]);
    setPhase("results");
    const tier = config?.imageTier ?? "high";
    try {
      let list: PageState[];
      if (workMode === "files") {
        setPrepMessage("整理緊你嘅檔案…");
        const imgs = await filesToPages(workFiles, tier, setPrepMessage);
        if (!imgs.length) throw new Error("搵唔到可以改嘅頁面。");
        list = imgs.map((image) => ({ image, label: image.label, status: "waiting" }));
      } else {
        list = [{ image: null, label: "打字作答", status: "waiting" }];
      }

      let key = keyText.trim();
      if (keyFiles.length) {
        setPrepMessage("讀緊答案…");
        const keyPages = await filesToPages(keyFiles, tier);
        const chunks = chunkBySize(keyPages);
        const out = [];
        let startPage = 1;
        for (const [ci, c] of chunks.entries()) {
          setPrepMessage(chunks.length > 1 ? `讀緊答案（${ci + 1} / ${chunks.length}）…` : "讀緊答案…");
          out.push(await readAnswerKey(c.map((p) => ({ data: p.base64, width: p.width, height: p.height })), startPage, accessCode));
          startPage += c.length;
        }
        const extracted = answerKeyToText(out);
        setExtractedKey(extracted);
        key = [key, extracted].filter(Boolean).join("\n");
      }
      runKeyText.current = key;
      setPrepMessage(null);
      setPages(list);

      // Mark pages a couple at a time; results appear as each page finishes.
      let next = 0;
      const worker = async () => {
        while (next < list.length) {
          const i = next++;
          await gradeOne(i, list[i], list.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
    } catch (e) {
      setPrepMessage(null);
      setError((e as Error).message || "出咗錯，請再試一次。");
      setPhase("setup");
    }
  };

  const startDemo = () => {
    setError("");
    setIsDemo(true);
    setOffsets({});
    setExtractedKey("");
    setPrepMessage(null);
    setSelected(null);
    setPages([
      {
        image: { dataUrl: DEMO_IMAGE.src, base64: "", width: DEMO_IMAGE.width, height: DEMO_IMAGE.height, label: DEMO_IMAGE.label },
        label: DEMO_IMAGE.label,
        status: "done",
        result: DEMO_RESULT,
      },
    ]);
    setPhase("results");
  };

  const reset = () => {
    setPhase("setup");
    setPages([]);
    setSelected(null);
    setEditMode(false);
    setIsDemo(false);
  };

  // Flat list of every marked question, for previous / next.
  const flat = useMemo(() => {
    const out: { page: number; q: number }[] = [];
    pages.forEach((p, pi) => p.result?.questions.forEach((_, qi) => out.push({ page: pi, q: qi })));
    return out;
  }, [pages]);
  const flatIndex = selected ? flat.findIndex((f) => f.page === selected.page && f.q === selected.q) : -1;
  const selectedQ = selected ? pages[selected.page]?.result?.questions[selected.q] : undefined;

  const totals = useMemo(() => computeTotals(pages.map((p) => p.result)), [pages]);
  const doneCount = pages.filter((p) => p.status === "done" || p.status === "error").length;
  const progress = prepMessage
    ? { done: 0, total: 1, label: prepMessage }
    : pages.length && doneCount < pages.length
      ? { done: doneCount, total: pages.length, label: `改緊卷…（${doneCount} / ${pages.length} 頁完成）` }
      : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const detail = selectedQ && selected && (
    <QuestionDetail
      q={selectedQ}
      pageLabel={pages[selected.page].label}
      position={`第 ${flatIndex + 1} / ${flat.length} 題`}
      onPrev={flatIndex > 0 ? () => setSelected(flat[flatIndex - 1]) : undefined}
      onNext={flatIndex >= 0 && flatIndex < flat.length - 1 ? () => setSelected(flat[flatIndex + 1]) : undefined}
      onClose={() => setSelected(null)}
    />
  );

  return (
    <main className="pb-24">
      <header className="no-print mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-5 sm:px-6">
        <button onClick={reset} className="flex items-center gap-2 rounded-lg" aria-label="MarkMate 改卷，返去首頁">
          <Logo />
          <span className="text-lg font-black tracking-tight">MarkMate</span>
          <span className="text-sm text-ink-soft">改卷</span>
        </button>
        {phase === "results" && (
          <button onClick={reset} className="rounded-lg border border-line bg-paper px-3 py-1.5 text-sm font-medium hover:bg-paper-2">
            改另一份
          </button>
        )}
      </header>

      {phase === "setup" ? (
        <div className="mx-auto mt-8 grid max-w-6xl gap-10 px-4 sm:px-6 lg:mt-14 lg:grid-cols-[minmax(0,1fr)_540px] lg:gap-14">
          <div className="lg:pt-6">
            <h1 className="text-4xl font-black leading-[1.15] tracking-tight sm:text-5xl">
              影低功課，
              <br />
              即刻改好。
            </h1>
            <p className="mt-5 max-w-[34em] text-lg text-pretty text-ink-soft">
              選擇題會用藍筆圈出正確答案，長題目打紅色 ✓ 或 ✗，每一題都附解釋同正確做法。有答案就跟答案改，冇答案 AI 會自己計。
            </p>
            <Legend />
            <p className="mt-8 max-w-[34em] text-sm text-ink-faint">你上載嘅相片只會傳去 AI 改卷，呢個網站唔會儲存你嘅檔案。AI 都會出錯，重要嘅答案記得自己核對。</p>
          </div>
          <UploadPanel
            config={config}
            workMode={workMode}
            setWorkMode={setWorkMode}
            workFiles={workFiles}
            setWorkFiles={setWorkFiles}
            workText={workText}
            setWorkText={setWorkText}
            keyFiles={keyFiles}
            setKeyFiles={setKeyFiles}
            keyText={keyText}
            setKeyText={setKeyText}
            settings={settings}
            setSettings={setSettings}
            accessCode={accessCode}
            setAccessCode={setAccessCode}
            onStart={start}
            onDemo={startDemo}
            error={error}
          />
        </div>
      ) : (
        <div className="mx-auto mt-5 max-w-6xl px-4 sm:px-6">
          {/* toolbar */}
          <div className="no-print mb-4 flex flex-wrap items-center gap-2 text-sm">
            <Toggle on={showNotes} onChange={setShowNotes} label="顯示批註" />
            <Toggle on={editMode} onChange={(v) => { setEditMode(v); if (v) setSelected(null); }} label="調整記號位置" />
            <button onClick={() => window.print()} className="ml-auto rounded-lg border border-line bg-paper px-3 py-1.5 font-medium hover:bg-paper-2">
              列印 / 儲存 PDF
            </button>
          </div>
          {editMode && (
            <p className="no-print mb-4 rounded-lg bg-blue-soft px-3 py-2 text-sm">拖動 ✓ ✗ 或者藍色圈，放返去啱嘅位置。改好再撳「調整記號位置」關閉。</p>
          )}
          {isDemo && (
            <p className="no-print mb-4 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink-soft">
              呢份係示範卷，已經預先改好，唔使用 API。㩒紅色記號旁邊嘅題號睇解釋。
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-6">
              <div className="lg:hidden">
                <ScoreSummary totals={totals} progress={progress} />
              </div>

              {extractedKey && (
                <details className="no-print paper rounded-2xl px-5 py-3">
                  <summary className="cursor-pointer font-medium">AI 讀到嘅答案（檢查吓有冇讀錯）</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-sm text-ink-soft">{extractedKey}</pre>
                </details>
              )}

              {pages.map((p, pi) => (
                <section key={pi} className="paper print-page overflow-hidden rounded-2xl" aria-label={p.label}>
                  <div className="no-print flex items-center gap-3 border-b border-line px-4 py-2.5">
                    <h2 className="min-w-0 flex-1 truncate font-bold">{p.label}</h2>
                    <PageStatus p={p} />
                    {p.status === "error" && (
                      <button onClick={() => gradeOne(pi, p, pages.length)} className="rounded-lg bg-ink px-3 py-1 text-sm font-medium text-paper">
                        再改一次
                      </button>
                    )}
                    {p.image && p.status === "done" && (
                      <button
                        onClick={() => {
                          const svg = svgRefs.current[pi];
                          if (svg && p.image) downloadMarkedPage(p.image, svg, `markmate-page-${pi + 1}.png`).catch(() => setError("下載圖片失敗。"));
                        }}
                        className="rounded-lg border border-line px-3 py-1 text-sm font-medium hover:bg-paper-2"
                      >
                        下載圖片
                      </button>
                    )}
                  </div>

                  {p.result?.page_note && <p className="border-b border-line bg-marker-soft px-4 py-2 text-sm">{p.result.page_note}</p>}

                  {p.image ? (
                    <div className={p.status === "grading" || p.status === "waiting" ? "opacity-70" : ""}>
                      <PageView
                        pageIndex={pi}
                        image={p.image}
                        result={p.result}
                        selected={selected?.page === pi ? selected.q : null}
                        onSelect={(q) => setSelected({ page: pi, q })}
                        showNotes={showNotes}
                        editMode={editMode}
                        offsets={offsets}
                        onOffset={(k, v) => setOffsets((o) => ({ ...o, [k]: v }))}
                        svgRef={(el) => {
                          svgRefs.current[pi] = el;
                        }}
                      />
                    </div>
                  ) : (
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-b border-line bg-paper-2 px-4 py-3 text-sm text-ink-soft">{workText}</pre>
                  )}

                  {p.result && (
                    <div className="no-print border-t border-line">
                      {p.result.page_summary && (
                        <div className="px-4 pt-3 text-[15px]">
                          <span className="font-bold">老師評語：</span>
                          {p.result.page_summary}
                        </div>
                      )}
                      {p.result.questions.length === 0 ? (
                        <p className="px-4 py-4 text-sm text-ink-soft">呢頁搵唔到題目。</p>
                      ) : (
                        <QuestionList
                          questions={p.result.questions}
                          selected={selected?.page === pi ? selected.q : null}
                          onSelect={(q) => setSelected({ page: pi, q })}
                        />
                      )}
                    </div>
                  )}
                </section>
              ))}

              <PrintReport pages={pages} />
            </div>

            {/* desktop side panel */}
            <aside className="no-print hidden lg:block">
              <div className="sticky top-4 space-y-4">
                <ScoreSummary totals={totals} progress={progress} />
                <div className="paper max-h-[calc(100dvh-14rem)] overflow-hidden rounded-2xl">
                  {detail || (
                    <p className="px-5 py-6 text-sm text-ink-soft">
                      {flat.length ? "㩒頁面上嘅題號，或者下面清單入面任何一題，睇詳細解釋。" : "改好嘅題目會喺呢度顯示解釋。"}
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* mobile bottom sheet */}
      {phase === "results" && detail && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/35" aria-label="關閉解釋" onClick={() => setSelected(null)} />
          <div className="paper absolute inset-x-0 bottom-0 flex max-h-[82dvh] flex-col rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" aria-hidden />
            {detail}
          </div>
        </div>
      )}
    </main>
  );
}

function PageStatus({ p }: { p: PageState }) {
  if (p.status === "done") {
    const n = p.result?.questions.length ?? 0;
    return <span className="text-sm text-ink-soft">{n} 題</span>;
  }
  if (p.status === "error") return <span className="text-sm font-medium text-redpen">{p.error}</span>;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-soft">
      <span className="h-2 w-2 animate-pulse rounded-full bg-bluepen" aria-hidden />
      {p.status === "grading" ? "改緊…" : "排緊隊"}
    </span>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium ${on ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-paper-2"}`}
    >
      <span className={`h-3.5 w-3.5 rounded-sm border ${on ? "border-paper bg-paper" : "border-ink-faint"}`} aria-hidden>
        {on && (
          <svg viewBox="0 0 14 14" className="h-full w-full text-ink">
            <path d="M3 7.5l2.5 2.5L11 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}

function Legend() {
  const items: { glyph: React.ReactNode; title: string; text: string }[] = [
    {
      glyph: (
        <svg viewBox="0 0 40 40" className="h-10 w-10" aria-hidden>
          <path d="M9 21 Q13 25 16 30 Q22 18 33 9" fill="none" stroke="var(--redpen)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: "紅色 ✓ ✗",
      text: "對定錯。部分正確會寫埋分數。",
    },
    {
      glyph: (
        <svg viewBox="0 0 40 40" className="h-10 w-10" aria-hidden>
          <ellipse cx="20" cy="20" rx="15" ry="10" transform="rotate(-6 20 20)" fill="none" stroke="var(--bluepen)" strokeWidth="2.6" />
          <text x="20" y="25" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--ink)">B</text>
        </svg>
      ),
      title: "藍筆",
      text: "正確答案同老師批註。",
    },
    {
      glyph: (
        <svg viewBox="0 0 40 40" className="h-10 w-10" aria-hidden>
          <circle cx="20" cy="20" r="13" fill="none" stroke="var(--marker)" strokeWidth="3" />
          <text x="20" y="26" textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--marker)">?</text>
        </svg>
      ),
      title: "黃色 ?",
      text: "AI 唔夠把握，請你自己再睇。",
    },
    {
      glyph: (
        <span className="inline-flex h-10 w-10 items-center justify-center" aria-hidden>
          <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-paper">2b</span>
        </span>
      ),
      title: "題號",
      text: "㩒落去睇詳細解釋同正確做法。",
    },
  ];
  return (
    <dl className="mt-8 grid max-w-md gap-y-3">
      {items.map((it) => (
        <div key={it.title} className="flex items-center gap-3">
          <dt className="shrink-0">{it.glyph}</dt>
          <dd className="leading-snug">
            <span className="font-bold">{it.title}</span>
            <span className="ml-2 text-ink-soft">{it.text}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--paper)" stroke="var(--line)" />
      <path d="M8 17 Q11 19.5 13.5 23.5 Q18 13 25 8" fill="none" stroke="var(--redpen)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Only visible when printing: every question with its explanation. */
function PrintReport({ pages }: { pages: PageState[] }) {
  const any = pages.some((p) => p.result?.questions.length);
  if (!any) return null;
  return (
    <section className="print-break hidden print:block">
      <h2 className="mb-4 text-2xl font-black">解釋</h2>
      {pages.map((p, pi) =>
        p.result?.questions.map((q, qi) => (
          <div key={`${pi}-${qi}`} className="mb-5 break-inside-avoid border-b border-line pb-4">
            <p className="font-bold">
              {p.label}：第 {q.id} 題（{verdictLabel[q.verdict]}）
            </p>
            <p className="text-sm">
              你的答案：{q.student_answer || "（冇作答）"}　正確答案：{q.correct_answer}
            </p>
            {q.explanation && <Markdown>{q.explanation}</Markdown>}
          </div>
        )),
      )}
    </section>
  );
}
