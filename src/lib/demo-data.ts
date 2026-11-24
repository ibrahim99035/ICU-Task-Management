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

export const DEMO_TEMPLATES_VERSION = 2;

/** Demo content only. Every template and tier needs clinical review. */
export const DEMO_TEMPLATES: DemoTemplate[] = [
  { id: "t-vent", name: "Ventilator settings check", category: "direct_care", tier: 1, intervalMin: 60, expectedMin: 10, offsetMin: 12, active: true, role: "nurse", scope: "bed" },
  { id: "t-titration", name: "Vasoactive / sedation titration", category: "direct_care", tier: 1, intervalMin: 30, expectedMin: 10, offsetMin: 4, active: true, role: "nurse", scope: "bed" },
  { id: "t-neuro", name: "Neuro check", category: "direct_care", tier: 2, intervalMin: 60, expectedMin: 8, offsetMin: 20, active: true, role: "nurse", scope: "bed" },
  { id: "t-vitals", name: "Vital signs", category: "direct_care", tier: 2, intervalMin: 60, expectedMin: 8, offsetMin: 8, active: true, role: "nurse", scope: "bed" },
  { id: "t-meds", name: "Scheduled medication round", category: "direct_care", tier: 2, intervalMin: 240, expectedMin: 20, offsetMin: 30, active: true, role: "nurse", scope: "bed" },
  { id: "t-abg", name: "ABG sampling", category: "direct_care", tier: 2, intervalMin: 240, expectedMin: 10, offsetMin: 60, active: true, role: "nurse", scope: "bed" },
  { id: "t-reposition", name: "Repositioning", category: "direct_care", tier: 3, intervalMin: 120, expectedMin: 10, offsetMin: 25, active: true, role: "nurse", scope: "bed" },
  { id: "t-oral", name: "Oral care", category: "direct_care", tier: 3, intervalMin: 240, expectedMin: 10, offsetMin: 90, active: true, role: "nurse", scope: "bed" },
  { id: "t-eye", name: "Eye care", category: "direct_care", tier: 3, intervalMin: 240, expectedMin: 8, offsetMin: 110, active: true, role: "nurse", scope: "bed" },
  { id: "t-wound", name: "Wound dressing", category: "direct_care", tier: 3, intervalMin: 720, expectedMin: 20, offsetMin: 150, active: true, role: "nurse", scope: "bed" },
  { id: "t-charting", name: "Charting / documentation", category: "indirect_care", tier: 4, intervalMin: 240, expectedMin: 15, offsetMin: 45, active: true, role: "nurse", scope: "bed" },
  { id: "t-family", name: "Family update", category: "indirect_care", tier: 4, intervalMin: 240, expectedMin: 10, offsetMin: 70, active: true, role: "nurse", scope: "bed" },
  { id: "t-supplies", name: "Supplies restock", category: "indirect_care", tier: 4, intervalMin: 480, expectedMin: 15, offsetMin: 120, active: true, role: "nurse", scope: "bed" },

  { id: "t-shift-report", name: "Receive shift report", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 15, offsetMin: 0, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-assessment", name: "Assessment for all patients", category: "direct_care", tier: 2, intervalMin: 0, expectedMin: 30, offsetMin: 15, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-vitals", name: "Vital signs", category: "direct_care", tier: 2, intervalMin: 240, expectedMin: 15, offsetMin: 45, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-safety", name: "Safety precautions", category: "direct_care", tier: 2, intervalMin: 0, expectedMin: 10, offsetMin: 60, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-adl", name: "ADL and positioning", category: "direct_care", tier: 3, intervalMin: 120, expectedMin: 15, offsetMin: 75, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-bloods", name: "Blood samples", category: "direct_care", tier: 2, intervalMin: 0, expectedMin: 15, offsetMin: 90, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-meds", name: "Routine medication", category: "direct_care", tier: 2, intervalMin: 240, expectedMin: 20, offsetMin: 105, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-emergency-time", name: "Allocate time for emergency", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 30, offsetMin: 180, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-break", name: "Break for rest", category: "indirect_care", tier: 4, intervalMin: 0, expectedMin: 15, offsetMin: 240, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-reassess", name: "Reassessment for all patients", category: "direct_care", tier: 2, intervalMin: 240, expectedMin: 20, offsetMin: 300, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-document", name: "Document interventions and report abnormal findings", category: "indirect_care", tier: 3, intervalMin: 0, expectedMin: 20, offsetMin: 360, active: true, role: "nurse", scope: "shift" },
  { id: "t-shift-handover", name: "Hand over patients to incoming nurse", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 20, offsetMin: 660, active: true, role: "nurse", scope: "shift" },

  { id: "t-head-report", name: "Receive shift report from previous shift", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 20, offsetMin: 0, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-assign", name: "Daily assignment for staff nurses", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 15, offsetMin: 20, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-med-request", name: "Medication request", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 10, offsetMin: 35, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-nutrition", name: "Nutrition request", category: "indirect_care", tier: 3, intervalMin: 0, expectedMin: 10, offsetMin: 45, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-stocks", name: "Receive stocks and monitor supplies", category: "indirect_care", tier: 4, intervalMin: 0, expectedMin: 20, offsetMin: 55, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-round", name: "Nursing round and safety supervision", category: "indirect_care", tier: 2, intervalMin: 240, expectedMin: 30, offsetMin: 75, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-emergency", name: "Manage emergencies and urgent situations", category: "indirect_care", tier: 1, intervalMin: 0, expectedMin: 30, offsetMin: 120, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-break", name: "Short break with safe coverage", category: "indirect_care", tier: 4, intervalMin: 0, expectedMin: 15, offsetMin: 240, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-physician", name: "Physician round and care coordination", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 30, offsetMin: 270, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-infection", name: "Infection control report", category: "indirect_care", tier: 3, intervalMin: 0, expectedMin: 20, offsetMin: 300, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-documentation", name: "Check nursing documentation", category: "indirect_care", tier: 3, intervalMin: 0, expectedMin: 20, offsetMin: 330, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-appraisal", name: "Staff appraisal / performance evaluation", category: "indirect_care", tier: 4, intervalMin: 0, expectedMin: 30, offsetMin: 360, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-emergency-time", name: "Allocate emergency time", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 30, offsetMin: 420, active: true, role: "head_nurse", scope: "shift" },
  { id: "t-head-handover", name: "Hand over shift report to next shift", category: "indirect_care", tier: 2, intervalMin: 0, expectedMin: 20, offsetMin: 660, active: true, role: "head_nurse", scope: "shift" },
];

export type DemoBed = {
  id: string;
  label: string;
  alias: string;
  templateIds: string[];
};

/** Never store patient names or identifiers in a bed alias. */
export const DEMO_BEDS: DemoBed[] = [
  { id: "bed-1", label: "Bed 1", alias: "Bed 1, post-op", templateIds: ["t-vitals", "t-meds", "t-abg", "t-reposition", "t-wound", "t-charting", "t-family"] },
  { id: "bed-2", label: "Bed 2", alias: "Bed 2, respiratory", templateIds: ["t-vent", "t-titration", "t-vitals", "t-abg", "t-reposition", "t-oral", "t-charting"] },
  { id: "bed-3", label: "Bed 3", alias: "Bed 3, neuro", templateIds: ["t-neuro", "t-vitals", "t-meds", "t-reposition", "t-eye", "t-charting", "t-family"] },
  { id: "bed-4", label: "Bed 4", alias: "Bed 4, cardiac", templateIds: ["t-titration", "t-vitals", "t-meds", "t-abg", "t-charting", "t-supplies"] },
  { id: "bed-5", label: "Bed 5", alias: "Bed 5, isolation", templateIds: ["t-vent", "t-vitals", "t-meds", "t-oral", "t-wound", "t-charting", "t-supplies"] },
  { id: "bed-6", label: "Bed 6", alias: "Bed 6, admission", templateIds: ["t-neuro", "t-vitals", "t-meds", "t-reposition", "t-family", "t-charting", "t-supplies"] },
];
