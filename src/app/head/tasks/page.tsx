"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, Play } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PlanningBoard } from "@/components/planning-board";
import { TaskEditModal } from "@/components/task-edit-modal";
import { InlineAlert } from "@/components/ui";
import { reduce, type DomainEvent, type Task, type Unit } from "@/domain";
import {
  completeHeadTask,
  createHeadTask,
  endHeadShift,
  fetchShiftDetail,
  fetchShifts,
  fetchUnits,
  logHeadTaskTime,
  patchTask,
  startHeadShift,
  type HeadShift,
  type ShiftDetail,
} from "@/lib/api";
import { useNow } from "@/lib/hooks";
import { useApp } from "@/lib/store";

export default function HeadTasksPage() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const token = useApp((s) => s.token);
  const notify = useApp((s) => s.notify);
  const now = useNow(1000);
  const [shift, setShift] = useState<HeadShift | null | undefined>(undefined);
  const [detail, setDetail] = useState<ShiftDetail | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState("");
  const [busy, setBusy] = useState(false);
  const [editTarget, setEditTarget] = useState<Task | null>(null);

  const load = useCallback(async () => {
    if (!token || !user) return;
    const [{ shifts }, unitResult] = await Promise.all([
      fetchShifts(token, { kind: "head_nurse", nurseId: user.id }),
      fetchUnits(token),
    ]);
    setUnits(unitResult.units.filter((unit) => unit.status === "active"));
    setUnitId((current) => current || unitResult.units.find((unit) => unit.status === "active")?.id || "");
    const active = shifts.find((item) => !item.endedAt) ?? null;
    setShift(active);
    setDetail(active ? await fetchShiftDetail(token, active.id) : null);
  }, [token, user]);

  useEffect(() => {
    if (user && user.role !== "head_nurse") router.replace("/tasks");
  }, [user, router]);

  useEffect(() => {
    void load().catch((error) => notify(error instanceof Error ? error.message : "Could not load head tasks", "error"));
  }, [load, notify]);

  const tasks = detail ? Object.values(reduce(detail.events as DomainEvent[]).tasks) : [];

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Action failed", "error");
    } finally {
      setBusy(false);
    }
  }

  if (shift === undefined) return <AppShell title="My tasks" subtitle="Loading head-nurse tasks…"><div /></AppShell>;

  return (
    <AppShell
      title="My tasks"
      subtitle={
        shift
          ? `${shift.unitName ?? "Unassigned"} · head-nurse shift · ${tasks.length} tasks`
          : "Start a head-nurse shift to use To do and Time log"
      }
      activeOverride="/head/tasks"
      actions={
        shift ? (
          <button
            className="btn-secondary h-9 px-3 text-xs"
            disabled={busy}
            onClick={() => void run(async () => {
              if (!token || !shift) return;
              await endHeadShift(token, shift.id);
              notify("Head-nurse shift ended. Unfinished tasks were marked missed.", "success");
            })}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />} End shift
          </button>
        ) : null
      }
    >
      {!shift ? (
        <div className="mx-auto max-w-xl space-y-4">
          <InlineAlert tone="info" title="Head-nurse tasks are separate from nurse tasks">
            <p>Start a head-nurse shift for a unit. The 14 head-nurse tasks are created automatically. Nurse task execution is unchanged.</p>
          </InlineAlert>
          <div className="card space-y-3 p-5">
            <div>
              <label className="label" htmlFor="head-unit">Unit</label>
              <select id="head-unit" className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </div>
            <button
              className="btn-primary w-full"
              disabled={busy || !unitId}
              onClick={() => void run(async () => {
                if (!token || !unitId) return;
                await startHeadShift(token, { unitId, type: "day" });
                notify("Head-nurse shift started with 14 tasks.", "success");
              })}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start head-nurse shift
            </button>
          </div>
        </div>
      ) : (
        <PlanningBoard
          role="head_nurse"
          tasks={tasks}
          shiftStartedAt={shift.startedAt}
          now={now}
          onCreate={async (input) => {
            if (!token || !shift) return;
            await createHeadTask(token, shift.id, {
              title: input.title,
              category: input.category,
              tier: input.tier,
              plannedFrom: input.plannedFrom,
              plannedTo: input.plannedTo,
              expectedMin: input.expectedMin,
              note: input.note,
            });
            await load();
            notify("Task added to the head-nurse To do list.", "success");
          }}
          onLogTime={async (task, startedAt, endedAt, note) => {
            if (!token || !shift) return;
            await logHeadTaskTime(token, shift.id, task.id, { startedAt, endedAt, note });
            await load();
            notify("Time log saved.", "success");
          }}
          onComplete={async (task) => {
            if (!token || !shift) return;
            await completeHeadTask(token, shift.id, task.id);
            await load();
            notify("Task marked done. You can add a time log later.", "info");
          }}
          onEdit={(task) => setEditTarget(task)}
        />
      )}

      <TaskEditModal
        open={Boolean(editTarget)}
        task={editTarget}
        onClose={() => setEditTarget(null)}
        onSave={async (patch) => {
          if (!token || !shift || !editTarget) return;
          await patchTask(token, shift.id, editTarget.id, patch);
          await load();
          notify("Head-nurse task updated. The change is in the event log.", "success");
        }}
      />
    </AppShell>
  );
}
