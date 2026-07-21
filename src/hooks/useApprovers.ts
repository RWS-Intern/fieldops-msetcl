import { useMemo } from 'react';
import { useUserStore } from '@/store/userStore';

// ─── Type ─────────────────────────────────────────────────────────────────────

export interface Approver {
  uid:          string;
  displayName:  string;
  engineerCode: string | undefined;
  email:        string;
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
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [users],
  );

  return { approvers, loading };
}
