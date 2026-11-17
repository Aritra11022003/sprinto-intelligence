"use client";
// Hand-built SVG/HTML charts for the dark dashboard. Colours were validated for the dark surface
// (dataviz validator): series #8f75f0 / #a8871a; verdicts #3aa76d / #b8860b / #df5b7f + neutral grey.
import { useEffect, useMemo, useState } from "react";
import type { DayPoint } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export const SERIES = { researched: "#8f75f0", qualified: "#a8871a" } as const;
export const VERDICT_COLOR: Record<string, string> = { qualified: "#3aa76d", manual_review: "#b8860b", disqualified: "#df5b7f", incomplete: "#6b7280" };

/** Smooth path through points (Catmull-Rom → cubic Bézier), clamped so curves never dip below zero. */
function smoothPath(pts: Array<[number, number]>, floorY: number): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = Math.min(floorY, p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = Math.min(floorY, p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / step) * step;
}

/** Two-series activity line chart with crosshair + tooltip. */
export function ActivityChart({ data }: { data: DayPoint[] }) {
  const W = 640, H = 230, PL = 28, PR = 10, PT = 16, PB = 26;
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.researched, d.qualified))));
  const x = (i: number) => PL + (i * (W - PL - PR)) / Math.max(1, data.length - 1);
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
  const base = y(0);
  const rPts = data.map((d, i) => [x(i), y(d.researched)] as [number, number]);
  const qPts = data.map((d, i) => [x(i), y(d.qualified)] as [number, number]);
  const rPath = smoothPath(rPts, base);
  const qPath = smoothPath(qPts, base);
  const ticks = [0, max / 2, max].map((t) => Math.round(t));
  const empty = data.every((d) => d.researched === 0);

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PL) / (W - PL - PR)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }
  const h = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Companies researched and qualified per day">
        <defs>
          <linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={SERIES.researched} stopOpacity="0.28" />
            <stop offset="100%" stopColor={SERIES.researched} stopOpacity="0" />
          </linearGradient>
          <pattern id="vlines" width="6" height="6" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="1" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="#ffffff" strokeOpacity="0.06" />
            <text x={PL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#71717a">{t}</text>
          </g>
        ))}
        {!empty && <path d={`${rPath} L ${x(data.length - 1)} ${base} L ${x(0)} ${base} Z`} fill="url(#vlines)" />}
        {!empty && <path d={`${rPath} L ${x(data.length - 1)} ${base} L ${x(0)} ${base} Z`} fill="url(#areaFill)" />}
        <path d={rPath} fill="none" stroke={SERIES.researched} strokeWidth="2.25" strokeLinecap="round" />
        <path d={qPath} fill="none" stroke={SERIES.qualified} strokeWidth="2" strokeLinecap="round" strokeDasharray={empty ? "4 4" : undefined} />
        {data.map((d, i) => (i % Math.ceil(data.length / 7) === 0 || i === data.length - 1) && (
          <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill={hover === i ? "#e4e4e7" : "#71717a"}>{d.label}</text>
        ))}
        {h && hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PT} y2={base} stroke="#e4e4e7" strokeOpacity="0.5" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(h.researched)} r="5" fill={SERIES.researched} stroke="#17171c" strokeWidth="2" />
            <circle cx={x(hover)} cy={y(h.qualified)} r="5" fill={SERIES.qualified} stroke="#17171c" strokeWidth="2" />
          </g>
        )}
        <rect x={PL} y={PT} width={W - PL - PR} height={H - PT - PB} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ cursor: "crosshair" }} />
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-1 flex -translate-x-1/2 gap-1.5 text-xs" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <span className="whitespace-nowrap rounded-full border border-white/10 bg-zinc-800/95 px-2 py-0.5 text-zinc-200">{h.label}</span>
          <span className="flex items-center gap-1 whitespace-nowrap rounded-full border border-white/10 bg-zinc-800/95 px-2 py-0.5 text-zinc-100"><span className="h-2 w-2 rounded-full" style={{ background: SERIES.researched }} />{h.researched} researched</span>
          <span className="flex items-center gap-1 whitespace-nowrap rounded-full border border-white/10 bg-zinc-800/95 px-2 py-0.5 text-zinc-100"><span className="h-2 w-2 rounded-full" style={{ background: SERIES.qualified }} />{h.qualified} qualified</span>
        </div>
      )}
      <table className="sr-only">
        <caption>Companies researched and qualified per day</caption>
        <thead><tr><th>Day</th><th>Researched</th><th>Qualified</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.date}><td>{d.label}</td><td>{d.researched}</td><td>{d.qualified}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
      {items.map((i) => <span key={i.label} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: i.color }} />{i.label}</span>)}
    </div>
  );
}

/** Rounded "pill" bars on hatched tracks; the largest bar gets a value chip. */
export function PillBars({ items }: { items: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const top = items.reduce((m, i) => (i.count > m ? i.count : m), 0);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div>
      <div className="flex h-44 items-end gap-2" role="img" aria-label={`Pages fetched by type: ${items.map((i) => `${i.label} ${i.count}`).join(", ")}`}>
        {items.map((i, idx) => {
          const pct = i.count ? Math.max(12, (i.count / max) * 100) : 0;
          const isTop = i.count > 0 && i.count === top;
          return (
            <div key={i.label} className="relative flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(idx)} onMouseLeave={() => setHover(null)}>
              <div className="absolute inset-0 rounded-2xl border border-white/5" style={{ background: "repeating-linear-gradient(135deg, rgba(255,255,255,0.07) 0 2px, transparent 2px 9px)" }} />
              <div className={cn("relative rounded-2xl transition-[height] duration-500", isTop ? "" : "opacity-90")} style={{ height: `${pct}%`, background: isTop ? "#c4b5fd" : "#3f3f46", boxShadow: "0 0 0 2px #17171c" }}>
                {(isTop || hover === idx) && i.count > 0 && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-900 shadow">{i.count}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        {items.map((i, idx) => <span key={i.label} className={cn("flex-1 text-center text-[11px]", hover === idx ? "text-zinc-100" : "text-zinc-500")}>{i.label}</span>)}
      </div>
    </div>
  );
}

/** Packed bubbles sized by share (area ∝ value), each directly labelled. */
export function VerdictBubbles({ items }: { items: Array<{ key: string; label: string; count: number; share: number }> }) {
  const shown = items.filter((i) => i.count > 0).sort((a, b) => b.count - a.count);
  const SLOTS = [
    { x: 38, y: 58 }, // largest
    { x: 74, y: 30 },
    { x: 74, y: 76 },
    { x: 92, y: 52 },
  ];
  if (!shown.length) {
    return (
      <div className="relative h-52">
        {SLOTS.slice(0, 3).map((s, i) => (
          <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/15" style={{ left: `${s.x}%`, top: `${s.y}%`, width: [130, 70, 84][i], height: [130, 70, 84][i] }} />
        ))}
        <p className="absolute inset-x-0 bottom-0 text-center text-xs text-zinc-500">Verdicts appear after your first run</p>
      </div>
    );
  }
  const maxD = 150, minD = 46;
  return (
    <div className="relative h-52" role="img" aria-label={`Verdict mix: ${shown.map((s) => `${s.label} ${Math.round(s.share * 100)}%`).join(", ")}`}>
      {shown.slice(0, 4).map((s, i) => {
        const d = Math.max(minD, Math.sqrt(s.share) * maxD);
        return (
          <div
            key={s.key}
            title={`${s.label}: ${s.count} (${Math.round(s.share * 100)}%)`}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-center transition-transform hover:scale-105"
            style={{ left: `${SLOTS[i].x}%`, top: `${SLOTS[i].y}%`, width: d, height: d, background: VERDICT_COLOR[s.key], boxShadow: "0 0 0 3px #17171c", zIndex: 10 - i }}
          >
            <span className={cn("font-semibold leading-none text-white", d > 100 ? "text-3xl" : d > 70 ? "text-xl" : "text-sm")}>{Math.round(s.share * 100)}%</span>
            {d > 64 && <span className="mt-1 px-1 text-[10px] leading-tight text-white/90">{s.label}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Month calendar; days with research runs are filled. */
export function RunCalendar({ calendar }: { calendar: { year: number; month: number; days: Array<{ day: number; runs: number; date: string }> } }) {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);
  const first = new Date(calendar.year, calendar.month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const cells = useMemo(() => [...Array.from({ length: lead }, () => null), ...calendar.days], [lead, calendar.days]);
  const isToday = (d: number) => !!today && today.getFullYear() === calendar.year && today.getMonth() === calendar.month && today.getDate() === d;
  return (
    <div>
      <div className="mb-1.5 grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((c, i) =>
          c === null ? <span key={`e${i}`} /> : (
            <span
              key={c.date}
              title={c.runs ? `${c.runs} research run${c.runs === 1 ? "" : "s"}` : "No runs"}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-xl text-[12px] tabular-nums",
                c.runs ? "bg-violet-300 font-semibold text-zinc-900" : "border border-white/5 bg-white/[0.04] text-zinc-400",
                isToday(c.day) && !c.runs && "ring-1 ring-violet-300/70",
              )}
            >
              {c.day}
              {c.runs > 1 && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-zinc-900" />}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
