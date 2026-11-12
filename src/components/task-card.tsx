"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Pause,
  Play,
  Star,
  TimerReset,
} from "lucide-react";
import type { Task } from "@/domain";
import { cn, dueLabel, formatElapsed, formatTime, tierStyle } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { TierBadge } from "./ui";

export function TaskCard({
  task,
  now,
  bedLabel,
  elapsedMs,
  onStart,
  onPause,
  onResume,
  onDone,
  onTickDone,
  onPin,
  onOpen,
}: {
  task: Task;
  now: number;
  bedLabel?: string;
  elapsedMs?: number;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onDone?: () => void;
  onTickDone?: () => void;
  onPin?: () => void;
  onOpen?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const due = dueLabel(task.dueAt, now);
  const completed = task.status === "done";
  const missed = task.status === "missed";
  const deferred = task.status === "deferred";
  const running = task.status === "in_progress";
  const paused = task.status === "paused";
  const style = tierStyle(task.tier);
  const accent =
    task.tier === 1 ? "bg-danger-600" : task.tier === 2 ? "bg-amber-500" : task.tier === 3 ? "bg-teal-500" : "bg-slate-400";

  async function run(action?: () => void | Promise<void>) {
    if (!action) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "card relative flex items-stretch gap-3 p-3 transition",
        running && "border-teal-300 ring-1 ring-teal-500/10",
        task.needsAttention && "border-amber-300",
        (completed || missed) && "opacity-70",
      )}
    >
      <div className={cn("mt-1 h-10 w-1 shrink-0 rounded-full", running ? "bg-teal-500" : accent)} aria-hidden />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
        aria-label={`Open ${task.title}`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <TierBadge tier={task.tier} compact />
          {bedLabel ? (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
              {bedLabel}
            </span>
          ) : null}
          {due.overdue && !["done", "missed", "deferred"].includes(task.status) ? (
            <span className="pill border border-danger-100 bg-danger-50 text-danger-700">
              <Clock3 className="h-3 w-3" aria-hidden /> {due.text}
            </span>
          ) : null}
          {task.needsAttention ? (
            <span className="pill border border-amber-200 bg-amber-50 text-amber-800">
              <AlertTriangle className="h-3 w-3" aria-hidden /> Needs attention
            </span>
          ) : null}
          {task.pinned ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-label="Pinned" /> : null}
        </div>
        <p className={cn("mt-1 truncate text-[15px] font-semibold leading-tight text-ink", (completed || missed) && "line-through decoration-slate-300")}>
          {task.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
          <span>{task.category === "direct_care" ? "Direct care" : "Indirect care"}</span>
          <span aria-hidden>·</span>
          <span>Due {formatTime(task.dueAt)}</span>
          {!due.overdue && !completed && !missed && !deferred ? <span className="text-slate-400">{due.text}</span> : null}
          {deferred ? <span className="font-semibold text-violet-700">Awaiting reschedule</span> : null}
          {task.durationRecorded === false && completed ? (
            <span className="inline-flex items-center gap-0.5 text-slate-400">
              <TimerReset className="h-3 w-3" /> tick-only
            </span>
          ) : null}
        </div>
      </button>

      <div className="flex shrink-0 flex-col items-end justify-between gap-1">
        {running ? (
          <>
            <span className="font-mono text-sm font-bold tabular-nums text-teal-700">
              {formatElapsed(elapsedMs ?? 0)}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => void run(onPause)}
                className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                aria-label={`Pause ${task.title}`}
                disabled={busy}
              >
                <Pause className="h-4 w-4" />
              </button>
              <button
                onClick={() => void run(onDone)}
                className="grid h-10 w-10 place-items-center rounded-xl bg-teal-600 text-white hover:bg-teal-700"
                aria-label={`Finish ${task.title}`}
                disabled={busy}
              >
                <Check className="h-5 w-5" />
              </button>
            </div>
          </>
        ) : paused ? (
          <>
            <span className="text-[10px] font-bold uppercase text-amber-700">Paused</span>
            <button
              onClick={() => void run(onResume)}
              className="grid h-10 w-10 place-items-center rounded-xl bg-teal-600 text-white hover:bg-teal-700"
              aria-label={`Resume ${task.title}`}
              disabled={busy}
            >
              <Play className="h-4 w-4" />
            </button>
          </>
        ) : completed ? (
          <CheckCircle2 className="h-5 w-5 text-teal-600" aria-label="Done" />
        ) : missed ? (
          <span className="pill bg-danger-50 text-danger-700">Missed</span>
        ) : deferred ? (
          <Clock3 className="h-5 w-5 text-violet-500" aria-label="Deferred" />
        ) : (
          <div className="flex items-center gap-1">
            {onTickDone ? (
              <button
                onClick={() => void run(onTickDone)}
                className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-400 hover:bg-teal-50 hover:text-teal-700"
                aria-label={`Mark ${task.title} done without a timer`}
                title="Mark done without a timer"
                disabled={busy}
              >
                <Check className="h-4 w-4" />
              </button>
            ) : null}
            <button
              onClick={() => void run(onStart)}
              className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-white hover:bg-slate-800"
              aria-label={`Start ${task.title}`}
              disabled={busy}
            >
              <Play className="h-4 w-4" />
            </button>
          </div>
        )}
        {onPin ? (
          <button
            onClick={() => void run(onPin)}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-300 hover:bg-amber-50 hover:text-amber-500"
            aria-label={task.pinned ? "Unpin task" : "Pin task"}
          >
            <Star className={cn("h-3.5 w-3.5", task.pinned && "fill-amber-400 text-amber-500")} />
          </button>
        ) : null}
        {onOpen ? <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden /> : null}
      </div>
    </div>
  );
}
