import type { EChartsOption } from './echarts'
import type { EChartEventParams } from '../components/EChart'
import type { ChartSelection, SelectionValue } from '../types/metrics'
import type { ExportTable } from '../utils/download'
import type { ZoomWindow } from './timeZoom'

type Datum = string | number | null | { name?: string; value?: unknown; children?: Datum[] } | unknown[]
type Series = { name?: string; type?: string; data?: Datum[]; links?: { source: string; target: string; value?: number }[] }
function list<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value] }
function scalar(datum: unknown): string | number | null {
  if (datum === null || datum === undefined) return null
  if (typeof datum === 'string' || typeof datum === 'number') return datum
  if (Array.isArray(datum)) return scalar(datum.at(-1))
  if (typeof datum === 'object' && 'value' in datum) return scalar(datum.value)
  return null
}
function named(data: Datum[], name: string): Datum | undefined {
  for (const datum of data) {
    if (!datum || typeof datum !== 'object' || Array.isArray(datum)) continue
    if (datum.name === name) return datum
    const child = named(datum.children ?? [], name)
    if (child !== undefined) return child
  }
  return undefined
}

/** Conservative adapter for old, read-only charts. It reads actual series records and
 * creates no source URL; domain pages supply adapters when identifiers have meaning. */
export function selectionFromOption(option: EChartsOption, event: EChartEventParams, chartId: string): ChartSelection | null {
  const series = list((option as { series?: Series | Series[] }).series)
  const selected = event.seriesIndex === undefined ? series.find((item) => item.name === event.seriesName) ?? series[0] : series[event.seriesIndex]
  const index = event.dataIndex
  if (!selected || index === undefined || index < 0) return null
  if (selected.type === 'sankey' && event.dataType === 'edge') {
    const link = selected.links?.[index]
    return link ? { kind: 'flow', id: `${chartId}:flow:${link.source}:${link.target}`, label: `${link.source} → ${link.target}`, sourceId: link.source, targetId: link.target, values: [{ label: 'Flow', value: link.value ?? null }] } : null
  }
  const raw = event.name ? named(selected.data ?? [], event.name) ?? selected.data?.[index] : selected.data?.[index]
  if (raw === undefined) return null
  const axes = list((option as { xAxis?: { type?: string; data?: unknown[] } | { type?: string; data?: unknown[] }[] }).xAxis)
  const axis = axes.find((candidate) => candidate.type === 'category' || candidate.data !== undefined)
  const axisDatum = axis?.data?.[index]
  const date = typeof axisDatum === 'string' ? axisDatum : undefined
  const label = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw.name : undefined) ?? date ?? event.name ?? `${selected.name ?? 'Point'} ${index + 1}`
  const values: SelectionValue[] = axis && ['line', 'bar', 'scatter', 'effectScatter'].includes(selected.type ?? '')
    ? series.filter((item) => ['line', 'bar'].includes(item.type ?? '') && item.data?.length === axis.data?.length)
      .map((item) => ({ label: item.name ?? 'Value', value: scalar(item.data?.[index]) }))
    : []
  if (values.length === 0) values.push({ label: selected.name ?? 'Value', value: scalar(raw) })
  if (values.every((value) => value.value === null)) return null
  return { kind: 'point', id: `${chartId}:${selected.name ?? ''}:${index}:${label}`, label, series: selected.name, index, date, values }
}

/** The exact export row is also a keyboard-accessible pinned readout. */
export function selectionFromRow(table: ExportTable, row: (string | number)[], index: number, chartId: string): ChartSelection {
  return { kind: 'point', id: `${chartId}:row:${index}`, label: String(row[0] ?? `Row ${index + 1}`), index, values: table.headers.map((label, column) => ({ label, value: row[column] === '' || row[column] === undefined ? null : row[column] })) }
}

export function initialZoomWindow(option: EChartsOption | null, explicit?: ZoomWindow): ZoomWindow | null {
  if (!option) return null
  if (explicit) return explicit
  const zoom = list((option as { dataZoom?: { startValue?: unknown; endValue?: unknown } | { startValue?: unknown; endValue?: unknown }[] }).dataZoom)[0]
  if (!zoom || typeof zoom.startValue !== 'number') return null
  const axes = list((option as { xAxis?: { data?: unknown[] } | { data?: unknown[] }[] }).xAxis)
  const end = typeof zoom.endValue === 'number' ? zoom.endValue : Math.max(0, (axes[0]?.data?.length ?? 1) - 1)
  return { startValue: zoom.startValue, endValue: end }
}

export function sameZoom(a: ZoomWindow | null, b: ZoomWindow | null): boolean {
  return a === b || (a !== null && b !== null && a.startValue === b.startValue && a.endValue === b.endValue)
}
