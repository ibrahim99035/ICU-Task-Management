export type DemoTemplate = {
  id: string;
  name: string;
  category: "direct_care" | "indirect_care";
  tier: 1 | 2 | 3 | 4;
  intervalMin: number;
  expectedMin: number;
  offsetMin: number;
  active: boolean;
};

/** Demo content only. Every template and tier needs ICU clinical review. */
export const DEMO_TEMPLATES: DemoTemplate[] = [
  { id: "t-vent", name: "Ventilator settings check", category: "direct_care", tier: 1, intervalMin: 60, expectedMin: 10, offsetMin: 12, active: true },
  { id: "t-titration", name: "Vasoactive / sedation titration", category: "direct_care", tier: 1, intervalMin: 30, expectedMin: 10, offsetMin: 4, active: true },
  { id: "t-neuro", name: "Neuro check", category: "direct_care", tier: 2, intervalMin: 60, expectedMin: 8, offsetMin: 20, active: true },
  { id: "t-vitals", name: "Vital signs", category: "direct_care", tier: 2, intervalMin: 60, expectedMin: 8, offsetMin: 8, active: true },
  { id: "t-meds", name: "Scheduled medication round", category: "direct_care", tier: 2, intervalMin: 240, expectedMin: 20, offsetMin: 30, active: true },
  { id: "t-abg", name: "ABG sampling", category: "direct_care", tier: 2, intervalMin: 240, expectedMin: 10, offsetMin: 60, active: true },
  { id: "t-reposition", name: "Repositioning", category: "direct_care", tier: 3, intervalMin: 120, expectedMin: 10, offsetMin: 25, active: true },
  { id: "t-oral", name: "Oral care", category: "direct_care", tier: 3, intervalMin: 240, expectedMin: 10, offsetMin: 90, active: true },
  { id: "t-eye", name: "Eye care", category: "direct_care", tier: 3, intervalMin: 240, expectedMin: 8, offsetMin: 110, active: true },
  { id: "t-wound", name: "Wound dressing", category: "direct_care", tier: 3, intervalMin: 720, expectedMin: 20, offsetMin: 150, active: true },
  { id: "t-charting", name: "Charting / documentation", category: "indirect_care", tier: 4, intervalMin: 240, expectedMin: 15, offsetMin: 45, active: true },
  { id: "t-family", name: "Family update", category: "indirect_care", tier: 4, intervalMin: 240, expectedMin: 10, offsetMin: 70, active: true },
  { id: "t-supplies", name: "Supplies restock", category: "indirect_care", tier: 4, intervalMin: 480, expectedMin: 15, offsetMin: 120, active: true },
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
