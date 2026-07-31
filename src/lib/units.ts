/**
 * Formats a metre quantity as a km string with no artificial precision loss
 * (1 m = 0.001 km exactly) and no trailing zeros — e.g. 240 -> "0.24",
 * 1234 -> "1.234", 1000 -> "1". Shared by StepBoq.tsx (Km cable-length hints)
 * and SurveyPreview.tsx (cable run totals) so the two never round differently.
 */
export function formatMetresAsKm(metres: number): string {
  const trimmed = (metres / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' ? '0' : trimmed;
}
