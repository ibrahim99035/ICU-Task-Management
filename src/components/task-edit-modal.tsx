"use client";

import { useEffect, useState } from "react";
import { Pencil, Save } from "lucide-react";
import {
  CATEGORY_LABELS,
  TIER_LABELS,
  isTaskEditable,
  type Task,
  type TaskEditPatch,
  type Tier,
} from "@/domain";
import { fromDateTimeLocal, toDateTimeLocal } from "@/lib/format";
import { Modal } from "./modal";

export function TaskEditModal({
  task,
  open,
  onClose,
  onSave,
}: {
  task?: Task | null;
  open: boolean;
  onClose: () => void;
  onSave: (patch: TaskEditPatch) => Promise<void> | void;
}) {
  const [title, setTitle] = useState("");
  const [tier, setTier] = useState<Tier>(3);
  const [category, setCategory] = useState<"direct_care" | "indirect_care">("direct_care");
  const [plannedFrom, setPlannedFrom] = useState("");
  const [plannedTo, setPlannedTo] = useState("");
  const [expectedMin, setExpectedMin] = useState(10);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!task || !open) return;
    setTitle(task.title);
    setTier(task.tier);
    setCategory(task.category);
    setPlannedFrom(toDateTimeLocal(task.plannedFrom));
    setPlannedTo(toDateTimeLocal(task.plannedTo));
    setExpectedMin(task.expectedMin);
    setNote(task.note ?? "");
    setError("");
    setBusy(false);
  }, [task?.id, open]);

  if (!task) return null;

  const editable = isTaskEditable(task.status);
  const from = fromDateTimeLocal(plannedFrom);
  const to = fromDateTimeLocal(plannedTo);
  const invalidTime = !Number.isFinite(from) || !Number.isFinite(to) || to < from;
  const invalid = !title.trim() || invalidTime || expectedMin < 0 || expectedMin > 720;

  async function save() {
    if (invalid || !editable) return;
    setBusy(true);
    setError("");
    try {
      await onSave({
        title: title.trim(),
        tier,
        category,
        plannedFrom: from,
        plannedTo: to,
        expectedMin,
        note,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Edit task"
      description={
        editable
          ? "Change the task details or add a note. The change is appended to the event log; if two people edit, the latest event wins."
          : "This task is finished and cannot be altered."
      }
      footer={
        <>
          <button className="btn-secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" type="button" onClick={() => void save()} disabled={busy || invalid || !editable}>
            <Save className="h-4 w-4" /> {busy ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="pill bg-slate-100 capitalize text-slate-600">{task.status.replace("_", " ")}</span>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700">
          <Pencil className="h-3.5 w-3.5" /> Auditable edit
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="task-edit-title">Title</label>
          <input
            id="task-edit-title"
            className="input"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!editable}
          />
        </div>

        <div>
          <label className="label" htmlFor="task-edit-tier">Tier</label>
          <select
            id="task-edit-tier"
            className="input"
            value={tier}
            onChange={(event) => setTier(Number(event.target.value) as Tier)}
            disabled={!editable}
          >
            {([1, 2, 3, 4] as const).map((value) => (
              <option key={value} value={value}>
                Tier {value} · {TIER_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="task-edit-category">Category</label>
          <select
            id="task-edit-category"
            className="input"
            value={category}
            onChange={(event) => setCategory(event.target.value as "direct_care" | "indirect_care")}
            disabled={!editable}
          >
            <option value="direct_care">{CATEGORY_LABELS.direct_care}</option>
            <option value="indirect_care">{CATEGORY_LABELS.indirect_care}</option>
          </select>
        </div>

        <div>
          <label className="label" htmlFor="task-edit-from">Planned start</label>
          <input
            id="task-edit-from"
            type="datetime-local"
            className="input"
            value={plannedFrom}
            onChange={(event) => setPlannedFrom(event.target.value)}
            disabled={!editable}
          />
        </div>

        <div>
          <label className="label" htmlFor="task-edit-to">Planned end</label>
          <input
            id="task-edit-to"
            type="datetime-local"
            className="input"
            value={plannedTo}
            onChange={(event) => setPlannedTo(event.target.value)}
            disabled={!editable}
          />
        </div>

        <div>
          <label className="label" htmlFor="task-edit-expected">Expected minutes</label>
          <input
            id="task-edit-expected"
            type="number"
            className="input"
            min={0}
            max={720}
            value={expectedMin}
            onChange={(event) => setExpectedMin(Number(event.target.value))}
            disabled={!editable}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="task-edit-note">Note for unfinished task</label>
          <textarea
            id="task-edit-note"
            className="input min-h-24 resize-y"
            value={note}
            maxLength={300}
            placeholder="Short context for the next nurse. No patient names, MRNs or other identifiers."
            onChange={(event) => setNote(event.target.value)}
            disabled={!editable}
          />
          <p className="mt-1 text-[11px] text-slate-400">{note.length}/300 · visible in the task and handover.</p>
        </div>
      </div>

      {invalidTime ? (
        <p className="mt-2 rounded-xl bg-danger-50 px-3 py-2 text-xs font-semibold text-danger-700">
          The planned end must be on or after the planned start.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-xl bg-danger-50 px-3 py-2 text-xs font-semibold text-danger-700">{error}</p>
      ) : null}
    </Modal>
  );
}
