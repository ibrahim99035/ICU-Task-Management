"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Copy,
  FileText,
  Printer,
  Share2,
  Siren,
  TimerReset,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/modal";
import { EmptyState, InlineAlert, Spinner, TierBadge } from "@/components/ui";
import {
  buildHandover,
  SHIFT_HANDOVER_ID,
  type DomainEvent,
  type HandoverSnapshot,
  type HandoverTask,
  type Task,
} from "@/domain";
import { activeShift, db, type HandoverRow } from "@/lib/db";
import { finalizeHandover } from "@/lib/actions";
import { cn, formatDateTime, formatMinutes, formatTime } from "@/lib/format";
import { useLive } from "@/lib/hooks";
import { useApp } from "@/lib/store";

function handoverText(snapshot: HandoverSnapshot, note: string): string {
  const lines = [
    `TaskLog shift handover — ${snapshot.bedLabel}`,
    `Shift: ${snapshot.shiftId ? snapshot.shiftId.slice(0, 8) : "—"}`,
    `Done (${snapshot.done.length}): ${snapshot.done.map((t) => t.title).join(", ") || "none"}`,
    `Pending (${snapshot.pending.length}): ${snapshot.pending.map((t) => (t.note ? `${t.title} — ${t.note}` : t.title)).join(", ") || "none"}`,
    `Deferred (${snapshot.deferred.length}): ${snapshot.deferred.map((t) => (t.note ? `${t.title} — ${t.note}` : t.title)).join(", ") || "none"}`,
    `Missed (${snapshot.missed.length}): ${snapshot.missed.map((t) => (t.note ? `${t.title} — ${t.note}` : t.title)).join(", ") || "none"}`,
    `Interruptions: ${snapshot.interruptions.map((i) => `${i.label} ${i.minutes}m`).join(", ") || "none"}`,
    `Emergency: ${formatMinutes(snapshot.emergencyMinutes)}`,
    `Note: ${note || "none"}`,
    "",
    "Planning aid only. Not a medical device or official record. No patient identifiers.",
  ];
  return lines.join("\n");
}

export default function HandoverPage() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const notify = useApp((s) => s.notify);
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
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
    async (): Promise<{ tasks: Task[]; events: DomainEvent[] }> => {
      const shift = shiftBox?.shift;
      if (!shift) return { tasks: [], events: [] };
      const [tasks, events] = await Promise.all([
        db().tasks.where("shiftId").equals(shift.id).toArray(),
        db().events.where("shiftId").equals(shift.id).toArray(),
      ]);
      return { tasks, events };
    },
    [shiftBox?.shift?.id],
  );

  const shift = shiftBox?.shift;
  const tasks = data?.tasks ?? [];
  const events = data?.events ?? [];

  const snapshot = useMemo(() => {
    if (!shift) return undefined;
    return buildHandover(
      events,
      { id: SHIFT_HANDOVER_ID, label: "Shift handover" },
      note,
    );
  }, [shift, events, note]);

  const existing = useLive(
    async (): Promise<HandoverRow | undefined> => {
      if (!shift) return undefined;
      const rows = await db().handovers.where("shiftId").equals(shift.id).toArray();
      return rows.find((row) => row.bedId === SHIFT_HANDOVER_ID);
    },
    [shift?.id],
  );

  async function finalize() {
    if (!shift) return;
    setBusy(true);
    try {
      await finalizeHandover(shift.id, SHIFT_HANDOVER_ID, note);
      setConfirmOpen(false);
      notify("Shift handover finalized and saved to the event log.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not finalize handover", "error");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!snapshot) return;
    const text = handoverText(snapshot, note);
    try {
      await navigator.clipboard.writeText(text);
      notify("Handover copied to clipboard.", "success");
    } catch {
      notify("Clipboard is unavailable. Use your browser share menu.", "warning");
    }
  }

  async function share() {
    if (!snapshot) return;
    const text = handoverText(snapshot, note);
    if (navigator.share) {
      try {
        await navigator.share({ title: "Shift handover", text });
        return;
      } catch {
        return;
      }
    }
    await copy();
  }

  if (!shiftBox) return <AppShell title="Shift handover" subtitle="Loading…"><Spinner /></AppShell>;
  if (!shift) return <AppShell title="Shift handover" subtitle="No active shift"><div /></AppShell>;

  return (
    <AppShell
      title="Shift handover"
      subtitle={`${shift.unitName ?? "Unassigned"} · built from the stored event log. Nothing is invented.`}
      activeOverride="/handover"
    >
      {tasks.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-6 w-6" />}
          title="No tasks on this shift"
          body="Start a shift to create the agreed staff-nurse task list."
          action={<Link className="btn-primary" href="/shift-start">Start shift</Link>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3">
            {existing ? (
              <InlineAlert tone="success" title="Handover already finalized">
                <p>
                  Finalized {formatDateTime(existing.createdAt)}. This snapshot is immutable; a later edit
                  cannot overwrite it. You can still copy or print it.
                </p>
              </InlineAlert>
            ) : snapshot?.emergencyMinutes ? (
              <InlineAlert tone="danger" title="Emergency time recorded">
                <p>
                  {formatMinutes(snapshot.emergencyMinutes)} of emergency time appears on this handover.
                  Confirm the emergency has ended before finalizing.
                </p>
              </InlineAlert>
            ) : null}

            <HandoverSnapshotCard
              snapshot={existing?.snapshot ?? snapshot}
              note={existing?.note ?? note}
              finalizedAt={existing?.createdAt}
            />

            {!existing ? (
              <div className="card p-4">
                <label className="label" htmlFor="handover-note">Free-text handover note</label>
                <textarea
                  id="handover-note"
                  className="input min-h-[120px] resize-y"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={2000}
                  placeholder="e.g. Watch urine output. Family asked for an update at 16:00. Do not enter patient names or identifiers."
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {note.length}/2000 · No names, MRNs, dates of birth or other identifiers.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button className="btn-primary flex-1" onClick={() => setConfirmOpen(true)}>
                    <ClipboardCheck className="h-4 w-4" /> Finalize handover
                  </button>
                  <button className="btn-secondary" onClick={() => void copy()} disabled={!snapshot}>
                    <Copy className="h-4 w-4" /> Copy
                  </button>
                  <button className="btn-secondary" onClick={() => void share()} disabled={!snapshot}>
                    <Share2 className="h-4 w-4" /> Share
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => void copy()}>
                  <Copy className="h-4 w-4" /> Copy handover
                </button>
                <button className="btn-secondary" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" /> Print
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="card p-5">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">At a glance</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat icon={<CheckCircle2 className="h-4 w-4" />} label="Done" value={String(snapshot?.done.length ?? 0)} tone="teal" />
                <Stat icon={<Clock3 className="h-4 w-4" />} label="Pending" value={String(snapshot?.pending.length ?? 0)} />
                <Stat icon={<TimerReset className="h-4 w-4" />} label="Deferred" value={String(snapshot?.deferred.length ?? 0)} tone="violet" />
                <Stat icon={<XCircle className="h-4 w-4" />} label="Missed" value={String(snapshot?.missed.length ?? 0)} tone="danger" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat icon={<Siren className="h-4 w-4" />} label="Emergency" value={formatMinutes(snapshot?.emergencyMinutes ?? 0)} tone="danger" />
                <Stat icon={<AlertTriangle className="h-4 w-4" />} label="Interruptions" value={formatMinutes((snapshot?.interruptions ?? []).reduce((s, i) => s + i.minutes, 0))} tone="amber" />
              </div>
            </div>

            <div className="card border-amber-200 bg-amber-50/50 p-4 text-xs leading-relaxed text-amber-900">
              <p className="flex items-center gap-2 font-bold"><FileText className="h-4 w-4" /> Safety boundary</p>
              <p className="mt-1.5">
                This handover is a planning aid. It does not replace the official clinical handover or the
                medical record. Always verify against the bedside and unit policy.
              </p>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={finalize}
        busy={busy}
        confirmLabel="Finalize handover"
        title="Finalize this shift handover?"
        body={
          <div className="space-y-2">
            <p>This writes an immutable snapshot to the event log. It cannot be edited afterwards.</p>
            <p className="text-xs text-slate-500">You can still copy or print the snapshot. The audit log keeps the original events.</p>
          </div>
        }
      />
    </AppShell>
  );
}

function Stat({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "teal" | "amber" | "danger" | "violet";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        tone === "default" && "border-slate-200 bg-slate-50",
        tone === "teal" && "border-teal-100 bg-teal-50 text-teal-900",
        tone === "amber" && "border-amber-100 bg-amber-50 text-amber-900",
        tone === "danger" && "border-danger-100 bg-danger-50 text-danger-900",
        tone === "violet" && "border-violet-100 bg-violet-50 text-violet-900",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide opacity-70">
        {icon} {label}
      </div>
      <p className="mt-0.5 text-lg font-bold">{value}</p>
    </div>
  );
}

function HandoverSnapshotCard({
  snapshot,
  note,
  finalizedAt,
}: {
  snapshot?: HandoverSnapshot;
  note: string;
  finalizedAt?: number;
}) {
  if (!snapshot) return null;
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Handover snapshot</p>
            <h2 className="text-base font-bold text-ink">{snapshot.bedLabel}</h2>
          </div>
          {finalizedAt ? <span className="pill bg-teal-50 text-teal-800">Finalized</span> : <span className="pill bg-amber-50 text-amber-800">Draft</span>}
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        <SnapshotSection title="Done" tasks={snapshot.done} tone="teal" />
        <SnapshotSection title="Pending" tasks={snapshot.pending} tone="default" />
        <SnapshotSection title="Deferred" tasks={snapshot.deferred} tone="violet" />
        <SnapshotSection title="Missed" tasks={snapshot.missed} tone="danger" />
        <div className="px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Interruptions</p>
          {snapshot.interruptions.length ? (
            <ul className="mt-1.5 space-y-1 text-sm text-slate-700">
              {snapshot.interruptions.map((item) => (
                <li key={item.reason} className="flex justify-between gap-2">
                  <span>{item.label} × {item.count}</span>
                  <span className="font-semibold">{formatMinutes(item.minutes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-slate-500">None recorded.</p>
          )}
        </div>
        <div className="px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Nurse note</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{note || "No note."}</p>
        </div>
      </div>
    </div>
  );
}

function SnapshotSection({
  title,
  tasks,
  tone,
}: {
  title: string;
  tasks: HandoverTask[];
  tone: "default" | "teal" | "violet" | "danger";
}) {
  if (!tasks.length) return null;
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{title} ({tasks.length})</p>
      <ul className="mt-1.5 space-y-1.5">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-start justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <TierBadge tier={task.tier} compact />
                <span className="truncate text-slate-700">{task.title}</span>
              </span>
              {task.note ? (
                <span className="mt-0.5 block whitespace-pre-wrap text-[11px] italic leading-relaxed text-amber-800">
                  {task.note}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "shrink-0 pt-0.5 text-[11px] font-medium",
                tone === "danger" && "text-danger-700",
                tone === "teal" && "text-teal-700",
                tone === "violet" && "text-violet-700",
                tone === "default" && "text-slate-500",
              )}
            >
              {formatTime(task.plannedFrom)} – {formatTime(task.plannedTo)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
