import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/config';

export interface FeatureFlags {
  surveyRemoteAutosaveEnabled:        boolean;
  surveyBackgroundPhotoUploadEnabled: boolean;
}

const OFF: FeatureFlags = {
  surveyRemoteAutosaveEnabled:        false,
  surveyBackgroundPhotoUploadEnabled: false,
};

/**
 * Live kill switches from appConfig/global.
 *
 * A real-time listener, not useAppConfig's 10-minute cache: a kill switch that
 * takes ten minutes to reach an engineer's phone is not a kill switch. Absent
 * fields and any read error resolve to OFF, so failure is the safe direction.
 */
export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(OFF);

  useEffect(() => onSnapshot(
    doc(db, 'appConfig', 'global'),
    (snap) => {
      const d = snap.data() ?? {};
      setFlags({
        surveyRemoteAutosaveEnabled:        d['surveyRemoteAutosaveEnabled'] === true,
        surveyBackgroundPhotoUploadEnabled: d['surveyBackgroundPhotoUploadEnabled'] === true,
      });
    },
    () => setFlags(OFF),
  ), []);

  return flags;
}
