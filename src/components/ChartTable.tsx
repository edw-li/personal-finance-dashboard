import type { ExportTable } from '../utils/download'
import type { ChartSelection } from '../types/metrics'
import { ApplicationSourceLink } from './details/MetricInspector'
import './panels.css'

/** The accessibility twin (chart spec §14): the builder's own ExportTable as a real table
 *  under the chart, so no value is tooltip-only and a screen reader gets every figure. */
export default function ChartTable({ table, caption, rowSelection, onSelect, selectedId }: {
  table: ExportTable
  caption: string
  rowSelection?: (row: (string | number)[], index: number) => ChartSelection | null
  onSelect?: (selection: ChartSelection) => void
  selectedId?: string
}) {
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
              {rowSelection && onSelect && <th scope="col">Details</th>}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => {
              const selection = rowSelection?.(row, r)
              return <tr key={r} className={selection && selection.id === selectedId ? 'is-selected' : undefined}>
                {row.map((cell, c) => (
                  <td key={c} className={numeric(cell) ? 'num' : undefined}>
                    {cell === '' ? '—' : String(cell)}
                  </td>
                ))}
                {rowSelection && onSelect && <td>{selection && <div className="chart-row-actions">
                  <button type="button" className="button" aria-label={`Inspect ${selection.label}`} aria-pressed={selection.id === selectedId} onClick={() => onSelect(selection)}>Inspect</button>
                  {selection.source && <ApplicationSourceLink href={selection.source.href}>{selection.source.label}</ApplicationSourceLink>}
                </div>}</td>}
              </tr>
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}
