import type { SecurityClassification } from '../../api/allocation'

/** The Security classifications card's three chips (2026-09-13 polish §13). */
export type ClassificationFilter = 'unclassified' | 'unreviewed' | 'all'

export const CLASSIFICATION_FILTERS: readonly { value: ClassificationFilter; label: string }[] = [
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'unreviewed', label: 'Not reviewed' },
  { value: 'all', label: 'All' },
]

/** No asset class yet — the gap the Allocation donut draws as "Unclassified". */
export const isUnclassified = (row: SecurityClassification): boolean => row.asset_class === null
/** Never confirmed by a person; imports and price refreshes leave reviewed_at empty. */
export const isUnreviewed = (row: SecurityClassification): boolean => row.reviewed_at === null

/** Which chip a fresh card opens on: the work when there is any, otherwise the whole list. */
export function defaultClassificationFilter(rows: SecurityClassification[]): ClassificationFilter {
  return rows.some(isUnclassified) ? 'unclassified' : 'all'
}

export function filterClassificationRows(
  rows: SecurityClassification[], filter: ClassificationFilter, search: string,
): SecurityClassification[] {
  const needle = search.trim().toLowerCase()
  return rows.filter((row) => {
    const onChip = filter === 'all' || (filter === 'unclassified' ? isUnclassified(row) : isUnreviewed(row))
    return onChip && (needle === '' || `${row.ticker} ${row.name}`.toLowerCase().includes(needle))
  })
}

/** "12 of 37 securities have no asset class · 37 not yet reviewed" — the card's one-line brief. */
export function coverageSentence(rows: SecurityClassification[]): string {
  const total = rows.length
  if (total === 0) return 'No securities yet — they appear here once transactions are recorded.'
  const unclassified = rows.filter(isUnclassified).length
  const unreviewed = rows.filter(isUnreviewed).length
  const head = unclassified === 0
    ? total === 1 ? 'The security has an asset class' : `All ${total} securities have an asset class`
    : `${unclassified} of ${total} ${total === 1 ? 'security' : 'securities'} ${unclassified === 1 ? 'has' : 'have'} no asset class`
  const tail = unreviewed === 0 ? 'all reviewed' : `${unreviewed} not yet reviewed`
  return `${head} · ${tail}`
}

/** What an empty filtered table says instead of a headerless grid. */
export function emptyFilterSentence(filter: ClassificationFilter, search: string): string {
  if (search.trim() !== '') return `No securities match “${search.trim()}”.`
  if (filter === 'unclassified') return 'All securities have an asset class.'
  if (filter === 'unreviewed') return 'Every security has been reviewed.'
  return 'No securities yet.'
}
