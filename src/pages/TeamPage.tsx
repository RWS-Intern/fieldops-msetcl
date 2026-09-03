import { useState, useMemo } from 'react';
import { Search, UserPlus, Download } from 'lucide-react';
import { useUserStore } from '@/store/userStore';
import { useUserActions } from '@/hooks/useUserActions';
import { useAuthStore } from '@/store/authStore';
import { UserCard }              from '@/components/team/UserCard';
import { EditUserModal }         from '@/components/team/EditUserModal';
import { CreateUserModal }       from '@/components/team/CreateUserModal';
import { EngineerDetailDrawer }  from '@/components/team/EngineerDetailDrawer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button }   from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { User } from '@/types';

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportEngineersCsv(users: User[]): void {
  const headers = ['Name', 'Engineer Code', 'Email', 'Role', 'Status'].join(',');
  const rows = users.map((u) =>
    [
      `"${u.name  ?? ''}"`,
      `"${u.engineerCode ?? ''}"`,
      `"${u.email ?? ''}"`,
      `"${u.role  ?? ''}"`,
      `"${u.active === false ? 'Disabled' : 'Active'}"`,
    ].join(',')
  );
  const csv  = [headers, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'engineers.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'admin' | 'approver' | 'field' | 'viewer' | 'disabled';

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all',      label: 'All'             },
  { key: 'admin',    label: 'Admins'          },
  { key: 'approver', label: 'Approvers'       },
  { key: 'field',    label: 'Field Engineers' },
  { key: 'viewer',   label: 'Viewers'         },
  { key: 'disabled', label: 'Disabled'        },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function TeamPage() {
  const { users, loading } = useUserStore();
  const { currentUser }    = useAuthStore();
  const { setUserActive }  = useUserActions();

  // Only an admin manages accounts. A viewer gets the same list (and the CSV
  // export) with Add User / Edit / Disable simply not rendered.
  const canManageUsers = currentUser?.role === 'admin';

  const [search,         setSearch]         = useState('');
  const [activeTab,      setActiveTab]      = useState<FilterTab>('all');
  const [editUser,       setEditUser]       = useState<User | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [viewEngineer,   setViewEngineer]   = useState<User | null>(null);
  // Confirm dialog state
  const [confirmUser, setConfirmUser] = useState<User | null>(null);
  const [confirming,  setConfirming]  = useState(false);

  // ── Filtered list ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();

    return users.filter((u) => {
      if (activeTab === 'admin'    && u.role !== 'admin')    return false;
      if (activeTab === 'approver' && u.role !== 'approver') return false;
      if (activeTab === 'field'    && u.role !== 'field')    return false;
      if (activeTab === 'viewer'   && u.role !== 'viewer')   return false;
      if (activeTab === 'disabled' && u.active)           return false;
      if (activeTab !== 'disabled' && !u.active)          return false;

      if (q) {
        return (
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [users, activeTab, search]);

  // ── Counts for tab badges ───────────────────────────────────────────────────
  const counts = useMemo(() => ({
    all:      users.filter((u) => u.active).length,
    admin:    users.filter((u) => u.role === 'admin' && u.active).length,
    approver: users.filter((u) => u.role === 'approver' && u.active).length,
    field:    users.filter((u) => u.role === 'field' && u.active).length,
    viewer:   users.filter((u) => u.role === 'viewer' && u.active).length,
    disabled: users.filter((u) => !u.active).length,
  }), [users]);

  // ── Confirm toggle handler ──────────────────────────────────────────────────
  function requestToggleActive(user: User) { setConfirmUser(user); }

  async function confirmToggleActive() {
    if (!confirmUser || !currentUser) return;
    setConfirming(true);
    try {
      await setUserActive(confirmUser.id, !confirmUser.active, currentUser.uid);
    } finally {
      setConfirming(false);
      setConfirmUser(null);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-0.5">Engineers</h2>
          <p className="text-sm text-gray-500">
            {loading
              ? 'Loading…'
              : `${counts.all} active member${counts.all !== 1 ? 's' : ''}${counts.disabled ? `, ${counts.disabled} disabled` : ''}`
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => exportEngineersCsv(filtered)}
            className="flex items-center gap-1.5"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          {canManageUsers && (
            <Button
              onClick={() => setShowCreateUser(true)}
              className="flex items-center gap-1.5"
            >
              <UserPlus className="h-4 w-4" />
              Add User
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          type="search"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white pl-9 pr-4 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors shrink-0',
              activeTab === key
                ? 'bg-brand-blue text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {label}
            <span className={cn(
              'ml-1.5 rounded-full px-1.5 py-px text-[10px]',
              activeTab === key ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-500',
            )}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* User list */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {search ? 'No users match your search.' : 'No users in this category.'}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              isSelf={user.id === currentUser?.uid}
              canManage={canManageUsers}
              onEdit={setEditUser}
              onToggleActive={requestToggleActive}
              onView={setViewEngineer}
            />
          ))}
        </div>
      )}

      {/* Add user modal — admin only */}
      {canManageUsers && (
        <CreateUserModal
          open={showCreateUser}
          onClose={() => setShowCreateUser(false)}
        />
      )}

      {/* Edit modal */}
      <EditUserModal
        user={editUser}
        onClose={() => setEditUser(null)}
      />

      {/* Engineer detail drawer */}
      <EngineerDetailDrawer
        engineer={viewEngineer}
        open={!!viewEngineer}
        onClose={() => setViewEngineer(null)}
      />

      {/* Disable / Enable confirmation dialog */}
      <Dialog
        open={!!confirmUser}
        onOpenChange={(o) => { if (!o && !confirming) setConfirmUser(null); }}
      >
        <DialogContent className="max-w-sm" aria-describedby="confirm-desc">
          <DialogHeader>
            <DialogTitle>
              {confirmUser?.active ? 'Disable Account' : 'Enable Account'}
            </DialogTitle>
            <DialogDescription id="confirm-desc">
              {confirmUser?.active
                ? `${confirmUser.name} will no longer be able to sign in.`
                : `${confirmUser?.name} will be able to sign in again.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmUser(null)}
              disabled={confirming}
            >
              Cancel
            </Button>
            <Button
              className={cn(
                'flex-1',
                confirmUser?.active
                  ? 'bg-red-600 hover:bg-red-700 text-white border-0'
                  : 'bg-green-600 hover:bg-green-700 text-white border-0',
              )}
              onClick={confirmToggleActive}
              disabled={confirming}
            >
              {confirming ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {confirmUser?.active ? 'Disabling…' : 'Enabling…'}
                </span>
              ) : (
                confirmUser?.active ? 'Disable' : 'Enable'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
