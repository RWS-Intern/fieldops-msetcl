import { useEffect, useState } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import type { SurveyUpdate } from '@/types';

/**
 * Real-time listener for a survey's immutable audit-trail snapshots
 * (surveyReports/{id}/updates — see submitSurvey/reviewSurvey in
 * useSurveyActions.ts), newest first. A single-field orderBy scoped to one
 * document's subcollection needs no composite index.
 */
export function useSurveyUpdates(surveyReportId: string | null | undefined) {
  const [updates, setUpdates] = useState<SurveyUpdate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // unsubscribe is assigned from inside an async IIFE (see below) purely to
    // route the id-less reset through a microtask rather than a bare
    // synchronous setState call — no real async work happens before it runs.
    let unsubscribe: (() => void) | undefined;

    (async () => {
      if (!surveyReportId) {
        setUpdates([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      const q = query(
        collection(db, 'surveyReports', surveyReportId, 'updates'),
        orderBy('createdAt', 'desc'),
      );

      unsubscribe = onSnapshot(
        q,
        (snap) => {
          setUpdates(snap.docs.map((d) => {
            const data = d.data();
            return {
              id:          d.id,
              action:      data['action'],
              actorUid:    data['actorUid']  ?? '',
              actorName:   data['actorName'] ?? '',
              createdAt:   data['createdAt']?.toDate?.() ?? new Date(),
              reviewNotes: data['reviewNotes'] ?? undefined,
              // Written as null by submitSurvey when the survey has no chain
              // (pre-chain document, or an offline item queued by an older
              // build) — normalised to undefined so display code has one
              // "absent" case to handle, not two.
              stageKey:      data['stageKey']      ?? undefined,
              stageIndex:    data['stageIndex']    ?? undefined,
              attachmentUrl: data['attachmentUrl'] ?? undefined,
              payload:       data['payload']       ?? undefined,
            } as SurveyUpdate;
          }));
          setLoading(false);
        },
        (err) => {
          console.error('[useSurveyUpdates] listener error:', err);
          setLoading(false);
        },
      );
    })();

    return () => unsubscribe?.();
  }, [surveyReportId]);

  return { updates, loading };
}
