"use client";

import { reduce } from "@/domain";
import { db } from "./db";

/** Rebuild the task projection from the append-only event log. */
export async function rebuildTasks(shiftId: string): Promise<void> {
  const events = await db().events.where("shiftId").equals(shiftId).toArray();
  if (!events.length) return;
  const state = reduce(events);
  const existing = await db().tasks.where("shiftId").equals(shiftId).toArray();
  const pinned = new Map(existing.filter((t) => t.pinned).map((t) => [t.id, true]));
  const next = Object.values(state.tasks).map((task) => ({ ...task, pinned: pinned.get(task.id) ?? false }));
  await db().tasks.where("shiftId").equals(shiftId).delete();
  await db().tasks.bulkPut(next);
}
