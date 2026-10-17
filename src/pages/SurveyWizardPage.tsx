import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { AlertTriangle, Clock, X } from 'lucide-react';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { useSurveyReport, normaliseRestoredDraft } from '@/hooks/useSurveyReport';
import { useSurveyActions } from '@/hooks/useSurveyActions';
import {
  useSurveySubmitQueue,
  toSurveyPayload,
  findLocalPhotoRefs,
  stripLocalPhotoRefs,
  replaceLocalPhotoRef,
} from '@/lib/surveySubmitQueue';
import type { PendingSurveyPhoto } from '@/lib/surveySubmitQueue';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useToast } from '@/components/ui/toast';
import { saveDraft, loadDraft, deleteDraft, markDraftSynced } from '@/lib/surveyDraftStore';
import { chooseDraftSource, surveySignature, buildAutosavePayload } from '@/lib/surveyDraftSync';
import { v4 as uuidv4 } from 'uuid';
import { mergePhotoFields, photoRefsIn, removedRefs } from '@/lib/surveyPhotoMerge';
import {
  signFields, writeSurveyFields, shieldFilledAnswers, planAutosave,
  recordTouches, composeTouched, adoptWithTouches,
  type FieldSignatures, type TouchedInputs,
} from '@/lib/surveyDelta';
import { useDebouncedRemoteSave } from '@/hooks/useDebouncedRemoteSave';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { usePendingPhotos } from '@/hooks/usePendingPhotos';
import { PHOTO_UPLOADED_EVENT, type PhotoUploadedDetail } from '@/lib/surveyPhotoUploader';
import { getPhoto, deletePhoto, blobToDataUrl, deletePhotosForWorkOrder } from '@/lib/surveyPhotoStore';
import { uploadToCloudinary } from '@/utils/uploadToCloudinary';
import { validateSurvey, getStepStatuses } from '@/lib/surveyValidation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { StepSiteVisit } from '@/components/survey/steps/StepSiteVisit';
import { StepFeederList } from '@/components/survey/steps/StepFeederList';
import { StepCapacitorBanks } from '@/components/survey/steps/StepCapacitorBanks';
import { StepTransformerDetails } from '@/components/survey/steps/StepTransformerDetails';
import { StepInfrastructure } from '@/components/survey/steps/StepInfrastructure';
import { StepAcdcDetails } from '@/components/survey/steps/StepAcdcDetails';
import { LegacyVoltageBanner } from '@/components/survey/LegacyVoltageBanner';
import { StepCableRuns } from '@/components/survey/steps/StepCableRuns';
import { StepPhotos } from '@/components/survey/steps/StepPhotos';
import { StepBoq } from '@/components/survey/steps/StepBoq';
import { StepSignOff } from '@/components/survey/steps/StepSignOff';
import type { StepStatus } from '@/lib/surveyValidation';
import type { SurveyStepProps } from '@/components/survey/steps/StepProps';
import type { SurveyReport } from '@/types';

// ─── Steps ────────────────────────────────────────────────────────────────────

interface WizardStep {
  key: string;
  label: string;
  Component: React.ComponentType<SurveyStepProps>;
  /**
   * This step's index in surveyValidation.ts's POSITIONAL status array, which
   * still describes the old 8-step form. The two orders no longer line up, so
   * every soft-validation read goes through this field instead of the step's
   * own index — otherwise Capacitor Banks would show Infrastructure's issue
   * count.
   *
   * null for steps the current validator knows nothing about; they read as
   * 'untouched' until the validation phase rewrites surveyValidation.ts, at
   * which point this indirection is deleted and the arrays align again.
   */
  validationIndex: number | null;
}

/**
 * The confirmed 10-step structure. Every step has a real form.
 *
 * CRP Relay Details was REMOVED here — MSETCL confirmed it is not required.
 * Only the wizard entry is gone: `survey.relays[]` stays on the type, in the
 * factory and in the mapper, existing entries are untouched, and the preview
 * still renders them for a survey submitted before this change.
 *
 * No renumbering was needed. `validationIndex` is matched BY VALUE
 * (statusForStep indexes the status array with it; wizardIndexForValidationIndex
 * searches for it), not by position, so dropping the step that claimed index 2
 * simply leaves that index unclaimed — every other step keeps the index it
 * always had. The validator's positional array deliberately KEEPS its slot 2
 * so indices 3-7 do not shift; it is inert because nothing emits an issue
 * there any more.
 */
const STEPS: WizardStep[] = [
  { key: 'site_visit', label: 'Site & Visit', Component: StepSiteVisit, validationIndex: 0 },
  { key: 'feeders', label: 'Feeder List', Component: StepFeederList, validationIndex: 1 },
  { key: 'capacitor_banks', label: 'Capacitor Banks', Component: StepCapacitorBanks, validationIndex: null },
  { key: 'transformers', label: 'Transformer Details', Component: StepTransformerDetails, validationIndex: null },
  { key: 'infrastructure', label: 'Site Infrastructure & Checklist', Component: StepInfrastructure, validationIndex: 3 },
  // New step, no validation rules yet — same treatment Capacitor Banks and
  // Transformer Details got when they first landed. validationIndex: null
  // means it reads 'untouched' and can never nag.
  { key: 'acdc_details', label: 'ACDB & DCDB Details', Component: StepAcdcDetails, validationIndex: null },
  { key: 'cable_runs', label: 'Cable Runs', Component: StepCableRuns, validationIndex: 4 },
  { key: 'photos', label: 'Photos', Component: StepPhotos, validationIndex: 5 },
  { key: 'boq', label: 'BOQ', Component: StepBoq, validationIndex: 6 },
  { key: 'sign_off', label: 'Sign-Off', Component: StepSignOff, validationIndex: 7 },
];

/** A step the validator doesn't cover yet — never 'incomplete', so it can't nag. */
const UNVALIDATED_STEP: StepStatus = { state: 'untouched', missingCount: 0 };

/**
 * Soft-validation status for a wizard step, via its validationIndex. Falls
 * back to 'untouched' both for placeholder steps and for a status array
 * shorter than expected, so a validator/registry mismatch degrades to "no
 * indicator" rather than a crash on undefined.
 */
function statusForStep(statuses: StepStatus[], step: WizardStep): StepStatus {
  if (step.validationIndex === null) return UNVALIDATED_STEP;
  return statuses[step.validationIndex] ?? UNVALIDATED_STEP;
}

/**
 * Maps a validation issue's stepIndex (old 8-step numbering) back to the
 * wizard step that now owns it, so "jump to issue" lands on the right screen.
 * Returns null if no step claims that index.
 */
function wizardIndexForValidationIndex(validationIndex: number): number | null {
  const found = STEPS.findIndex((s) => s.validationIndex === validationIndex);
  return found === -1 ? null : found;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Attempts to resolve every still-local photo reference by uploading it right
 * now (used at online Submit — capture-time upload may have failed earlier
 * in the session, e.g. a transient network blip). Returns the survey with
 * whatever succeeded replaced by its https:// URL, and allUploaded=false if
 * anything is still local:// afterward — the caller falls back to queueing
 * in that case rather than ever submitting a local:// reference to Firestore.
 */
/**
 * A signature is captured as a transparent PNG. Re-encoding it as JPEG drops
 * the alpha channel, which turned the whole image black — and even with a
 * white background painted in, lossy compression only costs a few kilobytes
 * of line art its crispness. Uploaded byte-for-byte instead.
 */
function isSignatureTarget(kind: string): boolean {
  return kind === 'signOffSurveyorSignature' || kind === 'signOffMsetclSignature';
}

async function resolveOnlinePhotoUploads(
  data: SurveyReport,
  siteCode: string,
): Promise<{ resolved: SurveyReport; allUploaded: boolean }> {
  let resolved = data;
  let allUploaded = true;

  for (const { photoId, target } of findLocalPhotoRefs(data)) {
    const stored = await getPhoto(photoId);
    if (!stored) {
      allUploaded = false; // orphan reference — nothing recoverable locally
      continue;
    }
    try {
      // Extension derived from the stored MIME type, not hardcoded .jpg — a
      // PNG signature named .jpg misreports itself to Cloudinary.
      const ext  = stored.mimeType === 'image/png' ? 'png' : 'jpg';
      const file = new File([stored.blob], `${photoId}.${ext}`, { type: stored.mimeType });
      const result = await uploadToCloudinary(file, {
        taskNum: siteCode,
        photoType: 'completion',
        index: 0,
        skipCompression: isSignatureTarget(target.kind),
      });
      resolved = replaceLocalPhotoRef(resolved, `local://${photoId}`, result.url);
      await deletePhoto(photoId).catch(() => { });
    } catch (err) {
      console.error('[SurveyWizardPage] submit-time photo upload failed:', err);
      allUploaded = false;
    }
  }

  return { resolved, allUploaded };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/** Top-level fields that hold photo references. */
const PHOTO_FIELDS = ['feeders', 'relays', 'sitePhotos', 'signOff'] as const;

/** A field still holding a photo that exists only on this device. */
function holdsLocalPhoto(value: unknown): boolean {
  return JSON.stringify(value ?? null).includes('local://');
}

export function SurveyWizardPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { survey, loading, error } = useSurveyReport(workOrderId);
  const { submitSurvey, saveProgress } = useSurveyActions();
  const featureFlags = useFeatureFlags();
  const { enqueue } = useSurveySubmitQueue();
  const isOnline = useNetworkStatus();
  const { showToast } = useToast();

  const [workOrderMeta, setWorkOrderMeta] = useState<{ workOrderCode: string; siteName: string } | null>(null);
  const [workOrderMetaError, setWorkOrderMetaError] = useState<string | null>(null);
  const [siteMaster, setSiteMaster] = useState<{ totalBays: number | null; numPowerTransformers: number | null } | null>(null);
  const [surveyData, setSurveyData] = useState<SurveyReport | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [localReady, setLocalReady] = useState(false);
  const [draftInfo, setDraftInfo] = useState<{ updatedAt: number } | null>(null);
  /**
   * True once the restore pass has looked and found nothing on this device.
   * Distinct from `draftInfo === null`, which is also the state before the
   * lookup has run — and the notice must not flash during load.
   */
  const [noDraftFound, setNoDraftFound] = useState(false);
  const [noDraftNoticeDismissed, setNoDraftNoticeDismissed] = useState(false);
  /**
   * A draft DOES exist on this device, but chooseDraftSource picked the
   * server's copy because another device pushed more recently.
   *
   * Tracked separately from `noDraftFound` because the two are opposite facts
   * that used to share one branch: the restore effect's `else` set
   * `noDraftFound` for both, so an engineer whose work had been superseded was
   * told "No draft found on this device" when there was one. That reads as
   * "your work is gone" at exactly the moment it has not been — the cloud copy
   * is newer, and the local one was simply not needed.
   */
  const [cloudCopyUsed, setCloudCopyUsed] = useState(false);
  const [cloudCopyNoticeDismissed, setCloudCopyNoticeDismissed] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showValidationSummary, setShowValidationSummary] = useState(false);

  const initializedRef = useRef(false);
  const startedTransitionRef = useRef(false);
  /** Single-flight lock for Submit — see handleSubmit for why state won't do. */
  const submitLockRef = useRef(false);

  // ── One-time WorkOrder meta fetch — workOrderCode/siteName for the header ──
  // A plain getDoc (not a listener): these two fields never change after
  // creation, and a single-doc read uses the stricter `get` rule, so an
  // unauthorized deep-link surfaces as a caught error, not a crash.
  useEffect(() => {
    if (!workOrderId) return;
    getDoc(doc(db, 'workOrders', workOrderId))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setWorkOrderMeta({
            workOrderCode: data['workOrderCode'] ?? '',
            siteName: data['siteName'] ?? '',
          });
        }
      })
      .catch((err) => {
        console.error('[SurveyWizardPage] work order fetch failed:', err);
        setWorkOrderMetaError('Could not load work order details.');
      });
  }, [workOrderId]);

  // ── One-time Site master fetch — totalBays/numPowerTransformers hint for Step 1 ──
  // Any authenticated user may `get` a site doc (firestore.rules: `allow read:
  // if isAuthenticated()`), so this is safe for field engineers too, not just
  // admins. Keyed on survey.siteId (denormalised onto SurveyReport already),
  // so it only needs the survey listener, not a second workOrder round-trip.
  useEffect(() => {
    if (!survey?.siteId) return;
    getDoc(doc(db, 'sites', survey.siteId))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setSiteMaster({
            totalBays: data['totalBays'] ?? null,
            numPowerTransformers: data['numPowerTransformers'] ?? null,
          });
        }
      })
      .catch((err) => {
        console.error('[SurveyWizardPage] site master fetch failed:', err);
      });
  }, [survey?.siteId]);

  // ── Load local draft or fall back to the server copy (once, per work order) ──
  useEffect(() => {
    if (loading || initializedRef.current) return;
    initializedRef.current = true;

    let restoredLocal: SurveyReport | null = null;
    (async () => {
      if (!survey) {
        setLocalReady(true);
        return;
      }
      try {
        const draft = await loadDraft(survey.workOrderId);

        // chooseDraftSource GENERALISES the previous behaviour rather than
        // replacing it: with remote autosave off, lastSyncedAt is never
        // written, so it returns 'local' whenever a draft exists and 'remote'
        // otherwise — exactly what this effect did before. The conflict branch
        // is unreachable until the feature is switched on.
        const source = chooseDraftSource({
          localUpdatedAt: draft?.updatedAt ?? null,
          localLastSyncedAt: draft?.lastSyncedAt ?? null,
          localSyncToken: draft?.lastSyncedToken ?? null,
          remoteSyncToken: survey.draftSyncToken ?? null,
        });

        if (draft && source === 'local') {
          // Normalised, never spread raw: a draft saved before a field existed
          // would otherwise restore that field as undefined and crash the
          // wizard's render body. See normaliseRestoredDraft.
          restoredLocal = normaliseRestoredDraft(survey, draft.data);
          setSurveyData(restoredLocal);
          setStepIndex(draft.stepIndex);
          setDraftInfo({ updatedAt: draft.updatedAt });
        } else {
          setSurveyData(survey);
          // Two different facts, two different notices. `noDraftFound` means
          // this device genuinely holds nothing; a draft that exists but lost
          // to a newer cloud copy is the opposite situation and gets its own
          // message. Deciding on `draft` alone — never on `source` — keeps
          // this correct whichever way chooseDraftSource is extended later.
          if (draft) setCloudCopyUsed(true);
          else setNoDraftFound(true);
        }
      } catch (err) {
        console.error('[SurveyWizardPage] draft load failed:', err);
        setSurveyData(survey);
        // A failed lookup is indistinguishable from an absent draft as far as
        // the engineer is concerned: either way this device has nothing to
        // continue from, and saying so is what matters.
        setNoDraftFound(true);
      }
      // "What the server holds" = the EXACT snapshot the form was built from.
      // This first snapshot can come from Firestore's offline cache and be
      // older than the server. Taking the baseline from a LATER snapshot
      // instead made the stale values on screen look like local edits, and
      // the new device pushed them over the other device's work. With the
      // baseline here, a fresher snapshot is simply adopted field by field.
      serverSigsRef.current = sigsOf(survey);
      serverBaseRef.current = survey;
      // A restored local draft (this device's own, or the only copy) may hold
      // edits that never reached the server — mark exactly those as touched so
      // they still go out. A form loaded from the server starts untouched.
      if (restoredLocal) {
        const keys = new Set([...serverSigsRef.current.keys(), ...sigsOf(restoredLocal).keys()]);
        keys.delete('draftSyncToken');
        recordTouches(touchedRef.current, survey, restoredLocal, keys);
      }
      lastPushedTokenRef.current = survey.draftSyncToken ?? null;
      setLocalReady(true);
    })();
  }, [survey, loading]);

  // ── First-edit transition: open/changes_requested → in_progress ──
  // Deliberately NOT fired on mount — useSurveyReport is a live listener, so
  // an effect-driven transition on open flips status (and hides the
  // changes_requested review-notes banner) before the engineer can even read
  // it, and would fire just from an admin opening the survey to look at it.
  // Instead this runs only from an actual user action (first handleChange,
  // and again defensively right before submit), and only for the assigned
  // engineer — an admin viewing/reviewing a survey must never mutate it by
  // observation. Guarded by startedTransitionRef so it only ever writes once.
  async function ensureInProgress() {
    if (!survey || !currentUser || !isOnline || startedTransitionRef.current) return;
    if (survey.assignedTo !== currentUser.uid) return;
    if (survey.status !== 'open' && survey.status !== 'changes_requested') return;

    startedTransitionRef.current = true;
    try {
      await saveProgress(survey.id, {
        workOrderId: survey.workOrderId,
        data: {},
        previousStatus: survey.status,
      });
    } catch (err) {
      console.error('[SurveyWizardPage] status transition failed:', err);
      startedTransitionRef.current = false; // allow a retry
    }
  }

  /**
   * Ask the browser to keep this origin's storage.
   *
   * An in-progress survey exists ONLY in IndexedDB until Submit, and without
   * this the browser may evict it under storage pressure — which loses 30-45
   * minutes of field work with no server copy to fall back on. Best-effort by
   * design: Chrome may grant it silently, Safari may decline, and a refusal is
   * not an error worth showing anyone. Logged so a future loss report can be
   * checked against whether storage was actually persisted.
   */
  const persistAskedRef = useRef(false);
  useEffect(() => {
    if (persistAskedRef.current) return;
    if (!survey || !currentUser || survey.assignedTo !== currentUser.uid) return;
    if (!navigator.storage?.persist) return;
    persistAskedRef.current = true;

    void (async () => {
      try {
        const persisted = await navigator.storage.persist();
        const estimate = await navigator.storage.estimate?.();
        console.info('[SurveyWizardPage] storage persisted:', persisted, estimate ?? '(no estimate)');
      } catch (err) {
        console.warn('[SurveyWizardPage] storage.persist() failed:', err);
      }
    })();
  }, [survey, currentUser]);

  // ── Debounced REMOTE autosave — makes the work survive the device ─────────
  //
  // The local draft below is the crash buffer; this is the slower push that
  // lets an engineer resume on another device. Behind a kill switch, and OFF
  // unless an admin turns it on — see AppConfig.surveyRemoteAutosaveEnabled.
  //
  // Only the assigned engineer writes. An admin or approver opening a survey
  // to look at it must never mutate it by observation, which is the same rule
  // ensureInProgress above is built around.
  const remoteAutosaveEnabled =
    featureFlags.surveyRemoteAutosaveEnabled
    && !!survey
    && !!currentUser
    && survey.assignedTo === currentUser.uid
    && (survey.status === 'open'
      || survey.status === 'in_progress'
      || survey.status === 'changes_requested');

  // Derived from the content, so a new edit path added later cannot forget to
  // mark the survey dirty. useMemo keys it on the survey object, so the walk
  // runs once per edit rather than once per render.
  const dataSignature = useMemo(
    () => (surveyData ? surveySignature(surveyData) : ''),
    [surveyData],
  );

  const remoteSave = useDebouncedRemoteSave({
    enabled: remoteAutosaveEnabled && localReady && !!surveyData,
    signature: dataSignature,
    // Near-real-time: ~2s after typing stops, never more than 8s while typing.
    // Affordable because each save is now a small delta, not the whole survey.
    debounceMs: 2_000,
    maxWaitMs: 8_000,
    save: async () => {
      if (!survey || !surveyData) return;
      // uuid, not crypto.randomUUID: the latter is undefined outside a secure
      // context — including a phone reaching the dev server over plain http.
      const token = uuidv4();
      lastPushedTokenRef.current = token;
      // Photos are merged, not replaced: the server may hold photos another
      // device added since this one last adopted. local:// refs are stripped —
      // they are blobs on this device only and would reach others as broken.
      // SHIELD: never blank an answer this device has never seen filled.
      const base = serverBaseRef.current ?? survey;
      const shielded = shieldFilledAnswers(surveyData, survey, base);
      if (shielded !== surveyData) {
        // Show the protected answers here too, so the screen matches the server.
        setSurveyData((prev) => (prev ? shieldFilledAnswers(prev, survey, base) : prev));
      }
      const merged = mergePhotoFields(shielded, survey);
      // PER-INPUT: the latest server copy with ONLY the inputs the user
      // operated on here laid over it. Anything not touched on this device is
      // the server's own value, so it can never be overwritten from here.
      const composed = composeTouched(survey, merged, touchedRef.current);
      const payload = buildAutosavePayload(stripLocalPhotoRefs(composed), token) as Record<string, unknown>;

      // ONLY changed fields, on every path — see planAutosave. A device that
      // has not typed anything writes nothing, so opening the survey on another
      // device (even from a stale offline copy) can never overwrite it.
      const plan = planAutosave(payload, serverSigsRef.current, survey.status, new Set(touchedRef.current.keys()));
      // Touched inputs are now either sent or already equal to the server, so
      // they leave the set — except a field still holding an un-uploaded photo,
      // which stays protected until the upload lands. An edit made while this
      // save is in the air re-records itself; a failed save puts these back.
      const released: TouchedInputs = new Map();
      for (const [k, paths] of touchedRef.current) {
        if (holdsLocalPhoto((merged as unknown as Record<string, unknown>)[k])) continue;
        released.set(k, paths);
        touchedRef.current.delete(k);
      }
      const restoreTouches = () => {
        for (const [k, paths] of released) {
          const m = touchedRef.current.get(k) ?? new Map();
          for (const [id, path] of paths) m.set(id, path);
          touchedRef.current.set(k, m);
        }
      };
      if (plan.kind === 'skip') {
        lastPushedTokenRef.current = survey.draftSyncToken ?? null;
        return;
      }
      const sentKeys = Object.keys(plan.fields).filter((k) => k !== 'draftSyncToken');
      try {
        if (plan.kind === 'fields') {
          await writeSurveyFields(survey.id, plan.fields);
        } else {
          // open / changes_requested: saveProgress also performs the status
          // transition the rules require — but with the delta, never the full survey.
          await saveProgress(survey.id, {
            workOrderId: survey.workOrderId,
            data: plan.fields,
            previousStatus: survey.status,
          });
        }
      } catch (err) {
        restoreTouches();
        throw err;
      }
      // The server now holds what was SENT — untouched fields keep whatever
      // the server had, so only the sent ones are recorded as changed.
      serverSigsRef.current = new Map([...serverSigsRef.current, ...signFields(plan.fields)]);
      const nextBase = { ...(serverBaseRef.current ?? survey) } as Record<string, unknown>;
      for (const k of sentKeys) nextBase[k] = (composed as unknown as Record<string, unknown>)[k];
      serverBaseRef.current = nextBase as unknown as SurveyReport;
      // Show this device the photos it just merged in. Our own echo is skipped
      // by the live effect below, so without this they would not appear here.
      // Only when the merge actually changed the photo set: replacing the form
      // state on every save re-rendered every input and felt like a refresh.
      setSurveyData((prev) => {
        if (!prev) return prev;
        const next = mergePhotoFields(prev, merged);
        const same =
          JSON.stringify(photoRefsIn(next)) === JSON.stringify(photoRefsIn(prev))
          && JSON.stringify(next.removedPhotoRefs ?? []) === JSON.stringify(prev.removedPhotoRefs ?? []);
        return same ? prev : next;
      });
      // Written ONLY after a confirmed push — chooseDraftSource treats this
      // marker as proof the server has this device's work, and setting it
      // optimistically would let a genuinely newer remote copy be discarded.
      if (workOrderId) await markDraftSynced(workOrderId, token);
    },
  });

  // ── Live A↔B: adopt another device's save while this survey is open ──
  // Latest save wins. Skipped while this device has unsent edits: those go out
  // on the next save and the OTHER device adopts them instead, so neither
  // side's newest typing is thrown away mid-keystroke.
  const lastPushedTokenRef = useRef<string | null>(null);
  // True once a save from ANOTHER device lands while this form is open — the
  // exact situation that risks losing data. Cancel hides it for this visit.
  const [otherDeviceActive, setOtherDeviceActive] = useState(false);
  const [otherDeviceDismissed, setOtherDeviceDismissed] = useState(false);
  // The exact inputs the user operated on HERE that have not reached the
  // server yet. Only these are ever sent, and only these are kept over the
  // server's values — see composeTouched / adoptWithTouches.
  const touchedRef = useRef<TouchedInputs>(new Map());
  // Per-field signatures of the last server version this device knows.
  const serverSigsRef = useRef<FieldSignatures>(new Map());
  // The server copy the form is built on — the shield's "what this device saw".
  const serverBaseRef = useRef<SurveyReport | null>(null);
  // Per-field signatures of what this device believes is on the server — the
  // basis for both delta saves and per-field adopt.
  const sigsOf = (data: SurveyReport): FieldSignatures =>
    signFields(buildAutosavePayload(stripLocalPhotoRefs(data), '') as Record<string, unknown>);

  // Runs on EVERY server snapshot (own echoes included), so the known-server
  // state never goes stale. Adopts only fields the other device changed that
  // this device has not touched — typed answers are never overwritten.
  useEffect(() => {
    if (!remoteAutosaveEnabled || !localReady || !survey) return;

    const known = serverSigsRef.current;
    const serverSigs = sigsOf(survey);

    // First snapshot after load: just record the baseline.
    if (known.size === 0) {
      serverSigsRef.current = serverSigs;
      lastPushedTokenRef.current = survey.draftSyncToken ?? null;
      return;
    }

    // A save from ANOTHER device (not our own echo) — for the warning only.
    const tok = survey.draftSyncToken ?? null;
    if (tok && tok !== lastPushedTokenRef.current) {
      setOtherDeviceActive(true);
      lastPushedTokenRef.current = tok;
    }

    setSurveyData((prev) => {
      if (!prev) return prev;
      const keys = [...serverSigs.keys()].filter((k) => k !== 'draftSyncToken');
      const adopted = adoptWithTouches(prev, survey, keys, touchedRef.current);
      const merged = mergePhotoFields(adopted, survey);
      const photosSame =
        JSON.stringify(photoRefsIn(merged)) === JSON.stringify(photoRefsIn(adopted))
        && JSON.stringify(merged.removedPhotoRefs ?? []) === JSON.stringify(adopted.removedPhotoRefs ?? []);
      // Untouched state is returned as-is so the form does not re-render.
      if (adopted === prev && photosSame) return prev;
      return photosSame ? adopted : merged;
    });

    serverSigsRef.current = serverSigs;
    serverBaseRef.current = survey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survey]);

  // A step change is a natural checkpoint and worth far more than any timer.
  const lastFlushedStepRef = useRef(stepIndex);
  useEffect(() => {
    if (lastFlushedStepRef.current === stepIndex) return;
    lastFlushedStepRef.current = stepIndex;
    remoteSave.flush();
  }, [stepIndex, remoteSave]);

  // ── Background photo uploads land here while the wizard is open ──
  // Applied to live state so the in-memory survey (the source of truth while
  // open) never lags the uploader. Only claimed once the survey has loaded:
  // claiming earlier would let the uploader treat an unapplied swap as done.
  // Inert when the uploader switch is off — nothing dispatches the event.
  useEffect(() => {
    if (!workOrderId || !localReady) return;
    const onUploaded = (e: Event) => {
      const d = (e as CustomEvent<PhotoUploadedDetail>).detail;
      if (d.workOrderId !== workOrderId) return;
      setSurveyData((prev) => {
        if (!prev) return prev;
        const next = replaceLocalPhotoRef(prev, d.oldRef, d.newRef);
        recordTouches(touchedRef.current, prev, next, PHOTO_FIELDS);
        return next;
      });
      d.handled = true;
    };
    window.addEventListener(PHOTO_UPLOADED_EVENT, onUploaded);
    return () => window.removeEventListener(PHOTO_UPLOADED_EVENT, onUploaded);
  }, [workOrderId, localReady]);

  const pendingPhotos = usePendingPhotos(workOrderId);

  // ── Debounced local draft autosave — every field change and every step change ──
  useEffect(() => {
    if (!localReady || !surveyData || !workOrderId) return;
    const timer = setTimeout(() => {
      saveDraft(workOrderId, { data: surveyData, stepIndex }).catch((err) => {
        console.error('[SurveyWizardPage] draft save failed:', err);
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [surveyData, stepIndex, workOrderId, localReady]);

  function handleChange(patch: Partial<SurveyReport>) {
    setSurveyData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      // The exact inputs this edit changed — only these may ever be sent.
      recordTouches(touchedRef.current, prev, next, Object.keys(patch));
      if (!featureFlags.surveyRemoteAutosaveEnabled) return next;
      // A photo the user removed becomes a tombstone, so another device's
      // copy of it is not merged back in on the next sync.
      const gone = removedRefs(photoRefsIn(prev), photoRefsIn(next));
      if (!gone.length) return next;
      const withTombstones = { ...next, removedPhotoRefs: [...new Set([...(prev.removedPhotoRefs ?? []), ...gone])] };
      recordTouches(touchedRef.current, next, withTombstones, ['removedPhotoRefs']);
      return withTombstones;
    });
    void ensureInProgress();
  }

  // Runs inside the setState updater, so it always sees the latest state —
  // unlike an onChange(photos.map(...)) call computed from a possibly-stale
  // prop snapshot, concurrent replacements (e.g. several photos uploading in
  // the same React batch) can never clobber each other here.
  function replacePhotoReference(oldRef: string, newRef: string) {
    setSurveyData((prev) => {
      if (!prev) return prev;
      const next = replaceLocalPhotoRef(prev, oldRef, newRef);
      recordTouches(touchedRef.current, prev, next, PHOTO_FIELDS);
      return next;
    });
  }

  async function handleDiscardDraft() {
    if (!workOrderId || !survey) return;
    await deleteDraft(workOrderId);
    // The server copy we're reverting to can never contain a local:// photo
    // reference (those are stripped before any Firestore write), so any
    // blobs still in surveyPhotoStore for this work order are orphaned the
    // moment we revert — safe to clear, same as the draft itself.
    await deletePhotosForWorkOrder(workOrderId).catch(() => { });
    setSurveyData(survey);
    setStepIndex(0);
    setDraftInfo(null);
    setDiscardConfirm(false);
    showToast('Local changes discarded — showing the last submitted version', 'success');
  }

  async function handleSubmit() {
    if (!survey || !surveyData || !workOrderId || !currentUser) return;

    // SINGLE-FLIGHT, via a ref rather than the `submitting` state below.
    // `setSubmitting(true)` only disables the button after React commits a
    // render; two presses landing in the same tick both read the old state and
    // both proceed. A ref flips synchronously, so the second call returns here.
    // Same pattern as startedTransitionRef in ensureInProgress above.
    if (submitLockRef.current) return;
    submitLockRef.current = true;

    if (validateSurvey(surveyData).some((i) => i.severity === 'error')) {
      setShowValidationSummary(true);
      submitLockRef.current = false;   // nothing was sent — let them fix and retry
      return;
    }
    setShowValidationSummary(false);
    setSubmitting(true);

    // Captured as plain locals (rather than referencing survey/currentUser
    // directly) so the nested queueOffline function below doesn't depend on
    // TypeScript's narrowing surviving into a hoisted function declaration —
    // it doesn't, since a declaration is technically callable from anywhere
    // in this scope.
    const woId = workOrderId;
    const surveyId = survey.id;
    const siteCode = survey.siteCode;
    const submittedBy = currentUser.uid;
    const submittedByName = currentUser.name;

    // Builds the pendingPhotos envelope from every local:// reference still
    // in `data`, reading each blob and converting it to the base64 data: URI
    // SurveyQueueProcessor's base64ToFile expects, then enqueues with those
    // references stripped out — a local:// string must never reach
    // Firestore. The processor's appendUploadedPhoto re-appends the real URL
    // once each pending photo uploads successfully.
    async function queueOffline(data: SurveyReport) {
      const pendingPhotos: PendingSurveyPhoto[] = [];
      for (const { photoId, target } of findLocalPhotoRefs(data)) {
        const stored = await getPhoto(photoId);
        if (!stored) continue; // orphan reference — nothing recoverable, drop silently
        const dataUri = await blobToDataUrl(stored.blob);
        pendingPhotos.push({ photoId, target, localUrl: dataUri });
      }

      await enqueue({
        workOrderId: woId,
        surveyReportId: surveyId,
        siteCode,
        submittedBy,
        submittedByName,
        data: toSurveyPayload(stripLocalPhotoRefs(data)),
        pendingPhotos,
        queuedAt: Date.now(),
        attempts: 0,
      });
    }

    try {
      await ensureInProgress();

      if (!isOnline) {
        await queueOffline(surveyData);
        // Do NOT delete the local draft or photos here — the submission only
        // exists in the IndexedDB queue until SurveyQueueProcessor
        // successfully drains it. Deleting them now would leave no
        // recoverable copy if the drain fails permanently. The processor
        // deletes the draft after success; pendingPhotos' blobs are read
        // straight from the queue item from here on, not from the photo
        // store, so they're already redundant — but harmless until cleared.
        showToast('Saved offline — kept on this device until it syncs', 'success');
        navigate('/surveys');
        return;
      }

      // Online: resolve any photo still local:// (normally none — capture
      // time already uploaded — but a transient failure can leave one
      // behind). Never submit a survey containing a local:// reference.
      let dataToSubmit = surveyData;
      if (findLocalPhotoRefs(surveyData).length > 0) {
        const { resolved, allUploaded } = await resolveOnlinePhotoUploads(surveyData, survey.siteCode);
        if (!allUploaded) {
          await queueOffline(resolved);
          showToast("Some photos couldn't upload right now — saved offline and will sync automatically", 'warning');
          navigate('/surveys');
          return;
        }
        dataToSubmit = resolved;
      }

      await submitSurvey(survey.id, {
        workOrderId,
        data: dataToSubmit,
        submittedBy: currentUser.uid,
        submittedByName: currentUser.name,
      });
      await deleteDraft(workOrderId);
      await deletePhotosForWorkOrder(workOrderId).catch(() => { });
      showToast('Survey submitted for approval', 'success');
      navigate('/surveys');
    } catch (err) {
      console.error('[SurveyWizardPage] submit failed:', err);
      showToast('Failed to submit. Try again.', 'error');
      // Released ONLY on failure. A successful submit navigates away, and the
      // lock must not reopen behind that navigation — leaving it held is what
      // makes a late tap on an unmounting screen a no-op.
      submitLockRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  // ── Loading / error / not-found states ──────────────────────────────────────

  if (loading || !localReady) {
    return <div className="p-6 text-center text-sm text-gray-400">Loading survey…</div>;
  }

  if (error) {
    return <div className="p-6 text-center text-sm text-brand-red">Failed to load survey: {error}</div>;
  }

  if (!survey || !surveyData) {
    return (
      <div className="p-6 text-center text-sm text-gray-400">
        Survey not found, or you don&apos;t have access to it.
      </div>
    );
  }

  const isReadOnly = survey.status === 'pending_approval' || survey.status === 'approved';

  /**
   * Never submitted. `submittedAt` is seeded null by createEmptySurveyReport
   * and written ONLY by submitSurvey, and nothing ever clears it — so a null
   * here means no version of this survey has ever reached the server with
   * content in it.
   */
  const neverSubmitted = survey.submittedAt == null;
  const isAssignedEngineer = !!currentUser && survey.assignedTo === currentUser.uid;

  /**
   * Discarding reverts to the SERVER copy — which, for a survey that has never
   * been submitted, is an empty shell. Offering "revert" there is offering to
   * delete everything with nothing to revert to, so the control is hidden
   * entirely. It stays for a sent-back survey, where the submitted version is
   * a real thing to go back to.
   */
  const canDiscardDraft = !!draftInfo && !neverSubmitted;

  /**
   * This device has no draft for a survey someone has already started working
   * on. Shown only to the assigned engineer, and only where it is genuinely
   * ambiguous: 'open' means nothing was started, and 'changes_requested' means
   * the server copy holds the submitted data, so neither is a mystery.
   */
  const showNoDraftNotice =
    isAssignedEngineer
    && !isReadOnly
    && noDraftFound
    && !noDraftNoticeDismissed
    && neverSubmitted
    && survey.status === 'in_progress';

  /**
   * The cloud copy was opened in preference to this device's older draft.
   *
   * Same audience gate as the notice above — the assigned engineer, on a
   * survey they can still edit. An admin, approver or viewer never filled
   * this form on another device, so for them it would be noise about a draft
   * that is not theirs. Deliberately NOT gated on neverSubmitted or on a
   * particular status: unlike the no-draft case there is nothing ambiguous
   * here, it is simply a fact about which copy is on screen.
   */
  const showCloudCopyNotice =
    isAssignedEngineer
    && !isReadOnly
    && cloudCopyUsed
    && !cloudCopyNoticeDismissed;
  // Stays visible while the engineer reworks and after status moves on to
  // in_progress — gating on the literal 'changes_requested' status would hide
  // the notes the moment ensureInProgress() flips it, which is the whole
  // point of moving that transition off the old changes_requested check.
  const showReviewNotesBanner = !!survey.reviewNotes && survey.status !== 'approved';
  const isLastStep = stepIndex === STEPS.length - 1;
  const { Component: StepComponent, label: stepLabel } = STEPS[stepIndex];
  const progressPct = ((stepIndex + 1) / STEPS.length) * 100;

  // Soft validation (step pills / per-step note) and hard validation (Submit
  // gate) share the same pure implementation — recomputed on every render,
  // which is cheap for a document this size and keeps both always in sync
  // with the live edit, no memoisation needed.
  const stepStatuses = getStepStatuses(surveyData);
  const validationIssues = validateSurvey(surveyData);
  const currentStepStatus = statusForStep(stepStatuses, STEPS[stepIndex]);
  const validationErrorCount = validationIssues.filter((i) => i.severity === 'error').length;
  const validationWarningCount = validationIssues.length - validationErrorCount;

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-24">

      {/* Header */}
      <div>
        <p className="text-xs text-gray-400 font-mono">
          {workOrderMeta?.workOrderCode || survey.siteCode}
        </p>
        <h2 className="text-xl font-bold text-gray-900 leading-snug">
          {workOrderMeta?.siteName || survey.siteCode}
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">{survey.siteCode}</p>
        {workOrderMetaError && (
          <p className="text-xs text-amber-600 mt-0.5">{workOrderMetaError}</p>
        )}
      </div>

      {/* Photos still only on this device — the signal that it is not yet
          safe to switch devices. Shown only with the uploader switch on. */}
      {featureFlags.surveyBackgroundPhotoUploadEnabled && pendingPhotos > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {pendingPhotos} photo{pendingPhotos !== 1 ? 's' : ''} still uploading from this device
          {!isOnline && ' — waiting for signal'}. Keep this device until it reaches zero.
        </div>
      )}

      {/* Same form open on another device — warn in plain words. */}
      {remoteAutosaveEnabled && otherDeviceActive && !otherDeviceDismissed && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
          <p className="text-xs text-amber-900">
            <span className="font-semibold">This form is open on another device too.</span>{' '}
            Please fill it on one device only, so no data gets lost.
          </p>
          <button
            type="button"
            onClick={() => setOtherDeviceDismissed(true)}
            className="shrink-0 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Remote sync status — only while the feature is on and there is
          something to say. Silence is the normal state. */}
      {/* Routine saves are silent: with saves every couple of seconds, a
          "Syncing…" banner appearing above the form made the whole step jump
          on each one. Only states the engineer must act on are shown. */}
      {remoteAutosaveEnabled && (remoteSave.error || (!isOnline && remoteSave.dirty)) && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${remoteSave.error
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-blue-200 bg-blue-50 text-brand-blue'
            }`}
        >
          {!isOnline
            ? 'Offline — saved on this device. Will sync when signal returns.'
            : 'Saved on this device, but could not sync yet. It will try again on your next change.'}
        </div>
      )}

      {/* Draft restored banner */}
      {/* A newer copy from another device was opened instead of this one's
          older draft. Blue, not amber: nothing is wrong and nothing needs
          acting on — it only explains why the form may not look like the
          engineer left it here. */}
      {showCloudCopyNotice && (
        <div className="flex items-start justify-between gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
          <p className="text-xs text-brand-blue">
            Opened the latest version saved from another device. The older copy on this device was
            not used.
          </p>
          <button
            type="button"
            onClick={() => setCloudCopyNoticeDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-brand-blue hover:bg-blue-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* No draft on this device for a survey that was already started. */}
      {showNoDraftNotice && (
        <div className="flex items-start justify-between gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          <p className="text-xs text-amber-800">
            No draft found on this device. If you started this survey on another phone, browser or
            the installed app, open it there to continue. Anything you enter here starts a blank
            form.
          </p>
          <button
            type="button"
            onClick={() => setNoDraftNoticeDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-amber-700 hover:bg-amber-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {draftInfo && !discardConfirm && !featureFlags.surveyRemoteAutosaveEnabled && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
          <span className="text-xs text-brand-blue">
            Draft restored — last saved {formatTime(draftInfo.updatedAt)}
          </span>
          {canDiscardDraft && (
            <button
              type="button"
              onClick={() => setDiscardConfirm(true)}
              className="text-xs font-medium text-brand-red hover:underline shrink-0"
            >
              Discard draft
            </button>
          )}
        </div>
      )}
      {discardConfirm && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 flex flex-col gap-2">
          <p className="text-xs text-red-700">
            This deletes the changes you made on this device since the last submitted version,
            including photos not yet uploaded. It cannot be undone.
          </p>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setDiscardConfirm(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" className="text-xs bg-brand-red hover:bg-red-700" onClick={handleDiscardDraft}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {/* Changes-requested banner — form stays editable */}
      {showReviewNotesBanner && (
        <div className="flex items-start gap-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-orange-800">
              Changes requested by {survey.reviewedByName ?? 'the approver'}
            </p>
            {survey.reviewNotes && (
              <p className="text-xs text-orange-700 mt-1 whitespace-pre-wrap">{survey.reviewNotes}</p>
            )}
          </div>
        </div>
      )}

      {/* Read-only banner */}
      {isReadOnly && (
        <div className="flex items-start gap-3 p-3 bg-violet-50 border border-violet-200 rounded-lg">
          <Clock className="h-5 w-5 text-violet-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-violet-800">
              {survey.status === 'approved' ? 'Approved' : 'Awaiting Approval'}
            </p>
            <p className="text-xs text-violet-600 mt-0.5">
              {survey.status === 'approved'
                ? 'This survey has been approved and can no longer be edited.'
                : 'This survey is awaiting approver review and cannot be edited right now.'}
            </p>
          </div>
        </div>
      )}

      {/* Step indicator — compact, usable one-handed */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-gray-700">
            Step {stepIndex + 1} of {STEPS.length}: {stepLabel}
          </span>
          {currentStepStatus.state === 'incomplete' && (
            <span className="text-xs font-medium text-amber-600 shrink-0">
              {currentStepStatus.missingCount} item{currentStepStatus.missingCount !== 1 ? 's' : ''} incomplete
            </span>
          )}
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-brand-blue transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {/* Step names — wider screens only */}
        <div className="hidden sm:flex items-center gap-1 flex-wrap">
          {STEPS.map((s, i) => {
            const status = statusForStep(stepStatuses, s);
            const isCurrent = i === stepIndex;
            return (
              <span
                key={s.key}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full font-medium',
                  isCurrent
                    ? 'bg-brand-blue text-white'
                    : status.state === 'complete'
                      ? 'bg-green-50 text-green-700'
                      : status.state === 'incomplete'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-gray-100 text-gray-400',
                )}
              >
                {s.label}
                {!isCurrent && status.state === 'incomplete' ? ` · ${status.missingCount}` : ''}
              </span>
            );
          })}
        </div>
      </div>

      {/* Pre-split voltage data — rendered here, ABOVE the step content, so it
          appears on every step rather than only on the affected sections. */}
      <LegacyVoltageBanner survey={surveyData} />

      {/* Step content */}
      <div className="flex-1 rounded-lg border border-gray-100 bg-white p-4 shadow-sm min-h-[200px]">
        <StepComponent
          survey={surveyData}
          onChange={handleChange}
          onReplacePhotoRef={replacePhotoReference}
          readOnly={isReadOnly}
          siteName={workOrderMeta?.siteName ?? null}
          siteMaster={siteMaster}
          workOrderCode={workOrderMeta?.workOrderCode ?? null}
        />
      </div>

      {/* Submit-blocked validation summary — hard gate on errors only, Submit only; navigation is never blocked */}
      {showValidationSummary && validationIssues.length > 0 && (
        <div className="flex flex-col gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-red-800">
              {validationErrorCount} item{validationErrorCount !== 1 ? 's' : ''} must be completed before submitting
              {validationWarningCount > 0 &&
                ` (plus ${validationWarningCount} warning${validationWarningCount !== 1 ? 's' : ''})`}
            </p>
            <button
              type="button"
              onClick={() => setShowValidationSummary(false)}
              className="text-xs font-medium text-red-600 hover:underline shrink-0"
            >
              Dismiss
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {validationIssues.map((iss, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    const target = wizardIndexForValidationIndex(iss.stepIndex);
                    if (target !== null) setStepIndex(target);
                  }}
                  className={cn(
                    'text-xs hover:underline text-left',
                    iss.severity === 'error' ? 'text-red-700' : 'text-amber-700',
                  )}
                >
                  <span className="font-semibold">{iss.label}:</span> {iss.message}
                  {iss.severity === 'warning' && <span className="italic"> (optional)</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Back / Next / Submit */}
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={stepIndex === 0}
        >
          Back
        </Button>
        {isLastStep ? (
          !isReadOnly && (
            <Button type="button" className="flex-1" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Submitting…' : isOnline ? 'Submit for Approval' : 'Save Offline'}
            </Button>
          )
        ) : (
          <Button
            type="button"
            className="flex-1"
            onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
