"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BedDouble,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  LogOut,
  Radio,
  Siren,
  Timer,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ActiveTaskBar } from "@/components/active-bar";
import { InterruptionSheet } from "@/components/interruption-sheet";
import { ConfirmDialog } from "@/components/modal";
import { InlineAlert, StatCard, TierBadge } from "@/components/ui";
import { isOverdue, reduce, type Task } from "@/domain";
import { activeShift, db, type BedRow } from "@/lib/db";
import { cn, dueLabel, formatElapsed, formatTime } from "@/lib/format";
import { useLive, useNow } from "@/lib/hooks";
import { endShift, finishEmergency, startEmergency } from "@/lib/actions";
import { useApp } from "@/lib/store";

export default function BedsPage() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const notify = useApp((s) => s.notify);
  const now = useNow(1000);
  const [interruptTask, setInterruptTask] = useState<Task | undefined>();
  const [interruptOpen, setInterruptOpen] = useState(false);
  const [emergencyBed, setEmergencyBed] = useState<BedRow | null>(null);
  const [endingShift, setEndingShift] = useState(false);
  const [endingEmergency, setEndingEmergency] = useState<BedRow | null>(null);
  const [busy, setBusy] = useState(false);

  const shiftBox = useLive(
    async () => (user ? { shift: await activeShift(user.id) } : undefined),
    [user?.id],
  );

  useEffect(() => {
    if (user?.role === "head_nurse") router.replace("/head");
    if (user && shiftBox && !shiftBox.shift) router.replace("/shift-start");
  }, [shiftBox, user, router]);

  const data = useLive(async () => {
    const shift = shiftBox?.shift;
    if (!shift) return { beds: [] as BedRow[], tasks: [] as Task[], state: undefined, shift: undefined };
    const [beds, tasks, events] = await Promise.all([
      db().beds.where("shiftId").equals(shift.id).toArray(),
      db().tasks.where("shiftId").equals(shift.id).toArray(),
      db().events.where("shiftId").equals(shift.id).toArray(),
    ]);
    const state = reduce(events);
    return { beds, tasks, state, shift };
  }, [shiftBox?.shift?.id]);

  const shift = shiftBox?.shift;
  const beds = data?.beds ?? [];
  const tasks = data?.tasks ?? [];
  const emergencies = data?.state?.emergencies ?? [];
  const activeEmergencies = emergencies.filter((e) => !e.endedAt);
  const activeTasks = tasks.filter((t) => t.status === "in_progress" || t.status === "paused");
  const done = tasks.filter((t) => t.status === "done").length;
  const overdue = tasks.filter((t) => isOverdue(t, now)).length;
  const needsAttention = tasks.filter((t) => t.needsAttention).length;

  const bedSummaries = useMemo(
    () =>
      beds.map((bed) => {
        const bedTasks = tasks.filter((t) => t.bedId === bed.id);
        const open = bedTasks.filter((t) => !["done", "missed", "deferred"].includes(t.status));
        const next = open.sort((a, b) => a.dueAt - b.dueAt)[0];
        const emergency = activeEmergencies.find((e) => e.bedId === bed.id);
        return {
          bed,
          tasks: bedTasks,
          overdue: bedTasks.filter((t) => isOverdue(t, now)).length,
          next,
          emergency,
          active: bedTasks.find((t) => t.status === "in_progress" || t.status === "paused"),
          tier12: bedTasks.filter((t) => t.tier <= 2 && !["done", "missed", "deferred"].includes(t.status)).length,
        };
      }),
    [beds, tasks, now, activeEmergencies],
  );

  async function beginEmergency() {
    if (!emergencyBed) return;
    setBusy(true);
    try {
      await startEmergency(emergencyBed.id);
      setEmergencyBed(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not start emergency", "error");
    } finally {
      setBusy(false);
    }
  }

  async function completeEmergency() {
    if (!endingEmergency) return;
    setBusy(true);
    try {
      const result = await finishEmergency(endingEmergency.id);
      setEndingEmergency(null);
      if (result.proposals.length) {
        notify(`${result.proposals.length} deferred task(s) need a new time.`, "warning");
        router.push(`/review-deferred?bed=${endingEmergency.id}`);
      } else {
        notify(`Emergency ended after ${formatElapsed(result.durationMs)}. No deferred tasks to reschedule.`, "success");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not end emergency", "error");
    } finally {
      setBusy(false);
    }
  }

  async function finishShift() {
    if (!shift) return;
    setBusy(true);
    try {
      await endShift(shift.id, "Ended from bed overview");
      setEndingShift(false);
      router.push(`/summary?shift=${shift.id}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not end shift", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!shiftBox) return <AppShell title="Beds" subtitle="Loading shift…"><div /></AppShell>;
  if (!shift) return <AppShell title="Beds" subtitle="No active shift"><div /></AppShell>;

  return (
    <AppShell
      title="Bed overview"
      subtitle={`${shift.type} shift · started ${formatTime(shift.startedAt)} · ${beds.length} beds`}
      actions={
        <Link href="/handover" className="btn-ghost hidden h-9 px-2 text-xs sm:inline-flex">
          <ClipboardCheck className="h-4 w-4" /> Handover
        </Link>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Shift clock" value={formatElapsed(now - shift.startedAt)} hint="From timestamps" icon={<Timer className="h-4 w-4" />} />
        <StatCard label="Tasks done" value={`${done}/${tasks.length}`} hint={`${overdue} overdue`} tone="teal" icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Active timers" value={String(activeTasks.length)} hint="Running or paused" icon={<Activity className="h-4 w-4" />} />
        <StatCard
          label="Emergencies"
          value={String(activeEmergencies.length)}
          hint={needsAttention ? `${needsAttention} tier 1–2 flagged` : "None active"}
          tone={activeEmergencies.length ? "danger" : "default"}
          icon={<Siren className="h-4 w-4" />}
        />
      </div>

      {activeEmergencies.length ? (
        <div className="mb-4">
          <InlineAlert tone="danger" title="Emergency mode is active">
            <p>
              Tier 1–2 tasks are flagged “needs attention” and were not deferred. Tier 3–4 planned tasks are
              deferred until you confirm new times.
            </p>
          </InlineAlert>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {bedSummaries.map((item) => {
          const due = item.next ? dueLabel(item.next.dueAt, now) : undefined;
          return (
            <article
              key={item.bed.id}
              className={cn("card overflow-hidden", item.emergency && "border-danger-300 ring-2 ring-danger-500/10")}
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4 pb-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", item.emergency ? "bg-danger-50 text-danger-600" : "bg-slate-100 text-slate-600")}>
                    <BedDouble className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-bold text-ink">{item.bed.alias}</h2>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {item.bed.label} · {item.tasks.length} tasks · {item.tier12} tier 1–2 open
                    </p>
                  </div>
                </div>
                <Link
                  href={`/tasks?bed=${item.bed.id}`}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                  aria-label={`Open tasks for ${item.bed.alias}`}
                >
                  <ChevronRight className="h-5 w-5" />
                </Link>
              </div>

              <div className="space-y-3 p-4">
                {item.emergency ? (
                  <div className="rounded-xl border border-danger-200 bg-danger-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-danger-800">
                        <Siren className="h-4 w-4" /> Emergency active
                      </p>
                      <span className="font-mono text-sm font-bold text-danger-800">
                        {formatElapsed(now - item.emergency.startedAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-danger-700">
                      {item.tier12} tier 1–2 task(s) flagged. Do not defer them.
                    </p>
                    <button
                      className="btn mt-2 min-h-10 w-full bg-danger-600 text-white hover:bg-danger-700"
                      onClick={() => setEndingEmergency(item.bed)}
                    >
                      End emergency &amp; review deferrals
                    </button>
                  </div>
                ) : null}

                {item.active ? (
                  <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-teal-900">
                        <Activity className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item.active.title}</span>
                      </span>
                      <span className="font-mono text-[11px] font-bold text-teal-800">
                        {item.active.status === "paused" ? "paused" : "running"}
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className={cn("inline-flex items-center gap-1 font-semibold", item.overdue ? "text-danger-700" : "text-slate-500")}>
                    <Clock3 className="h-3.5 w-3.5" />
                    {item.overdue ? `${item.overdue} overdue` : "No overdue"}
                  </span>
                  {item.next ? (
                    <span className={cn("text-[11px]", due?.overdue ? "font-semibold text-danger-700" : "text-slate-500")}>
                      Next {formatTime(item.next.dueAt)} · {due?.text}
                    </span>
                  ) : (
                    <span className="text-[11px] text-teal-700">All clear</span>
                  )}
                </div>

                {item.next ? (
                  <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2">
                    <TierBadge tier={item.next.tier} compact />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{item.next.title}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
                  </div>
                ) : null}

                {!item.emergency ? (
                  <button className="btn-emergency min-h-10 w-full text-xs" onClick={() => setEmergencyBed(item.bed)}>
                    <Siren className="h-4 w-4" /> Emergency on this bed
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {beds.length === 0 ? (
        <InlineAlert tone="warning" title="No beds on this shift">
          <Link className="link" href="/shift-start">Start a shift with demo beds.</Link>
        </InlineAlert>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <Link href="/tasks" className="btn-primary">
          Open task queue <ArrowRight className="h-4 w-4" />
        </Link>
        <button className="btn-secondary" onClick={() => setEndingShift(true)}>
          <LogOut className="h-4 w-4" /> End shift &amp; summary
        </button>
      </div>

      <ActiveTaskBar
        onInterrupt={(task) => {
          setInterruptTask(task);
          setInterruptOpen(true);
        }}
      />
      <InterruptionSheet
        open={interruptOpen}
        onClose={() => setInterruptOpen(false)}
        task={interruptTask}
        beds={beds}
      />

      <ConfirmDialog
        open={Boolean(emergencyBed)}
        onClose={() => setEmergencyBed(null)}
        onConfirm={beginEmergency}
        busy={busy}
        tone="danger"
        confirmLabel="Start emergency"
        title={`Start emergency on ${emergencyBed?.alias ?? "this bed"}?`}
        body={
          <div className="space-y-2">
            <p>Active timers on this bed will pause. Planned tier 3–4 tasks will be deferred.</p>
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <strong>Tier 1–2 tasks will not be deferred.</strong> They stay in the queue and are flagged for
              your attention.
            </p>
            <p className="text-xs text-slate-500">Use this only for a practice scenario. The app does not contact anyone.</p>
          </div>
        }
      />

      <ConfirmDialog
        open={Boolean(endingEmergency)}
        onClose={() => setEndingEmergency(null)}
        onConfirm={completeEmergency}
        busy={busy}
        confirmLabel="End emergency"
        title="End this emergency?"
        body={
          <div className="space-y-2">
            <p>The emergency clock stops now. Deferred tier 3–4 tasks will be proposed with a new due time.</p>
            <p className="text-xs text-slate-500">You must confirm or edit each new time. Nothing is rescheduled automatically.</p>
          </div>
        }
      />

      <ConfirmDialog
        open={endingShift}
        onClose={() => setEndingShift(false)}
        onConfirm={finishShift}
        busy={busy}
        confirmLabel="End shift"
        title="End this shift?"
        body={
          <div className="space-y-2">
            <p>Any still-open task will be marked missed with reason “shift end”. Active timers close at this timestamp.</p>
            <p className="text-xs text-slate-500">You can review the summary next. This cannot be undone.</p>
          </div>
        }
      />
    </AppShell>
  );
}
