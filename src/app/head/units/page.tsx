"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Building2,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, InlineAlert, Spinner } from "@/components/ui";
import {
  assignNurses,
  createUnit,
  deleteUnit,
  fetchNurses,
  fetchUnit,
  fetchUnits,
  removeNurse,
  updateUnit,
  type NurseOption,
} from "@/lib/api";
import type { Unit } from "@/domain";
import { cn } from "@/lib/format";
import { useApp } from "@/lib/store";

export default function HeadUnitsPage() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const token = useApp((s) => s.token);
  const online = useApp((s) => s.online);
  const notify = useApp((s) => s.notify);

  const [units, setUnits] = useState<Unit[]>([]);
  const [nurses, setNurses] = useState<NurseOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [initialAssigned, setInitialAssigned] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user && user.role !== "head_nurse") router.replace("/tasks");
    if (!user) router.replace("/login");
  }, [user, router]);

  const load = useCallback(async () => {
    if (!token || user?.role !== "head_nurse") return;
    setLoading(true);
    setError("");
    try {
      const [unitResult, nurseResult] = await Promise.all([fetchUnits(token), fetchNurses(token)]);
      setUnits(unitResult.units);
      setNurses(nurseResult.nurses);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load units");
    } finally {
      setLoading(false);
    }
  }, [token, user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = units.find((unit) => unit.id === selectedId) ?? null;

  const openUnit = useCallback(
    async (unit: Unit) => {
      if (!token) return;
      setSelectedId(unit.id);
      setName(unit.name);
      setDescription(unit.description);
      setBusy("detail");
      setError("");
      try {
        const detail = await fetchUnit(token, unit.id);
        const ids = new Set(detail.nurses.map((nurse) => nurse.id));
        setAssigned(ids);
        setInitialAssigned(ids);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load unit details");
      } finally {
        setBusy("");
      }
    },
    [token],
  );

  async function create() {
    if (!token || !newName.trim()) return;
    setBusy("create");
    setError("");
    try {
      const result = await createUnit(token, {
        name: newName.trim(),
        description: newDescription.trim(),
      });
      setNewName("");
      setNewDescription("");
      await load();
      await openUnit(result.unit);
      notify(`${result.unit.name} created.`, "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create unit");
    } finally {
      setBusy("");
    }
  }

  async function saveDetails() {
    if (!token || !selected) return;
    setBusy("details");
    setError("");
    try {
      await updateUnit(token, selected.id, { name: name.trim(), description: description.trim() });
      await load();
      notify("Unit details saved.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save unit");
    } finally {
      setBusy("");
    }
  }

  async function toggleStatus() {
    if (!token || !selected) return;
    const status = selected.status === "active" ? "inactive" : "active";
    setBusy("status");
    setError("");
    try {
      await updateUnit(token, selected.id, { status });
      await load();
      notify(status === "active" ? "Unit restored." : "Unit archived.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update unit");
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    if (!token || !selected) return;
    if (!window.confirm(`Delete ${selected.name}? This only works if the unit has no shifts.`)) return;
    setBusy("delete");
    setError("");
    try {
      await deleteUnit(token, selected.id);
      setSelectedId("");
      setName("");
      setDescription("");
      setAssigned(new Set());
      setInitialAssigned(new Set());
      await load();
      notify("Unit deleted.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete unit");
    } finally {
      setBusy("");
    }
  }

  async function saveAssignments() {
    if (!token || !selected) return;
    setBusy("assign");
    setError("");
    try {
      const added = [...assigned].filter((id) => !initialAssigned.has(id));
      const removed = [...initialAssigned].filter((id) => !assigned.has(id));
      if (added.length) await assignNurses(token, selected.id, added);
      for (const nurseId of removed) await removeNurse(token, selected.id, nurseId);
      setInitialAssigned(new Set(assigned));
      notify("Nurse assignments saved.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save assignments");
    } finally {
      setBusy("");
    }
  }

  const visibleNurses = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return nurses;
    return nurses.filter((nurse) =>
      `${nurse.displayName} ${nurse.username} ${nurse.participantCode}`.toLowerCase().includes(text),
    );
  }, [nurses, query]);

  const assignmentsChanged = useMemo(() => {
    if (assigned.size !== initialAssigned.size) return true;
    return [...assigned].some((id) => !initialAssigned.has(id));
  }, [assigned, initialAssigned]);

  if (!user) return null;

  return (
    <AppShell
      title="Units"
      subtitle="Create units and assign nurses. A shift belongs to one unit."
      activeOverride="/head/units"
      actions={
        <button className="btn-ghost hidden h-9 px-2 text-xs sm:inline-flex" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </button>
      }
    >
      {!online ? (
        <div className="mb-4">
          <InlineAlert tone="warning" title="Unit management needs a connection">
            <p>Head-nurse configuration is online-only. Nurse logging stays available offline.</p>
          </InlineAlert>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4">
          <InlineAlert tone="danger" title="Unit change failed">
            <p>{error}</p>
          </InlineAlert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.4fr]">
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-base font-bold text-ink">
              <Plus className="h-4 w-4 text-teal-600" /> Create unit
            </h2>
            <div className="mt-3 space-y-3">
              <div>
                <label className="label" htmlFor="new-unit-name">Name</label>
                <input
                  id="new-unit-name"
                  className="input"
                  value={newName}
                  maxLength={80}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="e.g. Unit C"
                />
              </div>
              <div>
                <label className="label" htmlFor="new-unit-description">Description</label>
                <input
                  id="new-unit-description"
                  className="input"
                  value={newDescription}
                  maxLength={240}
                  onChange={(event) => setNewDescription(event.target.value)}
                  placeholder="Optional short description"
                />
              </div>
              <p className="text-[11px] leading-relaxed text-amber-700">
                Do not type patient names, MRNs or other identifiers.
              </p>
              <button className="btn-primary w-full" onClick={() => void create()} disabled={!newName.trim() || Boolean(busy)}>
                {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create unit
              </button>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 p-4">
              <h2 className="flex items-center gap-2 text-base font-bold text-ink">
                <Building2 className="h-4 w-4 text-teal-600" /> Unit list
              </h2>
            </div>
            {loading && !units.length ? (
              <Spinner label="Loading units…" />
            ) : units.length ? (
              <ul className="divide-y divide-slate-100">
                {units.map((unit) => (
                  <li key={unit.id}>
                    <button
                      onClick={() => void openUnit(unit)}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50",
                        selectedId === unit.id && "bg-teal-50/60",
                      )}
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-50 text-teal-700">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-slate-800">{unit.name}</span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {unit.description || "No description"}
                        </span>
                      </span>
                      <span className={cn("pill", unit.status === "active" ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-500")}>
                        {unit.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4">
                <EmptyState
                  icon={<Building2 className="h-6 w-6" />}
                  title="No units yet"
                  body="Create the first unit, then assign nurses to it."
                />
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4">
          {!selected ? (
            <section className="card p-6">
              <EmptyState
                icon={<Building2 className="h-6 w-6" />}
                title="Select a unit"
                body="Choose a unit to edit its details and nurse assignments."
              />
            </section>
          ) : (
            <>
              <section className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-ink">{selected.name}</h2>
                  <span className={cn("pill", selected.status === "active" ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-500")}>
                    {selected.status}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="unit-name">Name</label>
                    <input id="unit-name" className="input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="unit-description">Description</label>
                    <input id="unit-description" className="input" value={description} maxLength={240} onChange={(event) => setDescription(event.target.value)} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-primary" onClick={() => void saveDetails()} disabled={!name.trim() || Boolean(busy)}>
                    {busy === "details" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save details
                  </button>
                  <button className="btn-secondary" onClick={() => void toggleStatus()} disabled={Boolean(busy)}>
                    {selected.status === "active" ? <Archive className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                    {selected.status === "active" ? "Archive" : "Restore"}
                  </button>
                  <button className="btn-secondary text-danger-700" onClick={() => void remove()} disabled={Boolean(busy)}>
                    <Trash2 className="h-4 w-4" /> Delete unused
                  </button>
                </div>
              </section>

              <section className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="flex items-center gap-2 text-base font-bold text-ink">
                      <Users className="h-4 w-4 text-teal-600" /> Assigned nurses
                    </h2>
                    <p className="text-xs text-slate-500">A nurse can belong to more than one unit.</p>
                  </div>
                  <span className="pill bg-slate-100 text-slate-600">{assigned.size} selected</span>
                </div>
                <div className="relative mt-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    className="input pl-9"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search nurses by name, username or code"
                  />
                </div>
                <div className="mt-3 max-h-80 space-y-1 overflow-y-auto pr-1">
                  {visibleNurses.map((nurse) => {
                    const checked = assigned.has(nurse.id);
                    return (
                      <label key={nurse.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className="h-5 w-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          checked={checked}
                          onChange={(event) =>
                            setAssigned((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(nurse.id);
                              else next.delete(nurse.id);
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-800">{nurse.displayName}</span>
                          <span className="block text-[11px] text-slate-500">{nurse.username} · {nurse.participantCode}</span>
                        </span>
                      </label>
                    );
                  })}
                  {!visibleNurses.length ? <p className="py-4 text-sm text-slate-500">No nurse matches that search.</p> : null}
                </div>
                <button className="btn-primary mt-3 w-full" onClick={() => void saveAssignments()} disabled={!assignmentsChanged || Boolean(busy)}>
                  {busy === "assign" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save assignments
                </button>
              </section>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
