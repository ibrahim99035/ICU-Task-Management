"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PlanningBoard } from "@/components/planning-board";
import { TaskEditModal } from "@/components/task-edit-modal";
import type { Task } from "@/domain";
import { addPlannedTask, completeTask, editTask, logTaskTime } from "@/lib/actions";
import { activeShift, db } from "@/lib/db";
import { useLive, useNow } from "@/lib/hooks";
import { useApp } from "@/lib/store";

export default function PlanPage() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const notify = useApp((s) => s.notify);
  const now = useNow(1000);
  const [editTarget, setEditTarget] = useState<Task | null>(null);

  const data = useLive(
    async () => {
      if (!user) return undefined;
      const shift = await activeShift(user.id);
      if (!shift) return { shift: null, tasks: [] as Task[] };
      const tasks = await db().tasks.where("shiftId").equals(shift.id).toArray();
      return { shift, tasks };
    },
    [user?.id],
  );

  useEffect(() => {
    if (user?.role === "head_nurse") router.replace("/head/tasks");
  }, [user, router]);

  useEffect(() => {
    if (data && data.shift === null) router.replace("/shift-start");
  }, [data, router]);

  if (!data) return <AppShell title="To Do / Time Log"><div /></AppShell>;
  if (!data.shift) return <AppShell title="To Do / Time Log" subtitle="No active shift"><div /></AppShell>;

  return (
    <AppShell
      title="To Do / Time Log"
      subtitle={`${data.shift.unitName ?? "Unassigned"} · To do is future · Time log is past`}
      activeOverride="/plan"
    >
      <PlanningBoard
        role="nurse"
        tasks={data.tasks}
        shiftStartedAt={data.shift.startedAt}
        now={now}
        onCreate={async (input) => {
          await addPlannedTask({ shiftId: data.shift!.id, scope: "shift", ...input });
          notify("Task added to the To do list.", "success");
        }}
        onLogTime={async (task, startedAt, endedAt, note) => {
          await logTaskTime(task.id, startedAt, endedAt, note);
          notify("Time log saved. Duration is computed from the stored times.", "success");
        }}
        onComplete={async (task) => {
          await completeTask(task.id, task.status === "planned" || task.status === "deferred");
          notify("Task marked done without a timer. You can add a time log later.", "info");
        }}
        onEdit={(task) => setEditTarget(task)}
      />
      <TaskEditModal
        open={Boolean(editTarget)}
        task={editTarget}
        onClose={() => setEditTarget(null)}
        onSave={async (patch) => {
          if (!editTarget) return;
          await editTask(editTarget.id, patch);
          notify("Task updated. The change is in the event log.", "success");
        }}
      />
    </AppShell>
  );
}
