"use client";

import { useState } from "react";
import {
  AlarmClock,
  Boxes,
  HelpCircle,
  Radio,
  Stethoscope,
  UserRound,
  UsersRound,
  Siren,
} from "lucide-react";
import { INTERRUPTION_LABELS, INTERRUPTION_REASONS, type InterruptionReason, type Task } from "@/domain";
import { startInterruption } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { Modal } from "./modal";

const ICONS: Record<InterruptionReason, typeof Radio> = {
  physician_request: Stethoscope,
  missing_equipment: Boxes,
  family_visitor: UsersRound,
  other_staff: UserRound,
  alarm_device: AlarmClock,
  emergency: Siren,
  other: HelpCircle,
};

export function InterruptionSheet({
  open,
  onClose,
  task,
  bedId,
  beds = [],
}: {
  open: boolean;
  onClose: () => void;
  task?: Task;
  bedId?: string;
  beds?: { id: string; alias: string }[];
}) {
  const notify = useApp((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const [selectedBed, setSelectedBed] = useState(bedId ?? beds[0]?.id ?? "");

  async function choose(reason: InterruptionReason) {
    if (!task && !selectedBed) return;
    setBusy(true);
    try {
      await startInterruption(reason, task?.bedId ?? selectedBed, task?.id);
      notify("Interruption started. The timer is paused until you end it.", "warning");
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not start interruption", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log an interruption"
      description={
        task
          ? `This pauses “${task.title}” and starts an interruption clock. End it when you are back.`
          : "Choose a reason to start an interruption clock. End it when you are back."
      }
    >
      {!task && beds.length > 0 ? (
        <div className="mb-4">
          <label className="label" htmlFor="interruption-bed">
            Bed
          </label>
          <select
            id="interruption-bed"
            className="input"
            value={selectedBed}
            onChange={(e) => setSelectedBed(e.target.value)}
          >
            {beds.map((bed) => (
              <option key={bed.id} value={bed.id}>
                {bed.alias}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {INTERRUPTION_REASONS.map((reason) => {
          const Icon = ICONS[reason];
          return (
            <button
              key={reason}
              onClick={() => void choose(reason)}
              disabled={busy}
              className="flex min-h-[64px] items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:border-teal-300 hover:bg-teal-50 disabled:opacity-50"
            >
              <Icon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              {INTERRUPTION_LABELS[reason]}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Reasons are fixed presets for the demo so interruption totals stay comparable. Do not type patient
        identifiers into any note.
      </p>
    </Modal>
  );
}
