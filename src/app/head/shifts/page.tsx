"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  Loader2,
  RefreshCw,
  Search,
  Star,
  WifiOff,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, InlineAlert, Spinner, StatCard } from "@/components/ui";
import { fetchShifts, type HeadShift } from "@/lib/api";
import { cn, formatDate, formatDateTime, formatMinutes, formatPercent, todayInput } from "@/lib/format";
import { useApp } from "@/lib/store";

export default function HeadShiftsPage() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const token = useApp((s) => s.token);
  const online = useApp((s) => s.online);
  const [all, setAll] = useState<HeadShift[]>([]);
  const [from, setFrom] = useState(todayInput(-30));
  const [to, setTo] = useState(todayInput(0));
  const [nurse, setNurse] = useState("all");
  const [query, setQuery] = useState("");
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
      const result = await fetchShifts(token, { from, to });
      setAll(result.shifts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load shifts");
    } finally {
      setLoading(false);
    }
  }, [token, user?.role, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const nurses = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string }>();
    for (const shift of all) map.set(shift.userId, { id: shift.userId, name: shift.nurseName, code: shift.participantCode });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return all.filter((shift) => {
      if (nurse !== "all" && shift.userId !== nurse) return false;
      if (text && !`${shift.nurseName} ${shift.participantCode} ${shift.type}`.toLowerCase().includes(text)) return false;
      return true;
    });
  }, [all, nurse, query]);

  const finished = filtered.filter((s) => s.endedAt).length;
  const needsReview = filtered.filter((s) => s.endedAt && !s.reviewId).length;
  const support = filtered.filter((s) => s.needsSupport).length;

  if (!user) return null;

  return (
    <AppShell
      title="Nurse shifts"
      subtitle={`${filtered.length} shift(s) · ${from} to ${to}`}
      activeOverride="/head/shifts"
      actions={
        <button className="btn-ghost hidden h-9 px-2 text-xs sm:inline-flex" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </button>
      }
    >
      {!online ? (
        <div className="mb-4">
          <InlineAlert tone="warning" title="Shifts need a connection">
            <p>This list is fetched from the server. It is not cached on this device.</p>
          </InlineAlert>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Shifts" value={String(filtered.length)} hint={`${finished} finished`} icon={<CalendarDays className="h-4 w-4" />} />
        <StatCard label="Needs review" value={String(needsReview)} hint="Manual 1–5 ratings" tone="amber" icon={<Star className="h-4 w-4" />} />
        <StatCard label="Support flagged" value={String(support)} hint="Not a ranking" tone="danger" icon={<ClipboardCheck className="h-4 w-4" />} />
        <StatCard label="Nurses" value={String(nurses.length)} hint="In this date range" icon={<Search className="h-4 w-4" />} />
      </div>

      <div className="card mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="from">From</label>
            <input id="from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="to">To</label>
            <input id="to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="nurse">Nurse</label>
            <select id="nurse" className="input" value={nurse} onChange={(e) => setNurse(e.target.value)}>
              <option value="all">All nurses</option>
              {nurses.map((n) => (
                <option key={n.id} value={n.id}>{n.name} · {n.code}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="search">Search</label>
            <input id="search" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, code or shift" />
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-4">
          <InlineAlert tone="danger" title="Could not load shifts"><p>{error}</p></InlineAlert>
        </div>
      ) : null}

      {loading && !all.length ? (
        <Spinner label="Loading shifts…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title="No shifts match"
          body="Adjust the dates, choose another nurse, or finish a nurse shift first."
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card lg:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-bold">Nurse</th>
                  <th className="px-3 py-3 font-bold">Shift</th>
                  <th className="px-3 py-3 font-bold">Completion</th>
                  <th className="px-3 py-3 font-bold">Direct</th>
                  <th className="px-3 py-3 font-bold">Interruption</th>
                  <th className="px-3 py-3 font-bold">Review</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((shift) => (
                  <tr key={shift.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{shift.nurseName}</p>
                      <p className="text-[11px] text-slate-500">{shift.participantCode}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium capitalize text-slate-700">{shift.type}</p>
                      <p className="text-[11px] text-slate-500">{formatDateTime(shift.startedAt)}</p>
                    </td>
                    <td className="px-3 py-3 font-semibold text-slate-800">
                      {shift.summary ? formatPercent(shift.summary.completionRate) : "—"}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{shift.summary ? formatMinutes(shift.summary.directCareMin) : "—"}</td>
                    <td className="px-3 py-3 text-slate-600">{shift.summary ? formatMinutes(shift.summary.interruptionMin) : "—"}</td>
                    <td className="px-3 py-3">
                      {shift.reviewId ? (
                        <span className={cn("pill", shift.needsSupport ? "bg-amber-50 text-amber-800" : "bg-teal-50 text-teal-800")}>
                          {shift.needsSupport ? "Support flagged" : "Reviewed"}
                        </span>
                      ) : shift.endedAt ? (
                        <span className="pill bg-amber-50 text-amber-800">Needs review</span>
                      ) : (
                        <span className="pill bg-slate-100 text-slate-500">Open</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Link href={`/head/shift?id=${shift.id}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-teal-700 hover:bg-teal-50">
                        Open <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 lg:hidden">
            {filtered.map((shift) => (
              <Link key={shift.id} href={`/head/shift?id=${shift.id}`} className="card flex items-center gap-3 p-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500">
                  <CalendarDays className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-800">{shift.nurseName}</span>
                  <span className="block text-[11px] text-slate-500">{formatDate(shift.startedAt)} · {shift.type} · {shift.summary ? formatPercent(shift.summary.completionRate) : "open"}</span>
                </span>
                {shift.endedAt && !shift.reviewId ? <span className="pill bg-amber-50 text-amber-800">Review</span> : null}
                <ArrowRight className="h-4 w-4 text-slate-300" />
              </Link>
            ))}
          </div>
        </>
      )}

      <p className="mt-4 text-center text-[11px] text-slate-400">
        Timestamp facts and manual ratings only. No composite nurse score or leaderboard is generated.
      </p>
    </AppShell>
  );
}
