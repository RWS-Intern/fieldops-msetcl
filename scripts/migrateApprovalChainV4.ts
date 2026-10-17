/**
 * scripts/migrateApprovalChainV4.ts
 *
 * Backfills the approval chain from THREE stages to FOUR, inserting
 * `approver_level_3` immediately before `final_approver`.
 *
 * ─── WHY THIS MUST RUN BEFORE THE RULES DEPLOY ──────────────────────────────
 *
 * `approvalStages[]` is sized and labelled AT CREATION TIME from
 * SURVEY_APPROVAL_STAGES — it is not re-read from the constant. Every document
 * created under the three-stage chain therefore holds a 3-element array.
 *
 * The updated firestore.rules require `size() == 4` on both sides of every
 * chain transition. From the moment those rules are live, any document still
 * holding three stages has EVERY transition refused: approve, request changes
 * and escalate alike. In production that is a dead approval queue.
 *
 *   CORRECT ORDER:  1. run this script   2. deploy firestore.rules
 *   REVERSED:       approvals break for the whole window in between.
 *
 * ─── WHAT IT DOES ───────────────────────────────────────────────────────────
 *
 * For every non-archived workOrders and surveyReports document holding a
 * 3-element chain, it writes a 4-element chain with a new 'pending' stage
 * spliced in at index 2, and fixes up the two indices that depend on position:
 *
 *   currentStageIndex  0 or 1  → unchanged (the inserted stage is still ahead)
 *                           2  → 3         (was at Final; Final moved down one)
 *                           3  → 4         (was fully approved; stays complete)
 *
 * `approvalStageOwnerUids` is left ALONE. The inserted stage has no owner yet,
 * so the set of present-or-past owners is unchanged — and that array is what
 * firestore.rules reads to grant READ access, so rewriting it on a guess would
 * silently change who can see a survey.
 *
 * ─── THE INSERTED STAGE HAS NO OWNER ────────────────────────────────────────
 *
 * ownerUid/ownerName are null. A document whose chain reaches index 2 will sit
 * there until an admin nominates someone via reassignApprovalStageOwner —
 * which is the honest outcome: nobody has been appointed to a level that did
 * not exist yesterday. The alternative, copying another stage's owner, would
 * invent an approval assignment nobody made on a document headed for
 * government vetting.
 *
 * Prerequisites: serviceAccountKey.json at the repo root (see below)
 * Dry run:       npm run migrate:chain-v4 -- --dry-run
 * Run:           npm run migrate:chain-v4
 *
 * SAFE TO RE-RUN. Documents already holding four stages are skipped, so an
 * interrupted run can simply be repeated.
 */

import * as path   from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// No dotenv: the service-account key carries both the target project and the
// credentials, so there is no env file to read.

import { existsSync, readFileSync } from 'node:fs';
import { cert, initializeApp as initAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

// ─── Config ───────────────────────────────────────────────────────────────────

/** Must match SURVEY_APPROVAL_STAGES in src/lib/approvalStages.ts. */
const NEW_STAGE_KEY   = 'approver_level_3';
const NEW_STAGE_LABEL = 'Approver Level 3';
/** Where it goes — immediately before final_approver. */
const INSERT_AT       = 2;
const OLD_LENGTH      = 3;
const NEW_LENGTH      = 4;

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 500;

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Authenticated with a SERVICE ACCOUNT, not an email/password sign-in.
 *
 * The Web SDK path fails on this project: its browser API key carries HTTP
 * referrer restrictions, and a Node process sends no Referer, so Google
 * rejects the sign-in with auth/requests-from-referer-<empty>-are-blocked.
 * Relaxing that restriction to run a script would weaken a production key.
 *
 * A service account is also simply the right tool here. It needs no admin
 * password in an env file, and it is not subject to firestore.rules — so this
 * migration cannot be blocked by the very rules it exists to prepare for.
 *
 * Get the key: Firebase Console → Project Settings → Service Accounts →
 * Generate new private key. Save it as serviceAccountKey.json in the repo
 * root; .gitignore already excludes it.
 */
const KEY_PATH = path.resolve(__dirname, '../serviceAccountKey.json');

if (!existsSync(KEY_PATH)) {
  console.error('❌  serviceAccountKey.json not found at the repo root.');
  console.error('');
  console.error('   Firebase Console → Project Settings → Service Accounts');
  console.error('   → Generate new private key → save as serviceAccountKey.json');
  console.error('');
  console.error('   It is already in .gitignore, so it will not be committed.');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8')) as {
  project_id: string;
  client_email: string;
};

const app = initAdminApp({ credential: cert(KEY_PATH) });
const db  = getAdminFirestore(app);

// ─── Chain rewrite ────────────────────────────────────────────────────────────

interface StageEntry {
  stageKey:      string;
  stageLabel:    string;
  status:        string;
  ownerUid:      string | null;
  ownerName:     string | null;
  reviewNotes:   string | null;
  attachmentUrl: string | null;
  actedAt:       unknown;
}

/** The stage this migration inserts — unowned and unacted, by design. */
function newStage(): StageEntry {
  return {
    stageKey:      NEW_STAGE_KEY,
    stageLabel:    NEW_STAGE_LABEL,
    status:        'pending',
    ownerUid:      null,
    ownerName:     null,
    reviewNotes:   null,
    attachmentUrl: null,
    // A plain null, not serverTimestamp(): Firestore rejects FieldValue
    // sentinels inside array elements. Same constraint the app itself works
    // under — see the note on ApprovalStageResult.actedAt.
    actedAt:       null,
  };
}

/**
 * Where currentStageIndex must move so it keeps pointing at the same stage.
 *
 * Anything at or past the insertion point shifts down one. An index equal to
 * the OLD length means "fully approved"; it becomes the NEW length so the
 * document stays complete rather than reopening at the inserted stage.
 */
function remapIndex(old: number): number {
  if (old >= INSERT_AT) return old + 1;
  return old;
}

interface Plan {
  ref:       FirebaseFirestore.DocumentReference;
  collection: string;
  id:        string;
  stages:    StageEntry[];
  oldIndex:  number;
  newIndex:  number;
}

async function planCollection(name: 'workOrders' | 'surveyReports'): Promise<{
  plans: Plan[];
  skippedAlreadyFour: number;
  skippedOddLength: number;
  skippedArchived: number;
}> {
  const snap = await db.collection(name).get();
  const plans: Plan[] = [];
  let skippedAlreadyFour = 0;
  let skippedOddLength   = 0;
  let skippedArchived    = 0;

  for (const d of snap.docs) {
    const data   = d.data();
    const stages = data['approvalStages'] as StageEntry[] | undefined;

    if (data['archived'] === true) { skippedArchived++; continue; }
    if (!Array.isArray(stages))    { skippedOddLength++; continue; }
    if (stages.length === NEW_LENGTH) { skippedAlreadyFour++; continue; }

    // Anything that is neither the old nor the new length is NOT touched. A
    // chain of unexpected size is a data problem this script must not paper
    // over by guessing where a stage belongs.
    if (stages.length !== OLD_LENGTH) {
      skippedOddLength++;
      console.warn(`   ⚠  ${name}/${d.id}: chain length ${stages.length} — left untouched, needs a look`);
      continue;
    }

    const next = [...stages];
    next.splice(INSERT_AT, 0, newStage());

    const oldIndex = typeof data['currentStageIndex'] === 'number' ? data['currentStageIndex'] : 0;

    plans.push({
      ref: db.collection(name).doc(d.id),
      collection: name,
      id: d.id,
      stages: next,
      oldIndex,
      newIndex: remapIndex(oldIndex),
    });
  }

  return { plans, skippedAlreadyFour, skippedOddLength, skippedArchived };
}

async function commit(plans: Plan[]): Promise<void> {
  for (let i = 0; i < plans.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const p of plans.slice(i, i + BATCH_LIMIT)) {
      // approverUid is deliberately NOT rewritten. It names whoever must act
      // right now, and inserting a stage ahead of them does not change that —
      // the chain reaches the new stage only when it advances there.
      batch.update(p.ref, {
        approvalStages:    p.stages,
        currentStageIndex: p.newIndex,
      });
    }
    await batch.commit();
    console.log(`   committed ${Math.min(i + BATCH_LIMIT, plans.length)}/${plans.length}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
Project:         ${serviceAccount.project_id}`);
  console.log(`Service account: ${serviceAccount.client_email}`);
  console.log(DRY_RUN
    ? 'MODE:            DRY RUN — nothing will be written\n'
    : 'MODE:            LIVE — writing to the project named above\n');

  let total = 0;
  for (const name of ['workOrders', 'surveyReports'] as const) {
    const { plans, skippedAlreadyFour, skippedOddLength, skippedArchived } = await planCollection(name);
    console.log(`${name}:`);
    console.log(`   to migrate:        ${plans.length}`);
    console.log(`   already 4 stages:  ${skippedAlreadyFour}`);
    console.log(`   archived, skipped: ${skippedArchived}`);
    if (skippedOddLength) console.log(`   unexpected shape:  ${skippedOddLength}  ← review these`);

    const moved = plans.filter((p) => p.oldIndex !== p.newIndex);
    if (moved.length) {
      console.log(`   currentStageIndex shifts on ${moved.length}:`);
      for (const p of moved.slice(0, 10)) {
        console.log(`      ${p.id}: ${p.oldIndex} → ${p.newIndex}`);
      }
      if (moved.length > 10) console.log(`      …and ${moved.length - 10} more`);
    }

    if (!DRY_RUN && plans.length) await commit(plans);
    total += plans.length;
    console.log('');
  }

  console.log(DRY_RUN
    ? `DRY RUN complete — ${total} document(s) would be migrated. Re-run without --dry-run to apply.`
    : `Migration complete — ${total} document(s) updated. Deploy firestore.rules NOW.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌  Migration failed:', err);
  console.error('Nothing further was written. Re-running is safe — migrated documents are skipped.');
  process.exit(1);
});
