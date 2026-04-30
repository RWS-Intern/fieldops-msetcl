export type UserRole = 'admin' | 'field';

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

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export type CollectionType = 'yesno' | 'text' | 'number' | 'select' | 'image_only';

export interface SubtaskDefinition {
  subtaskId: string;
  label: string;
  collectionType: CollectionType;
  isRequired: boolean;
  imageRequired: boolean;
  options: string[];    // non-empty only for collectionType === 'select'
  sortOrder: number;
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
  createdBy: string;
  createdAt: Date;
  archived: boolean;
  archivedAt: Date | null;
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
