import { useMemo } from 'react';
import { useUserStore } from '@/store/userStore';

// ─── Type ─────────────────────────────────────────────────────────────────────

export interface Approver {
  uid:          string;
  displayName:  string;
  engineerCode: string | undefined;
  email:        string;
  /** Employing organisation, e.g. "MSETCL". Null on pre-existing records. */
  organization: string | null;
}

/**
 * Display string for an approver in a picker. Organisation wins when present —
 * it is the thing that distinguishes two same-named reviewers from different
 * organisations, which is the whole reason the field exists. Falls back to
 * engineerCode and then to the bare name, so an approver with neither renders
 * exactly as it did before this field was added.
 *
 * Shared by every approver dropdown so they can never drift apart.
 */
export function approverLabel(approver: Approver): string {
  const org = approver.organization?.trim();
  if (org) return `${approver.displayName} (${org})`;
  if (approver.engineerCode) return `${approver.displayName} (${approver.engineerCode})`;
  return approver.displayName;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Derives the assignable-approver pool from the already-live Zustand
 * userStore (populated by UsersListener in Layout.tsx).
 * Filters: role in ('approver', 'admin') AND active !== false AND no deletedAt.
 * Sorted alphabetically by displayName.
 */
export function useApprovers(): { approvers: Approver[]; loading: boolean } {
  const { users, loading } = useUserStore();

  const approvers = useMemo(
    () =>
      users
        .filter(
          (u) =>
            (u.role === 'approver' || u.role === 'admin') &&
            u.active !== false &&
            !u.deletedAt,
        )
        .map((u) => ({
          uid:          u.id,
          displayName:  u.name,
          engineerCode: u.engineerCode,
          email:        u.email,
          organization: u.organization ?? null,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [users],
  );

  return { approvers, loading };
}
