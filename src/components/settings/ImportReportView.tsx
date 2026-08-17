import type { ImportReport, ImportSheetReport } from '../../types/api'
import '../panels.css'
import './settings.css'

// Pure presentation: the card above owns the File, the two requests and every piece of
// state; this only draws the report it is handed (a dry run and an applied run differ by
// one sentence, because they are the same diff — one of them was written).

// Backend report.SHEET_KEYS order — keep in sync (all nine keys are always present).
const SHEET_ORDER = [
  'reference_data',
  'positions',
  'portfolio',
  'net_worth',
  'spending',
  'taxes',
  'espp',
  'paycheck',
  'focal_history',
] as const

const SHEET_LABELS: Record<string, string> = {
  reference_data: 'Reference data',
  positions: 'Positions',
  portfolio: 'Portfolio',
  net_worth: 'Net worth',
  spending: 'Spending',
  taxes: 'Taxes',
  espp: 'ESPP',
  paycheck: 'Paycheck',
  focal_history: 'Focal history',
}

// Every report carries all nine sheets; the clean ones are not news. Nine empty headings
// would bury the two that actually changed.
function sheetHasContent(s: ImportSheetReport): boolean {
  return (
    Object.keys(s.entities).length > 0 ||
    s.warnings.length > 0 ||
    s.errors.length > 0 ||
    s.samples.length > 0
  )
}

// One sheet's block. Extracted so the known-order sections and the unknown-key tail below
// are literally the same markup — two copies would let them drift.
function SheetSection({ label, sheet }: { label: string; sheet: ImportSheetReport }) {
  return (
    <section className="import-sheet">
      <h3 className="eyebrow">{label}</h3>
      {Object.keys(sheet.entities).length > 0 && (
        <table className="data-table">
          {/* Named columns, unlike the plan's headerless skeleton: every other .data-table
              in this app has a thead, and the glyphs alone (+ ~ = −) do not say which of
              the importer's four verbs a number belongs to. */}
          <thead>
            <tr>
              <th>Entity</th>
              <th className="num">Created</th>
              <th className="num">Updated</th>
              <th className="num">Unchanged</th>
              <th className="num">Deleted</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(sheet.entities).map(([entity, c]) => (
              <tr key={entity}>
                <td>{entity}</td>
                {/* created / updated / unchanged / deleted — the importer's four
                    verbs, in its own order. */}
                <td className="num">+{c.creates}</td>
                <td className="num">~{c.updates}</td>
                <td className="num">={c.skips}</td>
                <td className="num">−{c.deletes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sheet.errors.map((e, i) => (
        <p key={`e${i}`} className="import-error">
          ERROR: {e}
        </p>
      ))}
      {sheet.warnings.map((w, i) => (
        <p key={`w${i}`} className="settings-note">
          WARN: {w}
        </p>
      ))}
      {sheet.samples.length > 0 && (
        <details>
          <summary>
            {sheet.samples.length} sample changes
            {sheet.samples_truncated > 0 ? ` (+${sheet.samples_truncated} more)` : ''}
          </summary>
          <ul>
            {sheet.samples.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

export default function ImportReportView({ report }: { report: ImportReport }) {
  // A tenth backend sheet must not be able to fail INVISIBLY: the card's own
  // `reportHasErrors` scans every key of report.sheets, so a key this list has not caught
  // up with would disable Apply with nothing on screen to say why. Rendered after the
  // nine, in the server's own order, labelled by its raw key when SHEET_LABELS has none.
  const extraKeys = Object.keys(report.sheets).filter(
    (k) => !(SHEET_ORDER as readonly string[]).includes(k) && sheetHasContent(report.sheets[k]),
  )
  return (
    <div className="import-report">
      <p className="settings-note" role="status">
        {report.applied ? 'Applied.' : 'Dry run — nothing was written.'}
      </p>
      {SHEET_ORDER.filter((k) => report.sheets[k] && sheetHasContent(report.sheets[k])).map(
        (key) => (
          <SheetSection key={key} label={SHEET_LABELS[key] ?? key} sheet={report.sheets[key]} />
        ),
      )}
      {extraKeys.map((key) => (
        <SheetSection key={key} label={SHEET_LABELS[key] ?? key} sheet={report.sheets[key]} />
      ))}
    </div>
  )
}
