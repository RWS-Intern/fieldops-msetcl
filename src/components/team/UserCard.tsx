import { Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEngineerTasks } from '@/hooks/useEngineerTasks';
import type { User } from '@/types';

interface UserCardProps {
  user:           User;
  isSelf:         boolean;
  /** False for a read-only viewer — Edit / Disable are not rendered at all. */
  canManage:      boolean;
  onEdit:         (user: User) => void;
  onToggleActive: (user: User) => void;
  onView?:        (user: User) => void;
}

// ─── Avatar initial ───────────────────────────────────────────────────────────

function Avatar({ user }: { user: User }) {
  const initial = user.name.trim().charAt(0).toUpperCase() || '?';
  // Slate for the read-only viewer — deliberately distinct from the approver's
  // violet and the admin's navy.
  const bg =
    user.role === 'admin'    ? 'bg-brand-navy' :
    user.role === 'approver' ? 'bg-violet-600' :
    user.role === 'viewer'   ? 'bg-slate-500' :
    'bg-teal-600';

  return (
    <div
      className={cn(
        'h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-white font-semibold text-sm',
        bg,
        !user.active && 'opacity-50',
      )}
    >
      {initial}
    </div>
  );
}

// ─── Role badge ───────────────────────────────────────────────────────────────

const ROLE_BADGE_CLASS: Record<User['role'], string> = {
  admin:    'bg-brand-navy/10 text-brand-navy',
  approver: 'bg-violet-100 text-violet-700',
  // Slate reads as "read-only" and shares no colour with approver or admin.
  viewer:   'bg-slate-100 text-slate-700',
  field:    'bg-teal-100 text-teal-700',
};

const ROLE_BADGE_LABEL: Record<User['role'], string> = {
  admin:    'Admin',
  approver: 'Approver',
  viewer:   'Viewer',
  field:    'Field Engineer',
};

function RoleBadge({ role }: { role: User['role'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        ROLE_BADGE_CLASS[role] ?? ROLE_BADGE_CLASS.field,
      )}
    >
      {ROLE_BADGE_LABEL[role] ?? role}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UserCard({ user, isSelf, canManage, onEdit, onToggleActive, onView }: UserCardProps) {
  // Fetch task stats for field engineers; pass '' for admins → returns [] immediately.
  const { tasks, loading: statsLoading } = useEngineerTasks(
    user.role === 'field' ? user.id : ''
  );

  const assignedCount   = tasks.length;
  const completedCount  = tasks.filter((t) => t.status === 'completed').length;
  const completionPct   = assignedCount > 0
    ? Math.round((completedCount / assignedCount) * 100)
    : 0;

  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-4 flex gap-3 items-start transition-opacity',
        !user.active && 'opacity-60',
      )}
    >
      <Avatar user={user} />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Name row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('font-semibold text-sm text-gray-900', !user.active && 'line-through text-gray-400')}>
            {user.name}
          </span>
          {isSelf && (
            <span className="text-xs text-gray-400 font-normal">(You)</span>
          )}
          {/* FCM badge — green wifi icon when token is present */}
          {user.fcmToken && (
            <Wifi className="h-3.5 w-3.5 text-green-500 shrink-0" aria-label="Push notifications active" />
          )}
        </div>

        {/* Email */}
        <p className="text-xs text-gray-500 mt-0.5 truncate">{user.email}</p>

        {/* Badges row */}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <RoleBadge role={user.role} />
          {user.engineerCode && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-teal-50 text-teal-700 font-mono">
              {user.engineerCode}
            </span>
          )}
          {!user.active && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-50 text-red-600">
              Disabled
            </span>
          )}
        </div>

        {/* Task stats — field engineers only */}
        {user.role === 'field' && (
          <p className="text-xs text-gray-400 mt-1.5">
            {statsLoading ? (
              <span className="text-gray-300">Loading tasks…</span>
            ) : (
              <>
                <span className="font-medium text-gray-600">{assignedCount}</span> assigned
                {' · '}
                <span className="font-medium text-gray-600">{completedCount}</span> completed
                {' · '}
                <span className="font-medium text-gray-600">{completionPct}%</span>
              </>
            )}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5 shrink-0">
        {/* View button — field engineers only */}
        {user.role === 'field' && onView && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 min-h-[44px] sm:min-h-0 text-xs px-2.5 text-brand-blue border-brand-blue/30 hover:bg-blue-50"
            onClick={() => onView(user)}
          >
            View
          </Button>
        )}
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 min-h-[44px] sm:min-h-0 text-xs px-2.5"
            onClick={() => onEdit(user)}
          >
            Edit
          </Button>
        )}
        {canManage && !isSelf && (
          <Button
            size="sm"
            variant="outline"
            className={cn(
              'h-7 min-h-[44px] sm:min-h-0 text-xs px-2.5',
              user.active
                ? 'text-red-600 border-red-200 hover:bg-red-50'
                : 'text-green-700 border-green-200 hover:bg-green-50',
            )}
            onClick={() => onToggleActive(user)}
          >
            {user.active ? 'Disable' : 'Enable'}
          </Button>
        )}
      </div>
    </div>
  );
}
