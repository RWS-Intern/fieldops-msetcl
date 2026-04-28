import { Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { User } from '@/types';

interface UserCardProps {
  user:          User;
  isSelf:        boolean;
  onEdit:        (user: User) => void;
  onToggleActive:(user: User) => void;
}

// ─── Avatar initial ───────────────────────────────────────────────────────────

function Avatar({ user }: { user: User }) {
  const initial = user.name.trim().charAt(0).toUpperCase() || '?';
  const bg = user.role === 'admin' ? 'bg-brand-navy' : 'bg-teal-600';

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

function RoleBadge({ role }: { role: User['role'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        role === 'admin'
          ? 'bg-brand-navy/10 text-brand-navy'
          : 'bg-teal-100 text-teal-700',
      )}
    >
      {role === 'admin' ? 'Admin' : 'Field Engineer'}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UserCard({ user, isSelf, onEdit, onToggleActive }: UserCardProps) {
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
          {!user.active && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-50 text-red-600">
              Disabled
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs px-2"
          onClick={() => onEdit(user)}
        >
          Edit
        </Button>
        {!isSelf && (
          <Button
            size="sm"
            variant="outline"
            className={cn(
              'h-7 text-xs px-2',
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
