import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUserActions, countOrphanedWork } from '@/hooks/useUserActions';
import { useAuthStore } from '@/store/authStore';
import { useUserStore } from '@/store/userStore';
import { useVendorStore } from '@/store/vendorStore';
import type { OrphanedWorkCounts } from '@/hooks/useUserActions';
import type { User, UserRole } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  field:    'Field Expert',
  approver: 'Approver',
  viewer:   'Viewer (read-only)',
  admin:    'Admin',
};

// Select order mirrors CreateUserModal.
const ROLE_ORDER: UserRole[] = ['field', 'approver', 'viewer', 'admin'];

interface EditUserModalProps {
  user:    User | null;
  onClose: () => void;
}

export function EditUserModal({ user, onClose }: EditUserModalProps) {
  const { updateUserName, changeUserRole, setUserVendor } = useUserActions();
  const { currentUser } = useAuthStore();
  const { users }       = useUserStore();
  const { vendors }     = useVendorStore();

  const [name,      setName]      = useState('');
  const [role,      setRole]      = useState<UserRole>('field');
  const [vendorId,  setVendorId]  = useState('');
  const [saving,    setSaving]    = useState(false);
  const [nameError, setNameError] = useState('');
  const [roleError, setRoleError] = useState('');
  // Non-null once the orphaned-work check has found stranded work and is
  // waiting for the admin to confirm. Confirming re-runs handleSave, which
  // skips the check because this is already set.
  const [orphanWarning, setOrphanWarning] = useState<OrphanedWorkCounts | null>(null);
  const [checkingWork,  setCheckingWork]  = useState(false);

  // Only an admin may change roles. Everyone else sees the role read-only.
  const canChangeRole = currentUser?.role === 'admin';
  // An admin must never change their own role: a sole admin could demote
  // themselves and lock every account out of administration, leaving the
  // Firebase console as the only way back in.
  const isSelf = !!user && !!currentUser && user.id === currentUser.uid;
  const roleSelectDisabled = saving || checkingWork || isSelf;

  const roleChanged = !!user && role !== user.role;

  // Vendor is a field-engineer concept, so the picker follows the role being
  // SELECTED, not the one the account currently holds — promoting someone to
  // admin hides it, and the save clears the stored vendor to match.
  const showVendor = role === 'field';

  // Options carry the plain name separately from the decorated label: the
  // label is for display, the name is what gets denormalised onto the user.
  const vendorOptions = useMemo(() => {
    // Archived vendors are offered only when this engineer already belongs to
    // one, so an unrelated edit cannot move them off a vendor their historical
    // work is reported under.
    const opts = vendors
      .filter((v) => !v.archived || v.id === user?.vendorId)
      .map((v) => ({
        id:    v.id,
        name:  v.vendorName,
        label: v.vendorName
          + (v.vendorCode ? ` (${v.vendorCode})` : '')
          + (v.archived ? ' — archived' : ''),
      }));

    // An engineer may point at a vendor that has since been DELETED. It is gone
    // from the collection, so the option cannot come from `vendors` — it is
    // rebuilt from the name denormalised onto the user. Without this the picker
    // would read "Unassigned" and the next save of ANY field would quietly
    // clear a vendor the admin never touched.
    if (user?.vendorId && !vendors.some((v) => v.id === user.vendorId)) {
      const name = user.vendorName ?? 'Unknown vendor';
      opts.push({ id: user.vendorId, name, label: `${name} — deleted` });
    }
    return opts;
  }, [vendors, user]);

  const chosenVendor = vendorOptions.find((v) => v.id === vendorId) ?? null;
  const nextVendor = showVendor && chosenVendor
    ? { id: chosenVendor.id, name: chosenVendor.name }
    : null;
  const vendorChanged = !!user && (nextVendor?.id ?? null) !== (user.vendorId ?? null);

  // Sync inputs when the user prop changes
  useEffect(() => {
    if (user) {
      setName(user.name);
      setRole(user.role);
      setVendorId(user.vendorId ?? '');
      setNameError('');
      setRoleError('');
      setOrphanWarning(null);
    }
  }, [user]);

  function closeAndReset() {
    setOrphanWarning(null);
    setRoleError('');
    onClose();
  }

  async function handleSave() {
    if (!user) return;
    if (!name.trim()) {
      setNameError('Name is required');
      return;
    }

    // ── Name-only save — unchanged behaviour ────────────────────────────────
    if (!roleChanged) {
      setSaving(true);
      try {
        if (name.trim() !== user.name) await updateUserName(user.id, name);
        if (vendorChanged) await setUserVendor(user.id, nextVendor);
        closeAndReset();
      } catch {
        // Error toast already shown by useUserActions
      } finally {
        setSaving(false);
      }
      return;
    }

    // ── Role change guards ──────────────────────────────────────────────────
    setRoleError('');

    // (a) Never your own role.
    if (isSelf) {
      setRoleError('You cannot change your own role.');
      return;
    }

    // (b) Never remove the last admin. Counted as "active admins who would be
    // left afterwards", so demoting an already-disabled admin isn't blocked
    // just because the acting admin happens to be the only enabled one.
    if (user.role === 'admin') {
      const remainingAdmins = users.filter(
        (u) => u.role === 'admin' && u.active && u.id !== user.id,
      ).length;
      if (remainingAdmins === 0) {
        setRoleError(
          'This is the only active admin. Promote another user to Admin first — ' +
          'otherwise no one can administer the app.',
        );
        return;
      }
    }

    // (c) Warn about work that would be stranded, then let the admin proceed.
    if (!orphanWarning) {
      setCheckingWork(true);
      try {
        const counts = await countOrphanedWork(user.id, user.role);
        if (counts.assigned > 0 || counts.awaitingReview > 0) {
          setOrphanWarning(counts);
          return;
        }
      } catch (err) {
        console.error('[EditUserModal] orphaned-work check failed:', err);
        setRoleError('Could not check this user’s outstanding work. Try again.');
        return;
      } finally {
        setCheckingWork(false);
      }
    }

    // ── Commit ──────────────────────────────────────────────────────────────
    setSaving(true);
    try {
      if (name.trim() !== user.name) {
        await updateUserName(user.id, name);
      }
      // Log the name the record now carries, not the one it had before the
      // rename in the same save.
      await changeUserRole(
        { id: user.id, name: name.trim() || user.name, role: user.role },
        role,
      );
      // Silent: moving off `field` clears the vendor as a consequence of the
      // role change, which is not a separate edit worth its own toast.
      if (vendorChanged) await setUserVendor(user.id, nextVendor, true);
      closeAndReset();
    } catch {
      // Error toast already shown by useUserActions
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || checkingWork;

  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o && !busy) closeAndReset(); }}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-1">
          {/* Name — editable */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(''); }}
              placeholder="Full name"
              disabled={busy}
              className={nameError ? 'border-brand-red focus-visible:ring-brand-red' : ''}
            />
            {nameError && (
              <p className="text-xs text-brand-red">{nameError}</p>
            )}
          </div>

          {/* Email — read-only */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-email" className="text-gray-500">Email</Label>
            <Input
              id="edit-email"
              value={user?.email ?? ''}
              readOnly
              disabled
              className="bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>

          {/* Role — admin-editable, read-only for everyone else */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-role" className={canChangeRole ? undefined : 'text-gray-500'}>
              Role
            </Label>
            {canChangeRole ? (
              <>
                <Select
                  value={role}
                  onValueChange={(v) => {
                    setRole(v as UserRole);
                    setRoleError('');
                    setOrphanWarning(null);
                  }}
                >
                  <SelectTrigger id="edit-role" disabled={roleSelectDisabled}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_ORDER.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isSelf && (
                  <p className="text-xs text-gray-500">You cannot change your own role.</p>
                )}
                {roleError && (
                  <p className="text-xs text-brand-red">{roleError}</p>
                )}
              </>
            ) : (
              <Input
                id="edit-role"
                value={user ? ROLE_LABELS[user.role] ?? user.role : ''}
                readOnly
                disabled
                className="bg-gray-50 text-gray-500 cursor-not-allowed"
              />
            )}
          </div>

          {/* Vendor — field engineers only, see showVendor. */}
          {showVendor && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-vendor">Vendor</Label>
              {vendorOptions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400">
                  No vendors yet — add one under Settings.
                </p>
              ) : (
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger id="edit-vendor" disabled={busy}>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendorOptions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Orphaned-work confirmation — not a hard block: an admin may
              legitimately change a role and reassign the work afterwards. */}
          {orphanWarning && user && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1 min-w-0">
                <p className="text-xs font-semibold text-amber-900">
                  {orphanWarning.assigned > 0
                    ? `${orphanWarning.assigned} open item${orphanWarning.assigned !== 1 ? 's' : ''} still assigned to ${user.name}`
                    : `${orphanWarning.awaitingReview} item${orphanWarning.awaitingReview !== 1 ? 's' : ''} waiting on ${user.name} to review`}
                </p>
                <p className="text-xs text-amber-800">
                  {orphanWarning.assigned > 0
                    ? 'Once they are no longer a field engineer they can no longer work on it, so it will need reassigning.'
                    : 'Once they are no longer an approver no one can review it, so it will need reassigning to another approver.'}
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={closeAndReset}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={busy}
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving…
                </span>
              ) : checkingWork ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Checking…
                </span>
              ) : orphanWarning ? (
                'Change Role Anyway'
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
