"use client";

import { cn } from "@/lib/format";

export type DonutSegment = { label: string; value: number; color: string };

export function DonutChart({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: DonutSegment[];
  centerLabel: string;
  centerValue: string;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90" role="img" aria-label={`${centerLabel}: ${centerValue}`}>
          <circle cx="70" cy="70" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="16" />
          {total > 0
            ? segments.map((segment) => {
                const length = (Math.max(0, segment.value) / total) * circumference;
                const dash = `${length} ${circumference - length}`;
                const element = (
                  <circle
                    key={segment.label}
                    cx="70"
                    cy="70"
                    r={radius}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth="16"
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                    strokeLinecap="butt"
                  />
                );
                offset += length;
                return element;
              })
            : null}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-2xl font-extrabold tracking-tight text-ink">{centerValue}</p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{centerLabel}</p>
          </div>
        </div>
      </div>
      <ul className="w-full space-y-1.5">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: segment.color }} aria-hidden />
              {segment.label}
            </span>
            <span className="font-semibold tabular-nums text-slate-800">
              {Math.round(segment.value)}m
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarRow({
  label,
  value,
  max,
  color,
  right,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  right: string;
}) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="font-semibold tabular-nums text-slate-800">{right}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function Sparkline({ values, color = "#0d9488" }: { values: number[]; color?: string }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * 100;
      const y = 32 - (value / max) * 28;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 34" className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
