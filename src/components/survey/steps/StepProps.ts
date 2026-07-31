import type { SurveyReport } from '@/types';

/** Annexure-II site master values, shown as a discrepancy hint in Step 1. */
export interface SurveyStepSiteMaster {
  totalBays: number | null;
  numPowerTransformers: number | null;
}

/**
 * Shared prop contract for every wizard step. Each step gets the FULL survey
 * object (not a narrow per-field slice) plus a patch-style onChange — task 3
 * decides exactly which fields each step reads/writes; the shell doesn't
 * pre-commit to a data-slicing shape that might not fit once real fields
 * exist.
 */
export interface SurveyStepProps {
  survey:   SurveyReport;
  onChange: (patch: Partial<SurveyReport>) => void;
  readOnly: boolean;
  /** Denormalised WorkOrder field not present on SurveyReport — Step 1 read-only display. */
  siteName: string | null;
  /** Fetched once from the parent Site doc; null while loading or if unset. Step 1 only. */
  siteMaster: SurveyStepSiteMaster | null;
  /**
   * Replaces one local://<photoId> reference with its uploaded https:// URL
   * via a functional setSurveyData update, so concurrent photo uploads (e.g.
   * selecting several at once) can never clobber each other the way a
   * precomputed-array onChange call can. Used by PhotoCapture wherever it's
   * rendered (StepPhotos, StepBays, StepDevices) — steps without photos can
   * ignore it.
   */
  onReplacePhotoRef: (oldRef: string, newRef: string) => void;
}
