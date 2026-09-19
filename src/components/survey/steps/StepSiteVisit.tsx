import { useEffect, useMemo, useState } from 'react';
import { Navigation } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { parseCoordinatesInput, isValidLatLng } from '@/lib/coordinates';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { TriStateToggle } from '@/components/survey/TriStateToggle';
import { LegacyVoltageValueNote } from '@/components/survey/LegacyVoltageNote';
import {
  VOLTAGE_LEVEL_LABELS, ASSET_COUNT_ROWS, ASSET_COUNT_ROW_LABELS,
} from '@/lib/surveyLabels';
import type { AssetCountRowKey } from '@/lib/surveyLabels';
import { SURVEY_VOLTAGE_LEVELS, LEGACY_COMBINED_VOLTAGE_LEVEL } from '@/types';
import type { SurveyStepProps } from './StepProps';
import type {
  SurveyContactDetails, SurveyControlRoom, SurveyAssetCounts, SurveyVoltageLevel,
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

/** Column template shared by the grid's heading row and its four data rows. */
const ASSET_GRID_COLS = 'grid grid-cols-[7.5rem_repeat(7,minmax(3.25rem,1fr))] items-center gap-1.5';

/**
 * Sum of the answered levels only — null until at least one is filled, so a
 * half-filled row never shows a misleadingly low total against the site master.
 */
function sumAnswered(record: Record<string, number | null>): number | null {
  const answered = Object.values(record).filter((n): n is number => n != null);
  return answered.length > 0 ? answered.reduce((sum, n) => sum + n, 0) : null;
}

/**
 * One superseded flat total, shown back for manual distribution.
 *
 * Renders nothing when the old field is empty — which is every survey except
 * any in-progress one that answered it before the grid existed.
 */
function LegacyTotalNote({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
      Previously recorded total for {label}: <strong>{value}</strong> — please distribute across
      the voltage levels above. This total is no longer used.
    </p>
  );
}

// ─── Step ─────────────────────────────────────────────────────────────────────

/**
 * Site & Visit — Step 1. Four groups, matching how the checklist itself groups
 * them: contact details, control room details and asset counts. The survey-date / GPS / surveyor-name
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
  const totalBaysAnswered = sumAnswered(survey.assetCounts.baysByVoltage);
  const totalTransformersAnswered = sumAnswered(survey.assetCounts.transformersByVoltage);

  /**
   * Writes one cell of the asset grid.
   *
   * The cast is needed because `row` indexes a union of two record types
   * (bays carries the extra legacy key) — the spread itself is exact, and the
   * level is always a current one, so nothing can write the legacy key here.
   */
  function updateCountCell(row: AssetCountRowKey, level: SurveyVoltageLevel, value: number | null) {
    updateAssetCounts({ [row]: { ...counts[row], [level]: value } } as Partial<SurveyAssetCounts>);
  }

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

      {/* ── Asset Counts — the document's own 4 x 7 table ───────────────── */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-gray-900">Asset Counts</h3>
        <p className="text-xs text-gray-400">
          Four asset kinds across all seven voltage levels, matching the table on the paper form.
          Leave a cell blank where the level does not apply — blank means &ldquo;not counted&rdquo;,
          not zero.
        </p>

        {/* Horizontally scrollable: eight columns cannot fit a phone, and
            shrinking the inputs to fit would make them unusable one-handed.
            Same container pattern as the ACDB/DCDB step's MCB tables. */}
        <div className="overflow-x-auto">
          <div className="min-w-[40rem] flex flex-col gap-1.5 rounded-lg border border-gray-100 p-2">
            {/* Column headings once — the level is stated per column, not per input. */}
            <div className={ASSET_GRID_COLS}>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Asset
              </span>
              {SURVEY_VOLTAGE_LEVELS.map((level) => (
                <span
                  key={level}
                  className="text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400"
                >
                  {VOLTAGE_LEVEL_LABELS[level]}
                </span>
              ))}
            </div>

            {ASSET_COUNT_ROWS.map((row) => (
              <div key={row} className={ASSET_GRID_COLS}>
                <span className="text-xs font-medium text-gray-600">
                  {ASSET_COUNT_ROW_LABELS[row]}
                </span>
                {SURVEY_VOLTAGE_LEVELS.map((level) => (
                  <Input
                    key={level}
                    className="h-9 text-center"
                    type="number"
                    inputMode="numeric"
                    disabled={readOnly}
                    aria-label={`${ASSET_COUNT_ROW_LABELS[row]} at ${VOLTAGE_LEVEL_LABELS[level]}`}
                    value={counts[row][level] ?? ''}
                    onChange={(e) => updateCountCell(row, level, toCount(e.target.value))}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* A pre-split bay count is still stored under the combined key and has
            no column of its own — surface it so it can be re-entered. */}
        <LegacyVoltageValueNote value={counts.baysByVoltage[LEGACY_COMBINED_VOLTAGE_LEVEL]} />

        {/* The three flat totals this grid replaces. Read-only, shown only when
            one actually holds an answer, and NEVER auto-distributed: a single
            total carries no information about which levels it belongs to. */}
        <LegacyTotalNote label="transformers" value={counts.transformerCount} />
        <LegacyTotalNote label="buses" value={counts.busCount} />
        <LegacyTotalNote label="capacitor banks" value={counts.capacitorBankCount} />

        {(siteMaster?.totalBays != null || siteMaster?.numPowerTransformers != null) && (
          <div className="flex flex-col gap-0.5">
            {siteMaster?.totalBays != null && (
              <p className="text-xs text-gray-400">
                Master total bays: {siteMaster.totalBays}
                {totalBaysAnswered != null && ` · counted so far: ${totalBaysAnswered}`}
              </p>
            )}
            {siteMaster?.numPowerTransformers != null && (
              <p className="text-xs text-gray-400">
                Master transformers: {siteMaster.numPowerTransformers}
                {totalTransformersAnswered != null && ` · counted so far: ${totalTransformersAnswered}`}
              </p>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
