import { z } from "zod";

export const susAnswerSchema = z.array(z.number().int().min(1).max(5)).length(10);
export const tlxSliderSchema = z.array(z.number().min(0).max(100)).length(6);

/**
 * System Usability Scale. Odd items are positive (value - 1), even items are
 * negative (5 - value). The raw total is multiplied by 2.5.
 */
export function scoreSUS(answers: number[]): number {
  const parsed = susAnswerSchema.parse(answers);
  const total = parsed.reduce((sum, value, index) => {
    return sum + (index % 2 === 0 ? value - 1 : 5 - value);
  }, 0);
  return total * 2.5;
}

/**
 * Raw (unweighted) NASA-TLX. The brief explicitly excludes the weighted
 * version, so this is the arithmetic mean of six 0-100 scales.
 */
export function scoreRawTLX(sliders: number[]): number {
  const parsed = tlxSliderSchema.parse(sliders);
  return parsed.reduce((sum, value) => sum + value, 0) / parsed.length;
}
