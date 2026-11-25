"use client";

import { useEffect } from "react";
import type { Task } from "@/domain";
import {
  alarmEnabled,
  alarmPlayedKey,
  hasAlarmPlayed,
  markAlarmPlayed,
  playAlarm,
  unlockAlarm,
} from "@/lib/alarm";
import { activeShift, db } from "@/lib/db";
import { useLive, useNow } from "@/lib/hooks";
import { useApp } from "@/lib/store";

/**
 * Foreground-only alarm. It rings once when an open task reaches its planned
 * end time. There is no background push notification.
 */
export function AlarmWatcher() {
  const user = useApp((s) => s.user);
  const notify = useApp((s) => s.notify);
  const now = useNow(1000);
  const data = useLive(
    async (): Promise<{ tasks: Task[] }> => {
      if (!user) return { tasks: [] };
      const shift = await activeShift(user.id);
      if (!shift) return { tasks: [] };
      return { tasks: await db().tasks.where("shiftId").equals(shift.id).toArray() };
    },
    [user?.id],
  );

  useEffect(() => {
    const unlock = () => unlockAlarm();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!alarmEnabled()) return;
    const due = (data?.tasks ?? []).filter(
      (task) =>
        ["planned", "in_progress", "paused"].includes(task.status) &&
        task.plannedTo <= now &&
        !hasAlarmPlayed(alarmPlayedKey(task.id, task.plannedTo)),
    );
    if (!due.length) return;
    if (playAlarm()) {
      for (const task of due) markAlarmPlayed(alarmPlayedKey(task.id, task.plannedTo));
      notify(
        due.length === 1
          ? `Time is up: ${due[0].title}`
          : `Time is up for ${due.length} tasks. Check the To Do list.`,
        "warning",
      );
    }
  }, [data?.tasks, now, notify]);

  return null;
}
