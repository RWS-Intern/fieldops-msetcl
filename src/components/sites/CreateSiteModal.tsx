import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSiteActions }  from '@/hooks/useSiteActions';
import { useToast }        from '@/components/ui/toast';
import { useProjectStore } from '@/store/projectStore';
import { SITE_VOLTAGE_CLASSES } from '@/types';
import type { SiteVoltageClass } from '@/types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CreateSiteModalProps {
  open:    boolean;
  onClose: () => void;
  /** Pre-select a project when opened from inside ProjectDetailDrawer. */
  preselectedProjectId?: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(fields: {
  siteCode:     string;
  siteName:     string;
  city:         string;
  state:        string;
  projectId:    string;
  sapCode:      string;
  zone:         string;
  voltageClass: string;
}): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!fields.siteCode.trim())  errs['siteCode']  = 'Site code is required';
  if (!fields.siteName.trim())  errs['siteName']  = 'Site name is required';
  if (!fields.city.trim())      errs['city']       = 'City is required';
  if (!fields.state.trim())     errs['state']      = 'State is required';
  if (!fields.projectId)        errs['projectId']  = 'Project is required';
  // Required HERE but optional in the bulk CSV import — a deliberate
  // asymmetry, not an oversight. Someone creating one site by hand has the
  // substation master in front of them; a 250-row spreadsheet rejected whole
  // over one blank cell is a far worse failure.
  if (!fields.sapCode.trim())   errs['sapCode']      = 'SAP code is required';
  if (!fields.zone.trim())      errs['zone']         = 'Zone is required';
  if (!fields.voltageClass)     errs['voltageClass'] = 'Voltage class is required';
  return errs;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateSiteModal({
  open,
  onClose,
  preselectedProjectId,
}: CreateSiteModalProps) {
  const { createSite }    = useSiteActions();
  const { showToast }     = useToast();
  const { projects: all } = useProjectStore();

  // Derive the dropdown list from the already-live Zustand store.
  // useProjects() in Layout.tsx keeps this populated in real time.
  // active is already normalised to `!== false` by the store mapper, so
  // filtering `p.active !== false` catches both explicit-false and undefined.
  const projects = useMemo(
    () =>
      all
        .filter((p) => p.active !== false)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [all]
  );

  const [siteCode,   setSiteCode]   = useState('');
  const [siteName,   setSiteName]   = useState('');
  const [city,       setCity]       = useState('');
  const [state,      setState]      = useState('');
  const [sapCode,    setSapCode]    = useState('');
  const [zone,       setZone]       = useState('');
  const [voltageClass, setVoltageClass] = useState<SiteVoltageClass | ''>('');
  const [circle,     setCircle]     = useState('');
  const [division,   setDivision]   = useState('');
  const [address,    setAddress]    = useState('');
  const [lat,        setLat]        = useState('');
  const [lng,        setLng]        = useState('');
  const [projectId,  setProjectId]  = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors,     setErrors]     = useState<Record<string, string>>({});

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setSiteCode('');
    setSiteName('');
    setCity('');
    setState('');
    setSapCode('');
    setZone('');
    setVoltageClass('');
    setCircle('');
    setDivision('');
    setAddress('');
    setLat('');
    setLng('');
    setProjectId(preselectedProjectId ?? '');
    setErrors({});
  }, [open, preselectedProjectId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate({
      siteCode, siteName, city, state, projectId, sapCode, zone, voltageClass,
    });
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    // Build location — only if both lat and lng are valid finite numbers
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    const location =
      lat.trim() && lng.trim() && isFinite(parsedLat) && isFinite(parsedLng)
        ? { lat: parsedLat, lng: parsedLng }
        : null;

    setSubmitting(true);
    try {
      const proj = projects.find((p) => p.id === projectId);
      if (!proj) throw new Error('Project not found');

      await createSite({
        siteCode:    siteCode.trim(),
        siteName:    siteName.trim(),
        city:        city.trim(),
        state:       state.trim(),
        circle:      circle.trim(),
        division:    division.trim(),
        address:     address.trim(),
        projectId,
        projectName: proj.title,
        projectCode: proj.projectCode ?? '',
        location,
        // Written exactly as the bulk import writes them: trimmed, or null.
        sapCode:      sapCode.trim() || null,
        zone:         zone.trim()    || null,
        voltageClass: voltageClass   || null,
      });

      showToast('Site created successfully', 'success');
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create site';
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>New Site</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          {/* Project */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="site-project">Project *</Label>
            <Select
              value={projectId}
              onValueChange={(v) => {
                setProjectId(v);
                setErrors((prev) => ({ ...prev, projectId: '' }));
              }}
            >
              <SelectTrigger id="site-project" className={errors['projectId'] ? 'border-red-400' : ''}>
                <SelectValue placeholder="Select a project…" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}{p.projectCode ? ` (${p.projectCode})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors['projectId'] && (
              <p className="text-xs text-red-500">{errors['projectId']}</p>
            )}
          </div>

          {/* Site Code */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="site-code">Site Code *</Label>
            <Input
              id="site-code"
              value={siteCode}
              onChange={(e) => {
                setSiteCode(e.target.value.toUpperCase());
                setErrors((prev) => ({ ...prev, siteCode: '' }));
              }}
              placeholder="e.g. SUB-PUNE-047"
              className={errors['siteCode'] ? 'border-red-400' : ''}
            />
            {errors['siteCode'] && (
              <p className="text-xs text-red-500">{errors['siteCode']}</p>
            )}
          </div>

          {/* SAP Code — the MSETCL-side identifier, distinct from the Site
              Code above, which is this app's own. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="site-sap-code">SAP Code *</Label>
            <Input
              id="site-sap-code"
              value={sapCode}
              onChange={(e) => {
                setSapCode(e.target.value);
                setErrors((prev) => ({ ...prev, sapCode: '' }));
              }}
              placeholder="e.g. 10000123"
              className={errors['sapCode'] ? 'border-red-400' : ''}
            />
            {errors['sapCode'] && (
              <p className="text-xs text-red-500">{errors['sapCode']}</p>
            )}
          </div>

          {/* Site Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="site-name">Site Name *</Label>
            <Input
              id="site-name"
              value={siteName}
              onChange={(e) => {
                setSiteName(e.target.value);
                setErrors((prev) => ({ ...prev, siteName: '' }));
              }}
              placeholder="e.g. Pune Substation 47"
              className={errors['siteName'] ? 'border-red-400' : ''}
            />
            {errors['siteName'] && (
              <p className="text-xs text-red-500">{errors['siteName']}</p>
            )}
          </div>

          {/* City + State — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="site-city">City *</Label>
              <Input
                id="site-city"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setErrors((prev) => ({ ...prev, city: '' }));
                }}
                placeholder="e.g. Pune"
                className={errors['city'] ? 'border-red-400' : ''}
              />
              {errors['city'] && (
                <p className="text-xs text-red-500">{errors['city']}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="site-state">State *</Label>
              <Input
                id="site-state"
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  setErrors((prev) => ({ ...prev, state: '' }));
                }}
                placeholder="e.g. Maharashtra"
                className={errors['state'] ? 'border-red-400' : ''}
              />
              {errors['state'] && (
                <p className="text-xs text-red-500">{errors['state']}</p>
              )}
            </div>
          </div>

          {/* Circle + Division — optional, side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="site-circle">
                Circle <span className="text-gray-400 font-normal text-xs">(optional)</span>
              </Label>
              <Input
                id="site-circle"
                value={circle}
                onChange={(e) => setCircle(e.target.value)}
                placeholder="e.g. Pune Urban Circle"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="site-division">
                Division <span className="text-gray-400 font-normal text-xs">(optional)</span>
              </Label>
              <Input
                id="site-division"
                value={division}
                onChange={(e) => setDivision(e.target.value)}
                placeholder="e.g. Pune Division"
              />
            </div>
          </div>

          {/* Zone + Voltage Class — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="site-zone">Zone *</Label>
              {/* Free text, not a dropdown: MSETCL's zone allocation has not
                  been received, so there is no list to pick from — see the
                  note on Site.zone. */}
              <Input
                id="site-zone"
                value={zone}
                onChange={(e) => {
                  setZone(e.target.value);
                  setErrors((prev) => ({ ...prev, zone: '' }));
                }}
                placeholder="e.g. Mumbai Zone"
                className={errors['zone'] ? 'border-red-400' : ''}
              />
              {errors['zone'] && (
                <p className="text-xs text-red-500">{errors['zone']}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="site-voltage-class">Voltage Class *</Label>
              {/* A dropdown, because this one IS constrained — the same three
                  values the bulk import rejects anything else against. */}
              <Select
                value={voltageClass}
                onValueChange={(v) => {
                  setVoltageClass(v as SiteVoltageClass);
                  setErrors((prev) => ({ ...prev, voltageClass: '' }));
                }}
              >
                <SelectTrigger
                  id="site-voltage-class"
                  className={errors['voltageClass'] ? 'border-red-400' : ''}
                >
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {SITE_VOLTAGE_CLASSES.map((v) => (
                    <SelectItem key={v} value={v}>{v} kV</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors['voltageClass'] && (
                <p className="text-xs text-red-500">{errors['voltageClass']}</p>
              )}
            </div>
          </div>

          {/* Address (optional) */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="site-address">
              Address <span className="text-gray-400 font-normal text-xs">(optional)</span>
            </Label>
            <Input
              id="site-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street / area"
            />
          </div>

          {/* Latitude + Longitude — optional, side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="site-lat">
                Latitude <span className="text-gray-400 font-normal text-xs">(optional)</span>
              </Label>
              <Input
                id="site-lat"
                type="number"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="e.g. 18.5204"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="site-lng">
                Longitude <span className="text-gray-400 font-normal text-xs">(optional)</span>
              </Label>
              <Input
                id="site-lng"
                type="number"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="e.g. 73.8567"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-brand-blue hover:bg-brand-navy text-white"
            >
              {submitting ? 'Creating…' : 'Create Site'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
