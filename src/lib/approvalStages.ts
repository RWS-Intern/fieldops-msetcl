/**
 * Survey approval chain — the single source of truth for stage count, order
 * and labels. Nothing else in the codebase may hardcode these.
 *
 * All three stages are mechanically identical: each is owned by one user drawn
 * from the same pool (role in 'approver' | 'admin'), picked per slot by an
 * admin at work-order-creation time. There is deliberately no "internal vs
 * external" distinction anywhere in the code — MSETCL staff hold real accounts
 * on the existing `approver` role, so a stage owner is just a user.
 *
 * Fixed in code on purpose: there is no per-project stage configuration. If a
 * stage is ever added, removed or renamed, this array is the only edit — but
 * note that `approvalStages[]` on existing documents is sized and labelled
 * from this array AT CREATION TIME, so already-created surveys keep the shape
 * they were created with. Any change here needs a migration decision for
 * in-flight documents, not just a code change.
 */
export interface ApprovalStageDef {
  key:   string;
  label: string;
}

export const SURVEY_APPROVAL_STAGES: readonly ApprovalStageDef[] = [
  { key: 'approver_level_1', label: 'Approver Level 1' },
  { key: 'approver_level_2', label: 'Approver Level 2' },
  { key: 'final_approver',   label: 'Final Approver' },
] as const;

/** Number of stages in the chain — `currentStageIndex === this` means fully approved. */
export const SURVEY_APPROVAL_STAGE_COUNT = SURVEY_APPROVAL_STAGES.length;

/** Stage definition by key, or undefined for a key this build doesn't know. */
export function findApprovalStage(stageKey: string): ApprovalStageDef | undefined {
  return SURVEY_APPROVAL_STAGES.find((s) => s.key === stageKey);
}

/**
 * Label for a stage index, tolerant of an out-of-range index so display code
 * never throws on a document created under a different stage array.
 * Returns null for the "fully approved" index and anything outside the chain.
 */
export function approvalStageLabelAt(index: number): string | null {
  return SURVEY_APPROVAL_STAGES[index]?.label ?? null;
}

/**
 * The flat uid list that firestore.rules uses to grant READ to any present-or-
 * past stage owner. Semantically a set: duplicates carry no meaning (the rule
 * is an `in` check) and one person may legitimately own two stages, so they are
 * collapsed. Nulls are dropped — an unowned stage grants nobody anything.
 *
 * Single implementation so the copy written onto the WorkOrder and the copy
 * written onto its SurveyReport can never disagree — if they did, one document
 * would be readable by a stage owner and the other not.
 */
export function deriveStageOwnerUids(
  stages: readonly { ownerUid: string | null }[],
): string[] {
  const uids = stages.map((s) => s.ownerUid).filter((uid): uid is string => !!uid);
  return [...new Set(uids)];
}
