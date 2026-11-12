"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  HeartPulse,
  Loader2,
  MessageSquare,
  Send,
  Star,
  Timer,
  UserRound,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, InlineAlert, Spinner } from "@/components/ui";
import { fetchShiftDetail, postReview, type ShiftDetail } from "@/lib/api";
import { cn, formatDate, formatMinutes, formatPercent } from "@/lib/format";
import { useApp } from "@/lib/store";

const CRITERIA = [
  { key: "completion", label: "Task completion", hint: "Finished the planned care it was reasonable to finish." },
  { key: "critical_timeliness", label: "Critical task timeliness", hint: "Tier 1–2 care was started and finished when it mattered." },
  { key: "interruption_handling", label: "Interruption handling", hint: "Paused, logged and resumed work clearly." },
  { key: "handover_quality", label: "Handover quality", hint: "The snapshot and note conveyed what the next nurse needs." },
  { key: "documentation", label: "Documentation", hint: "Event log and timestamps tell a coherent story." },
] as const;

type Scores = Record<(typeof CRITERIA)[number]["key"], number>;

function ReviewInner() {
  const router = useRouter();
  const params = useSearchParams();
  const shiftId = params.get("shift") ?? "";
  const user = useApp((s) => s.user);
  const token = useApp((s) => s.token);
  const notify = useApp((s) => s.notify);
  const [detail, setDetail] = useState<ShiftDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scores, setScores] = useState<Scores>({
    completion: 3,
    critical_timeliness: 3,
    interruption_handling: 3,
    handover_quality: 3,
    documentation: 3,
  });
  const [comment, setComment] = useState("");
  const [needsSupport, setNeedsSupport] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && user.role !== "head_nurse") router.replace("/beds");
    if (!user) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!token || !shiftId || user?.role !== "head_nurse") return;
    setLoading(true);
    fetchShiftDetail(token, shiftId)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load shift"))
      .finally(() => setLoading(false));
  }, [token, shiftId, user?.role]);

  async function submit() {
    if (!token || !detail) return;
    setBusy(true);
    try {
      await postReview(token, {
        id: crypto.randomUUID(),
        shiftId,
        scores,
        comment: comment.trim(),
        needsSupport,
        createdAt: Date.now(),
      });
      notify("Manual review saved. No overall score was computed.", "success");
      router.push(`/head/shift?id=${shiftId}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save review", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;
  if (loading) return <AppShell title="Manual review" subtitle="Loading…" backHref="/head/shifts"><Spinner /></AppShell>;
  if (error || !detail) {
    return (
      <AppShell title="Manual review" subtitle="Could not load" backHref="/head/shifts">
        <EmptyState
          icon={<MessageSquare className="h-6 w-6" />}
          title="Shift not available"
          body={error || "The shift could not be loaded."}
          action={<Link href="/head/shifts" className="btn-primary">Back to shifts</Link>}
        />
      </AppShell>
    );
  }

  const shift = detail.shift;
  const summary = shift.summary;

  if (detail.review) {
    return (
      <AppShell title="Manual review" subtitle={`${shift.nurseName} · ${formatDate(shift.startedAt)}`} backHref={`/head/shift?id=${shiftId}`}>
        <div className="mx-auto max-w-2xl">
          <div className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-lg font-bold text-ink">Review already submitted</h1>
              <span className="pill bg-teal-50 text-teal-800"><CheckCircle2 className="h-3.5 w-3.5" /> Saved</span>
            </div>
            <div className="mt-4 space-y-2">
              {CRITERIA.map((criterion) => (
                <div key={criterion.key} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                  <span className="text-sm text-slate-600">{criterion.label}</span>
                  <span className="font-bold text-slate-800">{detail.review?.scores[criterion.key]}/5</span>
                </div>
              ))}
            </div>
            {detail.review.comment ? <p className="mt-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-600">{detail.review.comment}</p> : null}
            {detail.review.needsSupport ? <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">Support flagged. This is not a ranking.</p> : null}
            <Link href={`/head/shift?id=${shiftId}`} className="btn-primary mt-4">Back to shift</Link>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!shift.endedAt) {
    return (
      <AppShell title="Manual review" subtitle={`${shift.nurseName} · open shift`} backHref={`/head/shift?id=${shiftId}`}>
        <EmptyState
          icon={<Timer className="h-6 w-6" />}
          title="Shift is not finished"
          body="A manual review can only be written after the shift has ended."
          action={<Link href={`/head/shift?id=${shiftId}`} className="btn-primary">Back to shift</Link>}
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Manual review"
      subtitle={`${shift.nurseName} · ${formatDate(shift.startedAt)} · ${shift.type}`}
      backHref={`/head/shift?id=${shiftId}`}
      activeOverride="/head/shifts"
    >
      <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          <InlineAlert tone="info" title="Five manual ratings, no composite score">
            <p>
              Rate each criterion from 1 (needs support) to 5 (strong). The app does not average, weight or rank
              nurses. The comment is for feedback and support planning.
            </p>
          </InlineAlert>

          {CRITERIA.map((criterion) => (
            <section key={criterion.key} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-ink">{criterion.label}</h2>
                  <p className="text-[11px] text-slate-500">{criterion.hint}</p>
                </div>
                <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700">{scores[criterion.key]}/5</span>
              </div>
              <div className="mt-3 grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    onClick={() => setScores((prev) => ({ ...prev, [criterion.key]: value }))}
                    className={cn(
                      "min-h-11 rounded-xl border text-sm font-bold",
                      scores[criterion.key] === value
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                    aria-label={`${value} out of 5 for ${criterion.label}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                <span>Needs support</span>
                <span>Strong</span>
              </div>
            </section>
          ))}

          <section className="card p-4">
            <label className="label" htmlFor="review-comment">Comment</label>
            <textarea
              id="review-comment"
              className="input min-h-[110px] resize-y"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
              placeholder="Specific, behavioural feedback. No patient identifiers."
            />
            <p className="mt-1 text-[11px] text-slate-500">{comment.length}/2000</p>
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <input
                type="checkbox"
                checked={needsSupport}
                onChange={(e) => setNeedsSupport(e.target.checked)}
                className="h-5 w-5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-xs font-semibold text-amber-900">Flag for support (not a ranking)</span>
            </label>
          </section>

          <button className="btn-primary w-full" onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Save manual review
          </button>
        </div>

        <div className="space-y-3">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink"><UserRound className="h-4 w-4" /> Shift evidence</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Nurse" value={shift.nurseName} />
              <Row label="Participant" value={shift.participantCode} />
              <Row label="Completion" value={summary ? formatPercent(summary.completionRate) : "—"} />
              <Row label="Direct care" value={summary ? formatMinutes(summary.directCareMin) : "—"} />
              <Row label="Interruptions" value={summary ? formatMinutes(summary.interruptionMin) : "—"} />
              <Row label="Missed" value={summary ? String(summary.missedCount) : "—"} />
              <Row label="Handovers" value={String(detail.handovers.length)} />
            </dl>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
              Read the event timeline and handover before rating. Timestamps come from the stored log, not from
              memory.
            </div>
          </section>

          <section className="card border-amber-200 bg-amber-50/50 p-4 text-[11px] leading-relaxed text-amber-900">
            <p className="flex items-center gap-1.5 font-bold"><HeartPulse className="h-4 w-4" /> Keep it developmental</p>
            <p className="mt-1.5">
              This review supports teaching and follow-up. It must not be used as a leaderboard or staffing score.
            </p>
          </section>

          <Link href={`/head/shift?id=${shiftId}`} className="btn-ghost w-full justify-between">
            <span className="inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4" /> Back to shift</span>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<AppShell title="Manual review" subtitle="Loading…"><Spinner /></AppShell>}>
      <ReviewInner />
    </Suspense>
  );
}
