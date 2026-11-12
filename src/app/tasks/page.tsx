"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ListChecks,
  Loader2,
  Plus,
  Radio,
  Search,
  SlidersHorizontal,
  Star,
  TimerReset,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ActiveTaskBar } from "@/components/active-bar";
import { InterruptionSheet } from "@/components/interruption-sheet";
import { ConfirmDialog, Modal } from "@/components/modal";
import { TaskCard } from "@/components/task-card";
import { EmptyState, InlineAlert, Spinner, TierBadge } from "@/components/ui";
import {
  computeDurations,
  isOverdue,
  sortTasks,
  type DomainEvent,
  type Task,
  type TaskCategory,
  type Tier,
} from "@/domain";
import {
  addQuickTask,
  completeTask,
  correctEventTime,
  pauseTask,
  pinTask,
  resumeTask,
  startTask,
} from "@/lib/actions";
import { activeShift, db, type BedRow, type ShiftRow } from "@/lib/db";
import { cn, dueLabel, formatDateTime, formatElapsed, formatMinutes, formatTime, fromDateTimeLocal, toDateTimeLocal } from "@/lib/format";
import { useLive, useNow } from "@/lib/hooks";
import { useApp } from "@/lib/store";

type Filter = "open" | "overdue" | "deferred" | "done";

const PRESETS: {
  title: string;
  tier: Tier;
  category: TaskCategory;
  offsetMin: number;
  hint: string;
}[] = [
  { title: "Reposition / pressure care", tier: 3, category: "direct_care", offsetMin: 0, hint: "T3 · direct" },
  { title: "Oral care", tier: 3, category: "direct_care", offsetMin: 15, hint: "T3 · direct" },
  { title: "Vital signs", tier: 2, category: "direct_care", offsetMin: 0, hint: "T2 · direct" },
  { title: "Charting / documentation", tier: 4, category: "indirect_care", offsetMin: 15, hint: "T4 · indirect" },
  { title: "Supplies restock", tier: 4, category: "indirect_care", offsetMin: 30, hint: "T4 · indirect" },
  { title: "Family update", tier: 4, category: "indirect_care", offsetMin: 20, hint: "T4 · indirect" },
];

function runningElapsed(events: DomainEvent[], task: Task, now: number): number | undefined {
  if (task.status !== "in_progress" && task.status !== "paused") return undefined;
  const closed = (computeDurations(events, now).byTask[task.id]?.minutes ?? 0) * 60_000;
  if (task.status === "paused") return closed;
  const last = events
    .filter((e) => e.taskId === task.id && (e.type === "TASK_STARTED" || e.type === "TASK_RESUMED"))
    .sort((a, b) => a.clientTs - b.clientTs)
    .at(-1);
  return closed + (last ? Math.max(0, now - last.clientTs) : 0);
}

function TasksInner() {
  const router = useRouter();
  const params = useSearchParams();
  const bedFilter = params.get("bed") ?? undefined;
  const filterParam = params.get("filter");
  const user = useApp((s) => s.user);
  const notify = useApp((s) => s.notify);
  const now = useNow(1000);
  const [filter, setFilter] = useState<Filter>(() =>
    filterParam === "overdue" || filterParam === "deferred" || filterParam === "done" ? filterParam : "open",
  );
  const [quickOpen, setQuickOpen] = useState(false);
  const [interruptOpen, setInterruptOpen] = useState(false);
  const [interruptTask, setInterruptTask] = useState<Task | undefined>();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [tickTarget, setTickTarget] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);

  const shiftBox = useLive(
    async () => (user ? { shift: await activeShift(user.id) } : undefined),
    [user?.id],
  );

  useEffect(() => {
    if (user?.role === "head_nurse") router.replace("/head");
    if (user && shiftBox && !shiftBox.shift) router.replace("/shift-start");
  }, [shiftBox, user, router]);

  const data = useLive(
    async (): Promise<{ shift?: ShiftRow; tasks: Task[]; events: DomainEvent[]; beds: BedRow[] }> => {
      const shift = shiftBox?.shift;
      if (!shift) return { shift, tasks: [], events: [], beds: [] };
      const [tasks, events, beds] = await Promise.all([
        db().tasks.where("shiftId").equals(shift.id).toArray(),
        db().events.where("shiftId").equals(shift.id).toArray(),
        db().beds.where("shiftId").equals(shift.id).toArray(),
      ]);
      return { shift, tasks, events, beds };
    },
    [shiftBox?.shift?.id],
  );

  const shift = shiftBox?.shift;
  const tasks = data?.tasks ?? [];
  const events = data?.events ?? [];
  const beds = data?.beds ?? [];
  const bedMap = useMemo(() => new Map(beds.map((b) => [b.id, b.alias])), [beds]);
  const bed = bedFilter ? beds.find((b) => b.id === bedFilter) : undefined;
  const durations = useMemo(() => computeDurations(events, now), [events, now]);

  const filtered = useMemo(() => {
    const scoped = bedFilter ? tasks.filter((t) => t.bedId === bedFilter) : tasks;
    const sorted = sortTasks(scoped, now);
    if (filter === "overdue") return sorted.filter((t) => isOverdue(t, now));
    if (filter === "deferred") return sorted.filter((t) => t.status === "deferred");
    if (filter === "done") return sorted.filter((t) => t.status === "done" || t.status === "missed");
    return sorted.filter((t) => ["planned", "in_progress", "paused"].includes(t.status));
  }, [tasks, bedFilter, filter, now]);

  const counts = useMemo(
    () => ({
      open: tasks.filter((t) => !bedFilter || t.bedId === bedFilter).filter((t) => ["planned", "in_progress", "paused"].includes(t.status)).length,
      overdue: tasks.filter((t) => !bedFilter || t.bedId === bedFilter).filter((t) => isOverdue(t, now)).length,
      deferred: tasks.filter((t) => !bedFilter || t.bedId === bedFilter).filter((t) => t.status === "deferred").length,
      done: tasks.filter((t) => !bedFilter || t.bedId === bedFilter).filter((t) => t.status === "done" || t.status === "missed").length,
    }),
    [tasks, bedFilter, now],
  );

  const detail = detailId ? tasks.find((t) => t.id === detailId) : undefined;
  const detailEvents = detail ? events.filter((e) => e.taskId === detail.id) : [];
  const payableEvents = detailEvents.filter((e) =>
    ["TASK_STARTED", "TASK_RESUMED", "TASK_PAUSED", "TASK_COMPLETED", "TASK_MISSED"].includes(e.type),
  );

  async function guard(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Action failed", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!shiftBox) return <AppShell title="Tasks" subtitle="Loading queue…"><div /></AppShell>;
  if (!shift) return <AppShell title="Tasks" subtitle="No active shift"><div /></AppShell>;

  return (
    <AppShell
      title="Task queue"
      subtitle={
        bed
          ? `${bed.alias} · ${counts.open} open · ${counts.overdue} overdue`
          : `${counts.open} open · ${counts.overdue} overdue · sorted by tier then due time`
      }
      activeOverride="/tasks"
      actions={
        <>
          <button
            className="btn-ghost grid h-9 w-9 place-items-center px-0 sm:hidden"
            aria-label="Log interruption"
            onClick={() => { setInterruptTask(undefined); setInterruptOpen(true); }}
          >
            <Radio className="h-4 w-4" />
          </button>
          <button className="btn-ghost hidden h-9 px-2 text-xs sm:inline-flex" onClick={() => { setInterruptTask(undefined); setInterruptOpen(true); }}>
            <Radio className="h-4 w-4" /> Interruption
          </button>
          <button
            className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-white hover:bg-slate-800"
            aria-label="Quick add task"
            onClick={() => setQuickOpen(true)}
          >
            <Plus className="h-4 w-4" />
          </button>
        </>
      }
    >
      {bed ? (
        <div className="mb-3 flex items-center gap-2">
          <Link href="/tasks" className="inline-flex min-h-10 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
            <X className="h-3.5 w-3.5" /> Clear bed filter
          </Link>
          <span className="text-xs text-slate-500">{bed.alias}</span>
        </div>
      ) : null}

      <div className="hide-scrollbar -mx-1 mb-3 flex gap-1 overflow-x-auto px-1">
        {(
          [
            { value: "open", label: "Open", count: counts.open, Icon: ListChecks },
            { value: "overdue", label: "Overdue", count: counts.overdue, Icon: Clock3 },
            { value: "deferred", label: "Deferred", count: counts.deferred, Icon: TimerReset },
            { value: "done", label: "Done", count: counts.done, Icon: CheckCircle2 },
          ] as { value: Filter; label: string; count: number; Icon: typeof ListChecks }[]
        ).map((item) => (
          <button
            key={item.value}
            onClick={() => setFilter(item.value)}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition",
              filter === item.value
                ? "border-ink bg-ink text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            <item.Icon className="h-3.5 w-3.5" />
            {item.label}
            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", filter === item.value ? "bg-white/15" : "bg-slate-100 text-slate-500")}>
              {item.count}
            </span>
          </button>
        ))}
      </div>

      {filter === "open" && counts.overdue > 0 ? (
        <div className="mb-3 rounded-2xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-800">
          <p className="font-semibold">Overdue work is still in the queue.</p>
          <p className="mt-0.5 text-xs text-danger-700/80">Tier 1–2 items stay visible even during an emergency. Timer starts when you tap play.</p>
        </div>
      ) : null}

      <div className="space-y-2">
        {filtered.length ? (
          filtered.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              now={now}
              bedLabel={bedFilter ? undefined : bedMap.get(task.bedId)}
              elapsedMs={runningElapsed(events, task, now)}
              onStart={() => guard(() => startTask(task.id))}
              onPause={() => guard(() => pauseTask(task.id))}
              onResume={() => guard(() => resumeTask(task.id))}
              onDone={() => guard(() => completeTask(task.id))}
              onTickDone={task.status === "planned" ? () => setTickTarget(task) : undefined}
              onPin={() => guard(() => pinTask(task.id, !task.pinned))}
              onOpen={() => setDetailId(task.id)}
            />
          ))
        ) : (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title={filter === "done" ? "No completed tasks yet" : "Nothing in this view"}
            body={
              filter === "deferred"
                ? "Deferred tier 3–4 tasks appear here until you confirm a new due time."
                : "Start a task from the queue or add a quick task. The top of the queue is always the most critical."
            }
            action={
              <button className="btn-primary" onClick={() => setQuickOpen(true)}>
                <Plus className="h-4 w-4" /> Quick add
              </button>
            }
          />
        )}
      </div>

      <div className="h-20" aria-hidden />

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
        bedId={bedFilter ?? beds[0]?.id}
        beds={beds}
      />

      <QuickAddSheet
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        shift={shift}
        beds={beds}
        defaultBedId={bedFilter ?? beds[0]?.id ?? ""}
        now={now}
      />

      <ConfirmDialog
        open={Boolean(tickTarget)}
        onClose={() => setTickTarget(null)}
        onConfirm={() =>
          tickTarget
            ? guard(async () => {
                await completeTask(tickTarget.id, true);
                setTickTarget(null);
              })
            : undefined
        }
        busy={busy}
        confirmLabel="Mark done"
        title={`Mark “${tickTarget?.title ?? "task"}” done without a timer?`}
        body={
          <div className="space-y-2">
            <p>This records completion but <strong>no duration</strong>. Use it only when the task was already done and you did not use the timer.</p>
            <p className="text-xs text-slate-500">For timed care, press play when you start and finish when you are done.</p>
          </div>
        }
      />

      <TaskDetail
        task={detail}
        bedLabel={detail ? bedMap.get(detail.bedId) : undefined}
        events={detailEvents}
        payableEvents={payableEvents}
        durations={durations.byTask[detail?.id ?? ""]}
        now={now}
        busy={busy}
        onClose={() => setDetailId(null)}
        onStart={() => detail && guard(() => startTask(detail.id))}
        onPause={() => detail && guard(() => pauseTask(detail.id))}
        onResume={() => detail && guard(() => resumeTask(detail.id))}
        onDone={() => detail && guard(async () => { await completeTask(detail.id); setDetailId(null); })}
        onTickDone={() => detail && (setTickTarget(detail), setDetailId(null))}
        onPin={() => detail && guard(() => pinTask(detail.id, !detail.pinned))}
        onCorrect={(eventId, value) =>
          detail
            ? guard(async () => {
                await correctEventTime(detail.shiftId, eventId, fromDateTimeLocal(value));
                notify("Timestamp corrected. The original event is still stored.", "success");
              })
            : undefined
        }
      />
    </AppShell>
  );
}

function QuickAddSheet({
  open,
  onClose,
  shift,
  beds,
  defaultBedId,
  now,
}: {
  open: boolean;
  onClose: () => void;
  shift: ShiftRow;
  beds: BedRow[];
  defaultBedId: string;
  now: number;
}) {
  const notify = useApp((s) => s.notify);
  const [bedId, setBedId] = useState(defaultBedId);
  const [title, setTitle] = useState("");
  const [tier, setTier] = useState<Tier>(3);
  const [category, setCategory] = useState<TaskCategory>("direct_care");
  const [minutes, setMinutes] = useState(15);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setBedId(defaultBedId);
  }, [open, defaultBedId]);

  async function addPreset(preset: (typeof PRESETS)[number]) {
    if (!bedId) return;
    setBusy(true);
    try {
      await addQuickTask({
        shiftId: shift.id,
        bedId,
        title: preset.title,
        tier: preset.tier,
        category: preset.category,
        dueAt: Date.now() + preset.offsetMin * 60_000,
      });
      notify(`Added “${preset.title}” to ${beds.find((b) => b.id === bedId)?.alias ?? "bed"}.`, "success");
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not add task", "error");
    } finally {
      setBusy(false);
    }
  }

  async function addCustom(event: React.FormEvent) {
    event.preventDefault();
    if (!bedId || !title.trim()) return;
    setBusy(true);
    try {
      await addQuickTask({
        shiftId: shift.id,
        bedId,
        title: title.trim(),
        tier,
        category,
        dueAt: Date.now() + minutes * 60_000,
      });
      notify("Task added to the queue.", "success");
      setTitle("");
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not add task", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Quick add task" description="Two taps for a preset. Edit the bed or due time if needed.">
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="quick-bed">Bed</label>
          <select id="quick-bed" className="input" value={bedId} onChange={(e) => setBedId(e.target.value)}>
            {beds.map((b) => (
              <option key={b.id} value={b.id}>{b.alias}</option>
            ))}
          </select>
        </div>

        <div>
          <p className="label">Presets</p>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.title}
                onClick={() => void addPreset(preset)}
                disabled={busy || !bedId}
                className="min-h-[64px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:border-teal-300 hover:bg-teal-50/50 disabled:opacity-50"
              >
                <span className="block text-xs font-bold leading-tight text-slate-800">{preset.title}</span>
                <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-slate-400">{preset.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <details className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-700">
            <SlidersHorizontal className="h-4 w-4" /> Custom task
            <ChevronDown className="ml-auto h-4 w-4" />
          </summary>
          <form onSubmit={addCustom} className="mt-3 space-y-3">
            <div>
              <label className="label" htmlFor="quick-title">Title</label>
              <input
                id="quick-title"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Check infusion site"
                maxLength={100}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="quick-tier">Priority tier</label>
                <select id="quick-tier" className="input" value={tier} onChange={(e) => setTier(Number(e.target.value) as Tier)}>
                  <option value={1}>T1 · Life support</option>
                  <option value={2}>T2 · Time-critical</option>
                  <option value={3}>T3 · Scheduled</option>
                  <option value={4}>T4 · Indirect</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="quick-cat">Category</label>
                <select id="quick-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)}>
                  <option value="direct_care">Direct care</option>
                  <option value="indirect_care">Indirect care</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="quick-due">Due in (minutes)</label>
              <input
                id="quick-due"
                type="number"
                min={0}
                max={720}
                className="input"
                value={minutes}
                onChange={(e) => setMinutes(Math.max(0, Number(e.target.value)))}
              />
            </div>
            <button className="btn-primary w-full" disabled={busy || !title.trim() || !bedId}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add custom task
            </button>
          </form>
        </details>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Do not enter patient names, MRNs or other identifiers in a task title. Use the bed nickname only.
        </p>
      </div>
    </Modal>
  );
}

function TaskDetail({
  task,
  bedLabel,
  events,
  payableEvents,
  durations,
  now,
  busy,
  onClose,
  onStart,
  onPause,
  onResume,
  onDone,
  onTickDone,
  onPin,
  onCorrect,
}: {
  task?: Task;
  bedLabel?: string;
  events: DomainEvent[];
  payableEvents: DomainEvent[];
  durations?: { minutes: number; category: TaskCategory };
  now: number;
  busy: boolean;
  onClose: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onDone: () => void;
  onTickDone: () => void;
  onPin: () => void;
  onCorrect: (eventId: string, value: string) => void;
}) {
  const [eventId, setEventId] = useState("");
  const [when, setWhen] = useState("");

  useEffect(() => {
    if (!task) return;
    const last = payableEvents.at(-1);
    setEventId(last?.id ?? "");
    setWhen(last ? toDateTimeLocal(last.clientTs) : toDateTimeLocal(Date.now()));
  }, [task?.id, payableEvents.length]);

  if (!task) return null;
  const due = dueLabel(task.dueAt, now);
  const running = task.status === "in_progress";
  const paused = task.status === "paused";
  const closed = task.status === "done" || task.status === "missed";

  return (
    <Modal
      open={Boolean(task)}
      onClose={onClose}
      wide
      title={task.title}
      description={`${bedLabel ?? "Bed"} · ${task.category === "direct_care" ? "Direct care" : "Indirect care"} · due ${formatTime(task.dueAt)}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <TierBadge tier={task.tier} />
        <span className={cn("pill", due.overdue ? "bg-danger-50 text-danger-700" : "bg-slate-100 text-slate-600")}>
          <Clock3 className="h-3.5 w-3.5" /> {due.text}
        </span>
        {task.needsAttention ? <span className="pill bg-amber-50 text-amber-800">Needs attention</span> : null}
        {task.pinned ? <span className="pill bg-amber-50 text-amber-700"><Star className="h-3.5 w-3.5 fill-amber-400" /> Pinned</span> : null}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Status</p>
          <p className="mt-0.5 text-sm font-semibold capitalize text-slate-800">{task.status.replace("_", " ")}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Recorded</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-800">{formatMinutes(durations?.minutes ?? 0)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Events</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-800">{events.length}</p>
        </div>
      </div>

      {closed ? (
        <p className="mt-3 text-xs text-slate-500">
          {task.completedAt ? `Closed ${formatDateTime(task.completedAt)}.` : "Closed."} Duration is computed from stored start, pause, resume and completion events.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {task.status === "planned" ? (
          <>
            <button className="btn-dark" onClick={onStart} disabled={busy}><Activity className="h-4 w-4" /> Start</button>
            <button className="btn-secondary" onClick={onTickDone} disabled={busy}><CheckCircle2 className="h-4 w-4" /> Tick done</button>
          </>
        ) : null}
        {running ? (
          <>
            <button className="btn-secondary" onClick={onPause} disabled={busy}>Pause</button>
            <button className="btn-primary" onClick={onDone} disabled={busy}>Finish</button>
          </>
        ) : null}
        {paused ? (
          <button className="btn-primary" onClick={onResume} disabled={busy}>Resume</button>
        ) : null}
        <button className="btn-ghost" onClick={onPin} disabled={busy}>
          <Star className={cn("h-4 w-4", task.pinned && "fill-amber-400 text-amber-500")} /> {task.pinned ? "Unpin" : "Pin"}
        </button>
      </div>

      {payableEvents.length ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Correct a timestamp</p>
          <p className="mt-1 text-[11px] text-slate-500">Append-only correction. The original event stays in the log.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select className="input" value={eventId} onChange={(e) => {
              setEventId(e.target.value);
              const found = payableEvents.find((ev) => ev.id === e.target.value);
              if (found) setWhen(toDateTimeLocal(found.clientTs));
            }}>
              {payableEvents.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.type.replace("TASK_", "").replaceAll("_", " ").toLowerCase()} · {formatDateTime(ev.clientTs)}
                </option>
              ))}
            </select>
            <input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
            <button className="btn-secondary" disabled={busy || !eventId || !when} onClick={() => onCorrect(eventId, when)}>
              Save
            </button>
          </div>
        </div>
      ) : null}

      <details className="mt-4 text-xs text-slate-500">
        <summary className="cursor-pointer font-semibold text-slate-600">Event log ({events.length})</summary>
        <ul className="mt-2 space-y-1">
          {events.map((ev) => (
            <li key={ev.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
              <span className="font-medium text-slate-700">{ev.type.replaceAll("_", " ").toLowerCase()}</span>
              <span className="font-mono text-[10px]">{formatDateTime(ev.clientTs)}</span>
            </li>
          ))}
        </ul>
      </details>
    </Modal>
  );
}

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <AppShell title="Task queue" subtitle="Loading queue…">
          <Spinner />
        </AppShell>
      }
    >
      <TasksInner />
    </Suspense>
  );
}
