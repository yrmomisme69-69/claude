// Copies the pdf.js worker into /public so the browser can load it.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = join(root, "public", "pdf.worker.min.mjs");

if (existsSync(src)) {
  mkdirSync(join(root, "public"), { recursive: true });
  copyFileSync(src, dest);
  console.log("pdf.js worker copied to public/");
} else {
  console.log("pdf.js not installed yet, skipping worker copy");
}
