"use client";

import { useEffect } from "react";
import type { DomainEvent } from "@/domain";
import { ApiError, postSurvey, pullRequest, pushEventsRequest } from "./api";
import { db, getConfig, getSessionValue, setSessionValue } from "./db";
import { rebuildTasks } from "./projection";
import { useApp } from "./store";

let inflight: Promise<void> | null = null;
let timer: number | undefined;

export async function syncNow(): Promise<void> {
  if (inflight) return inflight;
  inflight = runSync().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runSync(): Promise<void> {
  const { user, token, online, setSync, setSessionExpired } = useApp.getState();
  if (!user || !token) return;
  if (user.role !== "nurse") return;
  if (!online || typeof navigator === "undefined" || !navigator.onLine) {
    setSync({ syncing: false, syncError: null });
    return;
  }
  setSync({ syncing: true, syncError: null });
  try {
    const outbox = await db().outbox.toArray();
    const eventItems = outbox.filter((i) => i.kind === "event");
    for (let i = 0; i < eventItems.length; i += 200) {
      const batch = eventItems.slice(i, i + 200);
      const events = batch.map((item) => item.payload as DomainEvent);
      const result = await pushEventsRequest(token, events);
      await db().outbox.bulkDelete(result.accepted);
    }
    for (const item of outbox.filter((i) => i.kind === "survey")) {
      const payload = item.payload as {
        id: string;
        instrument: "SUS" | "TLX";
        phase: "paper" | "app";
        answers: number[];
        takenAt: number;
      };
      await postSurvey(token, payload);
      await db().outbox.delete(item.id);
    }

    const cursor = (await getSessionValue<number>("syncCursor")) ?? 0;
    const pull = await pullRequest(token, cursor);
    await db().transaction(
      "rw",
      [db().events, db().tasks, db().reviews, db().handovers, db().templates, db().shifts, db().beds, db().session],
      async () => {
        if (pull.templates?.length) {
          await db().templates.bulkPut(
            pull.templates.map((t) => ({
              id: t.id,
              name: t.name,
              category: t.category,
              tier: t.tier,
              intervalMin: t.intervalMin,
              expectedMin: t.expectedMin,
              offsetMin: t.offsetMin ?? 0,
              active: t.active,
            })),
          );
        }
        if (pull.config) {
          await db().session.put({ key: "config", value: pull.config });
        }
        for (const shift of pull.shifts ?? []) {
          const existing = await db().shifts.get(shift.id);
          await db().shifts.put({
            id: shift.id,
            actorId: shift.userId,
            type: shift.type as "day" | "night" | "custom",
            startedAt: shift.startedAt,
            endedAt: shift.endedAt ?? undefined,
            summary: shift.summary ?? existing?.summary,
            syncedAt: Date.now(),
          });
        }
        for (const bed of pull.beds ?? []) {
          const existing = await db().beds.get(bed.id);
          await db().beds.put({
            id: bed.id,
            shiftId: bed.shiftId,
            label: bed.label,
            alias: bed.alias,
            templateIds: existing?.templateIds ?? [],
          });
        }
        if (pull.events?.length) {
          const shiftIds = new Set<string>();
          for (const event of pull.events) {
            await db().events.put(event as DomainEvent);
            shiftIds.add(event.shiftId);
          }
          for (const shiftId of shiftIds) await rebuildTasks(shiftId);
        }
        if (pull.reviews?.length) {
          await db().reviews.bulkPut(
            pull.reviews.map((r) => ({
              id: r.id,
              shiftId: r.shiftId,
              scores: r.scores as {
                completion: number;
                critical_timeliness: number;
                interruption_handling: number;
                handover_quality: number;
                documentation: number;
              },
              comment: r.comment,
              needsSupport: r.needsSupport,
              createdAt: r.createdAt,
            })),
          );
        }
        if (pull.handovers?.length) {
          await db().handovers.bulkPut(
            pull.handovers.map((h) => ({
              id: h.id,
              shiftId: h.shiftId,
              bedId: h.bedId,
              snapshot: h.snapshot,
              note: h.snapshot?.note ?? "",
              createdAt: h.createdAt,
            })),
          );
        }
        await db().session.put({ key: "syncCursor", value: pull.cursor ?? 0 });
      },
    );

    const pending = await db().outbox.count();
    useApp.getState().setSync({ syncing: false, pending, lastSync: Date.now(), syncError: null });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setSessionExpired(true);
      useApp.getState().setSync({ syncing: false, syncError: "Session expired. Sign in again to sync." });
      return;
    }
    const pending = await db().outbox.count();
    useApp.getState().setSync({
      syncing: false,
      pending,
      syncError: error instanceof Error ? error.message : "Sync failed",
    });
  }
}

export function scheduleSync(delay = 900): void {
  if (typeof window === "undefined") return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void syncNow();
  }, delay);
}

export function useSyncLoop(): void {
  const user = useApp((s) => s.user);
  useEffect(() => {
    if (!user || user.role !== "nurse") return;
    const setOnline = useApp.getState().setOnline;
    const onOnline = () => {
      setOnline(true);
      void syncNow();
    };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => {
      if (navigator.onLine) void syncNow();
    }, 15_000);
    void syncNow();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [user]);
}

export async function currentConfig() {
  return getConfig();
}
