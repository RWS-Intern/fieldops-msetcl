import { useEffect, useState } from 'react';
import { doc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { mapWorkOrder } from '@/hooks/useAssignedWorkOrders';
import type { Site, SiteStatus, TaskStatus, WorkOrderStage, WorkOrderStatus } from '@/types';

/**
 * One row of a substation's lifecycle — a work order or a site task,
 * normalised so the timeline can render both without branching per field.
 *
 * Deliberately covers `workOrders` + `siteTasks` only. The legacy v2.1
 * `tasks`/`taskMaster` collections are being phased out and are excluded
 * everywhere in this app.
 */
export interface LifecycleEntry {
  kind:  'workOrder' | 'siteTask';
  id:    string;
  /** workOrderCode, or the site task's taskCode. */
  code:  string;
  /** Stage label for a work order; task label for a site task. */
  label: string;
  /** WorkOrderStatus or TaskStatus — the two unions don't overlap fully, so
   *  the renderer picks its badge map from `kind`. */
  status: string;
  assignedToName: string | null;
  updatedAt: Date;
  /**
   * Lifecycle stage, for the quick-glance summary. Null for site tasks, which
   * are not part of the four-stage contract lifecycle.
   */
  stage: WorkOrderStage | null;
  /**
   * Route to the existing detail surface, or null when there isn't one.
   *
   * Null in two cases, both deliberate rather than missing work:
   *   - site tasks have no route at all — they open SiteTaskDetailDrawer,
   *     which the page mounts in read-only mode (reusing the existing viewer
   *     rather than building a second one);
   *   - non-survey work orders (repair/commissioning/amc) have no detail
   *     screen yet — only the survey stage is implemented today.
   */
  linkTo: string | null;
}

export interface SiteLifecycle {
  /** The site document itself, for the page header. Null while loading or if missing. */
  site:    Site | null;
  entries: LifecycleEntry[];
  loading: boolean;
  error:   string | null;
}

/**
 * Everything that has happened at one substation, as a single time-ordered
 * timeline.
 *
 * Three listeners: the site document, its work orders, and its site tasks.
 * Both collection queries are single-field equality on `siteId` with NO
 * orderBy — sorting is client-side. That is the same shape useSiteWorkOrders
 * already uses, and it means both run on Firestore's automatic single-field
 * indexes: NO new composite index is required for this feature.
 *
 * Archived items are filtered out of both, matching every other list surface
 * in the app — an archived record means "created in error", not "history".
 */
export function useSiteLifecycle(siteId: string | undefined): SiteLifecycle {
  const [site,       setSite]       = useState<Site | null>(null);
  const [workOrders, setWorkOrders] = useState<LifecycleEntry[]>([]);
  const [siteTasks,  setSiteTasks]  = useState<LifecycleEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  // ── The site document ──────────────────────────────────────────────────
  // Read directly rather than from siteStore: that store holds only
  // non-archived sites and only populates for admin/viewer sessions, so a
  // deep link to an archived site would otherwise render "not found".
  // The async IIFE routes the id-less reset through a microtask rather than a
  // bare synchronous setState in the effect body — same pattern, and the same
  // reason, as useSurveyUpdates.ts / useSiteWorkOrders.ts. No real async work
  // happens before the listener attaches.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    (async () => {
      if (!siteId) { setSite(null); setLoading(false); return; }
      setLoading(true);

      unsubscribe = onSnapshot(
      doc(db, 'sites', siteId),
      (snap) => {
        if (!snap.exists()) { setSite(null); setLoading(false); return; }
        const d = snap.data();
        setSite({
          id:                   snap.id,
          siteCode:             d['siteCode']     ?? '',
          siteName:             d['siteName']     ?? '',
          city:                 d['city']         ?? '',
          state:                d['state']        ?? '',
          address:              d['address']      ?? '',
          circle:               d['circle']       ?? undefined,
          division:             d['division']     ?? undefined,
          projectId:            d['projectId']    ?? '',
          projectName:          d['projectName']  ?? '',
          projectCode:          d['projectCode']  ?? '',
          location:             d['location']
            ? { lat: d['location'].latitude ?? d['location'].lat,
                lng: d['location'].longitude ?? d['location'].lng }
            : null,
          status:               (d['status'] ?? 'active') as SiteStatus,
          taskCount:            d['taskCount']            ?? 0,
          completedTaskCount:   d['completedTaskCount']   ?? 0,
          inProgressTaskCount:  d['inProgressTaskCount']  ?? 0,
          blockedTaskCount:     d['blockedTaskCount']     ?? 0,
          pendingApprovalTaskCount: d['pendingApprovalTaskCount'] ?? 0,
          createdBy:            d['createdBy']    ?? '',
          createdAt:            d['createdAt']?.toDate?.()  ?? new Date(),
          archived:             d['archived']     ?? false,
          archivedAt:           d['archivedAt']?.toDate?.() ?? null,
          sapCode:              d['sapCode']      ?? null,
          zone:                 d['zone']         ?? null,
          voltageClass:         d['voltageClass'] ?? null,
          totalBays:            d['totalBays']            ?? null,
          numPowerTransformers: d['numPowerTransformers'] ?? null,
          workOrderCounters:    d['workOrderCounters']    ?? {},
        });
        setLoading(false);
      },
      (err) => {
        console.error('[useSiteLifecycle] site listener error:', err);
        setError(err.message);
        setLoading(false);
      },
      );
    })();

    return () => unsubscribe?.();
  }, [siteId]);

  // ── Work orders at this site ───────────────────────────────────────────
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    (async () => {
      if (!siteId) { setWorkOrders([]); return; }

      unsubscribe = onSnapshot(
      query(collection(db, 'workOrders'), where('siteId', '==', siteId)),
      (snap) => {
        setWorkOrders(
          snap.docs
            .map((d) => mapWorkOrder(d.id, d.data()))
            .filter((w) => !w.archived)
            .map((w): LifecycleEntry => ({
              kind:   'workOrder',
              id:     w.id,
              code:   w.workOrderCode,
              label:  WORK_ORDER_STAGE_LABEL[w.stage] ?? w.stage,
              status: w.status,
              assignedToName: w.assignedToName,
              updatedAt: w.updatedAt,
              stage:  w.stage,
              // The survey record page keys off the WORK ORDER id (the paired
              // survey shares it — see createWorkOrder). Later stages have no
              // screen yet, so their rows are informational only.
              linkTo: w.stage === 'survey' ? `/survey-record/${w.id}` : null,
            })),
        );
      },
      (err) => {
        console.error('[useSiteLifecycle] workOrders listener error:', err);
        setError(err.message);
      },
      );
    })();

    return () => unsubscribe?.();
  }, [siteId]);

  // ── Site tasks at this site ────────────────────────────────────────────
  // Only the handful of fields the timeline renders are mapped — this hook
  // never needs the full SiteTask (subtasks, answers, photos), and the page
  // hands the drawer a real SiteTask from useSiteTasks when one is opened.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    (async () => {
      if (!siteId) { setSiteTasks([]); return; }

      unsubscribe = onSnapshot(
      query(collection(db, 'siteTasks'), where('siteId', '==', siteId)),
      (snap) => {
        setSiteTasks(
          snap.docs
            .filter((d) => d.data()['archived'] !== true)
            .map((d): LifecycleEntry => {
              const data = d.data();
              return {
                kind:   'siteTask',
                id:     d.id,
                code:   data['taskCode']  ?? '',
                label:  data['taskLabel'] ?? '',
                status: (data['status'] ?? 'pending') as TaskStatus,
                assignedToName: data['assignedToName'] ?? null,
                updatedAt: data['updatedAt']?.toDate?.() ?? new Date(),
                stage:  null,
                // No route exists for a site task — the page opens the
                // existing SiteTaskDetailDrawer read-only instead.
                linkTo: null,
              };
            }),
        );
      },
      (err) => {
        console.error('[useSiteLifecycle] siteTasks listener error:', err);
        setError(err.message);
      },
      );
    })();

    return () => unsubscribe?.();
  }, [siteId]);

  // Newest first — one merged timeline.
  const entries = [...workOrders, ...siteTasks].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );

  return { site, entries, loading, error };
}

// ─── Stage helpers ────────────────────────────────────────────────────────────

export const WORK_ORDER_STAGE_LABEL: Record<WorkOrderStage, string> = {
  survey:        'Survey',
  repair:        'Repair',
  commissioning: 'Commissioning',
  amc:           'AMC',
};

/** The contract lifecycle, in order. Only 'survey' is implemented today. */
export const WORK_ORDER_STAGES: readonly WorkOrderStage[] = [
  'survey', 'repair', 'commissioning', 'amc',
];

export interface StageSummary {
  stage:  WorkOrderStage;
  label:  string;
  /** null when no work order exists for this stage yet — "Not started". */
  status: WorkOrderStatus | null;
  /** How many work orders this site has had at this stage. */
  count:  number;
}

/**
 * Current state of each of the four lifecycle stages at this site, derived
 * from the timeline.
 *
 * A stage with no work order reads "Not started" rather than being hidden:
 * only the survey stage is built today, and showing all four makes it visible
 * that repair/commissioning/AMC are coming rather than missing. Status comes
 * from the MOST RECENT work order at that stage (entries arrive newest-first).
 */
export function summariseStages(entries: LifecycleEntry[]): StageSummary[] {
  return WORK_ORDER_STAGES.map((stage) => {
    const forStage = entries.filter((e) => e.kind === 'workOrder' && e.stage === stage);
    return {
      stage,
      label:  WORK_ORDER_STAGE_LABEL[stage],
      status: forStage.length > 0 ? (forStage[0].status as WorkOrderStatus) : null,
      count:  forStage.length,
    };
  });
}
