import { Folder } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';
import type { Project, ProjectStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STRIPE: Record<ProjectStatus, string> = {
  pending:     '#9CA3AF',
  in_progress: '#F4A261',
  completed:   '#2A9D8F',
  blocked:     '#E63946',
};

const STATUS_BADGE: Record<ProjectStatus, string> = {
  pending:     'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-50 text-amber-700',
  completed:   'bg-green-50 text-green-700',
  blocked:     'bg-red-50 text-red-700',
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  blocked:     'Blocked',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project: Project;
  onView:  () => void;
  onEdit?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectCard({ project, onView, onEdit }: ProjectCardProps) {
  const { currentUser } = useAuthStore();
  const stripe         = STATUS_STRIPE[project.status] ?? '#9CA3AF';
  const templateCount  = (project.taskTemplates ?? []).length;
  const isInactive     = project.active === false;

  // Progress bar percentage — guard against taskCount = 0
  const progressPct =
    project.taskCount > 0
      ? Math.round((project.completedTaskCount / project.taskCount) * 100)
      : 0;

  // Assigned names: show first 3, then "+N more"
  const visibleNames  = project.assignedToNames.slice(0, 3);
  const hiddenCount   = project.assignedToNames.length - visibleNames.length;

  return (
    <Card className="overflow-hidden border-0 shadow-sm">
      <div className="flex">
        {/* Left colour stripe */}
        <div className="w-1 shrink-0" style={{ backgroundColor: stripe }} />

        <div className="flex-1 p-3 min-w-0">
          {/* Project number + code + inactive badge */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Folder className="h-3 w-3 text-gray-400 shrink-0" />
            <span className="text-xs font-mono text-gray-400">{project.projectNum}</span>
            {project.projectCode && (
              <span className="text-xs font-mono font-semibold text-brand-blue bg-blue-50 rounded px-1.5 py-0.5">
                {project.projectCode}
              </span>
            )}
            {project.siteCode && (
              <span className="text-xs text-gray-400">· {project.siteCode}</span>
            )}
            {isInactive && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                Inactive
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-1">
            {project.title}
          </h3>

          {/* Description */}
          {project.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">
              {project.description}
            </p>
          )}

          {/* Progress bar */}
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">
                {project.completedTaskCount} of {project.taskCount} task
                {project.taskCount !== 1 ? 's' : ''} completed
              </span>
              <span className="text-xs font-medium text-gray-600">{progressPct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Status badge */}
          <div className="flex items-center mt-2">
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[project.status]}`}
            >
              {STATUS_LABELS[project.status]}
            </span>
          </div>

          {/* Assigned engineers */}
          {project.assignedToNames.length > 0 && (
            <p className="text-xs text-gray-400 mt-1.5">
              {visibleNames.join(', ')}
              {hiddenCount > 0 && ` +${hiddenCount} more`}
            </p>
          )}

          {/* Task template count */}
          {currentUser?.role === 'admin' && (
            <p className="text-xs text-gray-400 mt-1">
              {templateCount === 0
                ? 'No task types defined'
                : `${templateCount} task type${templateCount !== 1 ? 's' : ''}`}
            </p>
          )}

          {/* View + Edit buttons — admin only */}
          {currentUser?.role === 'admin' && (
            <div className="flex justify-end gap-2 mt-2">
              {onEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={onEdit}
                >
                  Edit
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={onView}
              >
                View
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
