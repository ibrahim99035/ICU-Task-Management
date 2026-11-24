"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, ListChecks, Loader2, Pencil, Plus, TimerReset } from "lucide-react";
import type { Task, TaskCategory, Tier } from "@/domain";
import type { BedRow } from "@/lib/db";
import { cn, formatDateTime, formatMinutes, formatTime, fromDateTimeLocal, toDateTimeLocal } from "@/lib/format";
import { Modal } from "./modal";
import { EmptyState, InlineAlert, TierBadge } from "./ui";

export type PlannedTaskInput = {
  title: string;
  tier: Tier;
  category: Exclude<TaskCategory, "interruption">;
  scope: "bed" | "shift";
  bedId?: string;
  plannedFrom: number;
  plannedTo: number;
  expectedMin: number;
  note?: string;
};

export function PlanningBoard({
  role,
  tasks,
  beds = [],
  shiftStartedAt,
  now,
  onCreate,
  onLogTime,
  onComplete,
  onEdit,
}: {
  role: "nurse" | "head_nurse";
  tasks: Task[];
  beds?: BedRow[];
  shiftStartedAt: number;
  now: number;
  onCreate: (input: PlannedTaskInput) => Promise<void>;
  onLogTime: (task: Task, startedAt: number, endedAt: number, note: string) => Promise<void>;
  onComplete: (task: Task) => Promise<void>;
  onEdit?: (task: Task) => void;
}) {
  const [tab, setTab] = useState<"todo" | "log">("todo");
  const [createOpen, setCreateOpen] = useState(false);
  const [logTarget, setLogTarget] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const todo = useMemo(
    () =>
      tasks
        .filter((task) => !["done", "missed"].includes(task.status))
        .sort((a, b) => a.plannedFrom - b.plannedFrom || a.tier - b.tier),
    [tasks],
  );
  const logged = useMemo(
    () =>
      tasks
        .filter((task) => task.status === "done" || (task.timeLogs?.length ?? 0) > 0)
        .sort((a, b) => (b.completedAt ?? b.plannedTo) - (a.completedAt ?? a.plannedTo)),
    [tasks],
  );

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1">
          <button
            onClick={() => setTab("todo")}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold",
              tab === "todo" ? "bg-ink text-white" : "text-slate-600",
            )}
          >
            <ListChecks className="h-4 w-4" /> To do <span className="opacity-70">{todo.length}</span>
          </button>
          <button
            onClick={() => setTab("log")}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold",
              tab === "log" ? "bg-ink text-white" : "text-slate-600",
            )}
          >
            <TimerReset className="h-4 w-4" /> Time log <span className="opacity-70">{logged.length}</span>
          </button>
        </div>
        <button className="btn-primary ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Plan a task
        </button>
      </div>

      <InlineAlert tone="info" title="Future plan vs past record">
        <p>
          <strong>To do</strong> is a future planned window with a duration. <strong>Time log</strong> records a
          past interval such as 07:00–07:30. Durations are always calculated from the stored times.
        </p>
      </InlineAlert>

      {error ? (
        <div className="rounded-xl border border-danger-100 bg-danger-50 px-3 py-2 text-xs text-danger-800">{error}</div>
      ) : null}

      {tab === "todo" ? (
        <div className="space-y-2">
          {todo.length ? (
            todo.map((task) => {
              const bed = beds.find((b) => b.id === task.bedId);
              return (
                <article key={task.id} className="card flex items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <TierBadge tier={task.tier} compact />
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                        {bed?.alias ?? "Shift task"}
                      </span>
                      <span className="pill bg-slate-100 text-slate-600">
                        <Clock3 className="h-3 w-3" /> {formatTime(task.plannedFrom)}–{formatTime(task.plannedTo)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-ink">{task.title}</p>
                    <p className="text-[11px] text-slate-500">
                      {task.category === "direct_care" ? "Direct care" : "Indirect care"} · planned{" "}
                      {formatMinutes(task.expectedMin)} · {formatDateTime(task.plannedFrom)}
                    </p>
                    {task.note ? <p className="mt-1 text-[11px] text-amber-800">Note: {task.note}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      className="btn-secondary min-h-9 px-2 text-[11px]"
                      onClick={() => setLogTarget(task)}
                      disabled={busy || task.durationRecorded || task.status === "in_progress" || task.status === "paused"}
                    >
                      Log time
                    </button>
                    <button
                      className="btn-ghost min-h-8 px-2 text-[11px]"
                      onClick={() => void run(() => onComplete(task))}
                      disabled={busy}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Done
                    </button>
                    {onEdit ? (
                      <button className="btn-ghost min-h-8 px-2 text-[11px]" onClick={() => onEdit(task)} disabled={busy}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <EmptyState
              icon={<ListChecks className="h-6 w-6" />}
              title="No planned tasks"
              body="Add a future task with a start time and duration. It will appear here and in the queue."
              action={<button className="btn-primary" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Plan a task</button>}
            />
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {logged.length ? (
            logged.map((task) => {
              const bed = beds.find((b) => b.id === task.bedId);
              const actual = task.timeLogs?.[0];
              const from = actual?.startedAt ?? task.startedAt;
              const to = actual?.endedAt ?? task.completedAt;
              return (
                <article key={task.id} className="card p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TierBadge tier={task.tier} compact />
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                      {bed?.alias ?? "Shift task"}
                    </span>
                    <span className={cn("pill", task.durationRecorded ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800")}>
                      {task.durationRecorded ? "Timed" : "Tick-only"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-ink">{task.title}</p>
                  <p className="text-[11px] text-slate-500">
                    Planned {formatTime(task.plannedFrom)}–{formatTime(task.plannedTo)}
                    {from && to ? ` · Logged ${formatTime(from)}–${formatTime(to)}` : " · no actual interval"}
                  </p>
                  {!task.durationRecorded && task.status !== "missed" ? (
                    <button className="btn-secondary mt-2 min-h-9 px-2 text-[11px]" onClick={() => setLogTarget(task)}>
                      <TimerReset className="h-3.5 w-3.5" /> Add time log
                    </button>
                  ) : null}
                </article>
              );
            })
          ) : (
            <EmptyState
              icon={<TimerReset className="h-6 w-6" />}
              title="No time logs yet"
              body="Complete a task or add a past interval. The app stores the actual start and end times."
            />
          )}
        </div>
      )}

      <PlanTaskModal
        open={createOpen}
        role={role}
        beds={beds}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (input) => {
          await onCreate(input);
          setCreateOpen(false);
        }}
      />

      <TimeLogModal
        task={logTarget}
        shiftStartedAt={shiftStartedAt}
        now={now}
        onClose={() => setLogTarget(null)}
        onSubmit={async (startedAt, endedAt, note) => {
          if (!logTarget) return;
          await onLogTime(logTarget, startedAt, endedAt, note);
          setLogTarget(null);
        }}
      />
    </div>
  );
}

function PlanTaskModal({
  open,
  role,
  beds,
  onClose,
  onSubmit,
}: {
  open: boolean;
  role: "nurse" | "head_nurse";
  beds: BedRow[];
  onClose: () => void;
  onSubmit: (input: PlannedTaskInput) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [tier, setTier] = useState<Tier>(3);
  const [category, setCategory] = useState<Exclude<TaskCategory, "interruption">>("direct_care");
  const [scope, setScope] = useState<"bed" | "shift">(role === "head_nurse" ? "shift" : "bed");
  const [bedId, setBedId] = useState(beds[0]?.id ?? "");
  const [when, setWhen] = useState(toDateTimeLocal(Date.now() + 15 * 60_000));
  const [minutes, setMinutes] = useState(30);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setWhen(toDateTimeLocal(Date.now() + 15 * 60_000));
    setBedId((current) => current || beds[0]?.id || "");
    setError("");
  }, [open, beds]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const plannedFrom = fromDateTimeLocal(when);
      await onSubmit({
        title: title.trim(),
        tier,
        category,
        scope,
        bedId: scope === "bed" ? bedId : undefined,
        plannedFrom,
        plannedTo: plannedFrom + Math.max(1, minutes) * 60_000,
        expectedMin: Math.max(1, minutes),
        note: note.trim() || undefined,
      });
      setTitle("");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not plan task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Plan a task" description="Future time and duration. This is the To Do list.">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="plan-title">Title</label>
          <input id="plan-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Check infusion site" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="plan-tier">Tier</label>
            <select id="plan-tier" className="input" value={tier} onChange={(e) => setTier(Number(e.target.value) as Tier)}>
              <option value={1}>T1 · Life support</option>
              <option value={2}>T2 · Time-critical</option>
              <option value={3}>T3 · Routine</option>
              <option value={4}>T4 · Administrative</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="plan-cat">Category</label>
            <select id="plan-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value as Exclude<TaskCategory, "interruption">)}>
              <option value="direct_care">Direct care</option>
              <option value="indirect_care">Indirect care</option>
            </select>
          </div>
        </div>
        {role === "nurse" ? (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="plan-scope">Applies to</label>
              <select id="plan-scope" className="input" value={scope} onChange={(e) => setScope(e.target.value as "bed" | "shift")}>
                <option value="bed">A bed</option>
                <option value="shift">Whole shift</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="plan-bed">Bed</label>
              <select id="plan-bed" className="input" value={bedId} onChange={(e) => setBedId(e.target.value)} disabled={scope === "shift"}>
                {beds.map((bed) => <option key={bed.id} value={bed.id}>{bed.alias}</option>)}
              </select>
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="plan-when">Planned start</label>
            <input id="plan-when" type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="plan-min">Duration (minutes)</label>
            <input id="plan-min" type="number" min={1} max={720} className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="plan-note">Note (optional)</label>
          <textarea id="plan-note" className="input min-h-20" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
        {error ? <p className="text-xs text-danger-700">{error}</p> : null}
        <button className="btn-primary w-full" disabled={busy || !title.trim() || (scope === "bed" && !bedId)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add to To do
        </button>
        <p className="text-[11px] text-slate-500">Do not enter patient names, MRNs or other identifiers.</p>
      </form>
    </Modal>
  );
}

function resolveTime(shiftStartedAt: number, value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date(shiftStartedAt);
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() < shiftStartedAt - 30 * 60_000) date.setDate(date.getDate() + 1);
  return date.getTime();
}

function TimeLogModal({
  task,
  shiftStartedAt,
  now,
  onClose,
  onSubmit,
}: {
  task: Task | null;
  shiftStartedAt: number;
  now: number;
  onClose: () => void;
  onSubmit: (startedAt: number, endedAt: number, note: string) => Promise<void>;
}) {
  const defaultStart = task?.startedAt ?? task?.plannedFrom ?? now - 30 * 60_000;
  const defaultEnd = task?.completedAt ?? task?.plannedTo ?? now;
  const [start, setStart] = useState(new Date(defaultStart).toTimeString().slice(0, 5));
  const [end, setEnd] = useState(new Date(defaultEnd).toTimeString().slice(0, 5));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!task) return;
    const nextStart = task.startedAt ?? task.plannedFrom ?? now - 30 * 60_000;
    const nextEnd = task.completedAt ?? task.plannedTo ?? now;
    setStart(new Date(nextStart).toTimeString().slice(0, 5));
    setEnd(new Date(nextEnd).toTimeString().slice(0, 5));
    setNote("");
    setError("");
  }, [task?.id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const startedAt = resolveTime(shiftStartedAt, start);
      let endedAt = resolveTime(shiftStartedAt, end);
      if (endedAt <= startedAt) endedAt += 86_400_000;
      if (endedAt > Date.now() + 5 * 60_000) throw new Error("Time log cannot end in the future");
      await onSubmit(startedAt, endedAt, note.trim());
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log time");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(task)} onClose={onClose} title={task ? `Log time: ${task.title}` : "Log time"} description="Past interval. Example: 07:00 to 07:30.">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="log-start">From</label>
            <input id="log-start" type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="log-end">To</label>
            <input id="log-end" type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="log-note">Note (optional)</label>
          <textarea id="log-note" className="input min-h-16" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
        {error ? <p className="text-xs text-danger-700">{error}</p> : null}
        <button className="btn-primary w-full" disabled={busy || !start || !end}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <TimerReset className="h-4 w-4" />} Save time log
        </button>
      </form>
    </Modal>
  );
}
