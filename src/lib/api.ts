"use client";

import type { DomainEvent, ShiftSummary, Unit } from "@/domain";
import type { HandoverSnapshot } from "@/domain";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
  return `${base}/api`;
}

async function apiFetch<T>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = options;
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(rest.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Your work is saved on this device.");
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep default */
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export type LoginResponse = {
  token: string;
  user: {
    id: string;
    username: string;
    role: "nurse" | "head_nurse";
    displayName: string;
    participantCode: string;
  };
  expiresInSec: number;
};

export async function loginRequest(username: string, pin: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, pin }),
  });
}

export async function registerRequest(
  username: string,
  displayName: string,
  pin: string,
): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, displayName, pin }),
  });
}

export type NurseOption = {
  id: string;
  username: string;
  displayName: string;
  participantCode: string;
};

export type UnitDetail = { unit: Unit; nurses: NurseOption[] };

export async function fetchUnits(token: string): Promise<{ units: Unit[] }> {
  return apiFetch("/units", { token });
}

export async function createUnit(
  token: string,
  input: { name: string; description?: string },
): Promise<{ unit: Unit }> {
  return apiFetch("/units", { method: "POST", token, body: JSON.stringify(input) });
}

export async function fetchUnit(token: string, id: string): Promise<UnitDetail> {
  return apiFetch(`/units/${encodeURIComponent(id)}`, { token });
}

export async function updateUnit(
  token: string,
  id: string,
  input: { name?: string; description?: string; status?: "active" | "inactive" },
): Promise<{ unit: Unit }> {
  return apiFetch(`/units/${encodeURIComponent(id)}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(input),
  });
}

export async function deleteUnit(token: string, id: string): Promise<{ deleted: string }> {
  return apiFetch(`/units/${encodeURIComponent(id)}`, { method: "DELETE", token });
}

export async function fetchNurses(token: string): Promise<{ nurses: NurseOption[] }> {
  return apiFetch("/nurses", { token });
}

export async function assignNurses(token: string, id: string, nurseIds: string[]): Promise<{ assigned: number }> {
  return apiFetch(`/units/${encodeURIComponent(id)}/nurses`, {
    method: "POST",
    token,
    body: JSON.stringify({ nurseIds }),
  });
}

export async function removeNurse(token: string, id: string, nurseId: string): Promise<{ removed: string }> {
  return apiFetch(`/units/${encodeURIComponent(id)}/nurses/${encodeURIComponent(nurseId)}`, {
    method: "DELETE",
    token,
  });
}

export async function pushEventsRequest(token: string, events: DomainEvent[]) {
  return apiFetch<{ accepted: string[]; inserted: number; duplicates: number }>("/sync/push", {
    method: "POST",
    token,
    body: JSON.stringify({ events }),
  });
}

export type PullResponse = {
  cursor: number;
  templates: {
    id: string;
    name: string;
    category: "direct_care" | "indirect_care";
    tier: 1 | 2 | 3 | 4;
    intervalMin: number;
    expectedMin: number;
    offsetMin: number;
    active: boolean;
  }[];
  config: Record<string, unknown> | null;
  units: Unit[];
  shifts: {
    id: string;
    userId: string;
    type: string;
    unitId: string | null;
    unitName: string | null;
    startedAt: number;
    endedAt: number | null;
    summary: unknown;
  }[];
  beds: { id: string; shiftId: string; label: string; alias: string }[];
  events: (DomainEvent & { serverSeq?: number })[];
  reviews: {
    id: string;
    shiftId: string;
    scores: Record<string, number>;
    comment: string;
    needsSupport: boolean;
    createdAt: number;
  }[];
  handovers: {
    id: string;
    shiftId: string;
    bedId: string;
    snapshot: HandoverSnapshot;
    createdAt: number;
  }[];
};

export async function pullRequest(token: string, cursor: number): Promise<PullResponse> {
  return apiFetch<PullResponse>(`/sync/pull?cursor=${encodeURIComponent(cursor)}`, { token });
}

export async function postSummary(token: string, shiftId: string): Promise<{ summary: ShiftSummary }> {
  return apiFetch(`/shifts/${encodeURIComponent(shiftId)}/summary`, { method: "POST", token });
}

export async function postHandover(
  token: string,
  input: { id: string; shiftId: string; bedId: string; snapshot: HandoverSnapshot; note: string; createdAt: number },
) {
  return apiFetch<{ accepted: string }>("/handovers", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export async function postReview(
  token: string,
  input: {
    id: string;
    shiftId: string;
    scores: {
      completion: number;
      critical_timeliness: number;
      interruption_handling: number;
      handover_quality: number;
      documentation: number;
    };
    comment: string;
    needsSupport: boolean;
    createdAt: number;
  },
) {
  return apiFetch<{ accepted: string }>("/reviews", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export async function postSurvey(
  token: string,
  input: { id: string; instrument: "SUS" | "TLX"; phase: "paper" | "app"; answers: number[]; takenAt: number },
) {
  return apiFetch<{ accepted: string; score: number }>("/surveys", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export type HeadShift = {
  id: string;
  userId: string;
  type: string;
  unitId: string | null;
  unitName: string | null;
  startedAt: number;
  endedAt: number | null;
  summary: ShiftSummary | null;
  nurseName: string;
  participantCode: string;
  reviewId: string | null;
  needsSupport: boolean | null;
};

export async function fetchShifts(
  token: string,
  filters: { nurseId?: string; from?: string; to?: string; unitId?: string } = {},
): Promise<{ shifts: HeadShift[] }> {
  const params = new URLSearchParams();
  if (filters.nurseId) params.set("nurseId", filters.nurseId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.unitId) params.set("unitId", filters.unitId);
  return apiFetch(`/shifts?${params.toString()}`, { token });
}

export type ShiftDetail = {
  shift: HeadShift & { nurseName: string; participantCode: string };
  events: (DomainEvent & { serverTs: number; serverSeq: number })[];
  beds: { id: string; shiftId: string; label: string; alias: string }[];
  handovers: { id: string; shiftId: string; bedId: string; snapshot: HandoverSnapshot; createdAt: number }[];
  review: {
    id: string;
    scores: Record<string, number>;
    comment: string;
    needsSupport: boolean;
    createdAt: number;
  } | null;
};

export async function fetchShiftDetail(token: string, id: string): Promise<ShiftDetail> {
  return apiFetch(`/shifts/${encodeURIComponent(id)}`, { token });
}

export type UnitAnalytics = {
  days: number;
  shifts: number;
  avgDirectCareMin: number;
  avgIndirectCareMin: number;
  avgInterruptionMin: number;
  avgEmergencyMin: number;
  avgCompletionRate: number;
  avgTier12OnTimeRate: number;
  totalMissed: number;
  totalDeferred: number;
  topInterruptions: { reason: string; label: string; count: number; minutes: number }[];
};

export async function fetchAnalytics(token: string, days = 30, unitId?: string): Promise<UnitAnalytics> {
  const params = new URLSearchParams({ days: String(days) });
  if (unitId) params.set("unitId", unitId);
  return apiFetch(`/analytics/unit?${params.toString()}`, { token });
}

export async function fetchMyReviews(token: string): Promise<{
  reviews: {
    id: string;
    shiftId: string;
    scores: Record<string, number>;
    comment: string;
    needsSupport: boolean;
    createdAt: number;
    reviewerName: string;
    shiftStartedAt: number;
  }[];
}> {
  return apiFetch("/reviews/mine", { token });
}

export async function downloadExport(
  token: string,
  type: "events" | "summaries" | "surveys" | "reviews",
  unitId?: string,
): Promise<Blob> {
  const params = new URLSearchParams({ type });
  if (unitId) params.set("unitId", unitId);
  const response = await fetch(`${apiBase()}/export?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new ApiError(response.status, "Export failed");
  return response.blob();
}
