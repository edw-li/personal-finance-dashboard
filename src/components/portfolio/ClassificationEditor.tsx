import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import { ASSET_CLASSES, GEOGRAPHIES, saveClassification, UNCLASSIFIED_LABEL } from '../../api/allocation'
import type { ClassificationInput, SecurityClassification } from '../../api/allocation'
import { errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import { formatDate } from '../../utils/format'
import Segmented from '../shell/Segmented'
import { useToast } from '../ToastProvider'
import TableScroll from '../TableScroll'
import {
  CLASSIFICATION_FILTERS, coverageSentence, defaultClassificationFilter, emptyFilterSentence,
  filterClassificationRows, isUnclassified, isUnreviewed,
} from './classificationRows'
import type { ClassificationFilter } from './classificationRows'
import './portfolio.css'
import './allocation.css'

/** What the Allocation card's "Classify these N holdings" action drives (2026-09-13 polish §13). */
export interface ClassificationEditorHandle {
  /** Scroll the card in, pin the Unclassified chip and put the caret on the first row's
   *  asset-class select. */
  focusUnclassified: () => void
}

/** The card's DOM id — the classify action's scroll target and an anchor deep links can use. */
export const CLASSIFICATION_CARD_ID = 'security-classifications'

// The Security classifications card (2026-09-13 polish §13; replaces the closed
// details.allocation-classifications accordion — A2/D6/W9). Always visible and opening on the
// work: a coverage sentence, filter chips + search on one row, a compact table whose selects
// PATCH on change through the same saveClassification + Undo toast the old Review form used.
export default function ClassificationEditor({ classifications, onChanged, ref }: {
  classifications: SecurityClassification[]
  onChanged: () => void
  /** React 19 ref-as-prop: AllocationPanel holds it to drive focusUnclassified(). */
  ref?: Ref<ClassificationEditorHandle>
}) {
  // null = "not chosen yet". The rows land AFTER the first render, so the default chip is derived
  // from them on every render rather than frozen by a useState initializer; a chip click or the
  // classify action pins an explicit choice.
  const [chosen, setChosen] = useState<ClassificationFilter | null>(null)
  const filter = chosen ?? defaultClassificationFilter(classifications)
  const [search, setSearch] = useState('')
  const [focusTick, setFocusTick] = useState(0)
  const rootRef = useRef<HTMLElement>(null)
  useImperativeHandle(ref, () => ({
    focusUnclassified() {
      setChosen('unclassified')
      setSearch('')
      // Optional call: jsdom has no scrollIntoView (HoldingDetailPanel's idiom). The card's
      // scroll-margin-top (allocation.css) keeps its top clear of the sticky tab strip.
      rootRef.current?.scrollIntoView?.({ block: 'start' })
      setFocusTick((tick) => tick + 1)
    },
  }), [])
  // The focus has to wait for the commit that renders the Unclassified rows — an effect keyed on
  // the tick IS that commit. DOM focus and a scroll only; no state is written here (react-hooks v7).
  // The filtered list's first row is the capped box's first row (2026-09-24 table-scroll spec §3.5):
  // a box the reader had scrolled down would hold it out of view, and preventScroll moves neither
  // the box nor the page — so the box goes back to its top first.
  useEffect(() => {
    if (focusTick === 0) return
    const root = rootRef.current
    const box = root?.querySelector<HTMLElement>('.table-scroll')
    if (box) box.scrollTop = 0
    root?.querySelector<HTMLSelectElement>('tbody select[data-field="asset_class"]')?.focus({ preventScroll: true })
  }, [focusTick])
  const rows = filterClassificationRows(classifications, filter, search)
  const counts: Record<ClassificationFilter, number> = {
    unclassified: classifications.filter(isUnclassified).length,
    unreviewed: classifications.filter(isUnreviewed).length,
    all: classifications.length,
  }
  const showAll = () => { setChosen('all'); setSearch('') }
  return <section ref={rootRef} id={CLASSIFICATION_CARD_ID} className="card allocation-classifications" aria-label="Security classifications">
    <h2 className="eyebrow">Security classifications</h2>
    <p className="allocation-coverage-sentence">{coverageSentence(classifications)}</p>
    <p className="hint">Classifications apply to the security across all owners and survive price refreshes and imports. Fund industry stays unknown until constituent data is available.</p>
    <div className="classification-toolbar">
      <Segmented variant="chips" size="sm" ariaLabel="Classification filter"
        options={CLASSIFICATION_FILTERS.map((option) => ({ ...option, badge: counts[option.value] }))}
        value={filter} onChange={setChosen} />
      <input className="field-input classification-search" type="search" aria-label="Find a security" placeholder="Find a security"
        value={search} onChange={(event) => setSearch(event.target.value)} />
    </div>
    {rows.length === 0
      ? <p className="empty-note">
          {emptyFilterSentence(filter, search)}
          {(filter !== 'all' || search.trim() !== '') && <>{' '}<button type="button" className="button" onClick={showAll}>Show all securities</button></>}
        </p>
      : <TableScroll className="holdings-scroll" label="Security classifications table"><table className="port-table classification-table">
          <thead><tr>
            <th scope="col">Security</th><th scope="col">Asset class</th><th scope="col">Geography</th>
            <th scope="col">Industry</th><th scope="col">Note</th><th scope="col">Source</th>
          </tr></thead>
          <tbody>{rows.map((row) => <ClassificationRow key={row.security_id} row={row} onChanged={onChanged} />)}</tbody>
        </table></TableScroll>}
  </section>
}

// One draft per row. The four editable fields as the user sees them (empty string, never null,
// so a draft value and its baseline compare directly) plus `sent`: the values this row last
// transmitted. `sent` is what "unchanged" is measured against — the server row still says the old
// thing until the parent's refetch lands, so comparing against the prop would re-PATCH the same
// words on the next blur.
const FIELD_NAMES = ['asset_class', 'geography', 'industry', 'note'] as const
type FieldName = (typeof FIELD_NAMES)[number]
type Fields = Record<FieldName, string>
interface Draft extends Fields { key: string; sent: Fields }

const serverKey = (row: SecurityClassification) =>
  `${row.asset_class}|${row.geography}|${row.industry}|${row.note}|${row.reviewed_at}`
const fieldsOf = (row: SecurityClassification): Fields => ({
  asset_class: row.asset_class ?? '', geography: row.geography ?? '',
  industry: row.industry ?? '', note: row.note ?? '',
})
const draftOf = (row: SecurityClassification): Draft => {
  const fields = fieldsOf(row)
  return { key: serverKey(row), ...fields, sent: fields }
}
/** A new server row for this security, folded in FIELD BY FIELD (P2 review round 2): a field the
 *  user has not touched since its last send takes the server's word, and a half-typed note is
 *  left alone. Wiping the whole draft lost text to an unrelated row's refetch. */
function rebased(current: Draft, row: SecurityClassification): Draft {
  const server = fieldsOf(row)
  const next: Draft = { ...current, key: serverKey(row), sent: { ...current.sent } }
  for (const field of FIELD_NAMES) {
    if (current[field] === current.sent[field]) {
      next[field] = server[field]
      next.sent[field] = server[field]
    }
  }
  return next
}
const bodyOf = (fields: Fields): ClassificationInput => ({
  asset_class: fields.asset_class || null, geography: fields.geography || null,
  industry: fields.industry.trim() || null, note: fields.note.trim() || null,
})

// The selects are optimistic: the pick shows at once, the PATCH follows, a failure reverts just
// that field beside an inline alert. The typed fields save on blur or Enter when they differ from
// what was last sent. Nothing is disabled while saving — disabling a focused control drops the
// caret, and the classify path is a keyboard walk down this table. The row is aria-busy instead,
// and a second edit inside one round-trip is QUEUED behind the first rather than dropped, so the
// PATCHes land in the order the user made them.
function ClassificationRow({ row, onChanged }: { row: SecurityClassification; onChanged: () => void }) {
  const [draft, setDraft] = useState(() => draftOf(row))
  // Adjust-during-render (the codebase's prop→state idiom): the fold happens before anything paints.
  if (draft.key !== serverKey(row)) setDraft((current) => rebased(current, row))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  // The serial tail of this row's saves. Read and written in event handlers only — never during
  // render — so the react-hooks refs rule holds.
  const queue = useRef<Promise<void>>(Promise.resolve())
  async function save(fields: Fields) {
    setBusy(true)
    setError(null)
    // The body is the row as the USER saw it when they acted, so a queued second edit carries the
    // first one's value rather than the server's stale one.
    const body = bodyOf(fields)
    try {
      const result = await saveClassification(row.security_id, body)
      setDraft((current) => ({ ...current, sent: { ...fields } }))
      const id = result.headers.get('X-Change-Batch')
      toast.success(`${row.ticker} classification saved`, id ? { action: { label: 'Undo', onAction: () => {
        void undoBatch(id).then(onChanged).catch((err) => toast.error(errorDetail(err)))
      } } } : undefined)
      onChanged()
    } catch (err) {
      setError(errorDetail(err))
      // Only the fields this request carried go back to the truth — a later queued edit to another
      // field is still on its way and must not be reverted with them.
      setDraft((current) => {
        const server = fieldsOf(row)
        const reverted: Draft = { ...current, sent: { ...current.sent } }
        for (const field of FIELD_NAMES) {
          if (fields[field] !== current.sent[field]) { reverted[field] = server[field]; reverted.sent[field] = server[field] }
        }
        return reverted
      })
    } finally {
      setBusy(false)
    }
  }
  /** Apply the edit optimistically and queue its PATCH behind whatever is already in flight. */
  const enqueue = (next: Fields) => {
    setDraft((current) => ({ ...current, ...next }))
    queue.current = queue.current.then(() => save(next))
  }
  const pick = (field: 'asset_class' | 'geography', value: string) => {
    enqueue({ asset_class: draft.asset_class, geography: draft.geography, industry: draft.industry, note: draft.note, [field]: value })
  }
  const saveText = (field: 'industry' | 'note') => {
    const next = draft[field].trim()
    if (next === draft.sent[field]) return
    enqueue({ asset_class: draft.asset_class, geography: draft.geography, industry: draft.industry, note: draft.note, [field]: next })
  }
  return <tr className={isUnclassified(row) ? 'allocation-unknown' : undefined} aria-busy={busy || undefined}>
    <th scope="row">
      <span className="ticker">{row.ticker}</span>
      <span className="sub" title={row.name}>{row.name}</span>
      {error && <span role="alert" className="classification-row-error">{error}</span>}
    </th>
    <td><select className="field-input" data-field="asset_class" aria-label={`${row.ticker} asset class`} value={draft.asset_class}
      onChange={(event) => pick('asset_class', event.target.value)}>
      <option value="">{UNCLASSIFIED_LABEL}</option>
      {Object.entries(ASSET_CLASSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></td>
    <td><select className="field-input" data-field="geography" aria-label={`${row.ticker} geography`} value={draft.geography}
      onChange={(event) => pick('geography', event.target.value)}>
      <option value="">Not set</option>
      {Object.entries(GEOGRAPHIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></td>
    <td>{row.industry_available
      ? <input className="field-input" aria-label={`${row.ticker} industry`} value={draft.industry} maxLength={80} placeholder="Industry"
          onChange={(event) => setDraft((current) => ({ ...current, industry: event.target.value }))}
          onBlur={() => saveText('industry')}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveText('industry') } }} />
      : <span className="sub">Fund holdings not loaded</span>}</td>
    <td><input className="field-input" aria-label={`${row.ticker} note`} value={draft.note} maxLength={500} placeholder="Add a note"
      onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
      onBlur={() => saveText('note')}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveText('note') } }} /></td>
    {/* The raw server source rides the title; the cell says the one thing that matters (§14). */}
    <td className="classification-source" title={row.source}>
      {row.reviewed_at ? `Reviewed ${formatDate(row.reviewed_at)}` : 'Import · not reviewed'}
    </td>
  </tr>
}
