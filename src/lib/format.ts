import type { Tier } from "@/domain";

export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatMinutes(min: number | undefined): string {
  if (min === undefined || Number.isNaN(min)) return "—";
  if (min > 0 && min < 1) return "<1m";
  const rounded = Math.round(min);
  if (rounded < 60) return `${rounded}m`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(ts);
}

export function formatDate(ts: number): string {
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" }).format(ts);
}

export function formatDateTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ts);
}

export function formatPercent(value: number | undefined, digits = 0): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function dueLabel(dueAt: number, now: number): { text: string; overdue: boolean } {
  const diff = now - dueAt;
  if (diff > 60_000) {
    const min = Math.max(1, Math.round(diff / 60_000));
    return { text: `${min} min overdue`, overdue: true };
  }
  if (diff >= -60_000) return { text: "Due now", overdue: false };
  const min = Math.max(1, Math.round(-diff / 60_000));
  if (min < 60) return { text: `in ${min} min`, overdue: false };
  const hours = Math.round(min / 60);
  return { text: `in ${hours}h`, overdue: false };
}

export function tierStyle(tier: Tier): { chip: string; icon: string } {
  switch (tier) {
    case 1:
      return { chip: "bg-danger-50 text-danger-700 border border-danger-100", icon: "text-danger-600" };
    case 2:
      return { chip: "bg-amber-50 text-amber-800 border border-amber-100", icon: "text-amber-600" };
    case 3:
      return { chip: "bg-teal-50 text-teal-800 border border-teal-100", icon: "text-teal-600" };
    case 4:
      return { chip: "bg-slate-100 text-slate-600 border border-slate-200", icon: "text-slate-500" };
  }
}

export function initials(name: string): string {
  return name
    .replace(/,.*$/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function toDateTimeLocal(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDateTimeLocal(value: string): number {
  return new Date(value).getTime();
}

export function clampDateTime(value: string): number {
  const ts = fromDateTimeLocal(value);
  return Number.isFinite(ts) ? ts : Date.now();
}

export function todayInput(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
