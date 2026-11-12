"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCheck, Clock3, Info, Loader2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, InlineAlert, Spinner, TierBadge } from "@/components/ui";
import type { RescheduleProposal } from "@/domain";
import { confirmReschedule, getReschedule, type StoredReschedule } from "@/lib/actions";
import { db, getSessionValue, type BedRow } from "@/lib/db";
import { formatDateTime, formatElapsed, toDateTimeLocal, fromDateTimeLocal } from "@/lib/format";
import { useLive } from "@/lib/hooks";
import { useApp } from "@/lib/store";

function ReviewInner() {
  const router = useRouter();
  const params = useSearchParams();
  const bedId = params.get("bed") ?? "";
  const user = useApp((s) => s.user);
  const notify = useApp((s) => s.notify);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user?.role === "head_nurse") router.replace("/head");
  }, [user, router]);

  const stored = useLive(() => getReschedule(bedId), [bedId]) as StoredReschedule | undefined;
  const bed = useLive(async () => (bedId ? db().beds.get(bedId) : undefined), [bedId]) as BedRow | undefined;

  useEffect(() => {
    if (!stored) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const proposal of stored.proposals) {
        if (!next[proposal.taskId]) next[proposal.taskId] = toDateTimeLocal(proposal.newDue);
      }
      return next;
    });
  }, [stored]);

  async function confirmOne(proposal: RescheduleProposal) {
    const value = values[proposal.taskId];
    if (!value) return;
    setBusy(true);
    try {
      await confirmReschedule(bedId, proposal.taskId, fromDateTimeLocal(value));
      notify("New due time saved. The old time remains in the event log.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not reschedule", "error");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAll() {
    if (!stored) return;
    setBusy(true);
    try {
      for (const proposal of stored.proposals) {
        const value = values[proposal.taskId];
        if (!value) continue;
        await confirmReschedule(bedId, proposal.taskId, fromDateTimeLocal(value));
      }
      notify("All deferred tasks rescheduled.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not reschedule", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!stored) {
    return (
      <AppShell title="Review deferrals" subtitle="No pending proposals" backHref="/beds">
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" />}
          title="Nothing waiting for a new time"
          body="Deferred tier 3–4 tasks appear here after an emergency ends. Tier 1–2 tasks are never deferred."
          action={<Link href="/beds" className="btn-primary">Back to beds</Link>}
        />
      </AppShell>
    );
  }

  const proposals = stored.proposals;

  return (
    <AppShell
      title="Confirm new times"
      subtitle={`${bed?.alias ?? "Bed"} · emergency lasted ${formatElapsed(stored.durationMs)}`}
      backHref="/beds"
    >
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <InlineAlert tone="warning" title="Nothing has moved yet">
            <p>
              These tier 3–4 tasks are still deferred. The suggested time is the old due time plus the actual
              emergency duration. Edit any time, then confirm.
            </p>
          </InlineAlert>

          {proposals.map((proposal) => (
            <div key={proposal.taskId} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <TierBadge tier={3} compact />
                    <h2 className="text-sm font-bold text-ink">{proposal.title}</h2>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Old due {formatDateTime(proposal.oldDue)} → suggested {formatDateTime(proposal.newDue)}
                  </p>
                </div>
                <span className="pill bg-violet-50 text-violet-700"><Clock3 className="h-3.5 w-3.5" /> Deferred</span>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  type="datetime-local"
                  className="input flex-1"
                  value={values[proposal.taskId] ?? toDateTimeLocal(proposal.newDue)}
                  onChange={(e) => setValues((prev) => ({ ...prev, [proposal.taskId]: e.target.value }))}
                  aria-label={`New due time for ${proposal.title}`}
                />
                <button className="btn-primary" disabled={busy} onClick={() => void confirmOne(proposal)}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                  Confirm time
                </button>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={confirmAll} disabled={busy || proposals.length === 0}>
              <CheckCheck className="h-4 w-4" /> Confirm all
            </button>
            <Link className="btn-secondary" href="/beds">Keep deferred for now</Link>
          </div>
        </div>

        <div className="space-y-3">
          <div className="card p-5">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Emergency evidence</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Started</dt>
                <dd className="font-semibold text-slate-800">{formatDateTime(stored.startedAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Clerked end</dt>
                <dd className="font-semibold text-slate-800">{formatDateTime(stored.endedAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Duration</dt>
                <dd className="font-semibold text-slate-800">{formatElapsed(stored.durationMs)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              Every timestamp comes from the stored event log, not an in-memory counter. That is what makes the
              handover and summary auditable.
            </p>
          </div>

          <div className="card border-teal-100 bg-teal-50/40 p-5">
            <p className="flex items-center gap-2 text-sm font-bold text-teal-900">
              <Info className="h-4 w-4" /> Protected tasks
            </p>
            <p className="mt-2 text-xs leading-relaxed text-teal-900/80">
              Tier 1–2 tasks on this bed were flagged for attention and stayed in the queue. They are never
              included in this reschedule list.
            </p>
          </div>

          <Link href="/tasks?filter=deferred" className="btn-ghost w-full justify-between">
            See deferred queue <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

export default function ReviewDeferredPage() {
  return (
    <Suspense fallback={<AppShell title="Review deferrals" subtitle="Loading…"><Spinner /></AppShell>}>
      <ReviewInner />
    </Suspense>
  );
}
