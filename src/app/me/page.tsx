"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileText,
  Loader2,
  LogOut,
  ShieldCheck,
  Star,
  Timer,
  UserRound,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/modal";
import { InlineAlert, StatCard } from "@/components/ui";
import type { ShiftSummary } from "@/domain";
import { activeShift, db, type ReviewRow, type ShiftRow } from "@/lib/db";
import { endShift } from "@/lib/actions";
import { formatDate, formatElapsed, formatMinutes, formatPercent, initials } from "@/lib/format";
import { useLive, useNow } from "@/lib/hooks";
import { useApp } from "@/lib/store";

export default function MePage() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const pending = useApp((s) => s.pending);
  const logout = useApp((s) => s.logout);
  const notify = useApp((s) => s.notify);
  const now = useNow(10_000);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = useLive(
    async () => (user ? await activeShift(user.id) : undefined),
    [user?.id],
  ) as ShiftRow | undefined;

  const shifts = useLive(
    async () => (user ? (await db().shifts.where("actorId").equals(user.id).toArray()).sort((a, b) => b.startedAt - a.startedAt).slice(0, 6) : []),
    [user?.id],
  ) as ShiftRow[] | undefined;

  const reviews = useLive(
    async () => (user ? (await db().reviews.toArray()).filter((r) => r.shiftId && (shifts ?? []).some((s) => s.id === r.shiftId)).sort((a, b) => b.createdAt - a.createdAt) : []),
    [user?.id, shifts?.length],
  ) as ReviewRow[] | undefined;

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  async function finishShift() {
    if (!active) return;
    setBusy(true);
    try {
      await endShift(active.id, "Ended from Me");
      setEndOpen(false);
      router.push(`/summary?shift=${active.id}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not end shift", "error");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await db().events.clear();
      await db().tasks.clear();
      await db().outbox.clear();
      await db().reviews.clear();
      await db().handovers.clear();
      await db().shifts.clear();
      await db().beds.clear();
      await db().session.clear();
      await logout();
      router.replace("/login");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <AppShell title="Me" subtitle="Profile, shift history and privacy" activeOverride="/me">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <section className="card overflow-hidden">
            <div className="bg-ink p-5 text-white">
              <div className="flex items-center gap-3">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-lg font-bold text-teal-200">
                  {initials(user.displayName)}
                </span>
                <div>
                  <h1 className="text-xl font-extrabold tracking-tight">{user.displayName}</h1>
                  <p className="text-xs text-white/60">@{user.username} · {user.role === "head_nurse" ? "Head nurse" : "Nurse"}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                  <p className="text-white/50">Participant code</p>
                  <p className="mt-0.5 font-mono text-sm font-bold text-teal-200">{user.participantCode}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                  <p className="text-white/50">This device</p>
                  <p className="mt-0.5 text-sm font-bold">{pending ? `${pending} pending` : "Synced"}</p>
                </div>
              </div>
            </div>
            <div className="p-4">
              <p className="text-xs leading-relaxed text-slate-500">
                Your participant code is used for survey analysis. It is not a patient identifier. The app never
                stores patient names, MRNs or dates of birth.
              </p>
            </div>
          </section>

          {user.role === "nurse" && active ? (
            <section className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-ink">Active shift</h2>
                  <p className="text-xs text-slate-500">{formatDate(active.startedAt)} · {active.type} shift</p>
                </div>
                <span className="pill bg-teal-50 text-teal-800"><Timer className="h-3.5 w-3.5" /> {formatElapsed(now - active.startedAt)}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/beds" className="btn-primary">Open beds <ArrowRight className="h-4 w-4" /></Link>
                <Link href={`/summary?shift=${active.id}`} className="btn-secondary">Preview summary</Link>
                <button className="btn-danger" onClick={() => setEndOpen(true)}>End shift</button>
              </div>
            </section>
          ) : null}

          {user.role === "nurse" ? (
            <section className="card p-5">
              <h2 className="text-base font-bold text-ink">Recent shifts</h2>
              {shifts?.length ? (
                <ul className="mt-2 divide-y divide-slate-100">
                  {shifts.map((shift) => {
                    const summary = shift.summary as ShiftSummary | undefined;
                    return (
                      <li key={shift.id}>
                        <Link href={`/summary?shift=${shift.id}`} className="flex min-h-14 items-center gap-3 py-2 hover:bg-slate-50">
                          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500">
                            <CalendarDays className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-slate-800">
                              {formatDate(shift.startedAt)} · {shift.type}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {summary ? `${summary.tasksDone}/${summary.tasksTotal} done · ${formatMinutes(summary.directCareMin)} direct` : shift.endedAt ? "Finished" : "Open"}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 text-slate-300" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No shifts on this device yet.</p>
              )}
            </section>
          ) : null}

          <section className="card p-5">
            <h2 className="text-base font-bold text-ink">Manual head-nurse reviews</h2>
            <p className="text-xs text-slate-500">Five criteria, each 1–5. There is no computed overall score or ranking.</p>
            {reviews?.length ? (
              <ul className="mt-3 space-y-2">
                {reviews.map((review) => (
                  <li key={review.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700">{formatDate(review.createdAt)}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                        <Star className="h-3.5 w-3.5 fill-amber-400" /> Manual review
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-500">
                      {Object.entries(review.scores).map(([key, value]) => (
                        <span key={key} className="capitalize">{key.replaceAll("_", " ")}: <strong className="text-slate-800">{value}/5</strong></span>
                      ))}
                    </div>
                    {review.comment ? <p className="mt-2 text-xs text-slate-600">{review.comment}</p> : null}
                    {review.needsSupport ? <p className="mt-2 text-[11px] font-semibold text-amber-800">Needs support flagged.</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No review received yet. Reviews sync from the head nurse.</p>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Tools</h2>
            </div>
            <div className="divide-y divide-slate-100">
              <ToolLink href="/surveys" icon={<ClipboardCheck className="h-4 w-4" />} title="Evaluation surveys" subtitle="SUS and raw NASA-TLX" />
              <ToolLink href="/privacy" icon={<ShieldCheck className="h-4 w-4" />} title="Privacy & data" subtitle="What is stored and who sees it" />
              {user.role === "nurse" ? (
                <ToolLink href="/handover" icon={<FileText className="h-4 w-4" />} title="Handover" subtitle="Build from the event log" />
              ) : (
                <ToolLink href="/head/export" icon={<Download className="h-4 w-4" />} title="Export data" subtitle="CSV for analysis" />
              )}
              <ToolLink href="/shift-start" icon={<CalendarDays className="h-4 w-4" />} title="Shift setup" subtitle="Shift type and demo beds" />
            </div>
          </section>

          <section className="card border-amber-200 bg-amber-50/50 p-4 text-xs leading-relaxed text-amber-900">
            <p className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4" /> Safety reminder</p>
            <p className="mt-1.5">
              ICU TaskLog is not a medical device. It does not read bedside monitors or alarms and does not replace
              official orders or the medical record.
            </p>
          </section>

          <button className="btn-secondary w-full" onClick={() => setLogoutOpen(true)}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
          <p className="text-center text-[11px] text-slate-400">ICU TaskLog v1.0 · thesis demo</p>
        </div>
      </div>

      <ConfirmDialog
        open={endOpen}
        onClose={() => setEndOpen(false)}
        onConfirm={finishShift}
        busy={busy}
        confirmLabel="End shift"
        tone="danger"
        title="End the active shift?"
        body={<p>Open tasks will be marked missed. The summary freezes at this timestamp.</p>}
      />

      <ConfirmDialog
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={signOut}
        busy={busy}
        confirmLabel="Sign out & clear device"
        tone="danger"
        title="Sign out and clear this device?"
        body={
          <div className="space-y-2">
            <p>Local events, tasks and handovers are removed from this browser. The server copy is kept if it was synced.</p>
            {pending ? (
              <p className="rounded-xl border border-danger-200 bg-danger-50 p-3 text-danger-800">
                <strong>{pending} action(s) have not synced.</strong> Signing out now will lose them. Connect and sync first.
              </p>
            ) : null}
          </div>
        }
      />
    </AppShell>
  );
}

function ToolLink({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-800">{title}</span>
        <span className="block text-[11px] text-slate-500">{subtitle}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-slate-300" />
    </Link>
  );
}
