import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { AlertTriangle, Clock } from 'lucide-react';
import { db } from '@/firebase/config';
import { useAuthStore }         from '@/store/authStore';
import { useSurveyReport, normaliseRestoredDraft } from '@/hooks/useSurveyReport';
import { useSurveyActions }     from '@/hooks/useSurveyActions';
import {
  useSurveySubmitQueue,
  toSurveyPayload,
  findLocalPhotoRefs,
  stripLocalPhotoRefs,
  replaceLocalPhotoRef,
} from '@/lib/surveySubmitQueue';
import type { PendingSurveyPhoto } from '@/lib/surveySubmitQueue';
import { useNetworkStatus }     from '@/hooks/useNetworkStatus';
import { useToast }             from '@/components/ui/toast';
import { saveDraft, loadDraft, deleteDraft } from '@/lib/surveyDraftStore';
import { getPhoto, deletePhoto, blobToDataUrl, deletePhotosForWorkOrder } from '@/lib/surveyPhotoStore';
import { uploadToCloudinary } from '@/utils/uploadToCloudinary';
import { validateSurvey, getStepStatuses } from '@/lib/surveyValidation';
import { Button } from '@/components/ui/button';
import { cn }      from '@/lib/utils';
import { StepSiteVisit }      from '@/components/survey/steps/StepSiteVisit';
import { StepFeederList }     from '@/components/survey/steps/StepFeederList';
import { StepRelayDetails }   from '@/components/survey/steps/StepRelayDetails';
import { StepCapacitorBanks } from '@/components/survey/steps/StepCapacitorBanks';
import { StepTransformerDetails } from '@/components/survey/steps/StepTransformerDetails';
import { StepInfrastructure } from '@/components/survey/steps/StepInfrastructure';
import { StepAcdcDetails }    from '@/components/survey/steps/StepAcdcDetails';
import { LegacyVoltageBanner } from '@/components/survey/LegacyVoltageBanner';
import { StepCableRuns }      from '@/components/survey/steps/StepCableRuns';
import { StepPhotos }         from '@/components/survey/steps/StepPhotos';
import { StepBoq }            from '@/components/survey/steps/StepBoq';
import { StepSignOff }        from '@/components/survey/steps/StepSignOff';
import type { StepStatus } from '@/lib/surveyValidation';
import type { SurveyStepProps } from '@/components/survey/steps/StepProps';
import type { SurveyReport } from '@/types';

// ─── Steps ────────────────────────────────────────────────────────────────────

interface WizardStep {
  key:   string;
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
 * The confirmed 11-step structure. Every step has a real form.
 *
 * Steps 6, 9 and 10 keep the components they already had: those are being
 * REVISED against the official checklist in a later phase, not built from
 * nothing, so they stay mounted and working in the meantime.
 */
const STEPS: WizardStep[] = [
  { key: 'site_visit',      label: 'Site & Visit',                    Component: StepSiteVisit,                             validationIndex: 0 },
  { key: 'feeders',         label: 'Feeder List',                     Component: StepFeederList,                            validationIndex: 1 },
  { key: 'relays',          label: 'CRP Relay Details',               Component: StepRelayDetails,                          validationIndex: 2 },
  { key: 'capacitor_banks', label: 'Capacitor Banks',                 Component: StepCapacitorBanks,                        validationIndex: null },
  { key: 'transformers',    label: 'Transformer Details',             Component: StepTransformerDetails,                    validationIndex: null },
  { key: 'infrastructure',  label: 'Site Infrastructure & Checklist', Component: StepInfrastructure,                        validationIndex: 3 },
  // New step, no validation rules yet — same treatment Capacitor Banks and
  // Transformer Details got when they first landed. validationIndex: null
  // means it reads 'untouched' and can never nag.
  { key: 'acdc_details',    label: 'ACDB & DCDB Details',             Component: StepAcdcDetails,                           validationIndex: null },
  { key: 'cable_runs',      label: 'Cable Runs',                      Component: StepCableRuns,                             validationIndex: 4 },
  { key: 'photos',          label: 'Photos',                          Component: StepPhotos,                                validationIndex: 5 },
  { key: 'boq',             label: 'BOQ',                             Component: StepBoq,                                   validationIndex: 6 },
  { key: 'sign_off',        label: 'Sign-Off',                        Component: StepSignOff,                               validationIndex: 7 },
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
async function resolveOnlinePhotoUploads(
  data: SurveyReport,
  siteCode: string,
): Promise<{ resolved: SurveyReport; allUploaded: boolean }> {
  let resolved = data;
  let allUploaded = true;

  for (const { photoId } of findLocalPhotoRefs(data)) {
    const stored = await getPhoto(photoId);
    if (!stored) {
      allUploaded = false; // orphan reference — nothing recoverable locally
      continue;
    }
    try {
      const file = new File([stored.blob], `${photoId}.jpg`, { type: stored.mimeType });
      const result = await uploadToCloudinary(file, { taskNum: siteCode, photoType: 'completion', index: 0 });
      resolved = replaceLocalPhotoRef(resolved, `local://${photoId}`, result.url);
      await deletePhoto(photoId).catch(() => {});
    } catch (err) {
      console.error('[SurveyWizardPage] submit-time photo upload failed:', err);
      allUploaded = false;
    }
  }

  return { resolved, allUploaded };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SurveyWizardPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { survey, loading, error } = useSurveyReport(workOrderId);
  const { submitSurvey, saveProgress } = useSurveyActions();
  const { enqueue } = useSurveySubmitQueue();
  const isOnline = useNetworkStatus();
  const { showToast } = useToast();

  const [workOrderMeta, setWorkOrderMeta] = useState<{ workOrderCode: string; siteName: string } | null>(null);
  const [workOrderMetaError, setWorkOrderMetaError] = useState<string | null>(null);
  const [siteMaster, setSiteMaster] = useState<{ totalBays: number | null; numPowerTransformers: number | null } | null>(null);
  const [surveyData, setSurveyData] = useState<SurveyReport | null>(null);
  const [stepIndex, setStepIndex]   = useState(0);
  const [localReady, setLocalReady] = useState(false);
  const [draftInfo, setDraftInfo]   = useState<{ updatedAt: number } | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showValidationSummary, setShowValidationSummary] = useState(false);

  const initializedRef        = useRef(false);
  const startedTransitionRef  = useRef(false);

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
            siteName:      data['siteName']      ?? '',
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
            totalBays:            data['totalBays']            ?? null,
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

    (async () => {
      if (!survey) {
        setLocalReady(true);
        return;
      }
      try {
        const draft = await loadDraft(survey.workOrderId);
        if (draft) {
          // Normalised, never spread raw: a draft saved before a field existed
          // would otherwise restore that field as undefined and crash the
          // wizard's render body. See normaliseRestoredDraft.
          setSurveyData(normaliseRestoredDraft(survey, draft.data));
          setStepIndex(draft.stepIndex);
          setDraftInfo({ updatedAt: draft.updatedAt });
        } else {
          setSurveyData(survey);
        }
      } catch (err) {
        console.error('[SurveyWizardPage] draft load failed:', err);
        setSurveyData(survey);
      }
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
        workOrderId:    survey.workOrderId,
        data:           {},
        previousStatus: survey.status,
      });
    } catch (err) {
      console.error('[SurveyWizardPage] status transition failed:', err);
      startedTransitionRef.current = false; // allow a retry
    }
  }

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
    setSurveyData((prev) => (prev ? { ...prev, ...patch } : prev));
    void ensureInProgress();
  }

  // Runs inside the setState updater, so it always sees the latest state —
  // unlike an onChange(photos.map(...)) call computed from a possibly-stale
  // prop snapshot, concurrent replacements (e.g. several photos uploading in
  // the same React batch) can never clobber each other here.
  function replacePhotoReference(oldRef: string, newRef: string) {
    setSurveyData((prev) => (prev ? replaceLocalPhotoRef(prev, oldRef, newRef) : prev));
  }

  async function handleDiscardDraft() {
    if (!workOrderId || !survey) return;
    await deleteDraft(workOrderId);
    // The server copy we're reverting to can never contain a local:// photo
    // reference (those are stripped before any Firestore write), so any
    // blobs still in surveyPhotoStore for this work order are orphaned the
    // moment we revert — safe to clear, same as the draft itself.
    await deletePhotosForWorkOrder(workOrderId).catch(() => {});
    setSurveyData(survey);
    setStepIndex(0);
    setDraftInfo(null);
    setDiscardConfirm(false);
    showToast('Draft discarded — reverted to last saved version', 'success');
  }

  async function handleSubmit() {
    if (!survey || !surveyData || !workOrderId || !currentUser) return;

    if (validateSurvey(surveyData).some((i) => i.severity === 'error')) {
      setShowValidationSummary(true);
      return;
    }
    setShowValidationSummary(false);
    setSubmitting(true);

    // Captured as plain locals (rather than referencing survey/currentUser
    // directly) so the nested queueOffline function below doesn't depend on
    // TypeScript's narrowing surviving into a hoisted function declaration —
    // it doesn't, since a declaration is technically callable from anywhere
    // in this scope.
    const woId            = workOrderId;
    const surveyId         = survey.id;
    const siteCode         = survey.siteCode;
    const submittedBy      = currentUser.uid;
    const submittedByName  = currentUser.name;

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
        workOrderId:     woId,
        surveyReportId:  surveyId,
        siteCode,
        submittedBy,
        submittedByName,
        data:            toSurveyPayload(stripLocalPhotoRefs(data)),
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
        submittedBy:     currentUser.uid,
        submittedByName: currentUser.name,
      });
      await deleteDraft(workOrderId);
      await deletePhotosForWorkOrder(workOrderId).catch(() => {});
      showToast('Survey submitted for approval', 'success');
      navigate('/surveys');
    } catch (err) {
      console.error('[SurveyWizardPage] submit failed:', err);
      showToast('Failed to submit. Try again.', 'error');
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
  const stepStatuses     = getStepStatuses(surveyData);
  const validationIssues = validateSurvey(surveyData);
  const currentStepStatus = statusForStep(stepStatuses, STEPS[stepIndex]);
  const validationErrorCount   = validationIssues.filter((i) => i.severity === 'error').length;
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

      {/* Draft restored banner */}
      {draftInfo && !discardConfirm && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
          <span className="text-xs text-brand-blue">
            Draft restored — last saved {formatTime(draftInfo.updatedAt)}
          </span>
          <button
            type="button"
            onClick={() => setDiscardConfirm(true)}
            className="text-xs font-medium text-brand-red hover:underline shrink-0"
          >
            Discard draft
          </button>
        </div>
      )}
      {discardConfirm && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 flex flex-col gap-2">
          <p className="text-xs text-red-700">
            Discard your local draft and revert to the last saved server version?
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
