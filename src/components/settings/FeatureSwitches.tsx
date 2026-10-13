import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useFeatureFlags, type FeatureFlags } from '@/hooks/useFeatureFlags';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const SWITCHES: { key: keyof FeatureFlags; label: string; help: string }[] = [
  {
    key:   'surveyRemoteAutosaveEnabled',
    label: 'Survey cloud autosave',
    help:  'Saves half-finished surveys to the server so engineers can resume on another device.',
  },
  {
    key:   'surveyBackgroundPhotoUploadEnabled',
    label: 'Background photo upload',
    help:  'Uploads survey photos whenever there is signal, not only at capture and submit.',
  },
];

/** Admin kill switches. Changes reach every open session live. */
export function FeatureSwitches() {
  const flags = useFeatureFlags();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<keyof FeatureFlags | null>(null);

  async function toggle(key: keyof FeatureFlags) {
    setBusy(key);
    try {
      // merge: never touch the counters that share this document.
      await setDoc(doc(db, 'appConfig', 'global'), { [key]: !flags[key] }, { merge: true });
    } catch (err) {
      console.error('[FeatureSwitches] update failed:', err);
      showToast('Failed to update setting. Try again.', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-base font-semibold text-gray-900">Feature switches</h3>
      <p className="mb-3 text-sm text-gray-500">Takes effect immediately for everyone. Turn off if anything misbehaves.</p>
      <div className="flex flex-col divide-y divide-gray-100">
        {SWITCHES.map(({ key, label, help }) => (
          <div key={key} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{label}</p>
              <p className="text-xs text-gray-500">{help}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={flags[key]}
              aria-label={label}
              disabled={busy !== null}
              onClick={() => toggle(key)}
              className={cn(
                'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
                flags[key] ? 'bg-brand-blue' : 'bg-gray-300',
              )}
            >
              <span className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                flags[key] ? 'translate-x-5' : 'translate-x-0.5',
              )} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
