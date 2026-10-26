"use client";

import type { AnswerKeyExtraction, AppConfig, GradeRequestBody, PageGrading } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function postJson<T>(url: string, body: unknown, accessCode: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(accessCode ? { "x-access-code": accessCode } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("連唔到伺服器，檢查吓網絡再試。", 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Vercel returns HTML for timeouts / payload errors.
  }
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ||
      (res.status === 413 ? "檔案太大，請分開上載。" : res.status === 504 ? "改卷超時，試吓將頁面分開上載。" : `出錯（${res.status}），請再試一次。`);
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export function gradePage(body: GradeRequestBody, accessCode: string) {
  return postJson<PageGrading>("/api/grade", body, accessCode);
}

export function readAnswerKey(images: { data: string; width: number; height: number }[], startPage: number, accessCode: string) {
  return postJson<AnswerKeyExtraction>("/api/answer-key", { images, startPage }, accessCode);
}

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config", { cache: "no-store" });
  return (await res.json()) as AppConfig;
}

export function answerKeyToText(extractions: AnswerKeyExtraction[]): string {
  const lines: string[] = [];
  for (const ex of extractions) {
    for (const e of ex.entries) {
      lines.push(`Q${e.question_id.replace(/^Q/i, "")}: ${e.answer}${e.notes ? `  [marking notes: ${e.notes}]` : ""}`);
    }
    if (ex.general_notes) lines.push(`General notes: ${ex.general_notes}`);
  }
  return lines.join("\n");
}
