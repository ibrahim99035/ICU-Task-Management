"use client";

import {
  Activity,
  Check,
  CheckCircle2,
  CircleDot,
  Clock,
  FileText,
  HeartPulse,
  PauseCircle,
  Sparkles,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import type { TaskStatus, Tier } from "@/domain";
import { CATEGORY_LABELS, TIER_LABELS } from "@/domain";
import { cn, tierStyle } from "@/lib/format";

export function Logo({ size = 34, light = false }: { size?: number; light?: boolean }) {
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-xl",
        light ? "bg-white/10 text-white" : "bg-ink text-teal-300",
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" width={size * 0.62} height={size * 0.62} fill="none">
        <path d="M13 4h6v9h9v6h-9v9h-6v-9H4v-6h9V4Z" fill="currentColor" opacity=".95" />
        <path d="M7 25h5l2-5 3 8 2.5-6H25" stroke="#0d9488" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function TierBadge({ tier, compact = false }: { tier: Tier; compact?: boolean }) {
  const Icon = tier === 1 ? HeartPulse : tier === 2 ? Activity : tier === 3 ? Sparkles : FileText;
  const style = tierStyle(tier);
  return (
    <span className={cn("pill", style.chip)} title={`Tier ${tier}: ${TIER_LABELS[tier]}`}>
      <Icon className={cn("h-3.5 w-3.5", style.icon)} aria-hidden />
      <span>
        T{tier}
        {!compact ? ` · ${TIER_LABELS[tier]}` : ""}
      </span>
    </span>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, { label: string; className: string; Icon: typeof Clock }> = {
    planned: { label: "Planned", className: "bg-slate-100 text-slate-600", Icon: CircleDot },
    in_progress: { label: "Running", className: "bg-teal-50 text-teal-800", Icon: Activity },
    paused: { label: "Paused", className: "bg-amber-50 text-amber-800", Icon: PauseCircle },
    done: { label: "Done", className: "bg-teal-50 text-teal-800", Icon: CheckCircle2 },
    deferred: { label: "Deferred", className: "bg-violet-50 text-violet-700", Icon: Clock },
    missed: { label: "Missed", className: "bg-danger-50 text-danger-700", Icon: XCircle },
  };
  const item = map[status];
  return (
    <span className={cn("pill", item.className)}>
      <item.Icon className="h-3.5 w-3.5" aria-hidden />
      {item.label}
    </span>
  );
}

export function CategoryBadge({ category }: { category: "direct_care" | "indirect_care" }) {
  return <span className="text-[11px] font-medium text-slate-500">{CATEGORY_LABELS[category]}</span>;
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "teal" | "amber" | "danger";
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "card p-4",
        tone === "teal" && "border-teal-100 bg-teal-50/40",
        tone === "amber" && "border-amber-100 bg-amber-50/40",
        tone === "danger" && "border-danger-100 bg-danger-50/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {icon ? <span className="text-slate-400">{icon}</span> : null}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">{icon}</div>
      <div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
      {label}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function InlineAlert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title: string;
  children?: React.ReactNode;
}) {
  const Icon = tone === "warning" ? TriangleAlert : tone === "success" ? CheckCircle2 : tone === "danger" ? XCircle : Check;
  return (
    <div
      className={cn(
        "flex gap-3 rounded-2xl border p-4 text-sm",
        tone === "info" && "border-slate-200 bg-white text-slate-700",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
        tone === "danger" && "border-danger-200 bg-danger-50 text-danger-800",
        tone === "success" && "border-teal-200 bg-teal-50 text-teal-900",
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{title}</p>
        {children ? <div className="mt-1 text-sm opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
