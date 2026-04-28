import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { useTaskMasterAdmin }   from '@/hooks/useTaskMasterAdmin';
import { useTaskMasterActions } from '@/hooks/useTaskMasterActions';
import { TaskTypeCard }         from '@/components/taskmaster/TaskTypeCard';
import { EditTaskTypeModal }    from '@/components/taskmaster/EditTaskTypeModal';
import { Button }               from '@/components/ui/button';
import { Skeleton }             from '@/components/ui/skeleton';
import type { TaskType }        from '@/types';

export function TaskMasterPage() {
  const navigate                          = useNavigate();
  const [searchParams]                    = useSearchParams();
  const { taskTypes, loading }            = useTaskMasterAdmin();
  const { toggleTaskTypeActive }          = useTaskMasterActions();

  const [selectedType, setSelectedType]   = useState<TaskType | null>(null);
  const [showEdit,     setShowEdit]       = useState(false);
  const [dismissed,    setDismissed]      = useState(false);

  // If we arrived from the "Create new task type" shortcut in CreateTaskModal,
  // open the New Task Type modal automatically.
  useEffect(() => {
    if (searchParams.get('openNew') === 'true') {
      setSelectedType(null);
      setShowEdit(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openNew() {
    setSelectedType(null);
    setShowEdit(true);
  }

  function openEdit(taskType: TaskType) {
    setSelectedType(taskType);
    setShowEdit(true);
  }

  function handleClose() {
    setShowEdit(false);
    setSelectedType(null);

    // If we arrived via the create-task-type flow (?openNew=true), navigate
    // back to the tasks page.  If sessionStorage holds a pending form, the
    // tasks page will restore it and reopen CreateTaskModal automatically.
    if (searchParams.get('openNew') === 'true') {
      const pending = sessionStorage.getItem('pendingTaskForm');
      if (pending) {
        navigate('/tasks?restoreForm=true');
      } else {
        navigate('/tasks');
      }
    }
  }

  return (
    <div className="max-w-2xl mx-auto">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-0.5">Task Master</h2>
          <p className="text-sm text-gray-500">
            {loading
              ? 'Loading…'
              : `${taskTypes.length} task type${taskTypes.length !== 1 ? 's' : ''} configured`}
          </p>
        </div>
        <Button
          onClick={openNew}
          className="shrink-0 flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" />
          New Task Type
        </Button>
      </div>

      {/* Info banner */}
      {!dismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 mb-5">
          <p className="flex-1 text-xs text-amber-800">
            Task types define the checklist field engineers follow. Changes take effect
            immediately for all connected devices.
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 text-amber-500 hover:text-amber-700 transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Task type list */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : taskTypes.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-400 text-sm mb-3">
            No task types configured yet.
          </p>
          <p className="text-gray-400 text-xs mb-6">
            Create your first task type to get started.
          </p>
          <Button variant="outline" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create First Task Type
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {[...taskTypes]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((tt) => (
              <TaskTypeCard
                key={tt.id}
                taskType={tt}
                onEdit={openEdit}
                onToggleActive={(id, active) => toggleTaskTypeActive(id, active)}
              />
            ))}
        </div>
      )}

      {/* Edit / Create modal */}
      <EditTaskTypeModal
        taskType={selectedType}
        open={showEdit}
        onClose={handleClose}
      />
    </div>
  );
}
