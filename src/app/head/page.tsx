"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Loader2,
  RefreshCw,
  Siren,
  Star,
  Timer,
  TrendingUp,
  WifiOff,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { BarRow, DonutChart } from "@/components/charts";
import { EmptyState, InlineAlert, Spinner, StatCard } from "@/components/ui";
import { fetchAnalytics, fetchShifts, type HeadShift, type UnitAnalytics } from "@/lib/api";
import { formatDate, formatMinutes, formatPercent, formatTime } from "@/lib/format";
import { useApp } from "@/lib/store";

export default function HeadDashboardPage() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const token = useApp((s) => s.token);
  const online = useApp((s) => s.online);
  const [days, setDays] = useState(30);
  const [data, setData] = useState<UnitAnalytics | null>(null);
  const [shifts, setShifts] = useState<HeadShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user && user.role !== "head_nurse") router.replace("/beds");
    if (!user) router.replace("/login");
  }, [user, router]);

  const load = useCallback(async () => {
    if (!token || user?.role !== "head_nurse") return;
    setLoading(true);
    setError("");
    try {
      const [analytics, list] = await Promise.all([fetchAnalytics(token, days), fetchShifts(token)]);
      setData(analytics);
      setShifts(list.shifts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load dashboard");
    } finally {
      setLoading(false);
    }
  }, [token, user?.role, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const reviewQueue = useMemo(() => shifts.filter((s) => s.endedAt && !s.reviewId).slice(0, 5), [shifts]);
  const timeSegments = data
    ? [
        { label: "Direct care", value: data.avgDirectCareMin, color: "#0d9488" },
        { label: "Indirect care", value: data.avgIndirectCareMin, color: "#3b82f6" },
        { label: "Interruptions", value: data.avgInterruptionMin, color: "#f59e0b" },
        { label: "Emergency", value: data.avgEmergencyMin, color: "#dc2626" },
      ]
    : [];

  if (!user) return null;

  return (
    <AppShell
      title="Unit dashboard"
      subtitle={`Finished-shift averages · last ${days} days`}
      activeOverride="/head"
      actions={
        <button className="btn-ghost hidden h-9 px-2 text-xs sm:inline-flex" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      }
    >
      {!online ? (
        <div className="mb-4">
          <InlineAlert tone="warning" title="Dashboard needs a connection">
            <p>Head-nurse analysis is online-only. Nurse logging and handover stay available offline on the nurse device.</p>
          </InlineAlert>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1">
          {[7, 30, 90].map((value) => (
            <button
              key={value}
              onClick={() => setDays(value)}
              className={`min-h-9 rounded-lg px-3 text-xs font-bold ${days === value ? "bg-ink text-white" : "text-slate-500"}`}
            >
              {value}d
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">Averages are unit-level. No nurse ranking is computed.</p>
      </div>

      {error ? (
        <div className="mb-4">
          <InlineAlert tone="danger" title="Could not load the dashboard">
            <p>{error}</p>
            <button className="btn-secondary mt-2 min-h-9 text-xs" onClick={() => void load()}>Try again</button>
          </InlineAlert>
        </div>
      ) : null}

      {loading && !data ? (
        <Spinner label="Loading unit averages…" />
      ) : !data || data.shifts === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          title="No finished shifts in this period"
          body="Finish a nurse shift or run the simulation script to create demo summaries. Head-nurse screens stay read-only."
          action={<Link className="btn-primary" href="/head/shifts">View shifts</Link>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Avg direct care" value={formatMinutes(data.avgDirectCareMin)} hint={`${data.shifts} finished shifts`} tone="teal" icon={<Timer className="h-4 w-4" />} />
            <StatCard label="Avg indirect" value={formatMinutes(data.avgIndirectCareMin)} hint="Charting & coordination" icon={<ClipboardCheck className="h-4 w-4" />} />
            <StatCard label="Avg interruption" value={formatMinutes(data.avgInterruptionMin)} hint="Logged reasons only" tone="amber" icon={<Activity className="h-4 w-4" />} />
            <StatCard label="Avg emergency" value={formatMinutes(data.avgEmergencyMin)} hint="Per affected shift" tone="danger" icon={<Siren className="h-4 w-4" />} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
            <div className="space-y-4">
              <section className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-ink">Average recorded time split</h2>
                    <p className="text-xs text-slate-500">Mean per finished shift over {data.days} days.</p>
                  </div>
                  <span className="pill bg-slate-100 text-slate-600">{data.shifts} shifts</span>
                </div>
                <div className="mt-4">
                  <DonutChart
                    segments={timeSegments}
                    centerLabel="Avg recorded"
                    centerValue={formatMinutes(
                      data.avgDirectCareMin + data.avgIndirectCareMin + data.avgInterruptionMin + data.avgEmergencyMin,
                    )}
                  />
                </div>
              </section>

              <section className="card p-5">
                <h2 className="text-base font-bold text-ink">Top interruption reasons</h2>
                <p className="text-xs text-slate-500">Counts and total logged minutes across finished shifts.</p>
                {data.topInterruptions.length ? (
                  <div className="mt-4 space-y-3">
                    {data.topInterruptions.map((item) => (
                      <BarRow
                        key={item.reason}
                        label={`${item.label} × ${item.count}`}
                        value={item.minutes}
                        max={Math.max(...data.topInterruptions.map((i) => i.minutes), 1)}
                        color="bg-amber-500"
                        right={formatMinutes(item.minutes)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No interruptions recorded.</p>
                )}
              </section>

              <section className="card p-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-ink">Review queue</h2>
                    <p className="text-xs text-slate-500">Finished shifts without a manual review.</p>
                  </div>
                  <Link href="/head/shifts" className="link text-xs">All shifts</Link>
                </div>
                {reviewQueue.length ? (
                  <ul className="mt-3 divide-y divide-slate-100">
                    {reviewQueue.map((shift) => (
                      <li key={shift.id}>
                        <Link href={`/head/review?shift=${shift.id}`} className="flex min-h-14 items-center gap-3 py-2 hover:bg-slate-50">
                          <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-700">
                            <Star className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-slate-800">{shift.nurseName} · {shift.participantCode}</span>
                            <span className="text-[11px] text-slate-500">{formatDate(shift.startedAt)} · {formatTime(shift.startedAt)} · {shift.type}</span>
                          </span>
                          <span className="pill bg-amber-50 text-amber-800">Review</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-teal-700">All finished shifts have a review.</p>
                )}
              </section>
            </div>

            <div className="space-y-4">
              <section className="card p-5">
                <h2 className="text-base font-bold text-ink">Unit facts</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  <Row label="Avg completion" value={formatPercent(data.avgCompletionRate)} />
                  <Row label="Tier 1–2 on time" value={formatPercent(data.avgTier12OnTimeRate)} />
                  <Row label="Total missed" value={String(data.totalMissed)} />
                  <Row label="Total deferred" value={String(data.totalDeferred)} />
                  <Row label="Finished shifts" value={String(data.shifts)} />
                </dl>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
                  These are timestamp-derived activity facts, not a nurse performance score. Ratings are entered
                  manually by the head nurse on a separate screen.
                </div>
              </section>

              <section className="card p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-ink">Recent shifts</h2>
                  <Link href="/head/shifts" className="link text-xs">Open list</Link>
                </div>
                {shifts.length ? (
                  <ul className="mt-2 divide-y divide-slate-100">
                    {shifts.slice(0, 6).map((shift) => (
                      <li key={shift.id}>
                        <Link href={`/head/shift?id=${shift.id}`} className="flex min-h-12 items-center gap-2 py-2 hover:bg-slate-50">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-slate-800">{shift.nurseName}</span>
                            <span className="text-[11px] text-slate-500">{formatDate(shift.startedAt)} · {shift.type}</span>
                          </span>
                          {shift.summary ? (
                            <span className="flex items-center gap-1 text-[11px] font-semibold text-teal-700">
                              <CheckCircle2 className="h-3.5 w-3.5" /> {formatPercent(shift.summary.completionRate)}
                            </span>
                          ) : (
                            <span className="pill bg-slate-100 text-slate-500"><Clock3 className="h-3 w-3" /> Open</span>
                          )}
                          <ArrowRight className="h-4 w-4 text-slate-300" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No shifts recorded.</p>
                )}
              </section>

              <section className="card p-5">
                <h2 className="flex items-center gap-2 text-base font-bold text-ink"><TrendingUp className="h-4 w-4 text-teal-600" /> Demo reading</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  The useful comparison is the shift-level mix of direct care, interruption time and priority
                  protection — not a single composite score for a nurse.
                </p>
              </section>
            </div>
          </div>
        </>
      )}
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
