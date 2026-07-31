import { RepeatableGroup } from '@/components/survey/RepeatableGroup';
import { TriStateToggle } from '@/components/survey/TriStateToggle';
import { PhotoCapture } from '@/components/survey/PhotoCapture';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { SurveyStepProps } from './StepProps';
import type { SurveyDevice, DeviceType, DeviceProtocol } from '@/types';

const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  mfm:             'MFM',
  cmr:             'CMR',
  tpi:             'TPI',
  gps:             'GPS',
  numerical_relay: 'Numerical Relay',
  legacy_rtu:      'Legacy RTU',
};

const PROTOCOL_LABELS: Record<DeviceProtocol, string> = {
  modbus:    'Modbus',
  iec_61850: 'IEC 61850',
  iec_103:   'IEC 103',
  serial:    'Serial',
  none:      'None',
};

type Port = NonNullable<SurveyDevice['port']>;

const PORT_LABELS: Record<Port, string> = {
  rs485:    'RS485',
  rs232:    'RS232',
  ethernet: 'Ethernet',
  other:    'Other',
};

const PORT_UNSPECIFIED = 'unspecified';

function createDevice(): SurveyDevice {
  return {
    uid:        crypto.randomUUID(),
    deviceType: null,
    make:       null,
    model:      null,
    protocol:   null,
    port:       null,
    quantity:   null,
    reusable:   null,
    photos:     [],
    remarks:    null,
  };
}

function renderDeviceSummary(device: SurveyDevice, index: number) {
  const label = device.make?.trim() || `Device #${index + 1}`;
  const typeLabel = device.deviceType ? DEVICE_TYPE_LABELS[device.deviceType] : '—';
  const protocolLabel = device.protocol ? PROTOCOL_LABELS[device.protocol] : '—';
  const qtyLabel = device.quantity ?? '—';
  return (
    <>
      <span className="font-semibold text-gray-900">{typeLabel}</span>
      <span className="text-gray-400">
        {' '}· {label} · {protocolLabel} · qty {qtyLabel}
      </span>
    </>
  );
}

/** Existing devices — Section D, repeatable. */
export function StepDevices({ survey, onChange, readOnly, onReplacePhotoRef }: SurveyStepProps) {
  function renderDeviceForm(device: SurveyDevice, update: (patch: Partial<SurveyDevice>) => void) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Device Type</Label>
          <Select
            disabled={readOnly}
            value={device.deviceType ?? undefined}
            onValueChange={(v) => update({ deviceType: v as DeviceType })}
          >
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {(Object.keys(DEVICE_TYPE_LABELS) as DeviceType[]).map((t) => (
                <SelectItem key={t} value={t}>{DEVICE_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Make</Label>
            <Input
              disabled={readOnly}
              value={device.make ?? ''}
              onChange={(e) => update({ make: e.target.value || null })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Model</Label>
            <Input
              disabled={readOnly}
              value={device.model ?? ''}
              onChange={(e) => update({ model: e.target.value || null })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Protocol</Label>
            <Select
              disabled={readOnly}
              value={device.protocol ?? undefined}
              onValueChange={(v) => update({ protocol: v as DeviceProtocol })}
            >
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(PROTOCOL_LABELS) as DeviceProtocol[]).map((p) => (
                  <SelectItem key={p} value={p}>{PROTOCOL_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Port</Label>
            <Select
              disabled={readOnly}
              value={device.port ?? PORT_UNSPECIFIED}
              onValueChange={(v) => update({ port: v === PORT_UNSPECIFIED ? null : (v as Port) })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={PORT_UNSPECIFIED}>Not specified</SelectItem>
                {(Object.keys(PORT_LABELS) as Port[]).map((p) => (
                  <SelectItem key={p} value={p}>{PORT_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Quantity</Label>
          <Input
            type="number" inputMode="numeric" disabled={readOnly}
            value={device.quantity ?? ''}
            onChange={(e) => update({ quantity: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) })}
          />
        </div>

        <TriStateToggle
          label="Reusable / suitable for integration?"
          value={device.reusable}
          onChange={(v) => update({ reusable: v })}
          readOnly={readOnly}
        />

        <PhotoCapture
          photos={device.photos}
          onChange={(photos) => update({ photos })}
          onReplacePhotoRef={onReplacePhotoRef}
          workOrderId={survey.workOrderId}
          siteCode={survey.siteCode}
          readOnly={readOnly}
          label="Photo"
        />

        <div className="flex flex-col gap-1.5">
          <Label>Remarks</Label>
          <Textarea
            disabled={readOnly}
            value={device.remarks ?? ''}
            onChange={(e) => update({ remarks: e.target.value || null })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-gray-900">Existing Devices</h3>

      <RepeatableGroup<SurveyDevice>
        entries={survey.devices}
        onChange={(devices) => onChange({ devices })}
        createEntry={createDevice}
        renderSummary={renderDeviceSummary}
        renderForm={renderDeviceForm}
        readOnly={readOnly}
        addLabel="Add Device"
        emptyText="No existing devices found yet."
        entryNoun="device"
      />
    </div>
  );
}
