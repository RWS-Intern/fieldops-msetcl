import { useState } from 'react';
import { Plus, RotateCcw } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useProjectStore } from '@/store/projectStore';
import { useAuthStore } from '@/store/authStore';
import { useRealtimeProjectStats } from '@/hooks/useRealtimeProjectStats';
import { useToast } from '@/components/ui/toast';
import { archiveProject } from '@/hooks/useProjectActions';
import { ProjectCard }        from '@/components/projects/ProjectCard';
import { CreateProjectModal } from '@/components/projects/CreateProjectModal';
import { EditProjectModal }   from '@/components/projects/EditProjectModal';
import { ProjectDetailDrawer } from '@/components/projects/ProjectDetailDrawer';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Project, ProjectStatus } from '@/types';

// ─── Mini stat card ────────────────────────────────────────────────────────────

interface MiniStatProps {
  label:   string;
  count:   number;
  colour:  string;
  active:  boolean;
  onClick: () => void;
}

function MiniStat({ label, count, colour, active, onClick }: MiniStatProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-lg border p-3 text-left transition-all"
      style={
        active
          ? { backgroundColor: colour, borderColor: colour }
          : { backgroundColor: 'white', borderColor: '#E5E7EB' }
      }
    >
      <p
        className="text-xl font-bold leading-none"
        style={{ color: active ? 'white' : colour }}
      >
        {count}
      </p>
      <p
        className="text-xs mt-1 font-medium"
        style={{ color: active ? 'rgba(255,255,255,0.85)' : '#6B7280' }}
      >
        {label}
      </p>
    </button>
  );
}

// ─── Skeletons ─────────────────────────────────────────────────────────────────

function ProjectSkeletons() {
  return (
    <div className="flex flex-col gap-2">
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-32 rounded-lg" />
      ))}
    </div>
  );
}

/** Minimal card shown in the archived view */
function ArchivedProjectCard({
  project,
  canRestore,
  onRestore,
}: {
  project:    Project;
  /** False for a read-only viewer — Restore is not rendered. */
  canRestore: boolean;
  onRestore:  () => void;
}) {
  return (
    <Card className="overflow-hidden border-0 shadow-sm opacity-75">
      <div className="flex">
        <div className="w-1 shrink-0 bg-gray-300" />
        <div className="flex-1 p-3 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0">
              <span className="text-xs font-mono text-gray-400">{project.projectNum}</span>
              {project.siteCode && (
                <span className="text-xs text-gray-400 ml-2">· {project.siteCode}</span>
              )}
            </div>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">
              Archived
            </span>
          </div>
          <h3 className="text-sm font-semibold text-gray-600 leading-snug line-clamp-1">
            {project.title}
          </h3>
          {project.description && (
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{project.description}</p>
          )}
          {project.assignedToNames.length > 0 && (
            <p className="text-xs text-gray-400 mt-1.5">
              {project.assignedToNames.slice(0, 2).join(', ')}
              {project.assignedToNames.length > 2 && ` +${project.assignedToNames.length - 2} more`}
            </p>
          )}
          {canRestore && (
            <div className="flex justify-end mt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={onRestore}
              >
                <RotateCcw className="h-3 w-3" />
                Restore
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

type FilterKey = ProjectStatus | 'all';

export function ProjectsPage() {
  const { projects, lastUpdated } = useProjectStore();
  const stats                     = useRealtimeProjectStats();
  const { showToast }             = useToast();
  const { currentUser }           = useAuthStore();

  // A viewer gets the same list, stat chips and detail drawer with New Project,
  // Edit and Restore not rendered.
  const canManageProjects = currentUser?.role === 'admin';

  const [activeFilter, setActiveFilter]       = useState<FilterKey>('all');
  const [showCreate, setShowCreate]           = useState(false);
  const [editProject, setEditProject]         = useState<Project | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showDetail, setShowDetail]           = useState(false);

  // Archived-view state
  const [showArchived, setShowArchived]         = useState(false);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [loadingArchived, setLoadingArchived]   = useState(false);

  const isLoading = !lastUpdated && projects.length === 0;

  const filtered =
    activeFilter === 'all'
      ? projects
      : projects.filter((p) => p.status === activeFilter);

  function toggleFilter(key: FilterKey) {
    setActiveFilter((prev) => (prev === key ? 'all' : key));
  }

  // ── Fetch archived projects (admin, on demand) ────────────────────────────
  async function loadArchivedProjects() {
    setLoadingArchived(true);
    try {
      const q = query(collection(db, 'projects'), where('archived', '==', true));
      const snap = await getDocs(q);
      const loaded: Project[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id:                 d.id,
          projectNum:         data['projectNum']         ?? '',
          title:              data['title']              ?? '',
          description:        data['description']        ?? undefined,
          status:             data['status']             ?? 'pending',
          assignedTo:         data['assignedTo']         ?? [],
          assignedToNames:    data['assignedToNames']    ?? [],
          createdBy:          data['createdBy']          ?? '',
          createdAt:          data['createdAt']?.toDate?.()   ?? new Date(),
          siteCode:           data['siteCode']           ?? undefined,
          startDate:          data['startDate']?.toDate?.()   ?? new Date(),
          dueDate:            data['dueDate']?.toDate?.()     ?? new Date(),
          taskCount:          data['taskCount']          ?? 0,
          completedTaskCount: data['completedTaskCount'] ?? 0,
          updatedAt:          data['updatedAt']?.toDate?.()   ?? new Date(),
          archived:           true,
          archivedAt:         data['archivedAt']?.toDate?.()  ?? null,
        } as Project;
      });
      loaded.sort((a, b) =>
        (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0)
      );
      setArchivedProjects(loaded);
    } catch {
      setArchivedProjects([]);
    } finally {
      setLoadingArchived(false);
    }
  }

  async function handleRestoreProject(projectId: string) {
    try {
      await archiveProject(projectId, false);
      setArchivedProjects((prev) => prev.filter((p) => p.id !== projectId));
      showToast('Project restored', 'success');
    } catch {
      showToast('Failed to restore project', 'error');
    }
  }

  const currentlyLoading = showArchived ? loadingArchived : isLoading;
  const displayProjects  = showArchived ? archivedProjects : filtered;

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-4">
      {/* Heading + count badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-gray-900">
            {showArchived ? 'Archived Projects' : 'Projects'}
          </h2>
          <span className="rounded-full bg-brand-blue/10 text-brand-blue text-xs font-semibold px-2 py-0.5">
            {currentlyLoading ? '…' : displayProjects.length}
          </span>
        </div>
        {!showArchived && canManageProjects && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-full bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-brand-navy active:scale-95 transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            New Project
          </button>
        )}
      </div>

      {/* Stat chips — hidden in archived view */}
      {!showArchived && (
        isLoading ? (
          <div className="flex gap-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="flex-1 h-16 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="flex gap-2">
            <MiniStat
              label="All"
              count={stats.all}
              colour="#0077B6"
              active={activeFilter === 'all'}
              onClick={() => toggleFilter('all')}
            />
            <MiniStat
              label="In Progress"
              count={stats.in_progress}
              colour="#F4A261"
              active={activeFilter === 'in_progress'}
              onClick={() => toggleFilter('in_progress')}
            />
            <MiniStat
              label="Completed"
              count={stats.completed}
              colour="#2A9D8F"
              active={activeFilter === 'completed'}
              onClick={() => toggleFilter('completed')}
            />
            <MiniStat
              label="Blocked"
              count={stats.blocked}
              colour="#E63946"
              active={activeFilter === 'blocked'}
              onClick={() => toggleFilter('blocked')}
            />
          </div>
        )
      )}

      {/* Show archived toggle */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            const next = !showArchived;
            setShowArchived(next);
            if (next) loadArchivedProjects();
            else setArchivedProjects([]);
          }}
          className={cn(
            'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
            showArchived
              ? 'bg-gray-500 text-white border-gray-500'
              : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
          )}
        >
          {showArchived ? 'Hide Archived' : 'Show Archived'}
        </button>
      </div>

      {/* Project list */}
      {currentlyLoading ? (
        <ProjectSkeletons />
      ) : displayProjects.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">
            {showArchived
              ? 'No archived projects found.'
              : projects.length === 0
              ? 'No projects yet.'
              : 'No projects match this filter.'}
          </p>
          {!showArchived && projects.length === 0 && canManageProjects && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="mt-3 text-sm font-medium text-brand-blue hover:underline"
            >
              + New Project
            </button>
          )}
        </div>
      ) : showArchived ? (
        <div className="flex flex-col gap-2">
          {displayProjects.map((project) => (
            <ArchivedProjectCard
              key={project.id}
              project={project}
              canRestore={canManageProjects}
              onRestore={() => handleRestoreProject(project.id)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {displayProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onView={() => {
                setSelectedProject(project);
                setShowDetail(true);
              }}
              onEdit={canManageProjects ? () => setEditProject(project) : undefined}
            />
          ))}
        </div>
      )}

      {/* Create + edit project modals — both write, so admin only */}
      {canManageProjects && (
        <>
          <CreateProjectModal
            open={showCreate}
            onClose={() => setShowCreate(false)}
          />

          <EditProjectModal
            project={editProject}
            onClose={() => setEditProject(null)}
          />
        </>
      )}

      {/* Project detail drawer */}
      {selectedProject && (
        <ProjectDetailDrawer
          project={selectedProject}
          open={showDetail}
          onClose={() => {
            setShowDetail(false);
            setTimeout(() => setSelectedProject(null), 350);
          }}
        />
      )}
    </div>
  );
}
