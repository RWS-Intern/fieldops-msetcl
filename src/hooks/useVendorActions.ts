import {
  doc,
  addDoc,
  setDoc,
  updateDoc,
  collection,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { useVendorStore } from '@/store/vendorStore';
import { useToast } from '@/components/ui/toast';
import { IN_HOUSE_VENDOR_ID } from '@/types';

/** Display name the built-in in-house vendor is seeded with. */
export const IN_HOUSE_VENDOR_NAME = 'Inside Engineers';

/**
 * Normalised form used for duplicate detection. Case- and spacing-insensitive,
 * so "ABC Contractors" and "abc  contractors" are the same vendor — two rows
 * that differ only in case would split one contractor's numbers across two
 * lines in every vendor-wise report.
 */
function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 500;

/**
 * Pushes a renamed vendor's name onto every user document pointing at it.
 *
 * Chunked at BATCH_LIMIT so a vendor with more engineers than one batch allows
 * still completes. Failures are logged, not toasted: the vendor document —
 * the canonical record — has already been written by the time this runs, and
 * the caller reports that success. A partial fan-out is repaired by renaming
 * the vendor again.
 */
async function fanOutVendorName(vendorId: string, vendorName: string): Promise<void> {
  try {
    const snap = await getDocs(
      query(collection(db, 'users'), where('vendorId', '==', vendorId)),
    );
    if (snap.empty) return;

    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) {
        batch.update(d.ref, { vendorName, updatedAt: serverTimestamp() });
      }
      await batch.commit();
    }
  } catch (err) {
    console.error('[fanOutVendorName] failed — engineer records may show the old name:', err);
  }
}

export function useVendorActions() {
  const { currentUser } = useAuthStore();
  const { vendors }     = useVendorStore();
  const { showToast }   = useToast();

  /**
   * Creates the built-in "Inside Engineers" vendor if it does not exist.
   *
   * Uses the FIXED document id IN_HOUSE_VENDOR_ID rather than addDoc, so two
   * admins opening Settings at the same moment cannot produce two in-house
   * vendors — the second write simply targets the same document. The
   * existence check then keeps that second write from resetting createdAt.
   *
   * Safe to call on every Settings mount; it is a no-op once seeded.
   */
  async function ensureInHouseVendor(): Promise<void> {
    if (currentUser?.role !== 'admin') return;

    const ref = doc(db, 'vendors', IN_HOUSE_VENDOR_ID);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) return;

      await setDoc(ref, {
        vendorName: IN_HOUSE_VENDOR_NAME,
        vendorCode: null,
        isInHouse:  true,
        archived:   false,
        archivedAt: null,
        createdAt:  serverTimestamp(),
        createdBy:  currentUser?.uid ?? '',
        updatedAt:  serverTimestamp(),
      });
    } catch (err) {
      console.error('[ensureInHouseVendor] failed:', err);
      // No toast — this runs on mount, and a failure here must not greet the
      // admin with an error they did not ask for. The empty list is visible
      // on its own, and Add Vendor still works.
    }
  }

  /** Adds an outsourced vendor. Returns the new document id, or null on failure. */
  async function createVendor(
    vendorName: string,
    vendorCode?: string | null,
  ): Promise<string | null> {
    const name = vendorName.trim();
    if (!name) {
      showToast('Vendor name is required', 'error');
      return null;
    }

    const clash = vendors.find((v) => normaliseName(v.vendorName) === normaliseName(name));
    if (clash) {
      showToast(
        clash.archived
          ? `"${clash.vendorName}" already exists but is archived — restore it instead.`
          : `"${clash.vendorName}" already exists.`,
        'error',
      );
      return null;
    }

    try {
      const ref = await addDoc(collection(db, 'vendors'), {
        vendorName: name,
        vendorCode: vendorCode?.trim().toUpperCase() || null,
        isInHouse:  false,
        archived:   false,
        archivedAt: null,
        createdAt:  serverTimestamp(),
        createdBy:  currentUser?.uid ?? '',
        updatedAt:  serverTimestamp(),
      });
      showToast(`Vendor "${name}" added`, 'success');
      return ref.id;
    } catch (err) {
      console.error('[createVendor] failed:', err);
      showToast('Failed to add vendor. Try again.', 'error');
      return null;
    }
  }

  /**
   * Renames a vendor, in-house one included — only its id and isInHouse flag
   * are fixed, not its label.
   *
   * vendorName is DENORMALISED onto every user carrying this vendorId (see the
   * field on User), so a rename is a fan-out, not a single write: the vendor
   * document first, then one batched update per affected engineer. Skipping
   * that would leave engineers labelled with the vendor's old name for good.
   *
   * The vendor write lands first deliberately. If the fan-out then fails, the
   * canonical record is already correct and re-running the rename retries the
   * copies; the reverse order could leave copies pointing at a name the vendor
   * never had.
   */
  async function updateVendor(
    vendorId: string,
    vendorName: string,
    vendorCode?: string | null,
  ): Promise<boolean> {
    const name = vendorName.trim();
    if (!name) {
      showToast('Vendor name is required', 'error');
      return false;
    }

    const clash = vendors.find(
      (v) => v.id !== vendorId && normaliseName(v.vendorName) === normaliseName(name),
    );
    if (clash) {
      showToast(`"${clash.vendorName}" already exists.`, 'error');
      return false;
    }

    try {
      await updateDoc(doc(db, 'vendors', vendorId), {
        vendorName: name,
        vendorCode: vendorCode?.trim().toUpperCase() || null,
        updatedAt:  serverTimestamp(),
      });
      await fanOutVendorName(vendorId, name);
      showToast('Vendor updated', 'success');
      return true;
    } catch (err) {
      console.error('[updateVendor] failed:', err);
      showToast('Failed to update vendor. Try again.', 'error');
      return false;
    }
  }

  /**
   * Archives or restores a vendor. There is no hard delete: engineers and
   * historical reports point at a vendor by id, so removing the document
   * would strand those references (firestore.rules refuses delete outright).
   *
   * The in-house vendor cannot be archived — it is the fallback every engineer
   * without an outsourced vendor belongs to.
   */
  async function setVendorArchived(vendorId: string, archived: boolean): Promise<void> {
    if (archived && vendorId === IN_HOUSE_VENDOR_ID) {
      showToast('The in-house vendor cannot be archived.', 'error');
      return;
    }

    try {
      await updateDoc(doc(db, 'vendors', vendorId), {
        archived,
        archivedAt: archived ? serverTimestamp() : null,
        updatedAt:  serverTimestamp(),
      });
      showToast(archived ? 'Vendor archived' : 'Vendor restored', 'success');
    } catch (err) {
      console.error('[setVendorArchived] failed:', err);
      showToast('Failed to update vendor. Try again.', 'error');
      throw err;
    }
  }

  /**
   * Counts the engineers currently pointing at a vendor.
   *
   * Used to tell the admin what a delete would cost before they confirm it.
   * Single-field equality, so it needs no composite index.
   */
  async function countVendorEngineers(vendorId: string): Promise<number> {
    const snap = await getDocs(
      query(collection(db, 'users'), where('vendorId', '==', vendorId)),
    );
    return snap.size;
  }

  /**
   * Permanently deletes a vendor.
   *
   * Engineers assigned to it are deliberately NOT rewritten. They keep the
   * denormalised vendorName, so their records still read correctly — what is
   * lost is the ability to select that vendor in the Reports filter, because
   * the option is built from the vendors collection. Callers show the engineer
   * count from countVendorEngineers first so that trade is made knowingly;
   * archiving is the reversible alternative.
   *
   * The in-house vendor cannot be deleted. Checked here for a clear message,
   * and independently pinned in firestore.rules by document id so it holds
   * even if this check is ever bypassed.
   */
  async function deleteVendor(vendorId: string): Promise<void> {
    if (vendorId === IN_HOUSE_VENDOR_ID) {
      showToast('The in-house vendor cannot be deleted.', 'error');
      return;
    }

    try {
      await deleteDoc(doc(db, 'vendors', vendorId));
      showToast('Vendor deleted', 'success');
    } catch (err) {
      console.error('[deleteVendor] failed:', err);
      showToast('Failed to delete vendor. Try again.', 'error');
      throw err;
    }
  }

  return {
    ensureInHouseVendor,
    createVendor,
    updateVendor,
    setVendorArchived,
    countVendorEngineers,
    deleteVendor,
  };
}
