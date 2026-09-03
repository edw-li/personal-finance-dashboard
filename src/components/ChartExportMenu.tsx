import { captionedPng, dataUrlToBlob } from '../charts/exportImage'
import { DARK, LIGHT } from '../theme/tokens'
import { downloadDataUrl, downloadText, toCsv } from '../utils/download'
import type { ExportTable } from '../utils/download'
import { formatDate } from '../utils/format'
import { todayIso } from '../utils/months'
import { useTheme } from './shell/ThemeProvider'
import { useToast } from './ToastProvider'
import './panels.css'

export interface ExportConfig {
  /** Download basename — the files land as {name}.png / {name}.csv. */
  name: string
  /** Rows supplied by the CALLER from data already in scope — never introspected from echarts
   *  options (2026-08-25 spec Decision log). Invoked lazily, on click. */
  csv?: () => ExportTable
  /** The card's title (chart spec §14). Present → the PNG carries a caption strip and Copy is
   *  offered; absent → the legacy raw snapshot (EChart's own exportConfig, until every mount
   *  is on ChartCard). */
  title?: string
  /** "as of Aug 14, 2026" — the strip's second line. */
  caption?: string
}

/** The chart-handle subset the menu needs: EChart hands in the live instance, tests a
 * stub. Kept minimal so nothing here depends on echarts' own types. */
export interface ExportableChart {
  getDataURL: (opts: { pixelRatio: number; backgroundColor: string }) => string
}

/**
 * The house ⤓ menu: PNG · Copy · CSV · Table. PNG snapshots the live canvas at 2× on the
 * resolved card surface (the theme paints the canvas transparent, which would export black)
 * and, with a title, composites the caption strip. Copy writes a PNG ClipboardItem; where the
 * browser has none (Firefox by default) or refuses, the PNG downloads and a toast says so.
 * Table is the card's data-table toggle (ChartCard owns the state).
 */
export default function ChartExportMenu({
  config,
  getChart,
  tableShown,
  onToggleTable,
}: {
  config: ExportConfig
  getChart: () => ExportableChart | null
  tableShown?: boolean
  onToggleTable?: () => void
}) {
  const { resolved } = useTheme()
  const toast = useToast()
  const tokens = resolved === 'light' ? LIGHT : DARK

  const snapshot = (): string | null => {
    const chart = getChart()
    return chart === null ? null : chart.getDataURL({ pixelRatio: 2, backgroundColor: tokens.surface })
  }
  const captioned = async (raw: string): Promise<string> =>
    config.title === undefined
      ? raw
      : captionedPng(raw, {
          title: config.title,
          caption: config.caption,
          exportedOn: formatDate(todayIso()),
          surface: tokens.surface,
          ink: tokens.text,
          muted: tokens.muted,
        })

  const png = () => {
    const raw = snapshot()
    if (raw === null) return // disposed mid-click: nothing to snapshot
    // Legacy configs stay synchronous — the pre-grammar behaviour, byte for byte.
    if (config.title === undefined) {
      downloadDataUrl(raw, `${config.name}.png`)
      return
    }
    void captioned(raw)
      // Decoration must NEVER fail an export (exportImage.ts's own contract). It already
      // returns the raw URL where the canvas cannot draw, but the image DECODE rejects —
      // uncaught that would be an unhandled rejection AND a click that downloads nothing.
      .catch(() => raw)
      .then((url) => downloadDataUrl(url, `${config.name}.png`))
  }

  const copy = async () => {
    const raw = snapshot()
    if (raw === null) return
    // Same fallback as png(): an undecorated copy beats no copy at all.
    const url = await captioned(raw).catch(() => raw)
    const Item = (globalThis as { ClipboardItem?: new (items: Record<string, Blob>) => ClipboardItem }).ClipboardItem
    if (Item !== undefined && typeof navigator.clipboard?.write === 'function') {
      try {
        await navigator.clipboard.write([new Item({ 'image/png': dataUrlToBlob(url) })])
        toast.success('Chart copied')
        return
      } catch {
        // Permission denied or an unsupported type: fall through to the download.
      }
    }
    downloadDataUrl(url, `${config.name}.png`)
    toast.info('Clipboard unavailable — downloaded instead')
  }

  const csv = config.csv
  return (
    <div className="chart-export" role="group" aria-label={`Export ${config.name}`}>
      <span className="chart-export-glyph" aria-hidden="true">⤓</span>
      <div className="segmented">
        <button type="button" onClick={png}>PNG</button>
        {config.title !== undefined && (
          <button type="button" onClick={() => void copy()}>Copy</button>
        )}
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
        {onToggleTable !== undefined && (
          <button type="button" aria-pressed={tableShown === true} onClick={onToggleTable}>Table</button>
        )}
      </div>
    </div>
  )
}
