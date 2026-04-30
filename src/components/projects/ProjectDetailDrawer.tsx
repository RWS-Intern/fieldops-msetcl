import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { Archive, Pencil, ChevronRight } from 'lucide-react';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/ui/toast';
import { archiveProject } from '@/hooks/useProjectActions';
import { EditProjectModal } from '@/components/projects/EditProjectModal';
import { SiteDetailDrawer } from '@/components/sites/SiteDetailDrawer';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Project, Site, ProjectStatus, SiteStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STRIPE: Record<ProjectStatus, string> = {
  pending:     '#9CA3AF',
  in_progress: '#F4A261',
  completed:   '#2A9D8F',
  blocked:     '#E63946',
};

const STATUS_BADGE_CLASS: Record<ProjectStatus, string> = {
  pending:     'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-50 text-amber-700',
  completed:   'bg-teal-50 text-teal-700',
  blocked:     'bg-red-50 text-red-700',
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  blocked:     'Blocked',
};

const SITE_STATUS_BADGE: Record<SiteStatus, string> = {
  active:    'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  on_hold:   'bg-gray-100 text-gray-600',
};

const SITE_STATUS_LABEL: Record<SiteStatus, string> = {
  active:    'Active',
  completed: 'Completed',
  on_hold:   'On Hold',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProjectDetailDrawerProps {
  project: Project;
  open:    boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectDetailDrawer({
  project,
  open,
  onClose,
}: ProjectDetailDrawerProps) {
  const { currentUser } = useAuthStore();
  const { showToast }   = useToast();

  // Sites list
  const [sites,        setSites]        = useState<Site[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);

  // Site detail drawer (stacks on top)
  const [selectedSite,   setSelectedSite]   = useState<Site | null>(null);
  const [showSiteDetail, setShowSiteDetail] = useState(false);

  // Edit modal
  const [showEdit, setShowEdit] = useState(false);

  // Archive confirmation
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiving,      setArchiving]      = useState(false);

  const stripeColour = STATUS_STRIPE[project.status] ?? '#9CA3AF';
  const templates    = project.taskTemplates ?? [];
  const isInactive   = project.active === false;

  // ── Fetch sites when drawer opens ─────────────────────────────────────────
  useEffect(() => {
    if (!open || !project?.id) return;
    setLoadingSites(true);
    getDocs(query(collection(db, 'sites'), where('projectId', '==', project.id)))
      .then((snap) => {
        const loaded: Site[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id:                 d.id,
              siteCode:           data['siteCode']           ?? '',
              siteName:           data['siteName']           ?? '',
              city:               data['city']               ?? '',
              state:              data['state']              ?? '',
              address:            data['address']            ?? '',
              projectId:          data['projectId']          ?? '',
              projectName:        data['projectName']        ?? '',
              projectCode:        data['projectCode']        ?? '',
              location:           data['location']
                ? { lat: data['location'].latitude ?? data['location'].lat, lng: data['location'].longitude ?? data['location'].lng }
                : null,
              status:              (data['status'] ?? 'active') as SiteStatus,
              taskCount:           data['taskCount']           ?? 0,
              completedTaskCount:  data['completedTaskCount']  ?? 0,
              inProgressTaskCount: data['inProgressTaskCount'] ?? 0,
              blockedTaskCount:    data['blockedTaskCount']    ?? 0,
              createdBy:           data['createdBy']           ?? '',
              createdAt:          data['createdAt']?.toDate?.()  ?? new Date(),
              archived:           data['archived']           ?? false,
              archivedAt:         data['archivedAt']?.toDate?.() ?? null,
            } as Site;
          })
          .filter((s) => !s.archived)
          .sort((a, b) => a.siteCode.localeCompare(b.siteCode));
        setSites(loaded);
      })
      .catch(() => setSites([]))
      .finally(() => setLoadingSites(false));
  }, [open, project?.id]);

  // ── Reset on close ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setSites([]);
      setArchiveConfirm(false);
    }
  }, [open]);

  async function handleArchiveProject() {
    setArchiving(true);
    try {
      await archiveProject(project.id, true);
      showToast('Project archived', 'success');
      onClose();
    } catch {
      showToast('Failed to archive project', 'error');
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent
          side="right"
          className="flex flex-col w-full md:max-w-[520px] p-0 overflow-y-auto"
          aria-describedby={undefined}
        >
          {/* ── Header ── */}
          <SheetHeader className="p-5 pb-4 border-b border-gray-100 shrink-0">
            {/* Status colour accent strip at very top */}
            <div
              className="absolute top-0 left-0 right-0 h-1"
              style={{ backgroundColor: stripeColour }}
            />

            {/* Project number */}
            <p className="text-xs font-mono text-gray-400 mt-1">{project.projectNum}</p>

            {/* Title */}
            <SheetTitle className="pr-8 text-lg leading-snug">
              {project.title}
            </SheetTitle>

            {/* projectCode badge + status + active/inactive */}
            <div className="flex items-center gap-2 flex-wrap">
              {project.projectCode && (
                <span className="text-xs font-mono font-semibold text-brand-blue bg-blue-50 rounded px-2 py-0.5">
                  {project.projectCode}
                </span>
              )}
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_BADGE_CLASS[project.status]}`}
              >
                {STATUS_LABELS[project.status]}
              </span>
              {isInactive && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  Inactive
                </span>
              )}
            </div>

            {/* Description */}
            {project.description && (
              <p className="text-sm text-gray-500 leading-relaxed mt-1">
                {project.description}
              </p>
            )}
          </SheetHeader>

          {/* ── Scrollable body ── */}
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">

            {/* ── Task Types ── */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm font-semibold text-gray-700">Task Types</p>
                <span className="rounded-full bg-gray-100 text-gray-600 text-xs font-semibold px-2 py-0.5">
                  {templates.length}
                </span>
              </div>
              {templates.length === 0 ? (
                <p className="text-xs text-gray-400">No task types defined for this project.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {templates
                    .slice()
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((tmpl) => (
                      <div
                        key={tmpl.taskKey}
                        className="flex items-center gap-0 rounded-lg border border-gray-100 bg-white overflow-hidden"
                      >
                        {/* Colour stripe */}
                        <div
                          className="w-1 self-stretch shrink-0"
                          style={{ backgroundColor: tmpl.colour }}
                        />
                        <div className="py-2.5 px-3 min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 leading-snug">
                            {tmpl.label}
                          </p>
                          <span className="text-xs text-gray-400 font-mono">
                            {tmpl.taskKey}
                          </span>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {tmpl.subtasks.length} subtask
                            {tmpl.subtasks.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* ── Sites list ── */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm font-semibold text-gray-700">Sites</p>
                {!loadingSites && (
                  <span className="rounded-full bg-gray-100 text-gray-600 text-xs font-semibold px-2 py-0.5">
                    {sites.length}
                  </span>
                )}
              </div>

              {loadingSites ? (
                <div className="flex flex-col gap-1.5">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                  ))}
                </div>
              ) : sites.length === 0 ? (
                <p className="text-xs text-gray-400">No active sites for this project.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {sites.map((site) => (
                    <button
                      key={site.id}
                      type="button"
                      onClick={() => { setSelectedSite(site); setShowSiteDetail(true); }}
                      className="w-full flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-left cursor-pointer hover:bg-gray-50 hover:border-gray-200 transition-colors"
                    >
                      {/* Site info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-semibold text-gray-800">
                            {site.siteCode}
                          </span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${SITE_STATUS_BADGE[site.status as SiteStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                            {SITE_STATUS_LABEL[site.status as SiteStatus] ?? site.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{site.siteName}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {site.city}{site.state ? `, ${site.state}` : ''}
                          {' · '}
                          <span className="text-teal-600 font-medium">{site.completedTaskCount}</span>
                          <span className="text-gray-400">/{site.taskCount} tasks</span>
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Admin actions ── */}
            {currentUser?.role === 'admin' && (
              <div className="flex flex-col gap-2">

                {/* Edit button — hidden while archive confirm is showing */}
                {!archiveConfirm && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={() => setShowEdit(true)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit Project
                  </Button>
                )}

                {/* Archive */}
                {!archiveConfirm ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5 text-gray-500 hover:text-gray-700"
                    onClick={() => setArchiveConfirm(true)}
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive Project
                  </Button>
                ) : (
                  <div className="rounded-lg border border-gray-200 p-3 flex flex-col gap-2">
                    <p className="text-xs text-gray-600">
                      Archive this project? It will be hidden from the active list
                      but all data is preserved.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        onClick={() => setArchiveConfirm(false)}
                        disabled={archiving}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 h-7 text-xs bg-gray-600 hover:bg-gray-700"
                        onClick={handleArchiveProject}
                        disabled={archiving}
                      >
                        {archiving ? 'Archiving…' : 'Archive'}
                      </Button>
                    </div>
                  </div>
                )}

              </div>
            )}

          </div>
        </SheetContent>
      </Sheet>

      {/* Edit modal — renders on top of this drawer */}
      <EditProjectModal
        project={showEdit ? project : null}
        onClose={() => setShowEdit(false)}
      />

      {/* Site detail drawer — stacks on top */}
      {selectedSite && (
        <SiteDetailDrawer
          site={selectedSite}
          open={showSiteDetail}
          onClose={() => {
            setShowSiteDetail(false);
            setTimeout(() => setSelectedSite(null), 350);
          }}
        />
      )}
    </>
  );
}
