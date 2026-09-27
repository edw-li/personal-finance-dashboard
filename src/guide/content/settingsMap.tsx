import { Link } from 'react-router-dom'
import { SETTINGS_MAP_ROWS } from './settingsMapRows'

/** The map, rendered twice: `page-settings-data`'s body and the Reference chapter's
 *  `ref-settings-map`. Rows are the jobs a reader arrives with, not the card order. */
export function SettingsMapTable() {
  return (
    <table className="data-table guide-map">
      <thead>
        <tr>
          <th>To…</th>
          <th>Go to</th>
        </tr>
      </thead>
      <tbody>
        {SETTINGS_MAP_ROWS.map((row) => (
          <tr key={row.to}>
            <td>{row.task}</td>
            <td>
              <Link to={row.to}>{row.place}</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
