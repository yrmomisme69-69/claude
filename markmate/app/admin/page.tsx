"use client";

import { useEffect, useState } from "react";

interface Day {
  day: string;
  spendUsd: number;
  pages: number;
  requests: number;
  budgetUsd: number;
  perPersonPageLimit: number;
  store: "redis" | "memory";
  storeError: boolean;
}

const HKD = 7.8; // approximate USD → HKD

export default function AdminPage() {
  const [code, setCode] = useState("");
  const [data, setData] = useState<{ model: string; days: Day[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async (c = code) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/usage", { headers: { "x-admin-code": c }, cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `出錯（${res.status}）`);
      setData(json);
      try {
        sessionStorage.setItem("mm.admin", c);
      } catch {
        /* not remembered */
      }
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("mm.admin");
      if (saved) {
        setCode(saved);
        load(saved);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayRow = data?.days[0];
  const pct = todayRow && todayRow.budgetUsd > 0 ? Math.min(100, (todayRow.spendUsd / todayRow.budgetUsd) * 100) : 0;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-black">用量</h1>
      <p className="mt-1 text-sm text-ink-soft">只有你（網站擁有人）睇到。金額係按 AI 官方價錢估算（用 Gemini 免費版嘅話實際係 0），實際收費以 Claude Console／Google AI Studio 為準。</p>

      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="管理員密碼（ADMIN_CODE）"
          autoComplete="current-password"
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2"
        />
        <button className="rounded-lg bg-ink px-4 py-2 font-bold text-paper disabled:opacity-50" disabled={!code || loading}>
          {loading ? "載入緊…" : "睇用量"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-redpen px-3 py-2 text-sm font-medium text-white">
          {error}
        </p>
      )}

      {data && todayRow && (
        <>
          <section className="paper mt-6 rounded-2xl p-5">
            <p className="text-sm text-ink-soft">今日（{todayRow.day}）</p>
            <p className="mt-1 text-3xl font-black tabular-nums">
              US${todayRow.spendUsd.toFixed(3)}
              <span className="ml-2 text-base font-normal text-ink-soft">約 HK${(todayRow.spendUsd * HKD).toFixed(2)}</span>
            </p>
            {todayRow.budgetUsd > 0 ? (
              <>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper-2">
                  <div className={`h-full rounded-full ${pct >= 90 ? "bg-redpen" : "bg-bluepen"}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1.5 text-sm text-ink-soft">
                  每日上限 US${todayRow.budgetUsd.toFixed(2)}（DAILY_BUDGET_USD），用咗 {pct.toFixed(0)}%
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm font-medium text-redpen">未設每日金額上限（DAILY_BUDGET_USD = 0）。</p>
            )}
            <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-ink-faint">改咗</dt>
                <dd className="text-lg font-bold tabular-nums">{todayRow.pages} 頁</dd>
              </div>
              <div>
                <dt className="text-ink-faint">每頁平均</dt>
                <dd className="text-lg font-bold tabular-nums">{todayRow.pages ? `US$${(todayRow.spendUsd / todayRow.pages).toFixed(4)}` : "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">每人每日上限</dt>
                <dd className="text-lg font-bold tabular-nums">{todayRow.perPersonPageLimit} 頁</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-ink-soft">模型：{data.model}</p>
          </section>

          {todayRow.storeError && (
            <p className="mt-4 rounded-lg bg-redpen px-3 py-2 text-sm font-medium text-white">
              最近 15 分鐘連唔到 Upstash Redis，暫時用緊伺服器記憶體記數。請檢查 Upstash 嘅 URL 同 token。
            </p>
          )}
          {todayRow.store === "memory" && (
            <p className="mt-4 rounded-lg border border-marker bg-marker-soft px-3 py-2 text-sm">
              而家用緊伺服器記憶體記數：重新部署會清零，多部伺服器會各自計，所以實際用量可能高過呢度顯示。建議跟 README 連接 Upstash Redis，並喺 Claude Console／Google Cloud 設消費上限。
            </p>
          )}

          <section className="paper mt-6 overflow-hidden rounded-2xl">
            <h2 className="border-b border-line px-5 py-3 font-bold">最近 7 日</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-ink-faint">
                <tr>
                  <th className="px-5 py-2 font-normal">日期</th>
                  <th className="px-2 py-2 text-right font-normal">頁數</th>
                  <th className="px-5 py-2 text-right font-normal">費用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.days.map((d) => (
                  <tr key={d.day}>
                    <td className="px-5 py-2 tabular-nums">{d.day}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{d.pages}</td>
                    <td className="px-5 py-2 text-right tabular-nums">US${d.spendUsd.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
