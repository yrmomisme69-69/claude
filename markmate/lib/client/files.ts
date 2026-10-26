"use client";

import { HIGH_RES, STANDARD_RES, resizedSize } from "@/lib/imageSizing";

export interface PageImage {
  /** data:image/jpeg;base64,... for showing on screen */
  dataUrl: string;
  /** base64 only, for the API */
  base64: string;
  width: number;
  height: number;
  label: string;
}

const MAX_PDF_PAGES = 40;
const MAX_BASE64 = 3_600_000; // leaves room for the rest of the request body

function tierLimits(tier: "high" | "standard") {
  return tier === "high" ? HIGH_RES : STANDARD_RES;
}

/** Turns a list of images / PDFs into page images sized exactly for Claude. */
export async function filesToPages(
  files: File[],
  tier: "high" | "standard",
  onProgress?: (message: string) => void,
): Promise<PageImage[]> {
  const pages: PageImage[] = [];
  for (const file of files) {
    if (isPdf(file)) {
      onProgress?.(`打開緊 ${file.name}…`);
      const rendered = await pdfToCanvases(file, tier, (i, n) => onProgress?.(`整理緊 ${file.name} 第 ${i} / ${n} 頁…`));
      rendered.forEach((canvas, i) => pages.push(canvasToPage(canvas, tier, `${file.name} 第 ${i + 1} 頁`)));
    } else {
      onProgress?.(`整理緊 ${file.name}…`);
      const canvas = await imageFileToCanvas(file);
      pages.push(canvasToPage(canvas, tier, file.name));
    }
  }
  return pages;
}

export function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function imageFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    // from-image respects the EXIF rotation that phone cameras add.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      `讀唔到「${file.name}」。如果係 HEIC 相片，請喺 iPhone「設定 › 相機 › 格式」揀「最兼容」，或者截圖再上載。`,
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function pdfToCanvases(
  file: File,
  tier: "high" | "standard",
  onPage: (i: number, n: number) => void,
): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const n = Math.min(doc.numPages, MAX_PDF_PAGES);
  const { maxEdge } = tierLimits(tier);
  const canvases: HTMLCanvasElement[] = [];
  for (let i = 1; i <= n; i++) {
    onPage(i, n);
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    // Render a little larger than needed, then downscale precisely.
    const scale = Math.min(4, (maxEdge * 1.1) / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    canvases.push(canvas);
    page.cleanup();
  }
  await task.destroy();
  return canvases;
}

function canvasToPage(source: HTMLCanvasElement, tier: "high" | "standard", label: string): PageImage {
  const { maxEdge, maxTokens } = tierLimits(tier);
  const [w, h] = resizedSize(source.width, source.height, maxEdge, maxTokens);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);

  let quality = 0.88;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > MAX_BASE64 && quality > 0.5) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(",") + 1), width: w, height: h, label };
}

/** Split pages into groups whose total size fits in one request. */
export function chunkBySize(pages: PageImage[], maxTotal = 3_800_000, maxCount = 8): PageImage[][] {
  const chunks: PageImage[][] = [];
  let current: PageImage[] = [];
  let size = 0;
  for (const p of pages) {
    if (current.length && (size + p.base64.length > maxTotal || current.length >= maxCount)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += p.base64.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
