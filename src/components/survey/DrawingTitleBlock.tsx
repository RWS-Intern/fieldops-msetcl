import { Input } from '@/components/ui/input';
import { DRAWING_TITLE_BLOCK_CONSTANTS } from '@/types';
import type { SurveyDrawingTitleBlock } from '@/types';

/**
 * Column template shared by the header and all three role rows. Same
 * overflow-x-auto + min-w container pattern as the ACDB/DCDB board tables and
 * the asset-count grid — seven columns of real inputs will not fit a phone,
 * and the row/column alignment IS the content here.
 *
 * THE TWO DATE COLUMNS ARE 9.5rem AND MUST NOT BE NARROWED. A native
 * `input[type="date"]` has an intrinsic minimum content width — the
 * dd/mm/yyyy segments plus the calendar picker indicator — of roughly 110px.
 * These tracks were 7rem (112px), which after the Input primitive's px-3
 * padding and borders left only 86px of content box. The browser does not
 * shrink the segments to fit: it clips, and the picker indicator (laid out
 * last, right-aligned) lands outside the visible box and stops being
 * clickable. The result reads as static "dd/mm/yyyy" text — an editable
 * input nobody can open. 9.5rem leaves ~126px, comfortably clear.
 */
const TITLE_BLOCK_COLS =
  'grid grid-cols-[6.5rem_9.5rem_minmax(9rem,1.4fr)_6rem_4rem_9.5rem_minmax(8rem,1fr)] items-center gap-1.5';

const HEADINGS = ['', 'Date', 'Name & Contact Details', 'Sign', 'REV', 'Date', 'Comment'];

/** yyyy-mm-dd for a date input, local-time — same helper shape as StepSiteVisit. */
function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fromDateInputValue(raw: string): Date | null {
  return raw ? new Date(`${raw}T00:00:00`) : null;
}

function displayDate(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Fallback for a draft that predates the title block entirely.
 *
 * Same reasoning as StepAcdcDetails' EMPTY_BOARD and StepInfrastructure's
 * EMPTY_AC_DC: a draft restored from IndexedDB is shallow-merged over the
 * mapped survey, so a sub-object added after that draft was saved arrives
 * genuinely absent. The restore path normalises now, but the component must
 * not depend on its caller having done so — this is a step a field expert
 * reaches mid-survey, and an undefined read here takes the whole wizard down.
 */
const EMPTY_TITLE_BLOCK: SurveyDrawingTitleBlock = {
  preparedByDate:        null,
  preparedByNameContact: null,
  preparedBySign:        null,
  preparedByRev:         null,
  preparedByRevDate:     null,
  preparedByComment:     null,
  documentNumber:        null,
};

function Cell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="min-h-[2.25rem] rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 flex items-center">
      {children}
    </div>
  );
}

/**
 * The drawing title block — the document-control header an engineering
 * drawing carries, rendered as the table it actually is rather than a stack of
 * labelled inputs.
 *
 * Three role rows, but only PREPARED BY is editable. Checked By and Approved
 * By render as empty bordered cells: the person filling this form cannot
 * meaningfully check and approve their own work, so those rows exist to be
 * completed on a printed or exported page. They are drawn, not disabled
 * inputs, because a disabled input invites "why can't I type here?" where an
 * empty ruled cell reads as "to be filled in later" — which is what it is.
 *
 * `readOnly` renders the Prepared By row as text too, which is what the
 * preview and any reviewer view get.
 */
export function DrawingTitleBlock({
  value: rawValue, onChange, readOnly,
}: {
  value:     SurveyDrawingTitleBlock | undefined;
  onChange?: (patch: Partial<SurveyDrawingTitleBlock>) => void;
  readOnly:  boolean;
}) {
  const value    = rawValue ?? EMPTY_TITLE_BLOCK;
  const editable = !readOnly && !!onChange;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        {/* Must stay >= the sum of the fixed tracks plus gaps (54.75rem), or
            the fr columns steal width back from the date tracks. */}
        <div className="min-w-[55rem] flex flex-col gap-1.5 rounded-lg border border-gray-200 p-2">

          {/* Column headings */}
          <div className={TITLE_BLOCK_COLS}>
            {HEADINGS.map((h, i) => (
              <span
                key={i}
                className="text-[10px] font-semibold uppercase tracking-wide text-gray-400"
              >
                {h}
              </span>
            ))}
          </div>

          {/* Prepared By — the only captured row */}
          <div className={TITLE_BLOCK_COLS}>
            <span className="text-xs font-medium text-gray-600">Prepared By</span>
            {editable ? (
              <>
                <Input
                  className="h-9" type="date" aria-label="Prepared by date"
                  value={value.preparedByDate ? toDateInputValue(value.preparedByDate) : ''}
                  onChange={(e) => onChange({ preparedByDate: fromDateInputValue(e.target.value) })}
                />
                <Input
                  className="h-9" aria-label="Prepared by name and contact details"
                  value={value.preparedByNameContact ?? ''}
                  onChange={(e) => onChange({ preparedByNameContact: e.target.value || null })}
                />
                <Input
                  className="h-9" aria-label="Prepared by sign"
                  value={value.preparedBySign ?? ''}
                  onChange={(e) => onChange({ preparedBySign: e.target.value || null })}
                />
                <Input
                  className="h-9" aria-label="Prepared by revision"
                  value={value.preparedByRev ?? ''}
                  onChange={(e) => onChange({ preparedByRev: e.target.value || null })}
                />
                <Input
                  className="h-9" type="date" aria-label="Prepared by revision date"
                  value={value.preparedByRevDate ? toDateInputValue(value.preparedByRevDate) : ''}
                  onChange={(e) => onChange({ preparedByRevDate: fromDateInputValue(e.target.value) })}
                />
                <Input
                  className="h-9" aria-label="Prepared by comment"
                  value={value.preparedByComment ?? ''}
                  onChange={(e) => onChange({ preparedByComment: e.target.value || null })}
                />
              </>
            ) : (
              <>
                <Cell>{displayDate(value.preparedByDate)}</Cell>
                <Cell>{value.preparedByNameContact ?? ''}</Cell>
                <Cell>{value.preparedBySign ?? ''}</Cell>
                <Cell>{value.preparedByRev ?? ''}</Cell>
                <Cell>{displayDate(value.preparedByRevDate)}</Cell>
                <Cell>{value.preparedByComment ?? ''}</Cell>
              </>
            )}
          </div>

          {/* Checked By / Approved By — ruled, empty, filled in off-app */}
          {(['Checked By', 'Approved By'] as const).map((role) => (
            <div key={role} className={TITLE_BLOCK_COLS}>
              <span className="text-xs font-medium text-gray-600">{role}</span>
              {[0, 1, 2, 3, 4, 5].map((i) => <Cell key={i} />)}
            </div>
          ))}

          {/* Summary row — both values fixed, shown so the printed page is
              complete rather than to be edited. */}
          <div className={TITLE_BLOCK_COLS}>
            <span className="text-xs font-medium text-gray-600">Rev.</span>
            <Cell>{DRAWING_TITLE_BLOCK_CONSTANTS.rev}</Cell>
            <span className="text-xs font-medium text-gray-600">Sheets</span>
            <Cell>{DRAWING_TITLE_BLOCK_CONSTANTS.sheets}</Cell>
            <span /><span /><span />
          </div>

          {/* LOA No. (fixed) left, Document Number (entered) right */}
          <div className="grid grid-cols-[6.5rem_minmax(16rem,2fr)_9rem_minmax(10rem,1fr)] items-center gap-1.5">
            <span className="text-xs font-medium text-gray-600">LOA No.</span>
            <Cell>{DRAWING_TITLE_BLOCK_CONSTANTS.loaNo}</Cell>
            <span className="text-xs font-medium text-gray-600">Document Number</span>
            {editable ? (
              <Input
                className="h-9" aria-label="Document number"
                value={value.documentNumber ?? ''}
                onChange={(e) => onChange({ documentNumber: e.target.value || null })}
              />
            ) : (
              <Cell>{value.documentNumber ?? ''}</Cell>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Checked By and Approved By are left blank deliberately — they are completed on the
        printed or exported page, not here. LOA No., Rev. and Sheets are fixed for this project.
      </p>
    </div>
  );
}
