import { useMemo } from 'react';
import { useUserStore } from '@/store/userStore';

// ─── Type ─────────────────────────────────────────────────────────────────────

export interface FieldEngineer {
  uid:          string;
  displayName:  string;
  engineerCode: string | undefined;
  email:        string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Derives the list of active field engineers from the already-live Zustand
 * userStore (populated by UsersListener in Layout.tsx).
 * Filters: role === 'field' AND active !== false AND no deletedAt.
 * Sorted alphabetically by displayName.
 */
export function useFieldEngineers(): { engineers: FieldEngineer[]; loading: boolean } {
  const { users, loading } = useUserStore();

  const engineers = useMemo(
    () =>
      users
        .filter(
          (u) =>
            u.role === 'field' &&
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

  return { engineers, loading };
}
