import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RepeatableGroupProps<T extends { uid: string }> {
  entries: T[];
  onChange: (entries: T[]) => void;
  createEntry: () => T;
  renderSummary: (entry: T, index: number) => ReactNode;
  renderForm: (entry: T, update: (patch: Partial<T>) => void) => ReactNode;
  readOnly: boolean;
  /** e.g. "Add Bay" */
  addLabel: string;
  /** e.g. "No bays added yet." */
  emptyText: string;
  /** Singular noun used in counts and the remove-confirm text, e.g. "bay". */
  entryNoun: string;
}

/**
 * One shared repeatable-entry pattern for bays, devices and cable runs:
 * collapsible cards, add/remove with confirm, entry count, empty state, and
 * readOnly support (no add/remove; entries still expand for review but the
 * caller is responsible for disabling its own form inputs via its own
 * readOnly prop when it builds renderForm).
 */
export function RepeatableGroup<T extends { uid: string }>({
  entries,
  onChange,
  createEntry,
  renderSummary,
  renderForm,
  readOnly,
  addLabel,
  emptyText,
  entryNoun,
}: RepeatableGroupProps<T>) {
  const [expanded, setExpanded]             = useState<Set<string>>(new Set());
  const [confirmRemoveUid, setConfirmRemoveUid] = useState<string | null>(null);
  const scrollTargetUid = useRef<string | null>(null);
  const cardRefs        = useRef<Map<string, HTMLDivElement>>(new Map());

  // Scrolls a freshly-added entry into view once its card has rendered.
  useEffect(() => {
    if (!scrollTargetUid.current) return;
    const el = cardRefs.current.get(scrollTargetUid.current);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    scrollTargetUid.current = null;
  }, [entries.length]);

  function toggleExpanded(uid: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  }

  function handleAdd() {
    const entry = createEntry();
    onChange([...entries, entry]);
    setExpanded((prev) => new Set(prev).add(entry.uid));
    scrollTargetUid.current = entry.uid;
  }

  function handleUpdate(uid: string, patch: Partial<T>) {
    onChange(entries.map((e) => (e.uid === uid ? { ...e, ...patch } : e)));
  }

  function handleRemove(uid: string) {
    onChange(entries.filter((e) => e.uid !== uid));
    setConfirmRemoveUid(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500">
          {entries.length} {entries.length === 1 ? entryNoun : `${entryNoun}s`}
        </span>
        {!readOnly && (
          <Button type="button" size="sm" variant="outline" className="gap-1" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
            {addLabel}
          </Button>
        )}
      </div>

      {entries.length === 0 && (
        <div className="py-8 text-center text-sm text-gray-400 rounded-lg border border-dashed border-gray-200">
          {emptyText}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {entries.map((entry, index) => {
          const isExpanded   = expanded.has(entry.uid);
          const isConfirming = confirmRemoveUid === entry.uid;

          return (
            <div
              key={entry.uid}
              ref={(el) => {
                if (el) cardRefs.current.set(entry.uid, el);
                else cardRefs.current.delete(entry.uid);
              }}
              className="rounded-lg border border-gray-100 bg-white shadow-sm overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggleExpanded(entry.uid)}
                className="w-full flex items-center justify-between gap-2 p-3 text-left"
              >
                <span className="text-sm text-gray-700 min-w-0 flex-1 truncate">
                  {renderSummary(entry, index)}
                </span>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-gray-400 shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 p-3 flex flex-col gap-3">
                  {renderForm(entry, (patch) => handleUpdate(entry.uid, patch))}

                  {!readOnly && (
                    isConfirming ? (
                      <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 flex flex-col gap-2">
                        <p className="text-xs text-red-700">
                          Remove this {entryNoun}? This can&apos;t be undone.
                        </p>
                        <div className="flex gap-2 justify-end">
                          <Button
                            type="button" variant="outline" size="sm" className="text-xs"
                            onClick={() => setConfirmRemoveUid(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button" size="sm"
                            className={cn('text-xs bg-brand-red hover:bg-red-700')}
                            onClick={() => handleRemove(entry.uid)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs text-brand-red hover:bg-red-50 gap-1 w-full"
                        onClick={() => setConfirmRemoveUid(entry.uid)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove {entryNoun}
                      </Button>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
