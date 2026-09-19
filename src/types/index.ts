/**
 * `viewer` is a read-only observer: it sees everything an admin sees
 * (unscoped — no projectIds filtering) and may export, but must never create,
 * edit, submit, approve, assign or delete anything. That is enforced in
 * firestore.rules (viewers are admitted to `get`/`list`/`read` only, never to
 * a single write branch), with the UI simply not rendering the controls.
 */
export type UserRole = 'admin' | 'approver' | 'field' | 'viewer';

/** Firestore user document — used by the Team Management feature. */
export interface User {
  id: string;          // Firestore document ID == Firebase Auth UID
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  createdBy?: string;
  deletedAt?: Date | null;
  photoURL?: string;
  fcmToken?: string;
  fcmTokenUpdatedAt?: Date;
  /** Auto-assigned on creation via engineerNumCounter. e.g. "ENG-001". */
  engineerCode?: string;
  /**
   * Employing organisation, e.g. "Rite Water Solutions" or "MSETCL".
   * Captured for `approver` accounts only (meaningless for field/admin/viewer)
   * and shown in approver pickers so an admin can tell two same-named
   * reviewers from different organisations apart. Null on every record created
   * before this field existed, which degrades to name-only display.
   */
  organization?: string | null;
}

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  fcmToken?: string;
  fcmTokenUpdatedAt?: Date;
  createdAt: Date;
  createdBy?: string;
  active: boolean;
  deletedAt?: Date | null;
  photoURL?: string;
  engineerCode?: string;
}

export interface AppConfig {
  orgName: string;
  taskNumPrefix: string;
  taskNumCounter: number;
  projectNumPrefix?: string;
  projectNumCounter?: number;
  mapDefaultLat: number;
  mapDefaultLng: number;
  mapDefaultZoom: number;
  sheetsTaskMasterUrl?: string;
  sheetsExportUrl?: string;
  // ── v3.0 counters ───────────────────────────────────────────────────────────
  /** Incremented atomically when a new Site is created. */
  siteNumCounter?: number;
  /** Incremented atomically when a new user is created via createUser(). */
  engineerNumCounter?: number;
  /** Incremented atomically when a new SiteTask is created. */
  siteTaskNumCounter?: number;
}

export type TaskStatus = 'pending' | 'in_progress' | 'pending_approval' | 'changes_requested' | 'completed' | 'blocked';

export type CollectionType = 'yesno' | 'text' | 'number' | 'select' | 'image_only';

export interface SubtaskDefinition {
  subtaskId: string;
  label: string;
  collectionType: CollectionType;
  isRequired: boolean;
  imageRequired: boolean;
  options: string[];    // non-empty only for collectionType === 'select'
  sortOrder: number;
  /**
   * When set, this subtask is only shown to the field engineer when the
   * referenced subtask has been answered with the specified value
   * (case-insensitive, trimmed comparison).
   * Subtasks without showWhen are always visible — no behaviour change.
   */
  showWhen?: {
    subtaskId: string;
    value: string;
  };
}

export interface TaskType {
  id: string;
  typeLabel: string;
  colour: string;
  sortOrder: number;
  active: boolean;
  subtasks: SubtaskDefinition[];
  lastSyncedFromSheets?: Date | null;
}

export interface Task {
  id: string;
  taskNum: string;
  title: string;
  type: string;
  description?: string;
  assignedTo: string;
  assignedToName: string;
  createdBy: string;
  siteCode?: string;
  startDate: Date;
  dueDate: Date;
  status: TaskStatus;
  blockedReason?: string | null;
  location?: { lat: number; lng: number } | null;
  subtaskAnswers: Record<string, { value: string; type: CollectionType }>;
  subtaskPhotos: Record<string, string[]>;
  completionPhotos: string[];
  createdAt: Date;
  updatedAt: Date;
  // Written on every field-user update (mirrors the updates subcollection snapshot)
  submittedBy?: string;
  submittedByName?: string;
  submittedAt?: Date;
  // Optional project linkage
  projectId?: string | null;
  projectTitle?: string | null;
  projectNum?: string | null;
  // Archive
  archived?: boolean;
  archivedAt?: Date | null;
}

export interface TaskStats {
  all: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
}

export interface TaskUpdate {
  id: string;
  submittedBy: string;
  submittedByName: string;
  submittedAt: Date;
  status: TaskStatus;
  location: { lat: number; lng: number } | null;
  blockedReason: string | null;
  subtaskAnswers: Record<string, { value: string; type: CollectionType }>;
  subtaskPhotos: Record<string, string[]>;
  completionPhotos: string[];
}

export interface ChecklistAnswer {
  subtaskId: string;
  value: string;
  type: CollectionType;
}

// ─── Task Templates ────────────────────────────────────────────────────────────
// Used inside ProjectV3 documents to define task types owned by a project.

/**
 * A task template embedded in a project document.
 * `taskKey` is unique within the project (auto-generated from label).
 * `subtasks` reuses the same SubtaskDefinition shape as taskMaster.
 */
export interface TaskTemplate {
  taskKey:   string;               // unique within project, e.g. "solar_addition"
  label:     string;               // display label, e.g. "Solar Addition"
  colour:    string;               // hex colour
  sortOrder: number;
  subtasks:  SubtaskDefinition[];  // same subtask shape as taskMaster
}

// ─── Projects ──────────────────────────────────────────────────────────────────

export type ProjectStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface Project {
  id: string;
  projectNum: string;        // e.g. RP:001
  title: string;
  description?: string;
  status: ProjectStatus;
  assignedTo: string[];      // array of field-user UIDs
  assignedToNames: string[]; // denormalised display names
  createdBy: string;
  createdAt: Date;
  siteCode?: string;
  startDate: Date;
  dueDate: Date;
  taskCount: number;
  completedTaskCount: number;
  updatedAt: Date;
  // ── v3.0 additions (optional so v2.1 docs stay valid) ──────────────────────
  /** Short uppercase project identifier, e.g. "IOT". */
  projectCode?: string;
  /** Whether the project is active (visible for site creation). Default true. */
  active?: boolean;
  /** Task templates owned by this project. */
  taskTemplates?: TaskTemplate[];
  /** Default approver inherited by every SiteTask spawned under this project. */
  defaultApproverUid?: string | null;
  defaultApproverName?: string | null;
  // Archive
  archived?: boolean;
  archivedAt?: Date | null;
}

export interface ProjectStats {
  all: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
}

// ─── Invites ───────────────────────────────────────────────────────────────────

export type InviteStatus = 'pending' | 'accepted' | 'revoked';

export interface Invite {
  id: string;            // document ID == UUID invite token
  name: string;          // pre-filled display name
  email: string;         // the invited email address
  role: UserRole;
  status: InviteStatus;
  createdBy: string;     // admin UID
  createdAt: Date;
  expiresAt: Date;       // 7 days after creation
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
}

// ─── v3.0 — Project → Site → SiteTask ─────────────────────────────────────────
// These types are additive. The existing Project/Task interfaces above remain
// for the v2.1 collections until Phase L cleanup.

/**
 * v3.0 Project — top-level container for Sites.
 * Stored in `projects` (separate from the v2.1 `projects` collection — Phase L
 * will reconcile once migration is complete).
 *
 * Named ProjectV3 here to avoid collision with the v2.1 Project interface.
 * Phase B will establish the canonical name once the old type is retired.
 */
export interface ProjectV3 {
  id: string;
  projectNum: string;       // e.g. "PRJ-001" — from projectNumCounter
  title: string;
  description?: string;
  status: ProjectStatus;    // reuses existing ProjectStatus union
  city?: string;
  projectCode?: string;     // short uppercase identifier, e.g. "IOT"
  active?: boolean;
  taskTemplates: TaskTemplate[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  archived?: boolean;
  archivedAt?: Date | null;
  /** Default approver inherited by every SiteTask spawned under this project. */
  defaultApproverUid?: string | null;
  defaultApproverName?: string | null;
}

// ─── Site ──────────────────────────────────────────────────────────────────────

export type SiteStatus = 'active' | 'completed' | 'on_hold';

/** A physical installation site belonging to a Project. */
export interface Site {
  id: string;
  siteCode: string;               // e.g. "SUB-PUNE-047" — from siteNumCounter
  siteName: string;               // e.g. "Pune Substation 47"
  city: string;
  state: string;
  address: string;                // "" if not provided
  /** Optional administrative circle, e.g. "Pune Urban Circle" */
  circle?: string;
  /** Optional administrative division, e.g. "Pune Division" */
  division?: string;
  projectId: string;
  projectName: string;            // denormalised from parent project
  projectCode: string;            // denormalised from parent project
  location: { lat: number; lng: number } | null;
  status: SiteStatus;
  taskCount: number;
  completedTaskCount: number;
  /** Number of tasks currently in_progress. Updated atomically on task status change. */
  inProgressTaskCount: number;
  /** Number of tasks currently blocked. Updated atomically on task status change. */
  blockedTaskCount: number;
  /** Number of tasks currently pending_approval. Updated atomically on task status change. */
  pendingApprovalTaskCount: number;
  createdBy: string;
  createdAt: Date;
  archived: boolean;
  archivedAt: Date | null;
  // ── Substation master (tender Annexure-II) — MSETCL Substation Visibility Project ──
  sapCode?: string | null;
  /** MSETCL zone — allocation not yet received, so this is plain editable data, not an enum. */
  zone?: string | null;
  voltageClass?: '132' | '110' | '100' | null;
  totalBays?: number | null;
  numPowerTransformers?: number | null;
  /**
   * Per-stage work order sequence, e.g. { survey: 2 } after this site's
   * second survey work order was created. Absent/missing stage means zero —
   * NOT initialised in createSite; createWorkOrder reads it with `?? 0`.
   */
  workOrderCounters?: Partial<Record<WorkOrderStage, number>>;
}

// ─── SiteTask ──────────────────────────────────────────────────────────────────

/**
 * An individual task auto-created on a Site from a project task template.
 * Phase D canonical shape — one document per template per site.
 * `city` is denormalised for composite reporting indexes.
 */
export interface SiteTask {
  id: string;
  /** e.g. "SUB-PUNE-001/IOT/SOLAR_ADDITION-01" */
  taskCode: string;
  siteId: string;
  siteCode: string;           // denormalised
  siteName: string;           // denormalised
  city: string;               // denormalised for composite indexes
  projectId: string;
  projectName: string;        // denormalised
  projectCode: string;        // denormalised
  /** Matches template taskKey, e.g. "solar_addition" */
  taskKey: string;
  /** Snapshot of template label at creation time */
  taskLabel: string;
  /** Snapshot of template hex colour at creation time */
  taskColour: string;
  /** Full subtask snapshot — isolated from future template edits */
  subtasks: SubtaskDefinition[];
  assignedTo: string | null;
  assignedToName: string | null;
  assignedToCode: string | null;
  status: TaskStatus;
  startDate: Date | null;
  dueDate: Date | null;
  subtaskAnswers: Record<string, { value: string; type: CollectionType }>;
  subtaskPhotos: Record<string, string[]>;
  completionPhotos: string[];
  blockedReason: string | null;
  location: { lat: number; lng: number } | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archived: boolean;
  archivedAt?: Date | null;
  /** Assigned approver — inherited from the project's defaultApproverUid, admin-overridable per task. */
  approverUid: string | null;
  approverName: string | null;
  approverCode: string | null;
  /** Notes written by the approver on "request changes". */
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
}

// ─── MSETCL Substation Visibility Project — WorkOrder + Survey ────────────────
//
// A substation (Site) is a long-lived asset worked on repeatedly over the
// contract life: Site → WorkOrder → stage record (SurveyReport now;
// Repair/Commissioning/AMC stage records later). The WorkOrder skeleton is
// defined now, covering all four stages, so there is no second migration when
// later stages arrive — but only the 'survey' stage is implemented today.
//
// Repeatable survey groups (bays, devices, cable runs) are ARRAYS INSIDE the
// SurveyReport document, not subcollections: one survey = one atomic document
// write, so an offline sync either lands completely or not at all.

export type WorkOrderStage = 'survey' | 'repair' | 'commissioning' | 'amc';

// ─── Approval chain ────────────────────────────────────────────────────────────

/**
 * One stage's outcome in the three-level approval chain. Stage count, order and
 * labels come from SURVEY_APPROVAL_STAGES (src/lib/approvalStages.ts); this is
 * the per-document record of what each stage's owner actually did.
 *
 * `stageLabel` is denormalised at creation so a document always renders with
 * the wording it was created under, even if the stage array is relabelled later.
 *
 * NOTE for writers: `actedAt` is a plain Date, not a serverTimestamp() sentinel
 * — Firestore rejects FieldValue sentinels inside array elements, so this is
 * necessarily a client clock value. Document-level timestamps (reviewedAt,
 * updatedAt) remain server-side.
 */
/**
 * Which way an approval chain is currently travelling — see the
 * `reviewDirection` field on WorkOrder / SurveyReport for the full semantics.
 */
export type ReviewDirection = 'forward' | 'backward';

export interface ApprovalStageResult {
  stageKey:      string;
  /** Denormalised from SURVEY_APPROVAL_STAGES at creation. */
  stageLabel:    string;
  status:        'pending' | 'approved' | 'changes_requested';
  ownerUid:      string | null;
  ownerName:     string | null;
  reviewNotes:   string | null;
  /** Optional at every stage — no stage requires an attachment. */
  attachmentUrl: string | null;
  /**
   * CLIENT-SUPPLIED wall-clock time, and therefore NOT authoritative for audit
   * or compliance purposes — it comes from the reviewer's own device and can be
   * wrong or deliberately set. Firestore forbids serverTimestamp() sentinels
   * inside array elements, so a server-stamped value is impossible here. The
   * trustworthy record of when a stage was acted on is the server timestamp on
   * the matching surveyReports/{id}/updates snapshot (see Phase 4), which
   * carries stageKey/stageIndex for exactly this reason. Treat this field as a
   * display convenience only; never cite it as evidence of timing.
   */
  actedAt:       Date | null;
}

export type WorkOrderStatus =
  | 'open' | 'in_progress' | 'pending_approval' | 'changes_requested'
  | 'approved' | 'closed';

/**
 * A unit of work against a Site for one stage of the contract lifecycle.
 * Stored in `workOrders`. Reuses the same approver semantics as SiteTask —
 * the survey (and later stages) submit into the SAME approval gate
 * (`reviewSiteTask` in useSiteTaskActions.ts), not a parallel mechanism.
 */
export interface WorkOrder {
  id: string;
  workOrderCode: string;        // e.g. WO-<siteCode>-SURVEY-01
  siteId: string;
  siteCode: string;             // denormalised, consistent with existing SiteTask pattern
  siteName: string;
  sapCode: string | null;
  zone: string | null;
  stage: WorkOrderStage;
  status: WorkOrderStatus;
  assignedTo: string | null;    // field engineer uid
  assignedToName: string | null;
  /**
   * Whoever must act RIGHT NOW — advances to the next stage's owner on each
   * approval, and is null once the chain is fully approved. Every existing
   * query filtering `approverUid == uid` therefore still means "in my queue"
   * with no structural change.
   */
  approverUid: string | null;
  approverName: string | null;
  // ── Three-level approval chain (see src/lib/approvalStages.ts) ─────────────
  /** One entry per SURVEY_APPROVAL_STAGES entry, in the same order. */
  approvalStages: ApprovalStageResult[];
  /** 0..length-1 while under review; === length once fully approved. */
  currentStageIndex: number;
  /**
   * All stage owners' uids, set at creation and only ever changed by an admin
   * via reassignApprovalStageOwner. Exists purely so firestore.rules can grant
   * READ to anyone who is or WAS a stage owner with a cheap `in` check that
   * works in both `get` and `list` — checking a nested field across array
   * elements does not. Write access is NOT derived from this: only
   * `approverUid == uid` (the live stage) may update.
   */
  approvalStageOwnerUids: string[];
  /**
   * Which way the review is currently travelling.
   *
   * 'forward'  — normal top-down progression: each stage approves and hands
   *              down to the next, or (at Level 1 only) sends the work back to
   *              the field.
   * 'backward' — an ESCALATION REVIEW is in progress. A stage above Level 1
   *              requested changes, and the flag is now cascading down one
   *              stage at a time for each lower stage to agree with (pass it
   *              further down) or disagree with (bounce it back up, forcing
   *              the stage above to reconsider). The field sees nothing until
   *              the flag reaches Level 1 AND Level 1 agrees.
   *
   * Paired across workOrders and surveyReports like every other chain field,
   * and pinned by firestore.rules: it can only change as part of a valid stage
   * transition, never on its own.
   */
  reviewDirection: ReviewDirection;
  createdAt: Date;
  updatedAt: Date;
  archived: boolean;
}

// ─── Survey sub-shapes ─────────────────────────────────────────────────────────
//
// NULL-VS-ZERO DISCIPLINE, carried forward from the original survey build and
// applying to every nullable number below: this becomes a jointly-signed BOQ
// submitted for government vetting, so "the surveyor hasn't answered yet" must
// stay distinguishable from any real value. 0 status points is a legitimate
// answer. Never default a count to 0.

/**
 * Substation voltage levels, as offered by every equipment-level picker
 * (feeder, relay, transformer, capacitor bank) and by the DC breaker voltage.
 *
 * 66 and 33 are SEPARATE levels. They were one combined '66_33' bucket until
 * the supervisor split them; see LEGACY_COMBINED_VOLTAGE_LEVEL below for what
 * that means for surveys answered before the split.
 */
export type SurveyVoltageLevel = '132' | '110' | '100' | '66' | '33' | '22' | '11';

export const SURVEY_VOLTAGE_LEVELS: readonly SurveyVoltageLevel[] =
  ['132', '110', '100', '66', '33', '22', '11'];

// SurveyBayVoltageLevel / SURVEY_BAY_VOLTAGE_LEVELS are GONE. They existed for
// the brief period when bay counts were thought to be a five-level question;
// the filled MSETCL example shows all four asset kinds counted across all seven
// levels, so the asset-count grid now uses SURVEY_VOLTAGE_LEVELS like every
// other voltage-keyed field.

/**
 * The pre-split combined value, '66_33'.
 *
 * NOT a current option — nothing writes it and no picker offers it. It exists
 * only so surveys answered before the split can be DETECTED and their old
 * answers shown back to the surveyor for manual re-entry.
 *
 * Deliberately never auto-migrated: a feeder's real level, or a DC breaker
 * voltage, can genuinely differ between 66kV and 33kV, so copying the combined
 * value into either would write a confidently wrong answer onto a document
 * that governs a government submission. A visible gap is the safer failure.
 */
export const LEGACY_COMBINED_VOLTAGE_LEVEL = '66_33';
export type LegacyVoltageLevel = typeof LEGACY_COMBINED_VOLTAGE_LEVEL;

/**
 * A voltage level as it may be found IN STORED DATA: a current level, or the
 * legacy combined value on a survey answered before the split. Every field
 * that reads a stored level is typed with this, so TypeScript forces each
 * display site to decide what to do about a legacy value rather than silently
 * mislabelling it.
 */
export type StoredVoltageLevel = SurveyVoltageLevel | LegacyVoltageLevel;

/** DC breaker voltage options — the same domain the old shared multi-select used. */
export type SurveyDcVoltage = '110' | '48' | '24';

// BayType and DeviceType are GONE. They described the pre-rebuild bay/device
// shapes, were superseded by SurveyFeederEntry / SurveyRelayEntry, and their
// last consumers (StepBays, StepDevices, SurveyPreview's old sections and
// surveyLabels' two label maps) are all deleted.

/** Still current — reused by SurveyRelayEntry.protocol. */
export type DeviceProtocol = 'modbus' | 'iec_61850' | 'iec_103' | 'serial' | 'none';

// ─── Feeder List (replaces the old bay shape) ─────────────────────────────────

/**
 * One bay/feeder row from the official checklist's Feeder List.
 *
 * Replaces SurveyBay's diPoints/doPoints/aiPoints model: the checklist asks
 * the surveyor to state directly how many MFMs, CMRs and F-RTU modules a
 * feeder needs, rather than deriving them from three signal counts.
 *
 * NAMING MISMATCH, DELIBERATE: the printed Feeder List column is headed "MFT
 * required", but this field is `mfmRequired`. The official document is
 * internally inconsistent (MFT in the Feeder List, MFM in the new BOQ table);
 * "Multi-Function Meter" only abbreviates to MFM, so the app standardises on
 * MFM everywhere. A surveyor comparing screen to paper will see MFM where the
 * paper says MFT — worth a line in the field instructions.
 *
 * `photos` keeps the existing local:// → Cloudinary pipeline untouched.
 */
export interface SurveyFeederEntry {
  uid: string;                  // client-generated id for list keys / edits
  bayName: string;
  nominalVoltage: StoredVoltageLevel | null;
  feederOrTransformerDescription: string | null;
  cableTrenchLengthM: number | null;
  panelSpaceAvailable: boolean | null;
  existingMfmAvailableWorking: boolean | null;
  existingMfmRs485Available: boolean | null;
  /** Direct surveyor entry. Summed into the MFM BOQ line's requiredToSupply. */
  mfmRequired: number | null;
  /** Direct surveyor entry. Summed into the CMR BOQ line's requiredToSupply. */
  cmrRequired: number | null;
  ctPtRatio: string | null;
  shutdownRequired: boolean | null;
  /** Direct surveyor entry — no longer split into DI/DO/AI. */
  diStatusPoints: number | null;
  /** Direct surveyor entry. Summed into the F-RTU BOQ line's requiredToSupply. */
  frtuModulesRequired: number | null;
  remarks: string | null;
  photos: string[];             // Cloudinary URLs / local:// refs — pipeline unchanged
}

// ─── CRP Relay Details (replaces the old flat device list) ────────────────────

/**
 * Relay technology. ONE single-select, not three booleans: a relay is normally
 * exactly one of these, and the three columns on the printed form are a print
 * layout rather than three independent facts.
 */
export type SurveyRelayType = 'electro_mechanical' | 'static' | 'numeric';

/**
 * One relay row from the official checklist's CRP Relay Details table.
 * Replaces SurveyDevice, which modelled any on-site device generically.
 */
export interface SurveyRelayEntry {
  uid: string;
  bayName: string;
  nominalVoltage: StoredVoltageLevel | null;
  relayMakeModel: string | null;
  relayType: SurveyRelayType | null;
  protocol: DeviceProtocol | null;
  ipAddress: string | null;
  /**
   * UNVERIFIED FIELD SHAPE — free text was chosen because it can hold either
   * answer. I could not check the official document (not available to me), so
   * whether this column is a tick-box or a description is unconfirmed. If it
   * is a tick-box, narrow this to `boolean | null` in Phase 2; free text can
   * represent "Yes"/"No" as well as "2 x ST fibre", so nothing is lost either
   * way while it stays unconfirmed.
   */
  optical: string | null;
  ctRatio: string | null;
  remarks: string | null;
  photos: string[];             // pipeline unchanged
}

// ─── Capacitor Bank Details (new repeatable group) ───────────────────────────

export interface SurveyCapacitorBank {
  uid: string;
  bankNumber: string;
  voltageLevel: StoredVoltageLevel | null;
  numberOfBanks: number | null;
  controlType: 'auto' | 'manual' | null;
  /** Nameplate rating as transcribed, e.g. "5 MVAR" — text, not a number. */
  ratingPerBank: string | null;
  /**
   * Free text, not a boolean: one entry can cover several banks
   * (`numberOfBanks`), so "2 of 3 in service" is a real and common answer
   * that a yes/no could only record as a lie in one direction.
   */
  workingStatus: string | null;
  remarks: string | null;
}

// ─── Transformer Details (new repeatable group) ───────────────────────────────

/**
 * One transformer, separate from the Feeder List — matching the official
 * document's own structure. Replaces SurveyBay's tapChangerPresent/tapPositions
 * conditional pair, which only ever captured a fraction of this.
 *
 * Nameplate/designation values are text rather than numbers so a transcription
 * like "50/63 MVA" or "+9/-9" survives intact.
 */
/** How a transformer's tap position is wired out for reading. */
export type TapPositionConnectionType = 'resistance' | 'lamp';

export interface SurveyTransformerEntry {
  uid: string;
  transformerNumber: string;
  voltageLevel: StoredVoltageLevel | null;
  mvaRating: string | null;
  rtccHighStep: string | null;
  rtccLowStep: string | null;
  /** "(Resistance/Lamp)" per the source document — no third option exists. */
  tapPositionConnectionType: TapPositionConnectionType | null;
  rtccPanelWorking: boolean | null;
  existingTpiWorking: boolean | null;
  existingTpi4to20mAAvailable: boolean | null;
  tptRequired: boolean | null;
  remarks: string | null;
}

// ─── Site & Visit extensions ─────────────────────────────────────────────────

/** Substation contact + location details, one set per survey. */
export interface SurveyContactDetails {
  substationInchargeName: string | null;
  /** The IN-CHARGE PERSON's own contact number — not the station's line. */
  substationInchargePhone: string | null;
  /**
   * The SUBSTATION's own telephone numbers, distinct from the in-charge
   * person's phone above: the document lists them as separate rows, and the
   * station line survives a change of in-charge. Kept as two flat fields
   * rather than a nested { landline, voip } object to match the flat style of
   * every other field in this interface — the UI groups them visually under
   * the document's own "Substation Telephone no./s" heading.
   */
  substationLandline: string | null;
  substationVoip: string | null;
  /**
   * Free text rather than a repeatable group: the printed form is a single
   * cell and a shift roster may list several names/numbers together.
   */
  shiftOperatorContacts: string | null;
  address: string | null;
  circle: string | null;
  division: string | null;
  commissionedDate: Date | null;
  nearestRailwayStationOrLandmark: string | null;
}

/** Control room measurements and services, one set per survey. */
export interface SurveyControlRoom {
  /**
   * Control room layout notes — deliberately NOT dimensions.
   *
   * The document doesn't ask for measurements here: it instructs the surveyor
   * to "prepare a sketch of panel placements and identify proposed RTU
   * location on it after consultation with local S/S In charge". The sketch
   * itself stays a paper/photo artefact (no in-app drawing), so this field
   * holds the written notes that accompany it.
   *
   * Renamed from `roomDimensions`, which described the question the form was
   * once thought to be asking rather than the one it actually asks.
   */
  layoutNotes: string | null;
  /** Free text — often recorded as a range rather than one reading. */
  roomTemperature: string | null;
  acAvailable: boolean | null;
  acCondition: string | null;
  mountingStructureOrRtuPanelDimensions: string | null;
  cableTrenchAvailable: boolean | null;
  cableTrenchLengthM: number | null;
  trenchExtensionNeeded: boolean | null;
}

/**
 * Counts as surveyed on site. Replaces the single `surveyedTotalBays` number
 * and the transformer-only `surveyedNumPowerTransformers`.
 *
 * These may legitimately differ from the Annexure-II site master
 * (Site.totalBays / Site.numPowerTransformers) — a discrepancy is a survey
 * finding, not a data-entry error to silently reconcile.
 */
/**
 * The asset-count grid: four asset kinds counted across all seven voltage
 * levels, matching the 4 x 7 table on the filled MSETCL example (Vashi S/S).
 *
 * Bays were briefly narrowed to five levels against an earlier, less complete
 * document; that is reversed here. The widening is deliberate and one-way —
 * `baysByVoltage` already carries real production data, so it is WIDENED in
 * place, never rebuilt, and it keeps the legacy combined key exactly as the
 * 66/33kV split left it.
 */
export interface SurveyAssetCounts {
  /**
   * All seven levels PLUS the legacy combined key, which is only ever read (to
   * show a surveyor what they recorded before the 66/33 split) and never
   * written by the form. Keeping it in the record type rather than dropping it
   * on read is what makes that old answer recoverable.
   */
  baysByVoltage:           Record<SurveyVoltageLevel | LegacyVoltageLevel, number | null>;
  /**
   * These three are NEW per-level records. They carry no legacy key: nothing
   * was ever counted per level for them, so there is no pre-split answer to
   * recover — only the flat totals below, which are surfaced separately.
   */
  busesByVoltage:          Record<SurveyVoltageLevel, number | null>;
  capacitorBanksByVoltage: Record<SurveyVoltageLevel, number | null>;
  transformersByVoltage:   Record<SurveyVoltageLevel, number | null>;

  /**
   * @deprecated FLAT TOTALS, superseded by the three per-level records above.
   *
   * Dead but deliberately present: these were live inputs on the Site & Visit
   * step from Phase 2b until this change, so an in-progress survey may hold a
   * real answer in any of them. Deleting them would orphan that data silently.
   * Nothing writes them any more; they are read only to show the old total
   * back for a human to distribute across the levels — never auto-redistributed,
   * because "5 transformers" carries no information about which levels they sit
   * at. Remove once every in-progress survey has been re-entered.
   */
  transformerCount: number | null;
  busCount: number | null;
  capacitorBankCount: number | null;
}

// ─── Site checklist (official checklist table 2) ─────────────────────────────

/**
 * Communication equipment details.
 *
 * The official checklist has FOUR UNLABELLED ROWS in this table — no heading
 * text at all. No fields are built for them: inventing plausible-sounding
 * labels for a government document would be worse than leaving them out. If
 * the labels are recovered from a later revision, add them here.
 */
export interface SurveyCommunicationEquipment {
  distanceToProposedRtuLocationM: number | null;
  channelType: string | null;
  channelMake: string | null;
  /** Whether a usable cable route already exists for the comms cable. */
  cableRouteExists: boolean | null;
}

/**
 * AC/DC supply. The DC breaker voltage is PER VOLTAGE LEVEL — each level
 * carries its own value, replacing the single shared multi-select
 * (SurveyInfrastructure.dcVoltages), which this supersedes.
 */
export interface SurveyAcDcSupply {
  ac230vAvailable: boolean | null;
  /** Seven current levels plus the read-only legacy key — see baysByVoltage. */
  dcBreakerVoltageByLevel: Record<SurveyVoltageLevel | LegacyVoltageLevel, SurveyDcVoltage | null>;
  distanceToAcdbM: number | null;
  distanceToDcdbM: number | null;
}

/** Two booleans rather than free text — the form asks only whether, not how. */
export interface SurveySldDetails {
  sldDrawnAndConfirmed: boolean | null;
  allEquipmentTypesShownOnSld: boolean | null;
}

export interface SurveyEarthingDetails {
  matExtendedToControlRoom: boolean | null;
  matIntact: boolean | null;
}

export interface SurveyStorageDetails {
  siteAccessAvailable: boolean | null;
  /**
   * The RTU panel is approximately 1000 x 440 x 600 mm. That figure is a HINT
   * for the surveyor only — deliberately not encoded as a validated dimension,
   * since the answer is a judgement about the actual room.
   */
  storageSpaceForRtuPanel: boolean | null;
  spaceForUnloading: boolean | null;
  installSpaceForFrtuSwitchMfmCmr: boolean | null;
}

/**
 * The official checklist's table 2 — one set per substation, not per bay.
 *
 * OVERLAP WITH SurveyInfrastructure is deliberate and unresolved in this
 * phase: AC/DC supply, earthing and civil work now appear in both shapes.
 * `dcBreakerVoltageByLevel` explicitly supersedes
 * `SurveyInfrastructure.dcVoltages`. Deciding which shape owns the rest needs
 * the official document to hand — see the Phase 1 report.
 */
export interface SurveySiteChecklist {
  /**
   * Free text, not an enum: the document's own wording for the options is
   * unknown, and inventing a status vocabulary would be the same mistake as
   * inventing the unlabelled rows above.
   */
  outdoorCivilWorkStatus: string | null;
  communication: SurveyCommunicationEquipment;
  acDcSupply: SurveyAcDcSupply;
  sld: SurveySldDetails;
  earthing: SurveyEarthingDetails;
  lightningProtectionToControlRoom: boolean | null;
  storage: SurveyStorageDetails;
}

/**
 * One cable run surveyed at the substation — an array element.
 * cableType/lengthM are nullable — same reasoning as SurveyBay above.
 */
export interface SurveyCableRun {
  uid: string;
  cableType: 'cat6' | 'power' | null;
  fromTo: string;
  lengthM: number | null;
  trays: 'available' | 'new_required' | null;
}

/**
 * @deprecated Length of the superseded fixed-slot arrays — see the note on
 * SurveyAcdcMcbDetails.acdbMcbSlots. Retained only so those arrays keep their
 * shape on read; nothing new should size itself from this.
 */
export const ACDC_MCB_SLOT_COUNT = 10;

export type McbPoleType = 'single' | 'double';

/**
 * @deprecated One slot of the superseded fixed-10 table. Kept because stored
 * documents may still hold these; nothing writes them any more.
 */
export interface McbSlot {
  poleType: McbPoleType | null;
  /** Free text — carries its unit/notation as written, e.g. "16 A", "6/10". */
  ratingA:  string | null;
}

/**
 * One distribution board's MCB detail, matching the filled MSETCL example's
 * table 12: two rows under the same three columns (pole type, rating, remarks).
 *
 * The two rows are stored as INDEPENDENT facts, exactly as the document lays
 * them out. Whether the "utilised" MCB is one of the spares counted above it,
 * or a separate thing entirely, is not determinable from one filled example —
 * so no relationship is modelled or enforced between them. Easy to tighten
 * once someone with the master spec confirms the intent; impossible to undo a
 * wrong assumption baked into stored data.
 */
export interface AcdcMcbBoardDetail {
  /** "Nos." — how many spare MCBs are available on this board. */
  spareMcbCount:   number | null;
  spareMcbPole:    McbPoleType | null;
  /** Free text — carries its unit as written, e.g. "16 A". */
  spareMcbRating:  string | null;
  spareMcbRemarks: string | null;

  /** The second row's own answer: which MCB will be reused, if any. */
  mcbUtilisedForNetworkPanel: string | null;
  utilisedMcbPole:    McbPoleType | null;
  utilisedMcbRating:  string | null;
  utilisedMcbRemarks: string | null;
}

/**
 * The station's own AC and DC distribution boards.
 *
 * DISTINCT from SurveySiteChecklist.acDcSupply.dcBreakerVoltageByLevel, which
 * records the DC breaker voltage at each SUBSTATION VOLTAGE LEVEL (the 132kV
 * bays, the 110kV bays, …). This is the station-wide DCDB battery/charger
 * system and its spare ways — one set of facts per substation, not per level.
 * Both exist deliberately; neither replaces the other.
 */
export interface SurveyAcdcMcbDetails {
  /** 230V AC board. */
  acdb: AcdcMcbBoardDetail;
  /** 110/220V DC board — the voltage corrected against the filled example. */
  dcdb: AcdcMcbBoardDetail;

  /** Free text — carries units, same reasoning as MVA Rating. */
  dcdbChargerOutputVoltage: string | null;
  dcdbBatteryOutputVoltage: string | null;

  /**
   * @deprecated The fixed 10-slot tables the two board details above replaced.
   *
   * Dead but deliberately present: these were live, editable inputs from the
   * round that added this step, so an in-progress survey may hold real
   * per-slot pole types and ratings. Deleting them would orphan that silently.
   * Nothing writes them any more; they are read only so the old entries can be
   * shown back for manual re-entry — never auto-mapped, because ten
   * individually-numbered slots carry no clean translation into one aggregate
   * count. Remove once every in-progress survey has been re-entered.
   */
  acdbMcbSlots: McbSlot[];
  dcdbMcbSlots: McbSlot[];
}

/** Sections E–G of the survey form — one set per site (not a repeatable group). */
export interface SurveyInfrastructure {
  panelSpaceAvailable: boolean | null;
  panelSpaceMeasurement: string | null;      // Section E "(measure)"
  newPanelRequired: boolean | null;
  mountingNotes: string | null;
  civilWork: ('grouting' | 'cable_entry' | 'foundation' | 'none')[];
  dcSupplyAvailable: boolean | null;
  dcVoltages: ('110' | '48' | '24')[];
  acSupplyAvailable: boolean | null;
  spareMcbs: boolean | null;
  dcdbLocation: string | null;                // Section F "DCDB / distribution location"
  ofcAvailable: boolean | null;
  routerAvailable: boolean | null;
  mplsAvailable: boolean | null;
  sldcPathNotes: string | null;
  earthingAvailable: boolean | null;
}

// SurveyPreVisit is GONE. The five-checkbox pre-visit section was removed from
// the survey on supervisor instruction; its type, factory, labels, mapper and
// validation touch-check went with it. Stored documents keep whatever
// preVisit map they were written with — the reader simply stops looking at it.


/**
 * One BOQ line item as surveyed at this site (surveyedQty is the field-filled
 * value).
 *
 * This is the quantity that GOVERNS SUPPLY at the site once jointly signed —
 * the tender's Annexure-I figures are only indicative until survey — so the
 * two booleans below exist to keep provenance in the stored document rather
 * than only on screen.
 */
export interface SurveyBoqLine {
  sr: number;
  itemKey: string;              // stable key from the BOQ master (see src/lib/boqMaster.ts)
  /**
   * TWO columns, replacing the old single `surveyedQty`, matching the official
   * BOQ table: what is already on site and reusable, and what we must supply.
   * Both nullable — an unanswered column must never read as a considered 0.
   *
   * `existingUsable` is meaningless for service/ITC lines; those master items
   * carry `hasExistingUsable: false` and leave it null.
   */
  existingUsable: number | null;
  requiredToSupply: number | null;
  remarks: string | null;
  /**
   * A CONSIDERED zero: the surveyor asserted this item isn't applicable here
   * and said why in `remarks`. Distinct from a null column (nobody has
   * answered yet) and from a plain 0 that was typed — all three would
   * otherwise be indistinguishable to a reviewer vetting the signed BOQ.
   */
  notApplicable: boolean;
  /**
   * True while `requiredToSupply` is still an auto-derived suggestion and the
   * surveyor has not overridden it. Applies to MFM / CMR / F-RTU only, each
   * summed from the matching per-feeder entry (SurveyFeederEntry.mfmRequired /
   * .cmrRequired / .frtuModulesRequired). `existingUsable` is never derived.
   *
   * Set false the moment they edit the quantity or tick `notApplicable`, which freezes
   * the line against further recomputation. Persisted (not component state)
   * for two reasons: a draft resumed in a later session must not silently
   * re-derive over a manual override, and a reviewer needs to see which
   * numbers were computed and which were entered by hand.
   */
  autoDerived: boolean;
}

/** Section J's three confirmation checkboxes, all default false. */
export interface SurveyBoqChecks {
  quantitiesCrossCheckedAgainstAnnexureI: boolean;  // "deviations noted with reason"
  markedUpSldAttached: boolean;
  updatedInMsetclWebAppAndTracker: boolean;
}

/**
 * The physically signed paper BOQ page is the legal artefact for government
 * vetting — signedPagePhotos is the record of that, not a substitute for it.
 */
export interface SurveySignOff {
  signedPagePhotos: string[];   // photo(s) of the PHYSICALLY signed BOQ page — the legal artefact
  surveyorName: string | null;
  msetclEngineerName: string | null;
  msetclEngineerDesignation: string | null;
  msetclEngineerEmpId: string | null;
  surveyorSignatureImage: string | null;      // optional on-screen signature
  msetclSignatureImage: string | null;        // optional on-screen signature
}

/**
 * The 'survey' stage record for a WorkOrder. Stored in `surveyReports`, one
 * document per WorkOrder. All repeatable groups (bays/devices/cableRuns) are
 * embedded arrays — see the module-level note above for why.
 */
export interface SurveyReport {
  id: string;
  workOrderId: string;
  siteId: string;
  siteCode: string;
  sapCode: string | null;
  zone: string | null;
  voltageClass: string | null;

  /**
   * Denormalised from the parent WorkOrder purely for list-view display —
   * SurveyReport has no other source for these. Avoids an N+1 getDoc per row
   * on pages that list many surveys (admin oversight, the approvals queue).
   * Set once at creation by createWorkOrder in useWorkOrderActions.ts (never
   * changes after — a work order's code and its site's name are permanent).
   * '' is the load-time fallback for documents written before this field
   * existed, not a real "no work order" state (every survey has exactly one).
   */
  siteName: string;
  workOrderCode: string;

  /**
   * Denormalised from the parent WorkOrder — NOT looked up via the parent at
   * read/rule-evaluation time. Firestore can't filter a query on a parent
   * document's field, and a security-rule get() on the parent is a billed
   * read per document evaluated (a list query multiplies this and can hit
   * the 10-lookup ceiling). Kept in sync at write time by
   * createWorkOrder/reassignWorkOrder/reassignApprovalStageOwner in
   * useWorkOrderActions.ts — never edit these two independently of the
   * parent WorkOrder.
   */
  assignedTo: string | null;
  assignedToName: string | null;
  /** The live stage owner — see the identical field on WorkOrder. */
  approverUid: string | null;
  approverName: string | null;

  // ── Three-level approval chain — mirrors the parent WorkOrder ─────────────
  // Denormalised onto the survey for the same reason assignedTo/approverUid
  // are: the review screen and the approval queue read surveyReports directly
  // and must not need a parent lookup. Kept in sync by the same batches.
  approvalStages: ApprovalStageResult[];
  currentStageIndex: number;
  approvalStageOwnerUids: string[];
  /**
   * Which way the review is currently travelling.
   *
   * 'forward'  — normal top-down progression: each stage approves and hands
   *              down to the next, or (at Level 1 only) sends the work back to
   *              the field.
   * 'backward' — an ESCALATION REVIEW is in progress. A stage above Level 1
   *              requested changes, and the flag is now cascading down one
   *              stage at a time for each lower stage to agree with (pass it
   *              further down) or disagree with (bounce it back up, forcing
   *              the stage above to reconsider). The field sees nothing until
   *              the flag reaches Level 1 AND Level 1 agrees.
   *
   * Paired across workOrders and surveyReports like every other chain field,
   * and pinned by firestore.rules: it can only change as part of a valid stage
   * transition, never on its own.
   */
  reviewDirection: ReviewDirection;

  surveyDate: Date | null;
  location: { lat: number; lng: number } | null;   // auto-captured, manual override allowed
  surveyorName: string | null;                     // Section A "Surveyor (our rep)"

  // ── Site & Visit (extended for the MSETCL Technical Survey Checklist) ─────
  contactDetails: SurveyContactDetails;
  controlRoom:    SurveyControlRoom;
  /** Replaces surveyedTotalBays + surveyedNumPowerTransformers. */
  assetCounts:    SurveyAssetCounts;

  // ── Repeatable groups ────────────────────────────────────────────────────
  /** Feeder List — replaces `bays`. */
  feeders:      SurveyFeederEntry[];
  /** CRP Relay Details — replaces `devices`. */
  relays:       SurveyRelayEntry[];
  /** New group, separate from feeders. */
  transformers: SurveyTransformerEntry[];
  /** New group, separate from feeders. */
  capacitorBanks: SurveyCapacitorBank[];

  cableRuns: SurveyCableRun[];
  difficultRunsNotes: string | null;    // Section H "Longest / difficult runs noted"
  /** Official checklist table 2 — see the overlap note on SurveySiteChecklist. */
  siteChecklist: SurveySiteChecklist;
  /** ACDB / DCDB spare-MCB detail — see the note on SurveyAcdcMcbDetails. */
  acdcMcbDetails: SurveyAcdcMcbDetails;
  /**
   * RETAINED, partly superseded. `infrastructure.dcVoltages` is definitively
   * replaced by siteChecklist.acDcSupply.dcBreakerVoltageByLevel; the AC/DC,
   * earthing and civil-work overlap with siteChecklist is unresolved pending
   * the official document. Phase 2 decides what survives here.
   */
  infrastructure: SurveyInfrastructure;
  boqSupply: SurveyBoqLine[];
  boqService: SurveyBoqLine[];
  boqChecks: SurveyBoqChecks;
  /**
   * Section I's named-slot photographs.
   *
   * `caption` holds the SLOT NAME (see SURVEY_PHOTO_SLOTS) — it is what groups
   * photos into their sections, not free text. `remark` is the surveyor's
   * optional note about that one photograph; always optional, never validated.
   */
  sitePhotos: { url: string; caption: string; remark: string | null }[];
  signOff: SurveySignOff;

  submittedBy: string | null;
  submittedByName: string | null;
  submittedAt: Date | null;
  status: WorkOrderStatus;
  reviewNotes: string | null;      // reuse approver semantics
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Immutable audit-trail snapshot written to surveyReports/{id}/updates on
 * submit/approve/request_changes (see useSurveyActions.ts). Never updated or
 * deleted after creation — the round-by-round history of what was actually
 * certified, for a document headed to SE-PAC for vetting.
 */
export interface SurveyUpdate {
  id: string;
  /**
   * 'agree'/'disagree' are ESCALATION-REVIEW decisions: a stage agreeing with,
   * or disagreeing with, a flag raised above it while the chain travels
   * backward. They are distinct from approve/request_changes so the History
   * section can say what actually happened.
   */
  action: 'submit' | 'approve' | 'request_changes' | 'agree' | 'disagree';
  actorUid: string;
  actorName: string;
  createdAt: Date;
  /** Present for request_changes and agree — both record a flag. */
  reviewNotes?: string;
  /**
   * Which stage of the approval chain this action belonged to. Written for
   * every action — submit, approve and request_changes alike — so the History
   * section can say which round each entry was part of. Undefined only on
   * entries written before the chain existed, or for a survey that has no
   * chain at all.
   *
   * Unlike ApprovalStageResult.actedAt, `createdAt` above is a SERVER
   * timestamp, which makes this subcollection the trustworthy record of when
   * a stage was acted on.
   */
  stageKey?: string;
  stageIndex?: number;
  /** Optional reviewer attachment, when one was provided with the decision. */
  attachmentUrl?: string;
  /** Full survey payload as submitted — only present for the 'submit' action. */
  payload?: Partial<SurveyReport>;
}

// ─── BulkUpload ────────────────────────────────────────────────────────────────

export type BulkUploadStatus = 'pending' | 'processing' | 'done' | 'failed';

/**
 * Tracks a CSV/spreadsheet bulk-upload job.
 * Stored in `bulkUploads` — admin only.
 */
export interface BulkUpload {
  id: string;
  uploadedBy: string;       // admin UID
  uploadedAt: Date;
  fileName: string;
  status: BulkUploadStatus;
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors?: { row: number; message: string }[];
  projectId?: string;
}

// ─── Phase G — Bulk Site Upload types ─────────────────────────────────────────

/** One parsed row from the sites CSV template. */
export interface BulkUploadRow {
  rowNumber:   number;
  projectCode: string;
  siteCode:    string;
  siteName:    string;
  city:        string;
  state:       string;
  circle?:     string;
  division?:   string;
  address?:    string;
  latitude?:   string;
  longitude?:  string;
  // ── Substation master (tender Annexure-II) — optional, MSETCL project only ──
  sapCode?:               string;
  zone?:                  string;
  voltageClass?:          string;   // validated against '132' | '110' | '100' at parse time
  totalBays?:             string;
  numPowerTransformers?:  string;
}

export type BulkRowStatus = 'valid' | 'error' | 'duplicate';

/** Validation result for a single CSV row. */
export interface BulkRowResult {
  rowNumber: number;
  status:    BulkRowStatus;
  data:      BulkUploadRow;
  errors:    string[];
}

/** Aggregated result of parsing + validating an entire upload file. */
export interface BulkUploadSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  results:   BulkRowResult[];
}

/** Audit record written to `bulkUploads` collection after a successful commit. */
export interface BulkUploadRecord {
  id:              string;
  uploadType:      'sites' | 'assignments';
  uploadedBy:      string;
  uploadedByName:  string;
  uploadedAt:      Date;
  fileName:        string;
  rowCount:        number;
  successCount:    number;
  errorCount:      number;
  errors:          { row: number; reason: string }[];
}

// ─── Phase H — Bulk Assignment Upload types ────────────────────────────────────

/** One parsed row from the assignments CSV template. */
export interface AssignmentUploadRow {
  rowNumber:    number;
  siteCode:     string;
  taskKey:      string;
  engineerCode: string;
  dueDate:      string;
}

export type AssignmentRowStatus = 'valid' | 'error' | 'warning';

/** Validation result for a single assignment CSV row. */
export interface AssignmentRowResult {
  rowNumber: number;
  status:    AssignmentRowStatus;
  data:      AssignmentUploadRow;
  errors:    string[];
  warnings:  string[];
  /** Fully resolved write-ready data — only set when status is 'valid' or 'warning'. */
  resolved?: {
    siteTaskId:   string;
    siteId:       string;
    siteCode:     string;
    taskKey:      string;
    taskLabel:    string;
    engineerUid:  string;
    engineerName: string;
    engineerCode: string;
    dueDate:      Date | null;
  };
}

/** Aggregated result of parsing + validating an assignments upload file. */
export interface AssignmentUploadSummary {
  totalRows:   number;
  validRows:   number;
  warningRows: number;
  errorRows:   number;
  results:     AssignmentRowResult[];
}

// ─── Offline queue — Site Task ─────────────────────────────────────────────────

/**
 * One queued offline submission for a SiteTask.
 * Stored in IndexedDB (`fieldops-offline-st` / `queue` store).
 *
 * `subtaskPhotos` and `completionPhotos` contain either:
 *   - `https://` Cloudinary URLs (if the photo was uploaded before going offline)
 *   - `data:` base64 URIs (converted from blob: URLs at queue time)
 *
 * The SiteTaskQueueProcessor uploads any `data:` entries to Cloudinary
 * before writing the final Firestore document.
 */
export interface QueuedSiteTaskUpdate {
  /** IDB auto-increment primary key — undefined before first insert. */
  id?:            number;
  siteTaskId:     string;
  taskCode:       string;
  siteCode:       string;
  taskLabel:      string;
  /** Required to update `completedTaskCount` on the parent Site document. */
  siteId:         string;
  /** Status BEFORE this update — used for completedTaskCount delta logic. */
  previousStatus: TaskStatus;
  payload: {
    status:          TaskStatus;
    blockedReason:   string | null;
    subtaskAnswers:  Record<string, { value: string; type: CollectionType }>;
    subtaskPhotos:   Record<string, string[]>;
    completionPhotos: string[];
    location:        { lat: number; lng: number } | null;
    /** ISO timestamp captured at the moment the user tapped Submit. */
    submittedAt:     string;
  };
  /** Date.now() when this entry was queued. */
  queuedAt:       number;
  attempts:       number;
  lastError?:     string;
}
