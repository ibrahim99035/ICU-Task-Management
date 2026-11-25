export const DEMO_UNITS = [
  { id: "unit-a", name: "Unit A", description: "Demo general care unit" },
  { id: "unit-b", name: "Unit B", description: "Demo step-down care unit" },
] as const;

export const DEMO_UNIT_MEMBERSHIPS: { unitId: string; nurseId: string }[] = [
  { unitId: "unit-a", nurseId: "u-nurse-1" },
  { unitId: "unit-a", nurseId: "u-nurse-2" },
  { unitId: "unit-b", nurseId: "u-nurse-2" },
  { unitId: "unit-b", nurseId: "u-nurse-3" },
];

export type DemoTemplate = {
  id: string;
  name: string;
  category: "direct_care" | "indirect_care";
  tier: 1 | 2 | 3 | 4;
  intervalMin: number;
  expectedMin: number;
  offsetMin: number;
  active: boolean;
  role: "nurse" | "head_nurse";
  scope: "bed" | "shift";
};

export const DEMO_TEMPLATES_VERSION = 3;

/**
 * Demo content only. Every template and tier needs clinical review.
 *
 * These are the only task templates in the app. They come from the agreed
 * staff-nurse and head-nurse lists. All are shift-level; there are no bed
 * task templates.
 */
export const DEMO_TEMPLATES: DemoTemplate[] = [
  // Staff nurse — 12 tasks
  { id: "t-shift-report", name: "Receive shift report from previous shift", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 15, offsetMin: 0, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-assessment", name: "Perform assessment for all patients", category: "direct_care", tier: 2, intervalMin: 0, expectedMin: 30, offsetMin: 15, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-vitals", name: "Measure vital signs for patients", category: "direct_care", tier: 2, intervalMin: 240, expectedMin: 15, offsetMin: 45, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-safety", name: "Apply appropriate safety precautions to patients", category: "direct_care", tier: 2, intervalMin: 0, expectedMin: 10, offsetMin: 60, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-adl", name: "Assist patients with activities of daily living and positioning; reposition every 2 hours if unable to change position", category: "direct_care", tier: 3, intervalMin: 120, expectedMin: 15, offsetMin: 75, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-bloods", name: "Withdraw the required blood samples for patients", category: "direct_care", tier: 2, intervalMin: 0, expectedMin: 15, offsetMin: 90, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-meds", name: "Administer routine medication", category: "direct_care", tier: 2, intervalMin: 240, expectedMin: 20, offsetMin: 105, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-emergency-time", name: "Allocate time for emergency", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 30, offsetMin: 180, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-break", name: "Take a break for rest", category: "indirect_care", tier: 4, intervalMin: 0, expectedMin: 15, offsetMin: 240, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-reassess", name: "Perform reassessment for all patients", category: "direct_care", tier: 2, intervalMin: 240, expectedMin: 20, offsetMin: 300, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-document", name: "Document all interventions and report abnormal findings to physician", category: "indirect_care", tier: 3, intervalMin: 0, expectedMin: 20, offsetMin: 360, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-handover", name: "Hand over patients' shift to incoming second shift nurse", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 20, offsetMin: 660, active: true, role: "nurse", scope: "shift" },

  // Head nurse — 14 tasks
  { id: "t-head-report", name: "Receive shift report from previous shift", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 20, offsetMin: 0, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-assign", name: "Make daily assignment for staff nurses", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 15, offsetMin: 20, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-med-request", name: "Make the medication request", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 10, offsetMin: 35, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-nutrition", name: "Make the nutrition request", category: "indirect_care", tier: 3, intervalMin: 0, expectedMin: 10, offsetMin: 45, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-stocks", name: "Receive the stocks from the store and monitor supplies", category: "indirect_care", tier: 4, intervalMin: 0, expectedMin: 20, offsetMin: 55, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-round", name: "Make the nursing round and supervise care and safety precautions", category: "indirect_care", tier: 2, intervalMin: 240, expectedMin: 30, offsetMin: 75, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-emergency", name: "Manage emergencies and urgent situations", category: "indirect_care", tier: 1, intervalMin: 0, expectedMin: 30, offsetMin: 120, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-break", name: "Take a short break and organize staff breaks with safe coverage", category: "indirect_care", tier: 4, intervalMin: 0, expectedMin: 15, offsetMin: 240, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-physician", name: "Attend the physician round and coordinate care plans", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 30, offsetMin: 270, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-infection", name: "Collect information and prepare the infection control report", category: "indirect_care", tier: 3, intervalMin: 0, expectedMin: 20, offsetMin: 300, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-documentation", name: "Check nursing documentation", category: "indirect_care", tier: 3, intervalMin: 0, expectedMin: 20, offsetMin: 330, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-appraisal", name: "Perform staff appraisal / performance evaluation", category: "indirect_care", tier: 4, intervalMin: 0, expectedMin: 30, offsetMin: 360, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-emergency-time", name: "Allocate emergency time", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 30, offsetMin: 420, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-handover", name: "Hand over shift report to the next shift", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 20, offsetMin: 660, active: true, role: "head_nurse", scope: "shift" },
];

/** Staff-nurse tasks, in the order they should appear. */
export const NURSE_TEMPLATES = DEMO_TEMPLATES.filter(
  (template) => template.role === "nurse" && template.scope === "shift" && template.active,
);

/** Head-nurse tasks, in the order they should appear. */
export const HEAD_TEMPLATES = DEMO_TEMPLATES.filter(
  (template) => template.role === "head_nurse" && template.scope === "shift" && template.active,
);
