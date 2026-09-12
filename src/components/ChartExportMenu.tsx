import { useEffect, useId, useRef, useState } from 'react'
import { captionedPng, dataUrlToBlob } from '../charts/exportImage'
import { DARK, LIGHT } from '../theme/tokens'
import { downloadDataUrl, downloadText, toCsv } from '../utils/download'
import type { ExportTable } from '../utils/download'
import { formatDate } from '../utils/format'
import { todayIso } from '../utils/months'
import { useTheme } from './shell/ThemeProvider'
import { useToast } from './ToastProvider'
import './panels.css'
import './chartInteractions.css'

export interface ExportConfig {
  /** Download basename — the files land as {name}.png / {name}.csv. */
  name: string
  /** Rows supplied by the CALLER from data already in scope — never introspected from echarts
   *  options (2026-08-25 spec Decision log). Invoked lazily, on click. */
  csv?: () => ExportTable
  /** The card's title (chart spec §14) — the PNG carries a caption strip and Copy is
   *  offered. Required since every mount goes through ChartCard, whose own title is. */
  title: string
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
 * composites the caption strip. Copy writes a PNG ClipboardItem; where the
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
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  const finish = (action: () => void) => { action(); setOpen(false); triggerRef.current?.focus() }

  const snapshot = (): string | null => {
    const chart = getChart()
    return chart === null ? null : chart.getDataURL({ pixelRatio: 2, backgroundColor: tokens.surface })
  }
  const captioned = async (raw: string): Promise<string> =>
    captionedPng(raw, {
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
      {onToggleTable !== undefined && <button type="button" className="button" aria-pressed={tableShown === true} onClick={onToggleTable}>Table</button>}
      <div ref={menuRef} className="chart-export-menu" onKeyDown={(event) => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus() }
        if (!open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
        const index = items.findIndex((item) => item === document.activeElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[next]?.focus()
      }}>
        <button ref={triggerRef} type="button" className="button" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
          if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true) }
        }}>Export</button>
        {open && <div id={menuId} className="chart-export-popover" role="menu" aria-label={`Export ${config.title}`}>
          <button type="button" role="menuitem" autoFocus onClick={() => finish(png)}>PNG</button>
          <button type="button" role="menuitem" onClick={() => finish(() => { void copy() })}>Copy image</button>
          {csv && <button type="button" role="menuitem" onClick={() => finish(() => {
            const { headers, rows } = csv()
            downloadText(toCsv(headers, rows), `${config.name}.csv`, 'text/csv;charset=utf-8')
          })}>CSV</button>}
        </div>}
      </div>
    </div>
  )
}
