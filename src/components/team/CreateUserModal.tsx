import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useUserActions } from '@/hooks/useUserActions';
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
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { UserRole } from '@/types';

interface CreateUserModalProps {
  open:    boolean;
  onClose: () => void;
}

export function CreateUserModal({ open, onClose }: CreateUserModalProps) {
  const { createUser } = useUserActions();

  const [name,        setName]        = useState('');
  const [email,       setEmail]       = useState('');
  const [role,        setRole]        = useState<UserRole>('field');
  const [submitting,  setSubmitting]  = useState(false);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  function reset() {
    setName('');
    setEmail('');
    setRole('field');
    setSubmitting(false);
    setCreatedEmail(null);
  }

  function handleClose() {
    if (!submitting) { reset(); onClose(); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);
    try {
      await createUser(name.trim(), email.trim(), role);
      // Show in-modal success state (toast is also shown by createUser)
      setCreatedEmail(email.trim());
    } catch {
      // Error toast already shown inside createUser — nothing more to do here
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add New User</DialogTitle>
        </DialogHeader>

        {!createdEmail ? (
          /* ── Form ── */
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cu-name">
                Full Name <span className="text-brand-red">*</span>
              </Label>
              <Input
                id="cu-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                required
                autoComplete="off"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cu-email">
                Email <span className="text-brand-red">*</span>
              </Label>
              <Input
                id="cu-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@ritesolar.com"
                required
                autoComplete="off"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Role <span className="text-brand-red">*</span></Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="field">Field Engineer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={handleClose}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={submitting || !name.trim() || !email.trim()}
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Creating…
                  </span>
                ) : (
                  'Create Account'
                )}
              </Button>
            </div>
          </form>
        ) : (
          /* ── Success state ── */
          <div className="flex flex-col items-center gap-4 mt-2 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <div className="flex flex-col gap-1">
              <p className="text-base font-semibold text-gray-800">
                Account created successfully!
              </p>
              <p className="text-sm text-gray-500">
                A password setup email has been sent to{' '}
                <span className="font-medium text-gray-700">{createdEmail}</span>.
                They can log in after setting their password.
              </p>
            </div>
            <Button onClick={handleClose} className="w-full mt-1">
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
