import type { ExportTable } from '../utils/download'
import './panels.css'

/** The accessibility twin (chart spec §14): the builder's own ExportTable as a real table
 *  under the chart, so no value is tooltip-only and a screen reader gets every figure. */
export default function ChartTable({ table, caption }: { table: ExportTable; caption: string }) {
  const numeric = (cell: string | number) => typeof cell === 'number' || /^-?\d/.test(String(cell))
  return (
    <details className="chart-table" open>
      <summary>Data table</summary>
      <div className="chart-table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {table.headers.map((header, i) => (
                <th key={i} scope="col">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className={numeric(cell) ? 'num' : undefined}>
                    {cell === '' ? '—' : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
