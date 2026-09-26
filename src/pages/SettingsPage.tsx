import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Archive, RotateCcw, Building2, Home, Trash2, AlertTriangle } from 'lucide-react';
import { useVendorStore } from '@/store/vendorStore';
import { useVendorActions } from '@/hooks/useVendorActions';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Vendor } from '@/types';

// ─── Vendor row ───────────────────────────────────────────────────────────────

interface VendorRowProps {
  vendor:    Vendor;
  onEdit:    (v: Vendor) => void;
  onArchive: (v: Vendor) => void;
  onDelete:  (v: Vendor) => void;
}

function VendorRow({ vendor, onEdit, onArchive, onDelete }: VendorRowProps) {
  const archiveLabel = vendor.archived ? 'Restore' : 'Archive';

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5',
        vendor.archived && 'opacity-60',
      )}
    >
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          vendor.isInHouse ? 'bg-brand-blue/10 text-brand-blue' : 'bg-gray-100 text-gray-500',
        )}
      >
        {vendor.isInHouse ? <Home className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-gray-900">
            {vendor.vendorName}
          </span>
          {vendor.vendorCode && (
            <span className="rounded bg-gray-100 px-1.5 py-px text-[10px] font-medium text-gray-600">
              {vendor.vendorCode}
            </span>
          )}
          {vendor.isInHouse && (
            <span className="rounded bg-brand-blue px-1.5 py-px text-[10px] font-medium text-white">
              In-house
            </span>
          )}
          {vendor.archived && (
            <span className="rounded bg-gray-200 px-1.5 py-px text-[10px] font-medium text-gray-600">
              Archived
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onEdit(vendor)}
          aria-label={'Edit ' + vendor.vendorName}
          className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <Pencil className="h-4 w-4" />
        </button>
        {/* The in-house vendor is the fallback every engineer without an
            outsourced vendor belongs to, so it is never archivable. */}
        {!vendor.isInHouse && (
          <button
            type="button"
            onClick={() => onArchive(vendor)}
            aria-label={archiveLabel + ' ' + vendor.vendorName}
            className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            {vendor.archived
              ? <RotateCcw className="h-4 w-4" />
              : <Archive className="h-4 w-4" />}
          </button>
        )}
        {/* Deleting the in-house vendor is refused by firestore.rules too. */}
        {!vendor.isInHouse && (
          <button
            type="button"
            onClick={() => onDelete(vendor)}
            aria-label={'Delete ' + vendor.vendorName}
            className="rounded p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-brand-red"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { vendors, loading } = useVendorStore();
  const {
    ensureInHouseVendor, createVendor, updateVendor,
    setVendorArchived, countVendorEngineers, deleteVendor,
  } = useVendorActions();

  const [showForm,     setShowForm]     = useState(false);
  const [editing,      setEditing]      = useState<Vendor | null>(null);
  const [formName,     setFormName]     = useState('');
  const [formCode,     setFormCode]     = useState('');
  const [saving,       setSaving]       = useState(false);
  const [confirm,      setConfirm]      = useState<Vendor | null>(null);
  const [confirming,   setConfirming]   = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Vendor | null>(null);
  // null while the engineer count is still being fetched — the confirm button
  // stays disabled until it resolves, so nobody deletes blind.
  const [deleteCount,  setDeleteCount]  = useState<number | null>(null);
  const [deleting,     setDeleting]     = useState(false);

  // Seed the built-in in-house vendor once the list has actually loaded.
  // The ref keeps a re-render — or the snapshot that seeding itself triggers —
  // from firing a second attempt.
  const seedAttempted = useRef(false);
  useEffect(() => {
    if (loading || seedAttempted.current) return;
    if (vendors.some((v) => v.isInHouse)) return;
    seedAttempted.current = true;
    void ensureInHouseVendor();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, vendors]);

  const active   = useMemo(() => vendors.filter((v) => !v.archived), [vendors]);
  const archived = useMemo(() => vendors.filter((v) =>  v.archived), [vendors]);

  function openCreate() {
    setEditing(null);
    setFormName('');
    setFormCode('');
    setShowForm(true);
  }

  function openEdit(vendor: Vendor) {
    setEditing(vendor);
    setFormName(vendor.vendorName);
    setFormCode(vendor.vendorCode ?? '');
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;
    setShowForm(false);
    setEditing(null);
    setFormName('');
    setFormCode('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) return;
    setSaving(true);
    try {
      const ok = editing
        ? await updateVendor(editing.id, formName, formCode)
        : (await createVendor(formName, formCode)) !== null;
      // A duplicate name or a failed write keeps the dialog open with the
      // typed text intact — the toast already says what went wrong.
      if (ok) closeForm();
    } finally {
      setSaving(false);
    }
  }

  async function requestDelete(vendor: Vendor) {
    setDeleteTarget(vendor);
    setDeleteCount(null);
    try {
      setDeleteCount(await countVendorEngineers(vendor.id));
    } catch (err) {
      console.error('[SettingsPage] engineer count failed:', err);
      // Close rather than offer a delete whose cost we could not establish.
      setDeleteTarget(null);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteVendor(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // Toast already shown inside deleteVendor.
    } finally {
      setDeleting(false);
    }
  }

  async function handleConfirmArchive() {
    if (!confirm) return;
    setConfirming(true);
    try {
      await setVendorArchived(confirm.id, !confirm.archived);
      setConfirm(null);
    } catch {
      // Toast already shown inside setVendorArchived.
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5">
        <h2 className="mb-0.5 text-xl font-bold text-gray-900 sm:text-2xl">Settings</h2>
        <p className="text-sm text-gray-500">Organisation configuration</p>
      </div>

      {/* ── Vendors ── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Vendors</h3>
            <p className="text-sm text-gray-500">
              The organisations field engineers work for. Assign one to each engineer
              to track and report performance vendor-wise.
            </p>
          </div>
          <Button onClick={openCreate} className="flex shrink-0 items-center gap-1.5">
            <Plus className="h-4 w-4" />
            Add Vendor
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {active.map((v) => (
                <VendorRow
                  key={v.id} vendor={v} onEdit={openEdit}
                  onArchive={setConfirm} onDelete={requestDelete}
                />
              ))}
            </div>

            {archived.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowArchived((s) => !s)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
                </button>
                {showArchived && (
                  <div className="mt-2 flex flex-col gap-2">
                    {archived.map((v) => (
                      <VendorRow
                        key={v.id} vendor={v} onEdit={openEdit}
                        onArchive={setConfirm} onDelete={requestDelete}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Add / edit dialog ── */}
      <Dialog open={showForm} onOpenChange={(o) => { if (!o) closeForm(); }}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Vendor' : 'Add Vendor'}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vendor-name">
                Vendor Name <span className="text-brand-red">*</span>
              </Label>
              <Input
                id="vendor-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. ABC Electricals"
                required
                autoComplete="off"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vendor-code">Short Code (optional)</Label>
              <Input
                id="vendor-code"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder="e.g. ABC"
                autoComplete="off"
              />
              <p className="text-xs text-gray-400">
                Used in compact displays and CSV exports. Saved in capitals.
              </p>
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={closeForm}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={saving || !formName.trim()}>
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Saving…
                  </span>
                ) : (
                  editing ? 'Save Changes' : 'Add Vendor'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Archive / restore confirmation ── */}
      <Dialog
        open={!!confirm}
        onOpenChange={(o) => { if (!o && !confirming) setConfirm(null); }}
      >
        <DialogContent className="max-w-sm" aria-describedby="vendor-confirm-desc">
          <DialogHeader>
            <DialogTitle>
              {confirm?.archived ? 'Restore Vendor' : 'Archive Vendor'}
            </DialogTitle>
            <DialogDescription id="vendor-confirm-desc">
              {confirm?.archived
                ? `"${confirm.vendorName}" will be selectable again when assigning engineers.`
                : `"${confirm?.vendorName}" will no longer be offered for new engineers. Engineers already assigned to it keep it, and past reports are unaffected.`}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirm(null)}
              disabled={confirming}
            >
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleConfirmArchive} disabled={confirming}>
              {confirming ? 'Working…' : confirm?.archived ? 'Restore' : 'Archive'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}
      >
        <DialogContent className="max-w-sm" aria-describedby="vendor-delete-desc">
          <DialogHeader>
            <DialogTitle>Delete Vendor</DialogTitle>
            <DialogDescription id="vendor-delete-desc">
              {deleteCount === null
                ? `Checking whether any engineers are assigned to "${deleteTarget?.vendorName}"…`
                : deleteCount === 0
                  ? `"${deleteTarget?.vendorName}" will be permanently deleted. No engineers are assigned to it.`
                  : `"${deleteTarget?.vendorName}" will be permanently deleted. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>

          {/* The cost of deleting a vendor that is still in use, stated plainly
              rather than blocked — the engineers survive, the reporting cut
              does not. */}
          {deleteCount !== null && deleteCount > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-xs font-semibold text-amber-900">
                  {deleteCount} engineer{deleteCount !== 1 ? 's are' : ' is'} assigned to this vendor
                </p>
                <p className="text-xs text-amber-800">
                  Their records keep the vendor name, so nothing is lost from their
                  profiles. But the vendor disappears from the Reports filter, so you
                  will no longer be able to isolate its work. Archive instead to keep
                  that filter working.
                </p>
              </div>
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            {deleteCount !== null && deleteCount > 0 && (
              <Button
                variant="outline"
                className="flex-1"
                disabled={deleting}
                onClick={() => {
                  const target = deleteTarget;
                  setDeleteTarget(null);
                  if (target) setConfirm(target);
                }}
              >
                Archive
              </Button>
            )}
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleConfirmDelete}
              disabled={deleting || deleteCount === null}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
