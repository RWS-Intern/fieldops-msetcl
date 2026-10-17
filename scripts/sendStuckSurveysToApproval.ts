/**
 * scripts/sendStuckSurveysToApproval.ts
 *
 * Pushes surveys that were filled in — and in most cases already submitted by
 * the engineer — into the approval queue, by performing the same transition
 * submitSurvey performs.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Some surveys are sitting at status 'in_progress' or 'open' when they should
 * be 'pending_approval' at Approver Level 1. An engineer who submitted offline
 * sees "submitted" on their phone while the queued write never reached the
 * server, and the survey stays in its pre-submit state with nobody reviewing
 * it. This moves those into the queue.
 *
 * ─── IT WRITES THE SAME SHAPE AS A REAL SUBMIT ──────────────────────────────
 *
 * Mirrors submitSurvey in src/hooks/useSurveyActions.ts exactly:
 *   surveyReports/{id}  status → 'pending_approval', chain restarted at stage 0,
 *                       approverUid/Name ← stage 0's owner, direction 'forward',
 *                       submittedBy/At filled only if missing
 *   workOrders/{id}     the same status + chain fields, in the SAME batch, so
 *                       the pair can never disagree
 *   .../updates/{new}   an audit entry
 *
 * The audit entry records action 'submit' with `backfilled: true` and the
 * service-account actor. It does NOT impersonate the engineer: this document
 * is headed for government vetting, and a trail claiming a person pressed
 * Submit when an administrator ran a script would be a false record.
 *
 * ─── WHAT IT REFUSES TO TOUCH ───────────────────────────────────────────────
 *
 *   - anything already 'pending_approval', 'approved' or 'closed'
 *   - 'changes_requested' — an approver deliberately sent that back; silently
 *     resubmitting it would erase a decision somebody made
 *   - archived documents
 *   - surveys with no approval chain, or whose stage 0 has no owner — there is
 *     nobody to send them to, and inventing an approver on a jointly-signed
 *     document is not a thing a migration may do
 *
 * By default it also requires EVIDENCE of a prior submission (submittedAt set).
 * Pass --include-never-submitted to also sweep up surveys that were never
 * submitted at all; read the dry run before you do.
 *
 * Prerequisites: serviceAccountKey.json at the repo root
 * Dry run:       npm run fix:stuck-approvals -- --dry-run
 * Run:           npm run fix:stuck-approvals
 * One survey:    npm run fix:stuck-approvals -- --ids WO-TEST-001-SURVEY-01
 *
 * SAFE TO RE-RUN — anything already pending_approval is skipped.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DRY_RUN = process.argv.includes('--dry-run');
const INCLUDE_NEVER_SUBMITTED = process.argv.includes('--include-never-submitted');

/** --ids CODE1 CODE2 … limits the run to those workOrderCodes. */
const idsFlag = process.argv.indexOf('--ids');
const ONLY_CODES = idsFlag === -1
  ? null
  : new Set(process.argv.slice(idsFlag + 1).filter((a) => !a.startsWith('--')));

const KEY_PATH = path.resolve(__dirname, '../serviceAccountKey.json');
if (!existsSync(KEY_PATH)) {
  console.error('❌  serviceAccountKey.json not found at the repo root.');
  console.error('');
  console.error('   Firebase Console → Project Settings → Service Accounts');
  console.error('   → Generate new private key → save as serviceAccountKey.json');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8')) as {
  project_id: string;
  client_email: string;
};

const app = initializeApp({ credential: cert(KEY_PATH) });
const db  = getFirestore(app);

/** Statuses a survey can legitimately be moved to approval FROM. */
const SUBMITTABLE = ['open', 'in_progress'];

interface StageEntry {
  stageKey?:   string;
  ownerUid?:   string | null;
  ownerName?:  string | null;
}

interface Candidate {
  id:            string;
  workOrderId:   string;
  workOrderCode: string;
  siteName:      string;
  status:        string;
  stageCount:    number;
  currentIndex:  number;
  submittedAt:   Timestamp | null;
  assignedTo:    string | null;
  assignedName:  string | null;
  stage0:        StageEntry;
  /** Most recent audit action, or null when the survey has no trail. */
  lastAction:    string | null;
}

interface Skipped { code: string; reason: string }

async function collect(): Promise<{ candidates: Candidate[]; skipped: Skipped[] }> {
  const snap = await db.collection('surveyReports').get();
  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];

  for (const d of snap.docs) {
    const data = d.data();
    const code = (data['workOrderCode'] as string) || d.id;

    if (ONLY_CODES && !ONLY_CODES.has(code)) continue;

    const status = (data['status'] as string) ?? '';
    if (data['archived'] === true) { skipped.push({ code, reason: 'archived' }); continue; }
    if (status === 'pending_approval') { skipped.push({ code, reason: 'already in the queue' }); continue; }
    if (status === 'approved' || status === 'closed') { skipped.push({ code, reason: `already ${status}` }); continue; }
    if (status === 'changes_requested') {
      skipped.push({ code, reason: 'changes_requested — an approver sent this back on purpose' });
      continue;
    }
    if (!SUBMITTABLE.includes(status)) { skipped.push({ code, reason: `unexpected status "${status}"` }); continue; }

    const stages = (data['approvalStages'] as StageEntry[] | undefined) ?? [];
    if (stages.length === 0) { skipped.push({ code, reason: 'no approval chain — nobody to send it to' }); continue; }
    if (!stages[0]?.ownerUid) { skipped.push({ code, reason: 'stage 1 has no nominated owner' }); continue; }

    const submittedAt = (data['submittedAt'] as Timestamp | null) ?? null;
    // submittedAt is the EVIDENCE that this survey really was submitted and has
    // since fallen out of the queue — which is the only case this script is
    // meant for. Without it, a survey is simply one nobody has finished, and
    // sending that to an approver puts a half-filled form in front of them.
    //
    // --ids does NOT bypass this. Naming a survey explicitly says "this one",
    // not "ignore the safety check"; the two are separate decisions and
    // conflating them is how an unfinished survey reaches an approver.
    if (!submittedAt && !INCLUDE_NEVER_SUBMITTED) {
      skipped.push({ code, reason: 'never submitted — no submittedAt (add --include-never-submitted to override)' });
      continue;
    }

    candidates.push({
      id: d.id,
      workOrderId:   (data['workOrderId'] as string) ?? '',
      workOrderCode: code,
      siteName:      (data['siteName'] as string) ?? '',
      status,
      stageCount:    stages.length,
      currentIndex:  (data['currentStageIndex'] as number) ?? 0,
      submittedAt,
      lastAction:    null,
      assignedTo:    (data['assignedTo'] as string) ?? null,
      assignedName:  (data['assignedToName'] as string) ?? null,
      stage0:        stages[0],
    });
  }

  // ── Audit-trail check ─────────────────────────────────────────────────
  //
  // A survey that was submitted, SENT BACK by an approver, and reopened by the
  // engineer is field-for-field indistinguishable from a corrupted one: the
  // original submittedAt is still there, and the status is 'in_progress'
  // because the engineer resumed work. Only the trail tells them apart.
  //
  // Sending one of those to an approver would put half-reworked answers in
  // front of them and bury the change request the engineer is still acting on.
  // So anything whose LAST recorded action is a flag is dropped.
  const vetted: Candidate[] = [];
  for (const c of candidates) {
    const last = await db
      .collection('surveyReports').doc(c.id).collection('updates')
      .orderBy('createdAt', 'desc').limit(1).get();

    const lastAction = last.empty ? null : (last.docs[0].data()['action'] as string ?? null);
    c.lastAction = lastAction;

    // 'agree' is a flag too — a stage agreeing with an objection travelling
    // down the chain. Both mean somebody asked for changes.
    if (lastAction === 'request_changes' || lastAction === 'agree') {
      skipped.push({
        code: c.workOrderCode,
        reason: 'sent back by an approver and being reworked — not corrupted',
      });
      continue;
    }
    vetted.push(c);
  }

  return { candidates: vetted, skipped };
}

async function send(c: Candidate): Promise<void> {
  const batch = db.batch();

  // The chain restart, identical to submitSurvey's: approvalStages itself is
  // NOT rewritten, only the pointers into it.
  const chainRestart = {
    currentStageIndex: 0,
    approverUid:       c.stage0.ownerUid ?? null,
    approverName:      c.stage0.ownerName ?? null,
    reviewDirection:   'forward',
  };

  // submittedBy/At are filled ONLY if missing. Where the engineer really did
  // submit, their name and the original time are the truthful record and must
  // survive; overwriting them would rewrite history to say an administrator
  // filled the form.
  const submissionFields: Record<string, unknown> = {};
  if (!c.submittedAt) {
    submissionFields['submittedAt']     = FieldValue.serverTimestamp();
    submissionFields['submittedBy']     = c.assignedTo;
    submissionFields['submittedByName'] = c.assignedName;
  }

  batch.update(db.collection('surveyReports').doc(c.id), {
    ...chainRestart,
    ...submissionFields,
    status:    'pending_approval',
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (c.workOrderId) {
    batch.update(db.collection('workOrders').doc(c.workOrderId), {
      ...chainRestart,
      status:    'pending_approval',
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  // Audit entry. Attributed to the SERVICE ACCOUNT, not the engineer — see the
  // header. `backfilled` marks it so the History can be read honestly later.
  const updateRef = db.collection('surveyReports').doc(c.id).collection('updates').doc();
  batch.set(updateRef, {
    action:     'submit',
    actorUid:   'script:sendStuckSurveysToApproval',
    actorName:  `Administrator (${serviceAccount.client_email})`,
    createdAt:  FieldValue.serverTimestamp(),
    stageKey:   c.stage0.stageKey ?? null,
    stageIndex: 0,
    backfilled: true,
    reviewNotes:
      `Moved to approval by an administrator. The survey was "${c.status}" on the server ` +
      `${c.submittedAt ? 'despite having been submitted earlier' : 'and had not been submitted'}.`,
  });

  await batch.commit();
}

async function main() {
  console.log(`\nProject:         ${serviceAccount.project_id}`);
  console.log(`Service account: ${serviceAccount.client_email}`);
  console.log(DRY_RUN
    ? 'MODE:            DRY RUN — nothing will be written\n'
    : 'MODE:            LIVE — writing to the project named above\n');
  if (ONLY_CODES) console.log(`Limited to:      ${[...ONLY_CODES].join(', ')}\n`);

  const { candidates, skipped } = await collect();

  if (candidates.length === 0) {
    console.log('Nothing to send.\n');
  } else {
    console.log(`${candidates.length} survey(s) would be sent to Approver Level 1:\n`);
    for (const c of candidates) {
      console.log(`  ${c.workOrderCode}  (${c.siteName})`);
      console.log(`     status        ${c.status} → pending_approval`);
      console.log(`     chain         ${c.stageCount} stage(s), index ${c.currentIndex} → 0`);
      console.log(`     goes to       ${c.stage0.ownerName ?? c.stage0.ownerUid}`);
      console.log(`     submittedAt   ${c.submittedAt ? c.submittedAt.toDate().toISOString() : 'MISSING — will be set now'}`);
      console.log(`     last action   ${c.lastAction ?? 'no audit trail'}`);
      console.log('');
    }
  }

  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`);
    const byReason = new Map<string, string[]>();
    for (const s of skipped) {
      if (!byReason.has(s.reason)) byReason.set(s.reason, []);
      byReason.get(s.reason)!.push(s.code);
    }
    for (const [reason, codes] of byReason) {
      console.log(`   ${reason}: ${codes.length}`);
      for (const code of codes.slice(0, 5)) console.log(`      ${code}`);
      if (codes.length > 5) console.log(`      …and ${codes.length - 5} more`);
    }
    console.log('');
  }

  if (DRY_RUN) {
    console.log('DRY RUN complete — re-run without --dry-run to apply.');
    process.exit(0);
  }

  let done = 0;
  for (const c of candidates) {
    try {
      await send(c);
      done++;
      console.log(`   sent ${c.workOrderCode}`);
    } catch (err) {
      console.error(`   FAILED ${c.workOrderCode}:`, (err as Error).message);
    }
  }

  console.log(`\nDone — ${done}/${candidates.length} sent to approval.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌  Failed:', err);
  console.error('Each survey is written in its own batch, so any already reported as sent did land.');
  process.exit(1);
});
