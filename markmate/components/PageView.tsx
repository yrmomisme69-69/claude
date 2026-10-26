"use client";

import { useRef } from "react";
import type { PageImage } from "@/lib/client/files";
import { formatMarks } from "@/lib/labels";
import type { GradedQuestion, PageGrading } from "@/lib/types";

export type Offsets = Record<string, [number, number]>;

interface Props {
  pageIndex: number;
  image: PageImage;
  result?: PageGrading;
  selected: number | null;
  onSelect: (questionIndex: number) => void;
  showNotes: boolean;
  editMode: boolean;
  offsets: Offsets;
  onOffset: (key: string, value: [number, number]) => void;
  svgRef?: (el: SVGSVGElement | null) => void;
}

/** One page of the student's work with the pen marks drawn on top. */
export default function PageView({ pageIndex, image, result, selected, onSelect, showNotes, editMode, offsets, onOffset, svgRef }: Props) {
  const W = image.width;
  const H = image.height;
  const u = Math.min(W, H) / 100; // one "pen unit" ≈ 1% of the short edge
  const drag = useRef<{ key: string; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const svgEl = useRef<SVGSVGElement | null>(null);

  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgEl.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = svg.getScreenCTM();
    const p = m ? pt.matrixTransform(m.inverse()) : pt;
    return { x: p.x, y: p.y };
  };

  const dragHandlers = (key: string, qi: number) => ({
    onPointerDown: (e: React.PointerEvent<SVGGElement>) => {
      if (!editMode) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = toSvg(e.clientX, e.clientY);
      const [ox, oy] = offsets[key] || [0, 0];
      drag.current = { key, sx: p.x, sy: p.y, ox, oy };
    },
    onPointerMove: (e: React.PointerEvent<SVGGElement>) => {
      const d = drag.current;
      if (!d || d.key !== key) return;
      const p = toSvg(e.clientX, e.clientY);
      onOffset(key, [d.ox + p.x - d.sx, d.oy + p.y - d.sy]);
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onClick: () => {
      if (!editMode) onSelect(qi);
    },
    onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(qi);
      }
    },
  });

  const questions = result?.questions || [];

  return (
    <div className="relative w-full select-none" style={{ aspectRatio: `${W} / ${H}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.dataUrl} alt={image.label} className="absolute inset-0 h-full w-full" draggable={false} />
      <svg
        ref={(el) => {
          svgEl.current = el;
          svgRef?.(el);
        }}
        viewBox={`0 0 ${W} ${H}`}
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: "none" }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {selected !== null && questions[selected]?.question_box.length === 4 && (
          <HighlightBox box={questions[selected].question_box} u={u} />
        )}
        {questions.map((q, qi) => {
          const circleKey = `${pageIndex}:${qi}:c`;
          const markKey = `${pageIndex}:${qi}:m`;
          const [cx, cy] = offsets[circleKey] || [0, 0];
          const [mx, my] = offsets[markKey] || [0, 0];
          const showCircle = q.correct_choice_box.length === 4 && (q.type === "mc" || q.type === "true_false") && q.verdict !== "correct";
          const delay = qi * 110;
          return (
            <g key={qi}>
              {showCircle && (
                <g
                  transform={`translate(${cx} ${cy})`}
                  style={{ pointerEvents: "auto", cursor: editMode ? "move" : "pointer", touchAction: editMode ? "none" : "auto" }}
                  {...dragHandlers(circleKey, qi)}
                >
                  <PenCircle box={q.correct_choice_box} u={u} delay={delay + 260} />
                </g>
              )}
              {q.mark_point.length === 2 && (
                <g
                  transform={`translate(${mx} ${my})`}
                  style={{ pointerEvents: "auto", cursor: editMode ? "move" : "pointer", touchAction: editMode ? "none" : "auto" }}
                  role="button"
                  tabIndex={0}
                  aria-label={`第 ${q.id} 題`}
                  {...dragHandlers(markKey, qi)}
                >
                  <MarkGlyph q={q} x={q.mark_point[0]} y={q.mark_point[1]} u={u} W={W} delay={delay} showNote={showNotes} active={selected === qi} />
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {editMode && (
        <div className="no-print pointer-events-none absolute inset-0 ring-2 ring-bluepen ring-inset" aria-hidden />
      )}
    </div>
  );
}

function HighlightBox({ box, u }: { box: number[]; u: number }) {
  const [x1, y1, x2, y2] = box;
  return (
    <rect
      x={x1 - u}
      y={y1 - u}
      width={x2 - x1 + 2 * u}
      height={y2 - y1 + 2 * u}
      rx={u}
      fill="#f2b705"
      fillOpacity={0.14}
      stroke="#f2b705"
      strokeWidth={u * 0.35}
    />
  );
}

const RED = "#d92b26";
const BLUE = "#1f56d6";
const AMBER = "#e0a100";
const GREY = "#7f8a9a";

function MarkGlyph({ q, x, y, u, W, delay, showNote, active }: { q: GradedQuestion; x: number; y: number; u: number; W: number; delay: number; showNote: boolean; active: boolean }) {
  const sw = u * 0.62;
  const marksPreview = formatMarks(q);
  const notePreview = showNote ? q.short_note.slice(0, 28) : "";
  // Estimated width of the label row, so it can go on whichever side has room.
  const rowW = (3.6 + Math.max(2.8, 1.25 * q.id.length + 1.2) + (marksPreview ? textUnits(marksPreview, 3.2) + 1.2 : 0) + (notePreview ? textUnits(notePreview, 3) + 1 : 0)) * u;
  const fitsRight = x + rowW < W - u;
  const flip = !fitsRight && x - rowW > u ? true : !fitsRight && x > W / 2;
  const side = flip ? -1 : 1;
  const anchor = flip ? "end" : "start";
  const common = { fill: "none", strokeWidth: sw, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, pathLength: 1, className: "draw-in", style: { animationDelay: `${delay}ms` } };
  const marks = formatMarks(q);

  let glyph: React.ReactNode;
  switch (q.verdict) {
    case "correct":
      glyph = <path d={tick(x, y, u)} stroke={RED} {...common} />;
      break;
    case "partially_correct":
      glyph = (
        <>
          <path d={tick(x, y, u)} stroke={RED} {...common} />
          <path d={`M ${x + 0.4 * u} ${y - 1.9 * u} L ${x + 1.9 * u} ${y - 0.2 * u}`} stroke={RED} {...common} style={{ animationDelay: `${delay + 200}ms` }} />
        </>
      );
      break;
    case "incorrect":
    case "unanswered":
      glyph = (
        <>
          <path d={`M ${x - 2 * u} ${y - 2 * u} Q ${x + 0.1 * u} ${y - 0.2 * u} ${x + 2.1 * u} ${y + 2.1 * u}`} stroke={RED} {...common} />
          <path
            d={`M ${x + 2 * u} ${y - 2.1 * u} Q ${x + 0.1 * u} ${y + 0.1 * u} ${x - 2.1 * u} ${y + 2 * u}`}
            stroke={RED}
            {...common}
            style={{ animationDelay: `${delay + 160}ms` }}
          />
        </>
      );
      break;
    case "scored":
      glyph = (
        <>
          <text x={x} y={y + 1.4 * u} fontSize={4.6 * u} textAnchor="middle" fill={RED} className="pen-text" strokeWidth={u * 0.5}>
            {marks || "★"}
          </text>
          <path d={`M ${x - 3.6 * u} ${y + 2.6 * u} Q ${x} ${y + 3.6 * u} ${x + 3.8 * u} ${y + 2.2 * u}`} stroke={RED} {...common} />
        </>
      );
      break;
    case "needs_review":
      glyph = (
        <>
          <circle cx={x} cy={y} r={2.4 * u} stroke={AMBER} {...common} />
          <text x={x} y={y + 1.25 * u} fontSize={3.4 * u} textAnchor="middle" fill={AMBER} className="pen-text" strokeWidth={u * 0.4}>
            ?
          </text>
        </>
      );
      break;
    default:
      glyph = (
        <text x={x} y={y + 1.25 * u} fontSize={3.6 * u} textAnchor="middle" fill={GREY} className="pen-text" strokeWidth={u * 0.4}>
          ?
        </text>
      );
  }

  const showMarks = marks && q.verdict !== "scored" && (q.verdict === "partially_correct" || q.type === "calculation" || q.type === "long_answer");
  const noteText = showNote ? q.short_note.slice(0, 28) : "";

  // Everything sits in one row beside the mark: [mark] [badge] [marks], note underneath.
  const labelX = x + side * 3.6 * u;
  const badgeW = Math.max(2.8, 1.25 * q.id.length + 1.2) * u;
  const badgeH = 2.6 * u;
  const badgeLeft = flip ? labelX - badgeW : labelX;
  const marksX = flip ? badgeLeft - 0.9 * u : badgeLeft + badgeW + 0.9 * u;

  return (
    <g>
      {/* generous invisible hit area for fingers */}
      <circle cx={x} cy={y} r={4.2 * u} fill="transparent" />
      {glyph}
      {/* question label: tap to open the explanation */}
      <g transform={`translate(${badgeLeft} ${y - badgeH / 2})`}>
        <rect width={badgeW} height={badgeH} rx={badgeH / 2} fill={active ? BLUE : "#172030"} opacity={active ? 1 : 0.82} />
        <text x={badgeW / 2} y={1.85 * u} fontSize={1.6 * u} textAnchor="middle" fill="#fff" fontFamily="Noto Sans HK, sans-serif" fontWeight={700}>
          {q.id}
        </text>
      </g>
      {showMarks && (
        <text x={marksX} y={y + 1.1 * u} fontSize={3.2 * u} textAnchor={anchor} fill={RED} className="pen-text" strokeWidth={u * 0.45}>
          {marks}
        </text>
      )}
      {noteText && (
        <text
          x={showMarks ? marksX + side * (textUnits(marks, 3.2) + 1.2) * u : marksX}
          y={y + 1.1 * u}
          fontSize={3 * u}
          textAnchor={anchor}
          fill={BLUE}
          className="pen-text"
          strokeWidth={u * 0.45}
        >
          {noteText}
        </text>
      )}
    </g>
  );
}

/** Rough width of pen text in "u" units (CJK characters are about twice as wide). */
function textUnits(s: string, fontSize: number) {
  let w = 0;
  for (const ch of s) w += /[\u2E80-\uFFEF]/.test(ch) ? 1 : 0.48;
  return w * fontSize;
}

function tick(x: number, y: number, u: number) {
  return `M ${x - 2.2 * u} ${y - 0.2 * u} Q ${x - 1.3 * u} ${y + 0.7 * u} ${x - 0.6 * u} ${y + 1.9 * u} Q ${x + 0.9 * u} ${y - 0.9 * u} ${x + 2.9 * u} ${y - 2.9 * u}`;
}

function PenCircle({ box, u, delay }: { box: number[]; u: number; delay: number }) {
  const [x1, y1, x2, y2] = box;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = (x2 - x1) / 2 + 1.1 * u;
  const ry = (y2 - y1) / 2 + 0.9 * u;
  const common = { fill: "none", stroke: BLUE, strokeLinecap: "round" as const, pathLength: 1, className: "draw-in" };
  // Two slightly different loops look like a quick pen circle.
  return (
    <g>
      <rect x={x1 - 1.5 * u} y={y1 - 1.3 * u} width={x2 - x1 + 3 * u} height={y2 - y1 + 2.6 * u} fill="transparent" />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(-4 ${cx} ${cy})`} strokeWidth={u * 0.55} {...common} style={{ animationDelay: `${delay}ms` }} />
      <ellipse
        cx={cx + 0.3 * u}
        cy={cy - 0.2 * u}
        rx={rx * 1.04}
        ry={ry * 0.96}
        transform={`rotate(3 ${cx} ${cy})`}
        strokeWidth={u * 0.3}
        opacity={0.55}
        {...common}
        style={{ animationDelay: `${delay + 180}ms` }}
      />
    </g>
  );
}
