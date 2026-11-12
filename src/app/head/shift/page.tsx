"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  HeartPulse,
  Loader2,
  MessageSquare,
  PauseCircle,
  Play,
  Siren,
  Star,
  Timer,
  TimerReset,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { BarRow, DonutChart } from "@/components/charts";
import { EmptyState, InlineAlert, Spinner, StatCard } from "@/components/ui";
import {
  buildShiftSummary,
  INTERRUPTION_LABELS,
  type DomainEvent,
  type ShiftSummary,
  type TaskStatus,
} from "@/domain";
import { fetchShiftDetail, type ShiftDetail } from "@/lib/api";
import { cn, formatDateTime, formatMinutes, formatPercent, formatTime } from "@/lib/format";
import { useApp } from "@/lib/store";

function ShiftInner() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const user = useApp((s) => s.user);
  const token = useApp((s) => s.token);
  const [detail, setDetail] = useState<ShiftDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && user.role !== "head_nurse") router.replace("/beds");
    if (!user) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!token || !id || user?.role !== "head_nurse") return;
    setLoading(true);
    fetchShiftDetail(token, id)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load shift"))
      .finally(() => setLoading(false));
  }, [token, id, user?.role]);

  const summary: ShiftSummary | undefined = useMemo(() => {
    if (!detail) return undefined;
    if (detail.shift.summary) return detail.shift.summary;
    try {
      return buildShiftSummary(detail.events as DomainEvent[], detail.shift.endedAt ?? Date.now());
    } catch {
      return undefined;
    }
  }, [detail]);

  const taskTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of detail?.events ?? []) {
      if (event.type === "TASK_CREATED" && (event.payload as { title?: string }).title) {
        map.set(event.taskId ?? "", (event.payload as { title?: string }).title ?? "Task");
      }
    }
    return map;
  }, [detail]);

  const bedMap = useMemo(
    () => new Map((detail?.beds ?? []).map((bed) => [bed.id, bed.alias])),
    [detail],
  );

  if (!user) return null;

  if (loading) return <AppShell title="Shift detail" subtitle="Loading…" backHref="/head/shifts"><Spinner /></AppShell>;
  if (error || !detail) {
    return (
      <AppShell title="Shift detail" subtitle="Could not load" backHref="/head/shifts">
        <EmptyState
          icon={<XCircle className="h-6 w-6" />}
          title="Shift not available"
          body={error || "This shift may have been removed or the server is unreachable."}
          action={<Link href="/head/shifts" className="btn-primary">Back to shifts</Link>}
        />
      </AppShell>
    );
  }

  const shift = detail.shift;
  const missed = detail.events
    .filter((event) => event.type === "TASK_MISSED")
    .map((event) => ({ title: taskTitles.get(event.taskId ?? "") ?? "Task" }));

  return (
    <AppShell
      title={shift.nurseName}
      subtitle={`${shift.participantCode} · ${formatDateTime(shift.startedAt)}${shift.endedAt ? ` → ${formatTime(shift.endedAt)}` : " · open"}`}
      backHref="/head/shifts"
      activeOverride="/head/shifts"
      actions={
        shift.endedAt ? (
          <Link href={`/head/review?shift=${shift.id}`} className="btn-primary hidden h-9 px-3 text-xs sm:inline-flex">
            <Star className="h-4 w-4" /> {detail.review ? "View review" : "Review"}
          </Link>
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Completion" value={summary ? formatPercent(summary.completionRate) : "—"} hint={`${summary?.tasksDone ?? 0}/${summary?.tasksTotal ?? 0} tasks`} tone="teal" icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Direct care" value={summary ? formatMinutes(summary.directCareMin) : "—"} hint="Timestamped" icon={<Timer className="h-4 w-4" />} />
        <StatCard label="Interruptions" value={summary ? formatMinutes(summary.interruptionMin) : "—"} hint={`${summary?.interruptionsByReason.reduce((s, i) => s + i.count, 0) ?? 0} logged`} tone="amber" icon={<Activity className="h-4 w-4" />} />
        <StatCard label="Emergency" value={summary ? formatMinutes(summary.emergencyMin) : "—"} hint="Separate clock" tone="danger" icon={<Siren className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          {summary ? (
            <section className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-ink">Recorded time</h2>
                  <p className="text-xs text-slate-500">Shift total {formatMinutes(summary.totalMinutes)}</p>
                </div>
                {shift.endedAt ? <span className="pill bg-teal-50 text-teal-800">Finished</span> : <span className="pill bg-amber-50 text-amber-800">Open</span>}
              </div>
              <div className="mt-4">
                <DonutChart
                  segments={[
                    { label: "Direct care", value: summary.directCareMin, color: "#0d9488" },
                    { label: "Indirect care", value: summary.indirectCareMin, color: "#3b82f6" },
                    { label: "Interruptions", value: summary.interruptionMin, color: "#f59e0b" },
                    { label: "Emergency", value: summary.emergencyMin, color: "#dc2626" },
                  ]}
                  centerLabel="Recorded"
                  centerValue={formatMinutes(summary.directCareMin + summary.indirectCareMin + summary.interruptionMin + summary.emergencyMin)}
                />
              </div>
            </section>
          ) : null}

          <section className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-ink">Event timeline</h2>
                <p className="text-xs text-slate-500">Append-only. Timestamps are the nurse device times.</p>
              </div>
              <span className="pill bg-slate-100 text-slate-600">{detail.events.length} events</span>
            </div>
            <ol className="mt-3 max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
              {detail.events.map((event) => {
                const label = eventLabel(event as DomainEvent, taskTitles);
                const Icon = eventIcon(event.type);
                const danger = event.type === "EMERGENCY_STARTED" || event.type === "EMERGENCY_ENDED" || event.type === "TASK_MISSED";
                const warn = event.type === "INTERRUPTION_LOGGED" || event.type === "TASK_DEFERRED" || event.type === "TASK_PAUSED";
                return (
                  <li key={event.id} className="flex items-start gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50">
                    <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg", danger ? "bg-danger-50 text-danger-600" : warn ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500")}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium leading-snug text-slate-700">{label}</span>
                      <span className="block text-[10px] text-slate-400">
                        {formatDateTime(event.clientTs)} · {event.bedId ? bedMap.get(event.bedId) ?? "Bed" : "Shift"} · {event.type}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="card p-5">
            <h2 className="text-base font-bold text-ink">Handover snapshots</h2>
            {detail.handovers.length ? (
              <div className="mt-3 space-y-3">
                {detail.handovers.map((handover) => (
                  <div key={handover.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-800">{handover.snapshot.bedLabel}</p>
                      <span className="text-[11px] text-slate-500">{formatDateTime(handover.createdAt)}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px]">
                      <HandoverCount label="Done" value={handover.snapshot.done.length} />
                      <HandoverCount label="Pending" value={handover.snapshot.pending.length} />
                      <HandoverCount label="Deferred" value={handover.snapshot.deferred.length} />
                      <HandoverCount label="Missed" value={handover.snapshot.missed.length} />
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{handover.snapshot.note || "No note."}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No handover was finalized for this shift.</p>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="text-base font-bold text-ink">Shift facts</h2>
            {summary ? (
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="Tasks complete" value={`${summary.tasksDone}/${summary.tasksTotal}`} />
                <Row label="Tier 1–2 on time" value={formatPercent(summary.tier12OnTimeRate)} />
                <Row label="Missed" value={String(summary.missedCount)} />
                <Row label="Deferred at end" value={String(summary.deferredCount)} />
                <Row label="Indirect care" value={formatMinutes(summary.indirectCareMin)} />
                <Row label="Emergency" value={formatMinutes(summary.emergencyMin)} />
              </dl>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Summary not available.</p>
            )}
            {summary ? (
              <div className="mt-4 space-y-2">
                {([1, 2, 3, 4] as const).map((tier) => {
                  const row = summary.tierBreakdown[tier];
                  return (
                    <BarRow
                      key={tier}
                      label={`Tier ${tier} · ${row.done}/${row.total} done`}
                      value={row.done}
                      max={row.total || 1}
                      color={tier === 1 ? "bg-danger-500" : tier === 2 ? "bg-amber-500" : tier === 3 ? "bg-teal-500" : "bg-slate-400"}
                      right={formatPercent(row.total ? row.done / row.total : 0)}
                    />
                  );
                })}
              </div>
            ) : null}
          </section>

          <section className={cn("card p-5", detail.review ? "border-amber-100" : "border-slate-200")}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-bold text-ink"><Star className="h-4 w-4 text-amber-500" /> Manual review</h2>
              {detail.review ? <span className="pill bg-teal-50 text-teal-800">Received</span> : shift.endedAt ? <span className="pill bg-amber-50 text-amber-800">Pending</span> : <span className="pill bg-slate-100 text-slate-500">Not finished</span>}
            </div>
            {detail.review ? (
              <>
                <div className="mt-3 space-y-1.5 text-sm">
                  {Object.entries(detail.review.scores).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2">
                      <span className="capitalize text-slate-500">{key.replaceAll("_", " ")}</span>
                      <span className="font-semibold text-slate-800">{value}/5</span>
                    </div>
                  ))}
                </div>
                {detail.review.comment ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{detail.review.comment}</p> : null}
                {detail.review.needsSupport ? <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">Needs support flagged.</p> : null}
              </>
            ) : (
              <>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Five manual 1–5 ratings: completion, critical timeliness, interruption handling, handover and
                  documentation. No overall score is computed.
                </p>
                {shift.endedAt ? (
                  <Link href={`/head/review?shift=${shift.id}`} className="btn-primary mt-3 w-full">
                    <Star className="h-4 w-4" /> Write review
                  </Link>
                ) : null}
              </>
            )}
          </section>

          {summary?.interruptionsByReason.length ? (
            <section className="card p-5">
              <h2 className="text-base font-bold text-ink">Interruptions</h2>
              <div className="mt-3 space-y-2">
                {summary.interruptionsByReason.map((item) => (
                  <div key={item.reason} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-600">{item.label} × {item.count}</span>
                    <span className="font-semibold text-slate-800">{formatMinutes(item.minutes)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {missed.length ? (
            <section className="card border-danger-100 p-5">
              <h2 className="text-base font-bold text-danger-800">Missed tasks</h2>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {missed.map((task, index) => <li key={index}>• {task.title}</li>)}
              </ul>
            </section>
          ) : null}

          <div className="card border-amber-200 bg-amber-50/50 p-4 text-[11px] leading-relaxed text-amber-900">
            <p className="font-bold">Planning aid only</p>
            <p className="mt-1">This view is not a live monitor or official record. Verify against the bedside and unit policy.</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function HandoverCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-1.5">
      <p className="text-sm font-bold text-slate-800">{value}</p>
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}

function eventIcon(type: string) {
  if (type === "SHIFT_STARTED" || type === "SHIFT_ENDED") return Clock3;
  if (type === "TASK_CREATED") return FileText;
  if (type === "TASK_STARTED" || type === "TASK_RESUMED") return Play;
  if (type === "TASK_PAUSED") return PauseCircle;
  if (type === "TASK_COMPLETED") return CheckCircle2;
  if (type === "TASK_MISSED") return XCircle;
  if (type === "TASK_DEFERRED" || type === "TASK_RESCHEDULED") return TimerReset;
  if (type === "EMERGENCY_STARTED" || type === "EMERGENCY_ENDED") return Siren;
  if (type === "INTERRUPTION_LOGGED") return MessageSquare;
  if (type === "HANDOVER_FINALIZED") return ClipboardCheck;
  if (type === "TIME_CORRECTED") return Timer;
  return Activity;
}

function eventLabel(event: DomainEvent, titles: Map<string, string>): string {
  const payload = event.payload as Record<string, unknown>;
  const task = event.taskId ? titles.get(event.taskId) ?? "Task" : "";
  switch (event.type) {
    case "SHIFT_STARTED": return `Shift started (${String(payload.shiftType ?? "")})`;
    case "SHIFT_ENDED": return "Shift ended";
    case "TASK_CREATED": return `Task created: ${String(payload.title ?? task)}`;
    case "TASK_STARTED": return `Started: ${task}`;
    case "TASK_PAUSED": return `Paused: ${task}`;
    case "TASK_RESUMED": return `Resumed: ${task}`;
    case "TASK_COMPLETED": return `Completed: ${task}${payload.tickOnly ? " (tick-only)" : ""}`;
    case "TASK_DEFERRED": return `Deferred: ${task}`;
    case "TASK_RESCHEDULED": return `Rescheduled: ${task}`;
    case "TASK_MISSED": return `Missed: ${task} (${String(payload.reason ?? "")})`;
    case "INTERRUPTION_LOGGED": return `Interruption: ${INTERRUPTION_LABELS[payload.reason as keyof typeof INTERRUPTION_LABELS] ?? String(payload.reason ?? "")}`;
    case "EMERGENCY_STARTED": return "Emergency started";
    case "EMERGENCY_ENDED": return "Emergency ended";
    case "TIME_CORRECTED": return `Timestamp corrected: ${task}`;
    case "HANDOVER_FINALIZED": return "Handover finalized";
  }
  return "Event";
}

export default function ShiftDetailPage() {
  return (
    <Suspense fallback={<AppShell title="Shift detail" subtitle="Loading…" backHref="/head/shifts"><Spinner /></AppShell>}>
      <ShiftInner />
    </Suspense>
  );
}
