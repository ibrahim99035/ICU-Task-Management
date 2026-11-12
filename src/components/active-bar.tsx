"use client";

import { useMemo } from "react";
import { Check, Pause, Play, Radio, Timer } from "lucide-react";
import { computeDurations, INTERRUPTION_LABELS, type DomainEvent, type Task } from "@/domain";
import { completeTask, endInterruption, getActiveInterruption, pauseTask, resumeTask } from "@/lib/actions";
import { db, type ActiveInterruption } from "@/lib/db";
import { cn, formatElapsed } from "@/lib/format";
import { useLive, useNow } from "@/lib/hooks";
import { useApp } from "@/lib/store";
import { TierBadge } from "./ui";

function activeElapsedMs(events: DomainEvent[], task: Task, now: number): number {
  const closed = computeDurations(events, now).byTask[task.id]?.minutes ?? 0;
  if (task.status !== "in_progress") return closed * 60_000;
  const last = events
    .filter((e) => e.taskId === task.id && (e.type === "TASK_STARTED" || e.type === "TASK_RESUMED"))
    .sort((a, b) => a.clientTs - b.clientTs)
    .at(-1);
  return closed * 60_000 + (last ? Math.max(0, now - last.clientTs) : 0);
}

export function ActiveTaskBar({ onInterrupt }: { onInterrupt: (task: Task) => void }) {
  const user = useApp((s) => s.user);
  const now = useNow(1000);
  const pending = useLive(
    () => getActiveInterruption(),
    [user?.id],
  ) as ActiveInterruption | undefined;
  const data = useLive(async () => {
    if (!user) return { tasks: [] as Task[], events: [] as DomainEvent[] };
    const shifts = await db().shifts.where("actorId").equals(user.id).toArray();
    const active = shifts.filter((s) => !s.endedAt).sort((a, b) => b.startedAt - a.startedAt)[0];
    if (!active) return { tasks: [] as Task[], events: [] as DomainEvent[] };
    const tasks = await db().tasks.where("shiftId").equals(active.id).toArray();
    const events = await db().events.where("shiftId").equals(active.id).toArray();
    return { tasks, events };
  }, [user?.id]);

  const task = useMemo(() => {
    const active = (data?.tasks ?? []).filter((t) => t.status === "in_progress" || t.status === "paused");
    return active.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
  }, [data?.tasks]);

  if (!task && !pending) return null;

  if (pending && !task) {
    return (
      <div className="no-print fixed inset-x-0 bottom-[76px] z-40 px-3 lg:bottom-6 lg:left-64">
        <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 shadow-xl">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500 text-white">
            <Radio className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-amber-900">
              Interruption: {INTERRUPTION_LABELS[pending.reason as keyof typeof INTERRUPTION_LABELS] ?? pending.reason}
            </p>
            <p className="font-mono text-xs font-semibold text-amber-700">
              {formatElapsed(now - pending.startedAt)} · tap end when you are back
            </p>
          </div>
          <button onClick={() => void endInterruption()} className="btn bg-amber-600 text-white hover:bg-amber-700">
            End
          </button>
        </div>
      </div>
    );
  }

  if (!task) return null;
  const elapsed = activeElapsedMs(data?.events ?? [], task, now);
  const running = task.status === "in_progress";

  return (
    <div className="no-print fixed inset-x-0 bottom-[76px] z-40 px-3 lg:bottom-6 lg:left-64">
      <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-ink/10 bg-ink p-3 text-white shadow-2xl">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", running ? "bg-teal-500/20 text-teal-200" : "bg-amber-400/20 text-amber-200")}>
          {running ? <Timer className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <TierBadge tier={task.tier} compact />
            {!running ? <span className="pill bg-amber-400/15 text-amber-100">Paused</span> : null}
            {pending ? <span className="pill bg-amber-400/15 text-amber-100">Interruption</span> : null}
          </div>
          <p className="mt-1 truncate text-sm font-bold">{task.title}</p>
          <p className="font-mono text-xs font-semibold tabular-nums text-teal-200">
            {pending ? `Task paused · ${formatElapsed(now - pending.startedAt)} interruption` : formatElapsed(elapsed)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {running ? (
            <button
              onClick={() => void pauseTask(task.id)}
              className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20"
              aria-label="Pause active task"
            >
              <Pause className="h-5 w-5" />
            </button>
          ) : (
            <button
              onClick={() => void resumeTask(task.id)}
              className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20"
              aria-label="Resume active task"
            >
              <Play className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={() => onInterrupt(task)}
            className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20"
            aria-label="Log interruption"
          >
            <Radio className="h-5 w-5" />
          </button>
          <button
            onClick={() => void completeTask(task.id)}
            disabled={!running}
            className="grid h-11 w-11 place-items-center rounded-xl bg-teal-500 text-white hover:bg-teal-400 disabled:opacity-40"
            aria-label="Finish active task"
          >
            <Check className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
