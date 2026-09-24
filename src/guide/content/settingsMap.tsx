import { Link } from 'react-router-dom'

// "Where to configure X" — the same table in the second Settings card and in Reference
// (2026-09-14 guide spec §5.1). One constant, two placements; every row links to a real
// Settings card anchor, and the cards that render it carry those links through the fences.
const ROWS: { task: string; to: string; place: string }[] = [
  { task: 'Add a person, rename one, set the marriage date', to: '/settings?section=household#household', place: 'Household → Household' },
  { task: 'Add, own, retire or delete a net-worth account; link a parent and its components; re-tag a portfolio account\u2019s owner', to: '/settings?section=household#accounts', place: 'Household → Accounts' },
  { task: 'Add a spending category; set Living, Tax or Transfer', to: '/settings?section=household#categories', place: 'Household → Spending categories' },
  { task: 'Enter or clone the year\u2019s contribution limits', to: '/settings?section=planning#limits', place: 'Planning → Contribution limits' },
  { task: 'Withdrawal rate, Plan until (year), ESPP ticker and discount', to: '/settings?section=planning#plan-assumptions', place: 'Planning → Plan assumptions' },
  { task: 'Theme, density, chart patterns, landing page', to: '/settings?section=account#appearance', place: 'Account → Appearance' },
  { task: 'Change the password (signs out other devices)', to: '/settings?section=account#password', place: 'Account → Password' },
  { task: 'The price refresh schedule, and refreshing now', to: '/settings?section=integrations#price-refresh', place: 'Integrations → Price refresh' },
  { task: 'The assistant\u2019s key, its default model, a key test', to: '/settings?section=integrations#assistant', place: 'Integrations → Assistant' },
  { task: 'Calendar subscription links and the monthly reminder day', to: '/settings?section=integrations#calendar', place: 'Integrations → Calendar feed' },
  { task: 'Import the workbook (dry run, then apply)', to: '/settings?section=data#import', place: 'Data → Import workbook' },
  { task: 'Write a snapshot now, download the ZIP, read the nightly ones', to: '/settings?section=data#backups', place: 'Data → Backups & snapshots' },
  { task: 'Restore a snapshot (dry run, type the date, restore)', to: '/settings?section=data#restore', place: 'Data → Restore' },
  { task: 'Data-health checks, each with its own fix', to: '/settings?section=data#health', place: 'Data → Data health' },
  { task: 'What each feed is entered through, the backup, the schema head', to: '/settings?section=data#system', place: 'Data → System' },
  { task: 'The change log, with Undo; import and restore reports', to: '/settings?section=data#activity', place: 'Data → Activity' },
]

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
        {ROWS.map((row) => (
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
