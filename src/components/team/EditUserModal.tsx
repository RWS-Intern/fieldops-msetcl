import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUserActions } from '@/hooks/useUserActions';
import type { User } from '@/types';

interface EditUserModalProps {
  user:    User | null;
  onClose: () => void;
}

export function EditUserModal({ user, onClose }: EditUserModalProps) {
  const { updateUserName } = useUserActions();
  const [name,    setName]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const [nameError, setNameError] = useState('');

  // Sync name input when the user prop changes
  useEffect(() => {
    if (user) {
      setName(user.name);
      setNameError('');
    }
  }, [user]);

  async function handleSave() {
    if (!user) return;
    if (!name.trim()) {
      setNameError('Name is required');
      return;
    }
    setSaving(true);
    try {
      await updateUserName(user.id, name);
      onClose();
    } catch {
      // Error toast already shown by useUserActions
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
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
              disabled={saving}
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

          {/* Role — read-only */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-role" className="text-gray-500">Role</Label>
            <Input
              id="edit-role"
              value={user?.role === 'admin' ? 'Admin' : 'Field Engineer'}
              readOnly
              disabled
              className="bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving…
                </span>
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
