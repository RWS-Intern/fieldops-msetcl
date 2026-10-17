import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { useSurveyActions } from '@/hooks/useSurveyActions';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import type { SurveyReport, WorkOrderStatus } from '@/types';

/**
 * Admin-only repair control for a survey whose stored state is wrong.
 *
 * WHY THIS EXISTS. A survey and its parent work order are a PAIR, and every
 * normal code path writes both in one batch with the approval chain duplicated
 * across them. Fixing one by hand in the Firestore console leaves the two
 * disagreeing: the oversight list and the approvals queue read surveyReports,
 * while the record screen reads the work order — so a console edit to one
 * appears to do nothing. Worse, a chain array that differs between them is
 * refused by firestore.rules as tampering on the next real transition, which
 * only surfaces when an approver tries to act.
 *
 * This moves both documents together, through code the rules already accept.
 *
 * It is NOT a review action. It records no approval and no rejection — it
 * restores the state a document should already have been in, and says so in
 * the audit trail under the admin's own name.
 */

type ForceTarget = Extract<WorkOrderStatus, 'pending_approval' | 'changes_requested' | 'in_progress'>;

const TARGETS: { value: ForceTarget; label: string; help: string }[] = [
  {
    value: 'pending_approval',
    label: 'Pending Approval',
    help: 'Puts it in the chosen stage owner’s queue, as a submission would.',
  },
  {
    value: 'changes_requested',
    label: 'Changes Requested',
    help: 'Sends it back to the engineer, as an approver’s rejection would.',
  },
  {
    value: 'in_progress',
    label: 'In Progress',
    help: 'Returns it to the engineer with nobody waiting on it.',
  },
];

export function AdminStateFixPanel({ survey }: { survey: SurveyReport }) {
  const { forceSurveyState } = useSurveyActions();
  const { showToast } = useToast();

  const [open,       setOpen]       = useState(false);
  const [target,     setTarget]     = useState<ForceTarget>('pending_approval');
  const [stageIndex, setStageIndex] = useState(0);
  const [reason,     setReason]     = useState('');
  const [saving,     setSaving]     = useState(false);

  const stages = survey.approvalStages ?? [];
  const needsStage = target !== 'in_progress';

  async function handleApply() {
    setSaving(true);
    try {
      await forceSurveyState({
        surveyReportId: survey.id,
        workOrderId:    survey.workOrderId,
        status:         target,
        stageIndex,
        stages,
        reason,
      });
      showToast('Survey state corrected on both documents', 'success');
      setOpen(false);
      setReason('');
    } catch (err) {
      console.error('[AdminStateFixPanel] failed:', err);
      showToast((err as Error).message || 'Could not correct the state. Try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (stages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400">
        This survey has no approval chain, so there is no stage to move it to.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-900">Admin: correct stored state</p>
            <p className="text-xs text-amber-800">
              Currently <span className="font-medium">{survey.status}</span>. Updates the survey and
              its work order together.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Wrench className="mr-1.5 h-3.5 w-3.5" />
            Fix state
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold text-amber-900">Correct stored state</p>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-amber-900">Move to</label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as ForceTarget)}
              className="rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs"
            >
              {TARGETS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p className="text-xs text-amber-700">
              {TARGETS.find((t) => t.value === target)?.help}
            </p>
          </div>

          {needsStage && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-amber-900">Live stage</label>
              <select
                value={stageIndex}
                onChange={(e) => setStageIndex(Number(e.target.value))}
                className="rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs"
              >
                {stages.map((st, i) => (
                  <option key={st.stageKey || i} value={i}>
                    {i + 1}. {st.stageLabel}
                    {st.ownerName ? ` — ${st.ownerName}` : ' — unassigned'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-amber-900">
              Reason <span className="text-brand-red">*</span>
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. submitted on 03 Oct but stored as in_progress"
              className="rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs"
            />
            <p className="text-xs text-amber-700">
              Written to the audit trail under your name, marked as an admin correction —
              not as an approval or a rejection.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => { setOpen(false); setReason(''); }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="flex-1"
              onClick={handleApply}
              disabled={saving || !reason.trim()}
            >
              {saving ? 'Applying…' : 'Apply'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
