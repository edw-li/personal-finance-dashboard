import { DARK, LIGHT } from '../theme/tokens'
import { downloadDataUrl, downloadText, toCsv } from '../utils/download'
import type { ExportTable } from '../utils/download'
import { useTheme } from './shell/ThemeProvider'
import './panels.css'

export interface ExportConfig {
  /** Download basename — the files land as {name}.png / {name}.csv. */
  name: string
  /** Rows supplied by the CALLER from data already in scope — never introspected from
   * echarts options (2026-08-25 spec Decision log). Invoked lazily, on click. */
  csv?: () => ExportTable
}

/** The chart-handle subset the menu needs: EChart hands in the live instance, tests a
 * stub. Kept minimal so nothing here depends on echarts' own types. */
export interface ExportableChart {
  getDataURL: (opts: { pixelRatio: number; backgroundColor: string }) => string
}

/**
 * The house ⤓ export menu (2026-08-25 spec §2a): RangeChips' segmented button grammar,
 * deliberately NOT echarts' toolbox (Decision log). PNG snapshots the live canvas at 2×
 * on the card surface — the theme paints the canvas transparent, which would export
 * black — and CSV serializes the caller's own table through utils/download's toCsv.
 * The surface comes from the RESOLVED theme (2026-09-03 shell spec §11): a hard-coded dark
 * card color would matte a light-theme chart onto near-black and lose every axis label.
 */
export default function ChartExportMenu({
  config,
  getChart,
}: {
  config: ExportConfig
  getChart: () => ExportableChart | null
}) {
  const { resolved } = useTheme()
  const png = () => {
    const chart = getChart()
    if (chart === null) return // disposed mid-click: nothing to snapshot
    const surface = resolved === 'light' ? LIGHT.surface : DARK.surface
    downloadDataUrl(
      chart.getDataURL({ pixelRatio: 2, backgroundColor: surface }),
      `${config.name}.png`,
    )
  }
  const csv = config.csv
  return (
    <div className="chart-export" role="group" aria-label={`Export ${config.name}`}>
      <span className="chart-export-glyph" aria-hidden="true">
        ⤓
      </span>
      <div className="segmented">
        <button type="button" onClick={png}>
          PNG
        </button>
        {csv && (
          <button
            type="button"
            onClick={() => {
              const { headers, rows } = csv()
              downloadText(toCsv(headers, rows), `${config.name}.csv`, 'text/csv;charset=utf-8')
            }}
          >
            CSV
          </button>
        )}
      </div>
    </div>
  )
}
