// Test-only reader of the grammar tooltip markup (charts/tooltip.ts). Builder tests assert
// the ROW CONTRACT — order, labels, values, kinds — not HTML bytes, so a markup tweak in
// tooltip.ts is one edit here rather than thirty pinned strings.
export interface TooltipRow {
  label: string
  value: string
  kind: 'row' | 'total' | 'ref'
}

export interface ParsedTooltip {
  head: string
  rows: TooltipRow[]
  notes: string[]
  foot: string[]
  /** itemTooltip's value-first layout. */
  lead?: string
  label?: string
  sub?: string
}

const ROW = /<div class="chart-tip-row( chart-tip-total| chart-tip-ref)?">.*?<span class="chart-tip-label">(.*?)<\/span><span class="chart-tip-value">(.*?)<\/span><\/div>/g
const block = (html: string, cls: string): string[] =>
  [...html.matchAll(new RegExp(`<div class="${cls}">(.*?)</div>`, 'g'))].map((m) => m[1])

export function tooltipRows(html: string): ParsedTooltip {
  const rows: TooltipRow[] = [...html.matchAll(ROW)].map((m) => ({
    kind: m[1] === ' chart-tip-total' ? 'total' : m[1] === ' chart-tip-ref' ? 'ref' : 'row',
    label: m[2],
    value: m[3],
  }))
  return {
    head: block(html, 'chart-tip-head')[0] ?? '',
    rows,
    notes: block(html, 'chart-tip-note'),
    foot: block(html, 'chart-tip-foot'),
    lead: block(html, 'chart-tip-lead')[0],
    label: rows.length === 0 ? block(html, 'chart-tip-label')[0] : undefined,
    sub: block(html, 'chart-tip-sub')[0],
  }
}
