import { useEffect, useMemo, useState } from 'react';
import { Navigation } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { parseCoordinatesInput, isValidLatLng } from '@/lib/coordinates';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { TriStateToggle } from '@/components/survey/TriStateToggle';
import { PRE_VISIT_LABELS, BAY_COUNT_LABELS } from '@/lib/surveyLabels';
import { SURVEY_VOLTAGE_LEVELS } from '@/types';
import type { SurveyStepProps } from './StepProps';
import type {
  SurveyContactDetails, SurveyControlRoom, SurveyAssetCounts,
} from '@/types';

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

/**
 * Number inputs on this step are all counts, so they share one handler: blank
 * clears to null, never to 0. An unanswered count must not read as a
 * considered "zero of these" — these figures set BOQ-adjacent expectations,
 * and a reviewer has to be able to tell "none here" from "nobody looked".
 */
function toCount(raw: string): number | null {
  return raw === '' ? null : Math.max(0, Number(raw));
}

// ─── Step ─────────────────────────────────────────────────────────────────────

/**
 * Site & Visit — Step 1. Four groups, matching how the checklist itself groups
 * them: contact details, control room details, asset counts, and the
 * (unchanged) pre-visit checklist. The survey-date / GPS / surveyor-name
 * capture that has always lived here is untouched and carries the new groups
 * alongside it.
 */
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

  // Patch helpers for the three nested groups — each spreads the current group
  // so a partial edit never drops a sibling field.
  function updateContact(patch: Partial<SurveyContactDetails>) {
    onChange({ contactDetails: { ...survey.contactDetails, ...patch } });
  }
  function updateControlRoom(patch: Partial<SurveyControlRoom>) {
    onChange({ controlRoom: { ...survey.controlRoom, ...patch } });
  }
  function updateAssetCounts(patch: Partial<SurveyAssetCounts>) {
    onChange({ assetCounts: { ...survey.assetCounts, ...patch } });
  }

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

  // Master-value hints (Annexure-II) are kept from the previous version of
  // this step, but the bay figure now compares against the SUM of the four
  // per-voltage counts, since that is what replaced the single total. The sum
  // stays null until at least one level is answered, so a partially-filled
  // group never shows a misleadingly low discrepancy.
  const answeredBayCounts = SURVEY_VOLTAGE_LEVELS
    .map((level) => survey.assetCounts.baysByVoltage[level])
    .filter((n): n is number => n != null);
  const totalBaysAnswered = answeredBayCounts.length > 0
    ? answeredBayCounts.reduce((sum, n) => sum + n, 0)
    : null;

  const contact     = survey.contactDetails;
  const controlRoom = survey.controlRoom;
  const counts      = survey.assetCounts;

  return (
    <div className="flex flex-col gap-5">
      {/* Site identification (read-only) + visit details */}
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
      </div>

      {/* ── Contact Details ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-gray-900">Contact Details</h3>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ssInchargeName">Name of the Substation In-charge</Label>
            <Input
              id="ssInchargeName"
              disabled={readOnly}
              value={contact.substationInchargeName ?? ''}
              onChange={(e) => updateContact({ substationInchargeName: e.target.value || null })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ssInchargePhone">Substation In-charge Contact Details</Label>
            <Input
              id="ssInchargePhone"
              type="tel" inputMode="tel" disabled={readOnly}
              value={contact.substationInchargePhone ?? ''}
              onChange={(e) => updateContact({ substationInchargePhone: e.target.value || null })}
            />
          </div>
        </div>

        {/*
          The STATION's own numbers — a separate row on the document from the
          in-charge person's contact above, and the two are not
          interchangeable: the station line outlives a change of in-charge.
          Grouped visually under the document's heading while staying two flat
          fields on the type.
        */}
        <div className="flex flex-col gap-1.5">
          <Label>Substation Telephone no./s</Label>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ssLandline" className="text-xs font-normal text-gray-500">
                Landline
              </Label>
              <Input
                id="ssLandline"
                type="tel" inputMode="tel" disabled={readOnly}
                value={contact.substationLandline ?? ''}
                onChange={(e) => updateContact({ substationLandline: e.target.value || null })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ssVoip" className="text-xs font-normal text-gray-500">
                VOIP
              </Label>
              <Input
                id="ssVoip"
                type="tel" inputMode="tel" disabled={readOnly}
                value={contact.substationVoip ?? ''}
                onChange={(e) => updateContact({ substationVoip: e.target.value || null })}
              />
            </div>
          </div>
        </div>

        {/*
          One free-text box, not a repeatable list: the paper checklist gives
          this a single cell, and shift rosters are written as prose ("A shift
          — Patil 98…"). Structuring it would force surveyors to invent a
          format the document doesn't ask for.
        */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="shiftOperatorContacts">Contact Details of Shift Operators</Label>
          <Textarea
            id="shiftOperatorContacts"
            disabled={readOnly}
            value={contact.shiftOperatorContacts ?? ''}
            onChange={(e) => updateContact({ shiftOperatorContacts: e.target.value || null })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ssAddress">Address</Label>
          <Textarea
            id="ssAddress"
            disabled={readOnly}
            value={contact.address ?? ''}
            onChange={(e) => updateContact({ address: e.target.value || null })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ssCircle">Circle</Label>
            <Input
              id="ssCircle"
              disabled={readOnly}
              value={contact.circle ?? ''}
              onChange={(e) => updateContact({ circle: e.target.value || null })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ssDivision">Division</Label>
            <Input
              id="ssDivision"
              disabled={readOnly}
              value={contact.division ?? ''}
              onChange={(e) => updateContact({ division: e.target.value || null })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="commissionedDate">Commissioned Date</Label>
          <Input
            id="commissionedDate"
            type="date"
            disabled={readOnly}
            value={contact.commissionedDate ? toDateInputValue(contact.commissionedDate) : ''}
            onChange={(e) => updateContact({
              commissionedDate: e.target.value ? new Date(`${e.target.value}T00:00:00`) : null,
            })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nearestLandmark">Nearest Railway Station / Landmark</Label>
          <Input
            id="nearestLandmark"
            disabled={readOnly}
            value={contact.nearestRailwayStationOrLandmark ?? ''}
            onChange={(e) => updateContact({
              nearestRailwayStationOrLandmark: e.target.value || null,
            })}
          />
        </div>
      </div>

      {/* ── Control Room Details ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-gray-900">Control Room Details</h3>

        {/*
          NOT a dimensions field. The document asks for a SKETCH of panel
          placements with the proposed RTU location marked on it, agreed with
          the local S/S in-charge. In-app drawing is out of scope — the paper
          sketch stays the artefact — so this captures the notes that go with
          it and points the surveyor at the photo step for the sketch itself.
        */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="layoutNotes">Control room layout notes</Label>
          <Textarea
            id="layoutNotes"
            disabled={readOnly}
            value={controlRoom.layoutNotes ?? ''}
            onChange={(e) => updateControlRoom({ layoutNotes: e.target.value || null })}
          />
          <p className="text-xs text-gray-500">
            Sketch the panel layout on paper and mark the proposed RTU location — note it
            here, and capture it in the site photos.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roomTemperature">Room Temperature</Label>
          <Input
            id="roomTemperature"
            disabled={readOnly}
            placeholder="e.g. 28 °C"
            value={controlRoom.roomTemperature ?? ''}
            onChange={(e) => updateControlRoom({ roomTemperature: e.target.value || null })}
          />
        </div>

        <TriStateToggle
          label="AC available?"
          value={controlRoom.acAvailable}
          onChange={(v) => updateControlRoom({ acAvailable: v })}
          readOnly={readOnly}
        />
        {/* Condition is only a question about an AC that exists. Existing
            answers are kept rather than cleared if the parent flips — same
            reasoning as the RS485 field on the Feeder List step. */}
        {controlRoom.acAvailable === true && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="acCondition">AC Condition</Label>
            <Input
              id="acCondition"
              disabled={readOnly}
              value={controlRoom.acCondition ?? ''}
              onChange={(e) => updateControlRoom({ acCondition: e.target.value || null })}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rtuPanelDimensions">
            Mounting Structure / Existing RTU Panel Dimensions
          </Label>
          <Input
            id="rtuPanelDimensions"
            disabled={readOnly}
            value={controlRoom.mountingStructureOrRtuPanelDimensions ?? ''}
            onChange={(e) => updateControlRoom({
              mountingStructureOrRtuPanelDimensions: e.target.value || null,
            })}
          />
        </div>

        <TriStateToggle
          label="Cable trench available?"
          value={controlRoom.cableTrenchAvailable}
          onChange={(v) => updateControlRoom({ cableTrenchAvailable: v })}
          readOnly={readOnly}
        />
        {controlRoom.cableTrenchAvailable === true && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="crTrenchLength">Cable Trench Length (m)</Label>
            <Input
              id="crTrenchLength"
              type="number" inputMode="numeric" disabled={readOnly}
              value={controlRoom.cableTrenchLengthM ?? ''}
              onChange={(e) => updateControlRoom({ cableTrenchLengthM: toCount(e.target.value) })}
            />
          </div>
        )}

        <TriStateToggle
          label="Trench extension needed?"
          value={controlRoom.trenchExtensionNeeded}
          onChange={(v) => updateControlRoom({ trenchExtensionNeeded: v })}
          readOnly={readOnly}
        />
      </div>

      {/* ── Asset Counts ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-gray-900">Asset Counts</h3>

        <div className="flex flex-col gap-1.5">
          {/* Driven by SURVEY_VOLTAGE_LEVELS so adding a level is a one-place
              change — never a new hard-coded input here. Labels come from
              BAY_COUNT_LABELS, which carries the document's verbatim row
              wording rather than the generic voltage-picker text. */}
          <div className="grid grid-cols-2 gap-3">
            {SURVEY_VOLTAGE_LEVELS.map((level) => (
              <div key={level} className="flex flex-col gap-1">
                <Label htmlFor={`bays-${level}`} className="text-xs font-normal text-gray-600">
                  {BAY_COUNT_LABELS[level]}
                </Label>
                <Input
                  id={`bays-${level}`}
                  type="number" inputMode="numeric" disabled={readOnly}
                  value={counts.baysByVoltage[level] ?? ''}
                  onChange={(e) => updateAssetCounts({
                    baysByVoltage: {
                      ...counts.baysByVoltage,
                      [level]: toCount(e.target.value),
                    },
                  })}
                />
              </div>
            ))}
          </div>
          {siteMaster?.totalBays != null && (
            <p className="text-xs text-gray-400">
              Master total: {siteMaster.totalBays}
              {totalBaysAnswered != null && ` · counted so far: ${totalBaysAnswered}`}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transformerCount">Number of Transformers</Label>
            <Input
              id="transformerCount"
              type="number" inputMode="numeric" disabled={readOnly}
              value={counts.transformerCount ?? ''}
              onChange={(e) => updateAssetCounts({ transformerCount: toCount(e.target.value) })}
            />
            {siteMaster?.numPowerTransformers != null && (
              <p className="text-xs text-gray-400">Master: {siteMaster.numPowerTransformers}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="busCount">Number of Buses</Label>
            <Input
              id="busCount"
              type="number" inputMode="numeric" disabled={readOnly}
              value={counts.busCount ?? ''}
              onChange={(e) => updateAssetCounts({ busCount: toCount(e.target.value) })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="capacitorBankCount">Number of Capacitor Banks</Label>
          <Input
            id="capacitorBankCount"
            type="number" inputMode="numeric" disabled={readOnly}
            value={counts.capacitorBankCount ?? ''}
            onChange={(e) => updateAssetCounts({ capacitorBankCount: toCount(e.target.value) })}
          />
        </div>
      </div>

      {/* ── Pre-Visit Checklist — unchanged ──────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-gray-900">Pre-Visit Checklist</h3>
        {PRE_VISIT_LABELS.map((item) => (
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
