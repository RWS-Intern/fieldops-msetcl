import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useToast } from '@/components/ui/toast';
import type { TaskType } from '@/types';

export function useTaskMasterActions() {
  const { showToast } = useToast();

  /**
   * Create or fully replace a task type document.
   * merge: false ensures the full subtasks array is written atomically —
   * avoids partial updates if subtasks were deleted.
   * Cache invalidation is no longer needed — onSnapshot listeners in
   * useTaskMaster and useTaskMasterAdmin receive the write instantly.
   */
  async function saveTaskType(
    typeId: string,
    data:   Omit<TaskType, 'id'>,
  ): Promise<void> {
    try {
      await setDoc(
        doc(db, 'taskMaster', typeId),
        { ...data, updatedAt: serverTimestamp() },
        { merge: false },
      );
      showToast('Task type saved', 'success');
    } catch (err) {
      console.error('[saveTaskType] error:', err);
      showToast('Failed to save task type', 'error');
      throw err;
    }
  }

  /**
   * Toggle active/inactive without touching other fields.
   */
  async function toggleTaskTypeActive(
    typeId: string,
    active: boolean,
  ): Promise<void> {
    try {
      await updateDoc(doc(db, 'taskMaster', typeId), {
        active,
        updatedAt: serverTimestamp(),
      });
      showToast(active ? 'Task type activated' : 'Task type deactivated', 'success');
    } catch (err) {
      console.error('[toggleTaskTypeActive] error:', err);
      showToast('Failed to update task type', 'error');
    }
  }

  return { saveTaskType, toggleTaskTypeActive };
}
