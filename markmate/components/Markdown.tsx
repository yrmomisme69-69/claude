"use client";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/** Renders Claude's explanations: Markdown + LaTeX maths. */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-mark text-[15px] leading-7 text-ink">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}>
        {normaliseMath(children)}
      </ReactMarkdown>
    </div>
  );
}

/** Claude sometimes uses \( \) and \[ \]; remark-math only understands $ and $$. */
function normaliseMath(s: string): string {
  return (
    s
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`)
      // A $$...$$ on a line of its own is display maths; remark-math needs the $$ on separate lines.
      .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, m) => `$$\n${m.trim()}\n$$`)
  );
}
