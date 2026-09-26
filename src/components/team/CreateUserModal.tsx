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
import { useVendorStore } from '@/store/vendorStore';
import type { UserRole } from '@/types';

interface CreateUserModalProps {
  open:    boolean;
  onClose: () => void;
}

export function CreateUserModal({ open, onClose }: CreateUserModalProps) {
  const { createUser } = useUserActions();
  const { vendors }    = useVendorStore();

  const [name,        setName]        = useState('');
  const [email,       setEmail]       = useState('');
  const [role,        setRole]        = useState<UserRole>('field');
  const [organization, setOrganization] = useState('');
  const [vendorId,    setVendorId]    = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  // Organisation only means something for a reviewer — MSETCL staff and our
  // own staff both hold `approver` accounts, and the stage pickers show this
  // to tell them apart. Irrelevant for field/admin/viewer.
  const showOrganization = role === 'approver';

  // Vendor is a field-engineer concept: it exists so engineer performance can
  // be reported vendor-wise. Same role-conditional treatment as organization
  // above, which is approver-only for the mirror-image reason.
  const showVendor = role === 'field';

  // Archived vendors are still loaded (an existing engineer may belong to one)
  // but are never offered for a NEW account.
  const selectableVendors = vendors.filter((v) => !v.archived);

  // Defaults to the in-house vendor without an effect: the form never holds a
  // stale id from before the vendor list arrived, because the fallback is
  // recomputed on every render until the admin picks something themselves.
  const effectiveVendorId =
    vendorId || selectableVendors.find((v) => v.isInHouse)?.id || '';

  function reset() {
    setName('');
    setEmail('');
    setRole('field');
    setOrganization('');
    setVendorId('');
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
      const chosenVendor = selectableVendors.find((v) => v.id === effectiveVendorId);
      await createUser(
        name.trim(),
        email.trim(),
        role,
        showOrganization ? organization.trim() || null : null,
        showVendor && chosenVendor
          ? { id: chosenVendor.id, name: chosenVendor.vendorName }
          : null,
      );
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
                placeholder="user@ritewater.in"
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
                  <SelectItem value="field">Field Expert</SelectItem>
                  <SelectItem value="approver">Approver</SelectItem>
                  <SelectItem value="viewer">Viewer (read-only)</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Field engineer only — see showVendor. */}
            {showVendor && (
              <div className="flex flex-col gap-1.5">
                <Label>Vendor</Label>
                {selectableVendors.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400">
                    No vendors yet — add one under Settings, then reopen this form.
                  </p>
                ) : (
                  <>
                    <Select
                      value={effectiveVendorId}
                      onValueChange={(v) => setVendorId(v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a vendor" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectableVendors.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.vendorName}{v.vendorCode ? ` (${v.vendorCode})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-400">
                      Used to report this engineer&apos;s performance vendor-wise.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Approver only — see showOrganization. */}
            {showOrganization && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cu-organization">Organization (optional)</Label>
                <Input
                  id="cu-organization"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="e.g. Rite Water Solutions, MSETCL"
                  autoComplete="off"
                />
                <p className="text-xs text-gray-400">
                  Shown next to this reviewer&apos;s name when picking approvers.
                </p>
              </div>
            )}

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
