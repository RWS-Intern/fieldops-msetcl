import { useEffect, useMemo, useState } from 'react';
import { Navigation } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { parseCoordinatesInput, isValidLatLng } from '@/lib/coordinates';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SurveyStepProps } from './StepProps';
import type { SurveyPreVisit } from '@/types';

// ─── Section B checklist items ─────────────────────────────────────────────────

const PRE_VISIT_ITEMS: { key: keyof SurveyPreVisit; label: string }[] = [
  { key: 'inZonalPlanAndEngineerConfirmed', label: 'Site included in the zonal survey plan and MSETCL engineer confirmed' },
  { key: 'authorisationLetterCarried',      label: 'Authorisation / intimation letter to the substation carried' },
  { key: 'existingSldObtained',             label: 'Existing SLD / substation drawings obtained (if available)' },
  { key: 'toolsCarried',                    label: 'Tools carried: measuring tape/laser, camera, this checklist, tender BOQ, laptop' },
  { key: 'substationInchargeContactConfirmed', label: 'Substation in-charge contact confirmed' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────────

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-800 truncate">{value}</span>
    </div>
  );
}

// ─── Step ─────────────────────────────────────────────────────────────────────

/** Site & visit details — form Sections A + B. */
export function StepSiteVisit({ survey, onChange, readOnly, siteName, siteMaster }: SurveyStepProps) {
  const { currentUser } = useAuthStore();

  const [gpsStatus, setGpsStatus]     = useState<'idle' | 'capturing' | 'error'>('idle');
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualInput, setManualInput] = useState('');

  const manualParsed = useMemo(() => {
    const parsed = parseCoordinatesInput(manualInput);
    return parsed && isValidLatLng(parsed.lat, parsed.lng) ? parsed : null;
  }, [manualInput]);

  function captureLocation() {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      setGpsErrorMsg('Geolocation is not supported on this device. Enter coordinates manually below.');
      return;
    }
    setGpsStatus('capturing');
    setGpsErrorMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({ location: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
        setGpsStatus('idle');
      },
      (err) => {
        setGpsStatus('error');
        setGpsErrorMsg(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Enter coordinates manually below.'
            : 'Could not get current location. Enter coordinates manually below.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  // Auto-capture GPS once, on first mount, only if nothing is set yet and the
  // survey is editable — never re-fires on later re-renders (empty deps),
  // and re-mounting this step (navigating back to it) only retries if the
  // location is still unset, so a manual override or a prior success is
  // never clobbered.
  useEffect(() => {
    if (!readOnly && !survey.location) {
      captureLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default the survey date to today on first mount, same reasoning as above.
  useEffect(() => {
    if (!readOnly && !survey.surveyDate) {
      onChange({ surveyDate: new Date() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default the surveyor name to the logged-in user, same reasoning as above.
  useEffect(() => {
    if (!readOnly && !survey.surveyorName && currentUser?.name) {
      onChange({ surveyorName: currentUser.name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSaveManualLocation() {
    if (!manualParsed) return;
    onChange({ location: manualParsed });
    setManualInput('');
    setShowManualEntry(false);
    setGpsStatus('idle');
    setGpsErrorMsg(null);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Section A — Site identification (read-only) + visit details */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-gray-900">Site &amp; Visit Details</h3>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 p-3 rounded-lg bg-gray-50 border border-gray-100">
          <ReadOnlyField label="Substation" value={siteName || survey.siteCode || '—'} />
          <ReadOnlyField label="Site Code" value={survey.siteCode || '—'} />
          <ReadOnlyField label="SAP Code" value={survey.sapCode ?? '—'} />
          <ReadOnlyField label="Zone" value={survey.zone ?? '—'} />
          <ReadOnlyField label="Voltage Class" value={survey.voltageClass ? `${survey.voltageClass} kV` : '—'} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="surveyDate">Survey Date</Label>
          <Input
            id="surveyDate"
            type="date"
            disabled={readOnly}
            value={survey.surveyDate ? toDateInputValue(survey.surveyDate) : ''}
            onChange={(e) =>
              onChange({ surveyDate: e.target.value ? new Date(`${e.target.value}T00:00:00`) : null })
            }
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="surveyorName">Surveyor (our rep)</Label>
          <Input
            id="surveyorName"
            disabled={readOnly}
            value={survey.surveyorName ?? ''}
            onChange={(e) => onChange({ surveyorName: e.target.value })}
          />
        </div>

        {/* GPS location */}
        <div className="flex flex-col gap-1.5">
          <Label>Location (GPS)</Label>
          {survey.location ? (
            <p className="text-sm font-mono text-gray-700">
              {survey.location.lat.toFixed(6)}, {survey.location.lng.toFixed(6)}
            </p>
          ) : (
            <p className="text-sm text-gray-400">Not captured yet.</p>
          )}
          {gpsStatus === 'capturing' && (
            <p className="text-xs text-brand-blue">Capturing location…</p>
          )}
          {gpsStatus === 'error' && gpsErrorMsg && (
            <p className="text-xs text-brand-red">{gpsErrorMsg}</p>
          )}

          {!readOnly && (
            <div className="flex gap-2 flex-wrap">
              <Button
                type="button" variant="outline" size="sm" className="gap-1.5"
                onClick={captureLocation}
                disabled={gpsStatus === 'capturing'}
              >
                <Navigation className="h-3.5 w-3.5" />
                Re-capture
              </Button>
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => setShowManualEntry((v) => !v)}
              >
                Enter manually
              </Button>
            </div>
          )}

          {!readOnly && showManualEntry && (
            <div className="flex flex-col gap-2 p-3 rounded-lg bg-gray-50 border border-gray-200">
              <Input
                placeholder="Paste Google Maps link or 'lat, lng'"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
              />
              {manualInput.trim() !== '' && !manualParsed && (
                <p className="text-xs text-brand-red">Couldn&apos;t recognise those coordinates.</p>
              )}
              <Button type="button" size="sm" disabled={!manualParsed} onClick={handleSaveManualLocation}>
                Save Location
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="surveyedTotalBays">Total Bays (counted)</Label>
            <Input
              id="surveyedTotalBays"
              type="number" inputMode="numeric" disabled={readOnly}
              value={survey.surveyedTotalBays ?? ''}
              onChange={(e) =>
                onChange({ surveyedTotalBays: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
            {siteMaster?.totalBays != null && (
              <p className="text-xs text-gray-400">Master: {siteMaster.totalBays}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="surveyedNumPowerTransformers">Power Transformers (counted)</Label>
            <Input
              id="surveyedNumPowerTransformers"
              type="number" inputMode="numeric" disabled={readOnly}
              value={survey.surveyedNumPowerTransformers ?? ''}
              onChange={(e) =>
                onChange({ surveyedNumPowerTransformers: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
            {siteMaster?.numPowerTransformers != null && (
              <p className="text-xs text-gray-400">Master: {siteMaster.numPowerTransformers}</p>
            )}
          </div>
        </div>
      </div>

      {/* Section B — Pre-visit checklist */}
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-gray-900">Pre-Visit Checklist</h3>
        {PRE_VISIT_ITEMS.map((item) => (
          <label
            key={item.key}
            className={cn(
              'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
              survey.preVisit[item.key] ? 'bg-blue-50 border-blue-200' : 'border-gray-200',
              readOnly && 'cursor-not-allowed opacity-70',
            )}
          >
            <input
              type="checkbox"
              checked={survey.preVisit[item.key]}
              disabled={readOnly}
              onChange={(e) => onChange({ preVisit: { ...survey.preVisit, [item.key]: e.target.checked } })}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-brand-blue focus:ring-brand-blue"
            />
            <span className="text-sm text-gray-700">{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
