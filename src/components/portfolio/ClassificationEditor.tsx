import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { KeyboardEvent, Ref } from 'react'
import { ASSET_CLASSES, GEOGRAPHIES, saveClassification, UNCLASSIFIED_LABEL } from '../../api/allocation'
import type { ClassificationInput, SecurityClassification } from '../../api/allocation'
import { errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import { formatDate } from '../../utils/format'
import Segmented from '../shell/Segmented'
import { useToast } from '../ToastProvider'
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
  // the tick IS that commit. DOM focus only; no state is written here (react-hooks v7).
  useEffect(() => {
    if (focusTick === 0) return
    rootRef.current
      ?.querySelector<HTMLSelectElement>('tbody select[data-field="asset_class"]')
      ?.focus({ preventScroll: true })
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
      : <div className="holdings-scroll"><table className="port-table classification-table">
          <thead><tr>
            <th scope="col">Security</th><th scope="col">Asset class</th><th scope="col">Geography</th>
            <th scope="col">Industry</th><th scope="col">Note</th><th scope="col">Source</th>
          </tr></thead>
          <tbody>{rows.map((row) => <ClassificationRow key={row.security_id} row={row} onChanged={onChanged} />)}</tbody>
        </table></div>}
  </section>
}

// One draft per row, reset only when THIS row's server values change (its own save landing, an
// undo) — an unrelated row's refetch never wipes what is being typed here.
const serverKey = (row: SecurityClassification) =>
  `${row.asset_class}|${row.geography}|${row.industry}|${row.note}|${row.reviewed_at}`
const draftOf = (row: SecurityClassification) => ({
  key: serverKey(row),
  asset_class: row.asset_class ?? '', geography: row.geography ?? '',
  industry: row.industry ?? '', note: row.note ?? '',
  // What this row has actually SENT for its typed fields. A blur right after an Enter-save must
  // not re-PATCH the same words: the server row still says the old value until the parent's
  // refetch lands, so "unchanged" is measured against the last request, not against the prop.
  sent: { industry: row.industry, note: row.note } as { industry: string | null; note: string | null },
})

// The selects are optimistic: the pick shows at once, the PATCH follows, a failure reverts it
// beside an inline alert. The typed fields save on blur or Enter when they differ from the
// server. Nothing is disabled while saving — disabling a focused control drops the caret, and
// the classify path is a keyboard walk down this table — the row is aria-busy instead and a
// second edit waits for the first to land.
function ClassificationRow({ row, onChanged }: { row: SecurityClassification; onChanged: () => void }) {
  const [draft, setDraft] = useState(() => draftOf(row))
  // Adjust-during-render (the codebase's prop→state idiom): a new server row for this security
  // replaces the draft before anything paints, and re-bases what counts as already sent.
  if (draft.key !== serverKey(row)) setDraft(draftOf(row))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  async function save(patch: Partial<ClassificationInput>) {
    setBusy(true)
    setError(null)
    // The body is the row as the USER sees it (draft + this change), so two quick edits to one
    // row cannot send the second PATCH with the first field's stale server value.
    const body: ClassificationInput = {
      asset_class: draft.asset_class || null, geography: draft.geography || null,
      industry: draft.industry.trim() || null, note: draft.note.trim() || null, ...patch,
    }
    try {
      const result = await saveClassification(row.security_id, body)
      setDraft((current) => ({ ...current, sent: { industry: body.industry, note: body.note } }))
      const id = result.headers.get('X-Change-Batch')
      toast.success(`${row.ticker} classification saved`, id ? { action: { label: 'Undo', onAction: () => {
        void undoBatch(id).then(onChanged).catch((err) => toast.error(errorDetail(err)))
      } } } : undefined)
      onChanged()
    } catch (err) {
      setError(errorDetail(err))
      setDraft(draftOf(row)) // the pick did not land — the select goes back to the truth
    } finally {
      setBusy(false)
    }
  }
  const pick = (field: 'asset_class' | 'geography', value: string) => {
    if (busy) return
    setDraft((current) => ({ ...current, [field]: value }))
    void save({ [field]: value || null })
  }
  const saveText = (field: 'industry' | 'note') => {
    if (busy) return
    const next = draft[field].trim() || null
    if (next !== draft.sent[field]) void save({ [field]: next })
  }
  const saveOnEnter = (field: 'industry' | 'note') => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); saveText(field) }
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
          onBlur={() => saveText('industry')} onKeyDown={saveOnEnter('industry')} />
      : <span className="sub">Fund holdings not loaded</span>}</td>
    <td><input className="field-input" aria-label={`${row.ticker} note`} value={draft.note} maxLength={500} placeholder="Add a note"
      onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
      onBlur={() => saveText('note')} onKeyDown={saveOnEnter('note')} /></td>
    {/* The raw server source rides the title; the cell says the one thing that matters (§14). */}
    <td className="classification-source" title={row.source}>
      {row.reviewed_at ? `Reviewed ${formatDate(row.reviewed_at)}` : 'Import · not reviewed'}
    </td>
  </tr>
}
