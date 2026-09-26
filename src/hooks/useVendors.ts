import { useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useVendorStore } from '@/store/vendorStore';
import type { Vendor } from '@/types';

/**
 * useVendors — real-time listener on the vendors collection.
 * Mount once via VendorsListener in Layout; every screen reads vendorStore.
 *
 * Deliberately UNFILTERED: archived vendors are loaded too, because an
 * engineer created under a vendor that was later archived must still render
 * with that vendor's name. Callers that are choosing a vendor for NEW work
 * filter to `!archived` themselves.
 *
 * Sorted client-side — in-house first, then alphabetically — so no composite
 * index is needed and every vendor dropdown in the app shows the same order.
 */
export function useVendors() {
  const { setVendors, setLoading } = useVendorStore();

  useEffect(() => {
    setLoading(true);

    const unsubscribe = onSnapshot(
      collection(db, 'vendors'),
      (snap) => {
        const vendors: Vendor[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id:         d.id,
              vendorName: data['vendorName'] ?? '',
              vendorCode: data['vendorCode'] ?? null,
              isInHouse:  data['isInHouse']  ?? false,
              archived:   data['archived']   ?? false,
              archivedAt: data['archivedAt']?.toDate?.() ?? null,
              createdAt:  data['createdAt']?.toDate?.()  ?? new Date(),
              createdBy:  data['createdBy']  ?? '',
              updatedAt:  data['updatedAt']?.toDate?.()  ?? new Date(),
            } as Vendor;
          })
          .sort((a, b) => {
            if (a.isInHouse !== b.isInHouse) return a.isInHouse ? -1 : 1;
            return a.vendorName.localeCompare(b.vendorName);
          });

        setVendors(vendors);
        setLoading(false);
      },
      (err) => {
        console.error('[useVendors] snapshot error:', err);
        setLoading(false);
      },
    );

    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
