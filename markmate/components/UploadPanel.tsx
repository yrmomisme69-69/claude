"use client";

import { useRef, useState } from "react";
import type { AppConfig, ExplanationLanguage } from "@/lib/types";

export interface Settings {
  subject: string;
  language: ExplanationLanguage;
  extra: string;
}

interface Props {
  config: AppConfig | null;
  workMode: "files" | "typed";
  setWorkMode: (m: "files" | "typed") => void;
  workFiles: File[];
  setWorkFiles: (f: File[]) => void;
  workText: string;
  setWorkText: (s: string) => void;
  keyFiles: File[];
  setKeyFiles: (f: File[]) => void;
  keyText: string;
  setKeyText: (s: string) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  accessCode: string;
  setAccessCode: (s: string) => void;
  onStart: () => void;
  onDemo: () => void;
  error: string;
}

const SUBJECTS = ["", "數學", "統計", "財務 / 會計", "經濟", "物理", "化學", "生物", "英文", "中文", "IELTS", "通識 / 公民", "歷史"];
const ACCEPT = "image/*,application/pdf,.pdf";

export default function UploadPanel(p: Props) {
  const [keyAsText, setKeyAsText] = useState(Boolean(p.keyText));
  const [dragging, setDragging] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  const canStart = p.workMode === "files" ? p.workFiles.length > 0 : p.workText.trim().length > 0;
  const noKey = p.config && !p.config.hasApiKey;
  const customSubject = !SUBJECTS.includes(p.settings.subject);

  const addWork = (list: FileList | null) => {
    if (!list?.length) return;
    p.setWorkFiles([...p.workFiles, ...Array.from(list)]);
  };

  return (
    <section className="paper rounded-2xl" aria-labelledby="upload-heading">
      <div className="space-y-6 p-5 sm:p-6">
        {/* Step: the student's work */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="upload-heading" className="text-lg font-bold">
              你的作答
            </h2>
            <div className="inline-flex rounded-lg bg-paper-2 p-0.5 text-sm" role="tablist" aria-label="作答方式">
              {(["files", "typed"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={p.workMode === m}
                  onClick={() => p.setWorkMode(m)}
                  className={`rounded-md px-3 py-1 font-medium ${p.workMode === m ? "bg-paper text-ink shadow-sm" : "text-ink-soft"}`}
                >
                  {m === "files" ? "相片 / PDF" : "直接打字"}
                </button>
              ))}
            </div>
          </div>

          {p.workMode === "files" ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addWork(e.dataTransfer.files);
              }}
              className={`mt-3 rounded-xl border-2 border-dashed p-4 transition-colors ${dragging ? "border-bluepen bg-blue-soft" : "border-line"}`}
            >
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => cameraRef.current?.click()} className="flex flex-col items-center gap-1.5 rounded-lg bg-ink px-3 py-4 font-bold text-paper hover:opacity-90">
                  <CameraIcon />
                  影相
                </button>
                <button onClick={() => pickRef.current?.click()} className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-4 font-bold hover:bg-paper-2">
                  <FileIcon />
                  揀相片或 PDF
                </button>
              </div>
              <p className="mt-3 text-sm text-ink-soft">一次可以揀幾頁。GoodNotes 用家：分享 › 匯出 › PDF，再揀嗰個檔案。電腦可以直接拖檔案入嚟。</p>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addWork(e.target.files); e.target.value = ""; }} />
              <input ref={pickRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { addWork(e.target.files); e.target.value = ""; }} />
              <FileChips files={p.workFiles} onRemove={(i) => p.setWorkFiles(p.workFiles.filter((_, j) => j !== i))} />
            </div>
          ) : (
            <textarea
              value={p.workText}
              onChange={(e) => p.setWorkText(e.target.value)}
              rows={8}
              className="mt-3 w-full rounded-xl border border-line bg-paper p-3 text-[15px] outline-none focus:border-bluepen"
              placeholder={"貼上題目同你嘅答案，例如：\n\n1. A bond pays 5% coupon... What is its price?\n我嘅答案：$95.67\n\n2. 寫出一個股票同債券嘅分別。\n我嘅答案：股票係擁有權，債券係借錢。"}
            />
          )}
        </div>

        {/* Step: optional answer key */}
        <div>
          <h2 className="text-lg font-bold">
            答案 <span className="text-sm font-normal text-ink-faint">可以唔俾</span>
          </h2>
          <p className="mt-1 text-sm text-ink-soft">有答案就跟答案改。冇嘅話 AI 會自己計，唔肯定嘅題目會用黃色「?」標出嚟。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => keyRef.current?.click()} className="rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-paper-2">
              上載答案相片或 PDF
            </button>
            <button onClick={() => setKeyAsText(!keyAsText)} className="rounded-lg px-3 py-2 text-sm font-medium text-bluepen hover:bg-blue-soft" aria-expanded={keyAsText}>
              {keyAsText ? "收起答案文字" : "貼上答案文字"}
            </button>
          </div>
          <input
            ref={keyRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) p.setKeyFiles([...p.keyFiles, ...Array.from(e.target.files)]);
              e.target.value = "";
            }}
          />
          <FileChips files={p.keyFiles} onRemove={(i) => p.setKeyFiles(p.keyFiles.filter((_, j) => j !== i))} />
          {keyAsText && (
            <textarea
              value={p.keyText}
              onChange={(e) => p.setKeyText(e.target.value)}
              rows={4}
              className="mt-3 w-full rounded-xl border border-line bg-paper p-3 text-[15px] outline-none focus:border-bluepen"
              placeholder={"例如：\n1. B  2. D  3. A\n4. $1,102.50\n5. 40"}
            />
          )}
        </div>

        {/* Settings */}
        <details className="group rounded-xl bg-paper-2 px-4 py-3">
          <summary className="cursor-pointer list-none font-medium marker:hidden">
            <span className="inline-flex items-center gap-2">
              <svg className="transition-transform group-open:rotate-90" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              改卷設定
            </span>
            <span className="ml-2 text-sm font-normal text-ink-faint">
              {p.settings.subject || "自動判斷科目"}，{p.settings.language === "zh-HK" ? "繁體中文解釋" : p.settings.language === "en" ? "English" : "跟題目語言"}
            </span>
          </summary>
          <div className="mt-3 space-y-4">
            <label className="block">
              <span className="text-sm font-medium">科目</span>
              <select
                value={customSubject ? "__custom" : p.settings.subject}
                onChange={(e) => p.setSettings({ ...p.settings, subject: e.target.value === "__custom" ? " " : e.target.value })}
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2"
              >
                {SUBJECTS.map((s) => (
                  <option key={s} value={s}>
                    {s || "自動判斷"}
                  </option>
                ))}
                <option value="__custom">其他（自己填）</option>
              </select>
              {customSubject && (
                <input
                  value={p.settings.subject.trim()}
                  onChange={(e) => p.setSettings({ ...p.settings, subject: e.target.value || " " })}
                  className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2"
                  placeholder="例如：FINA2010 Corporate Finance"
                />
              )}
            </label>
            <fieldset>
              <legend className="text-sm font-medium">解釋用咩語言</legend>
              <div className="mt-1 inline-flex rounded-lg bg-paper p-0.5 text-sm">
                {(
                  [
                    ["zh-HK", "繁體中文"],
                    ["en", "English"],
                    ["auto", "跟題目"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => p.setSettings({ ...p.settings, language: v })}
                    aria-pressed={p.settings.language === v}
                    className={`rounded-md px-3 py-1.5 font-medium ${p.settings.language === v ? "bg-ink text-paper" : "text-ink-soft"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="text-sm font-medium">其他要求</span>
              <textarea
                value={p.settings.extra}
                onChange={(e) => p.setSettings({ ...p.settings, extra: e.target.value })}
                rows={2}
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-[15px]"
                placeholder="例如：答案取 3 位有效數字；作文用 IELTS band 評分；解釋寫詳細啲"
              />
            </label>
          </div>
        </details>

        {p.config?.needsAccessCode && (
          <label className="block">
            <span className="text-sm font-medium">入場密碼</span>
            <input
              value={p.accessCode}
              onChange={(e) => p.setAccessCode(e.target.value)}
              type="password"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2"
              placeholder="問建立呢個網站嘅人攞"
            />
          </label>
        )}

        {noKey && (
          <p className="rounded-lg border border-marker bg-marker-soft px-3 py-2 text-sm">
            伺服器未設定 API key，暫時只可以試用示範卷。設定方法睇 README 第 3 步。
          </p>
        )}
        {p.error && (
          <p role="alert" className="rounded-lg bg-redpen px-3 py-2 text-sm font-medium text-white">
            {p.error}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
          <button
            onClick={p.onStart}
            disabled={!canStart || Boolean(noKey)}
            className="rounded-xl bg-redpen px-6 py-3 text-base font-bold text-white shadow-sm hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40 sm:ml-auto"
          >
            開始改卷
          </button>
          <button onClick={p.onDemo} className="rounded-xl px-4 py-3 text-sm font-medium text-ink-soft hover:bg-paper-2">
            試用示範卷
          </button>
        </div>
      </div>
    </section>
  );
}

function FileChips({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-paper py-1 pl-3 pr-1 text-sm">
          <span className="truncate">{f.name}</span>
          <button onClick={() => onRemove(i)} className="rounded-full p-1 text-ink-faint hover:bg-paper-2 hover:text-redpen" aria-label={`移除 ${f.name}`}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M3 3l6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CameraIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 13h6M9 17h6" />
    </svg>
  );
}
