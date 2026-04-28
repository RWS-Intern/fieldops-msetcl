import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useInviteActions } from '@/hooks/useInviteActions';
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
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { Button }   from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import type { UserRole } from '@/types';

interface InviteUserModalProps {
  open:    boolean;
  onClose: () => void;
}

/** Works on HTTP (local network IPs) as well as HTTPS. */
async function copyToClipboard(text: string): Promise<boolean> {
  // Modern API — requires HTTPS or localhost
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy method
    }
  }

  // Legacy execCommand fallback — works on HTTP / local IPs
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top  = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  } catch {
    document.body.removeChild(textarea);
    return false;
  }
}

export function InviteUserModal({ open, onClose }: InviteUserModalProps) {
  const { createInvite }              = useInviteActions();
  const { showToast, ToastComponent } = useToast();

  const [name,       setName]       = useState('');
  const [email,      setEmail]      = useState('');
  const [role,       setRole]       = useState<UserRole>('field');
  const [submitting, setSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied,     setCopied]     = useState(false);

  function reset() {
    setName('');
    setEmail('');
    setRole('field');
    setSubmitting(false);
    setInviteLink(null);
    setCopied(false);
  }

  function handleClose() {
    if (!submitting) { reset(); onClose(); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);
    try {
      const inviteId = await createInvite(name.trim(), email.trim(), role);
      setInviteLink(`${window.location.origin}/signup/${inviteId}`);
    } catch {
      showToast('Failed to create invite. Try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!inviteLink) return;
    const ok = await copyToClipboard(inviteLink);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      showToast('Could not copy to clipboard.', 'error');
    }
  }

  return (
    <>
      {ToastComponent}
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Invite New User</DialogTitle>
          </DialogHeader>

          {!inviteLink ? (
            /* ── Step 1: fill in details ── */
            <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-name">
                  Name <span className="text-brand-red">*</span>
                </Label>
                <Input
                  id="inv-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-email">
                  Email <span className="text-brand-red">*</span>
                </Label>
                <Input
                  id="inv-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@ritesolar.com"
                  required
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
                    'Create Invite'
                  )}
                </Button>
              </div>
            </form>
          ) : (
            /* ── Step 2: show the link ── */
            <div className="flex flex-col gap-4 mt-2">
              <p className="text-sm text-gray-600">
                Share this link with <strong>{name}</strong>. It expires in{' '}
                <strong>7 days</strong>.
              </p>

              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                <span className="flex-1 break-all font-mono text-xs text-gray-700">
                  {inviteLink}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 text-brand-blue transition-colors hover:text-brand-navy"
                  aria-label="Copy invite link"
                >
                  {copied
                    ? <Check className="h-4 w-4 text-green-500" />
                    : <Copy className="h-4 w-4" />}
                </button>
              </div>

              {copied && (
                <p className="-mt-2 text-center text-xs text-green-600">Copied!</p>
              )}

              <Button onClick={handleClose} className="w-full">
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
