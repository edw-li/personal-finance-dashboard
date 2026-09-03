import type { RestoreReport } from '../../types/api'
import { formatDate } from '../../utils/format'
import '../panels.css'
import './settings.css'

// Pure presentation (ImportReportView's posture): the Restore card and the Activity card's
// "View report" both hand a RestoreReport here and own every piece of state themselves.
// Differing tables first — those are the news; identical ones fold under one line, because
// a restore of last night's snapshot is 34 unchanged tables and two that moved.

function schemaLine(report: RestoreReport): string {
  const from =
    report.exported_at === null ? 'Snapshot' : `Snapshot from ${formatDate(report.exported_at)}`
  const head = (h: string | null) => h ?? 'none'
  return (
    `${from} · schema ${head(report.schema.snapshot_head)} · this server ` +
    `${head(report.schema.server_head)} · ${report.schema.compatible ? 'compatible' : 'incompatible'}`
  )
}

export default function RestoreReportView({ report }: { report: RestoreReport }) {
  const entries = Object.entries(report.tables)
  const changed = entries.filter(([, diff]) => !diff.identical)
  const unchanged = entries.filter(([, diff]) => diff.identical)
  return (
    <div className="import-report">
      <p className="settings-note" role="status">
        {report.applied ? 'Restored.' : 'Dry run — nothing was written.'}
      </p>
      <p className="settings-note">{schemaLine(report)}</p>
      {report.errors.map((e, i) => (
        <p key={`e${i}`} className="import-error">
          ERROR: {e}
        </p>
      ))}
      {report.warnings.map((w, i) => (
        <p key={`w${i}`} className="settings-note">
          WARN: {w}
        </p>
      ))}
      {changed.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Table</th>
              <th className="num">Current rows</th>
              <th className="num">Incoming rows</th>
            </tr>
          </thead>
          <tbody>
            {changed.map(([name, diff]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="num">{diff.current}</td>
                <td className="num">{diff.incoming}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unchanged.length > 0 && (
        <details>
          <summary>
            {unchanged.length} {unchanged.length === 1 ? 'table' : 'tables'} unchanged
          </summary>
          <ul>
            {unchanged.map(([name, diff]) => (
              <li key={name}>
                {name} ({diff.current})
              </li>
            ))}
          </ul>
        </details>
      )}
      {report.preserved_settings.length > 0 && (
        <p className="settings-note">
          Kept from this server: {report.preserved_settings.join(', ')}
        </p>
      )}
      {report.restore_point !== null && (
        <p className="settings-note">Restore point written: {report.restore_point}</p>
      )}
    </div>
  )
}
