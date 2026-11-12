"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Loader2,
  LogOut,
  Printer,
  Siren,
  Star,
  Timer,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { BarRow, DonutChart } from "@/components/charts";
import { ConfirmDialog } from "@/components/modal";
import { EmptyState, InlineAlert, Spinner, StatCard, TierBadge } from "@/components/ui";
import { buildShiftSummary, type DomainEvent, type ShiftSummary, type Task, type Tier } from "@/domain";
import { activeShift, db, type HandoverRow, type ReviewRow, type ShiftRow } from "@/lib/db";
import { endShift } from "@/lib/actions";
import { cn, formatDateTime, formatMinutes, formatPercent, formatTime } from "@/lib/format";
import { useLive, useNow } from "@/lib/hooks";
import { useApp } from "@/lib/store";

function SummaryInner() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("shift") ?? undefined;
  const user = useApp((s) => s.user);
  const notify = useApp((s) => s.notify);
  const now = useNow(10_000);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);

  const shiftBox = useLive(
    async (): Promise<{ shift?: ShiftRow }> => {
      if (!user) return { shift: undefined };
      if (requested) return { shift: await db().shifts.get(requested) };
      const active = await activeShift(user.id);
      if (active) return { shift: active };
      const all = await db().shifts.where("actorId").equals(user.id).toArray();
      return { shift: all.sort((a, b) => b.startedAt - a.startedAt)[0] };
    },
    [user?.id, requested],
  );

  useEffect(() => {
    if (user?.role === "head_nurse") router.replace("/head");
  }, [user, router]);

  const shift = shiftBox?.shift;
  const data = useLive(
    async (): Promise<{ events: DomainEvent[]; tasks: Task[]; handovers: HandoverRow[]; reviews: ReviewRow[]; beds: { id: string; alias: string }[] }> => {
      if (!shift) return { events: [], tasks: [], handovers: [], reviews: [], beds: [] };
      const [events, tasks, handovers, reviews, beds] = await Promise.all([
        db().events.where("shiftId").equals(shift.id).toArray(),
        db().tasks.where("shiftId").equals(shift.id).toArray(),
        db().handovers.where("shiftId").equals(shift.id).toArray(),
        db().reviews.where("shiftId").equals(shift.id).toArray(),
        db().beds.where("shiftId").equals(shift.id).toArray(),
      ]);
      return { events, tasks, handovers, reviews, beds };
    },
    [shift?.id],
  );

  const summary = useMemo(() => {
    if (!shift || !data?.events.length) return undefined;
    return buildShiftSummary(data.events, shift.endedAt ?? now);
  }, [shift, data?.events, now]);

  const tasks = data?.tasks ?? [];
  const missedTasks = tasks.filter((t) => t.status === "missed");
  const deferredTasks = tasks.filter((t) => t.status === "deferred");
  const review = data?.reviews?.[0];
  const handovers = data?.handovers ?? [];

  async function finish() {
    if (!shift) return;
    setBusy(true);
    try {
      await endShift(shift.id, "Ended from summary");
      setConfirmEnd(false);
      notify("Shift ended. Summary written from the event log.", "success");
      router.replace(`/summary?shift=${shift.id}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not end shift", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!shiftBox) return <AppShell title="Shift summary" subtitle="Loading…"><Spinner /></AppShell>;
  if (!shift) {
    return (
      <AppShell title="Shift summary" subtitle="No shift on this device">
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title="Nothing to summarise yet"
          body="Start a demo shift to create tasks, then end it to see the timestamp-based summary."
          action={<Link className="btn-primary" href="/shift-start">Start a shift</Link>}
        />
      </AppShell>
    );
  }

  if (!summary) return <AppShell title="Shift summary" subtitle="Building summary…"><Spinner /></AppShell>;

  return (
    <AppShell
      title="Shift summary"
      subtitle={`${shift.type} shift · ${formatDateTime(shift.startedAt)}${shift.endedAt ? ` → ${formatTime(shift.endedAt)}` : " · still open"}`}
      backHref={shift.endedAt ? "/me" : "/beds"}
      actions={
        <button className="btn-ghost hidden h-9 px-2 text-xs sm:inline-flex" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print
        </button>
      }
    >
      {!shift.endedAt ? (
        <div className="mb-4">
          <InlineAlert tone="warning" title="This shift is still open">
            <p>The figures below close open segments at the current time for preview. End the shift to freeze the summary.</p>
            <button className="btn-danger mt-3" onClick={() => setConfirmEnd(true)}>
              <LogOut className="h-4 w-4" /> End shift now
            </button>
          </InlineAlert>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Direct care" value={formatMinutes(summary.directCareMin)} hint="Timed task minutes" tone="teal" icon={<Timer className="h-4 w-4" />} />
        <StatCard label="Indirect care" value={formatMinutes(summary.indirectCareMin)} hint="Charting, family, supplies" icon={<ClipboardCheck className="h-4 w-4" />} />
        <StatCard label="Interruptions" value={formatMinutes(summary.interruptionMin)} hint={`${summary.interruptionsByReason.reduce((s, i) => s + i.count, 0)} logged`} tone="amber" icon={<XCircle className="h-4 w-4" />} />
        <StatCard label="Emergency" value={formatMinutes(summary.emergencyMin)} hint="On affected beds" tone="danger" icon={<Siren className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <section className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-ink">Where the time went</h2>
                <p className="text-xs text-slate-500">Computed from stored timestamps, never an in-memory counter.</p>
              </div>
              <span className="pill bg-slate-100 text-slate-600">{formatMinutes(summary.totalMinutes)} shift</span>
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
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              Categories can overlap in reality; this view shows only recorded, timestamped intervals. Emergency time is
              shown separately, not subtracted from care totals.
            </p>
          </section>

          <section className="card p-5">
            <h2 className="text-base font-bold text-ink">Tier completion</h2>
            <p className="text-xs text-slate-500">Tier is a planning label. It is not a nurse performance score.</p>
            <div className="mt-4 space-y-3">
              {([1, 2, 3, 4] as Tier[]).map((tier) => {
                const row = summary.tierBreakdown[tier];
                return (
                  <div key={tier}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-xs text-slate-600">
                        <TierBadge tier={tier} compact />
                        <span>{row.done}/{row.total} done</span>
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">{formatPercent(row.total ? row.done / row.total : 0)}</span>
                    </div>
                    <BarRow label="" value={row.done} max={row.total || 1} color={tier === 1 ? "bg-danger-500" : tier === 2 ? "bg-amber-500" : tier === 3 ? "bg-teal-500" : "bg-slate-400"} right="" />
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-base font-bold text-ink">Interruptions by reason</h2>
            {summary.interruptionsByReason.length ? (
              <div className="mt-3 space-y-3">
                {summary.interruptionsByReason.map((item) => (
                  <BarRow
                    key={item.reason}
                    label={`${item.label} × ${item.count}`}
                    value={item.minutes}
                    max={Math.max(...summary.interruptionsByReason.map((i) => i.minutes), 1)}
                    color="bg-amber-500"
                    right={formatMinutes(item.minutes)}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No interruptions were logged.</p>
            )}
            <p className="mt-3 text-[11px] text-slate-500">Reasons are fixed presets so totals stay comparable.</p>
          </section>
        </div>

        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="text-base font-bold text-ink">Shift facts</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Tasks complete" value={`${summary.tasksDone}/${summary.tasksTotal}`} />
              <Row label="Completion" value={formatPercent(summary.completionRate)} />
              <Row label="Tier 1–2 on time" value={formatPercent(summary.tier12OnTimeRate)} />
              <Row label="Deferred at end" value={String(summary.deferredCount)} />
              <Row label="Missed" value={String(summary.missedCount)} />
              <Row label="Handovers" value={String(handovers.length)} />
              <Row label="Head-nurse review" value={review ? "Received" : "Not yet"} />
            </dl>
            <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
              No composite score, ranking or leaderboard is calculated. The head nurse writes five manual 1–5
              ratings on a separate screen.
            </p>
          </section>

          {missedTasks.length ? (
            <section className="card border-danger-100 p-5">
              <h2 className="flex items-center gap-2 text-base font-bold text-danger-800">
                <XCircle className="h-4 w-4" /> Missed tasks
              </h2>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                {missedTasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-2">
                    <TierBadge tier={task.tier} compact />
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    <span className="text-[11px] text-slate-500">{formatTime(task.dueAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {deferredTasks.length ? (
            <section className="card border-violet-100 p-5">
              <h2 className="text-base font-bold text-violet-900">Still deferred</h2>
              <p className="mt-1 text-xs text-slate-500">Tier 3–4 only. Confirm a new due time before handover.</p>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                {deferredTasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-2">
                    <TierBadge tier={task.tier} compact />
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {review ? (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-bold text-ink">
                <Star className="h-4 w-4 text-amber-500" /> Head-nurse review
              </h2>
              <div className="mt-2 space-y-1.5 text-sm">
                {Object.entries(review.scores).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <span className="capitalize text-slate-500">{key.replaceAll("_", " ")}</span>
                    <span className="font-semibold text-slate-800">{value}/5</span>
                  </div>
                ))}
              </div>
              {review.comment ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{review.comment}</p> : null}
              {review.needsSupport ? <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">Needs support flagged. This is not a ranking.</p> : null}
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {shift.endedAt ? (
              <>
                <Link className="btn-primary" href="/shift-start">
                  Start next shift <ArrowRight className="h-4 w-4" />
                </Link>
                <Link className="btn-secondary" href="/me">Back to me</Link>
              </>
            ) : (
              <>
                <Link className="btn-secondary" href="/beds">Back to beds</Link>
                <button className="btn-danger" onClick={() => setConfirmEnd(true)}>End shift</button>
              </>
            )}
            <button className="btn-ghost" onClick={() => window.print()}>
              <Download className="h-4 w-4" /> Print / save PDF
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        onConfirm={finish}
        busy={busy}
        confirmLabel="End shift"
        tone="danger"
        title="End this shift and freeze the summary?"
        body={
          <div className="space-y-2">
            <p>Open tasks will be marked missed with reason “shift end”. Active timers close at this timestamp.</p>
            <p className="text-xs text-slate-500">The summary and its source events are kept. This cannot be undone.</p>
          </div>
        }
      />
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

export default function SummaryPage() {
  return (
    <Suspense fallback={<AppShell title="Shift summary" subtitle="Loading…"><Spinner /></AppShell>}>
      <SummaryInner />
    </Suspense>
  );
}
