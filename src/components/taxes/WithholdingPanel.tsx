import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchWithholding } from '../../api/taxes'
import InfoHint from '../InfoHint'
import StatTile from '../StatTile'
import type { WithholdingOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import type { Tone } from '../../utils/tone'
// This component's own sheet, like its siblings: the app-wide vocabulary
// (.card/.eyebrow/.kpi-row/.error-banner/.empty-note/.drill-hint) is panels.css, which the
// PAGE imports — and StatTile brings it along regardless.
import './taxes.css'

/**
 * "Will I owe?" — the year's liability against an estimate of what will actually be withheld:
 * salary checks at the paycheck profile's all-in withholding %, plus this year's RSU vests at
 * the supplemental rates and their marginal FICA.
 *
 * The CURRENT year only. The endpoint answers 422 for any other year (a settled year may well
 * be stored and summarizable, and this card still cannot be drawn for it), so the page gates
 * the mount on the same rule rather than spending a request on the refusal.
 *
 * Own feed, own failure surface (SummaryPanel's posture). Nothing here is stored and nothing
 * is re-derived: every figure is the server's, and the one piece of client arithmetic is the
 * display-only sign/abs on `balance_projected` that picks the balance tile's words, colour and
 * glyph (utils/format.ts's Number() rule).
 */
export default function WithholdingPanel({ year }: { year: number }) {
  // null = the feed has not answered yet (never a zeroed payload — "not loaded" and "nothing
  // withheld" say very different things under this heading).
  const [withholding, setWithholding] = useState<WithholdingOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  // An OBJECT, not a counter: Retry re-asserts the SAME year, and only a fresh identity
  // re-runs the effect below (HoldingDetailPanel's `span`, TaxesPage's `selection`).
  const [reload, setReload] = useState({})
  // Two loads in flight — a year change over an open request — must land in order: only the
  // newest may write the card or complain about it.
  const seqRef = useRef(0)

  // Promise callbacks only: no setState in the effect's synchronous body (react-hooks 7). The
  // mount fetch is covered by the initial busy value; Retry flips it itself.
  useEffect(() => {
    const seq = ++seqRef.current
    fetchWithholding(year)
      .then((data) => {
        if (seq !== seqRef.current) return
        setWithholding(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        // The previous payload is KEPT (CompPage's schedule banner): a reload that failed did
        // not make the figures on screen untrue, only older — and the banner below says so
        // whenever there is something behind it. A FIRST-load failure has nothing to be stale,
        // so it gets the bare sentence.
        setError(err instanceof ApiError ? err.message : 'Failed to load the withholding estimate')
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }, [year, reload])

  const retry = () => {
    setBusy(true)
    setError(null)
    setReload({})
  }

  // The ONE piece of client math on this card, and display-only: the SIGN of the server's own
  // balance picks the words, the colour and the glyph, and the figure beside them is that same
  // server string formatted — never a number this file computed (global rule 9).
  const balance = withholding === null ? 0 : Number(withholding.balance_projected)
  // Owing is the BAD direction, so the tone is the inverse of the number's sign — and the
  // glyph follows the NUMBER (a balance that grew points up however unwelcome it is), which is
  // exactly the case StatTile's explicit `direction` exists for.
  const balanceTone: Tone = balance > 0 ? 'negative' : balance < 0 ? 'positive' : 'neutral'
  const balanceDirection = balance > 0 ? 'up' : balance < 0 ? 'down' : undefined
  const balanceWords =
    balance > 0 ? 'to pay at filing' : balance < 0 ? 'refund expected' : 'dead even'

  return (
    <section className="card withholding-panel">
      <h2 className="eyebrow">
        Will I owe? — {year}
        <InfoHint text="Estimated all-in withholding — salary checks plus RSU vests — against the tax engine&apos;s liability for this year. An estimate, not advice." />
      </h2>
      {error !== null && (
        <div className="error-banner" role="alert">
          {/* The stale cue only when there IS something stale (CompPage's rule). */}
          {withholding === null ? error : `${error} — may be showing earlier figures.`}{' '}
          <button
            type="button"
            className="button"
            // Named, because the PAGE has a Retry of its own (the year-list banner) and two
            // buttons called "Retry" are two doors a screen reader cannot tell apart.
            aria-label="Retry loading the withholding estimate"
            onClick={retry}
          >
            Retry
          </button>
        </div>
      )}
      {withholding === null ? (
        // A first load that FAILED leaves the banner above as the whole card: "Loading…"
        // under an error would read as a request that is still coming.
        error === null && <p className="empty-note">Loading…</p>
      ) : (
        // Dimmed while a reload is in flight over figures that are still on screen — the same
        // treatment the page gives its own panels.
        <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
          <div className="kpi-row">
            <StatTile
              label="Projected tax"
              value={formatCurrency(withholding.liability_total)}
              hint="The tax engine&apos;s total on this year&apos;s stored inputs — keep them current as the year moves."
            />
            <StatTile
              label="Projected withholding"
              value={formatCurrency(withholding.total.projected)}
              delta={`${formatCurrency(withholding.total.ytd)} so far`}
              // A level with its own progress under it, not a movement: no glyph, no colour.
              tone="neutral"
              hint="Salary checks at your all-in withholding % plus RSU vests at 22% federal + 10.23% CA plus their FICA."
            />
            <StatTile
              label="Projected balance"
              value={formatCurrency(Math.abs(balance))}
              delta={balanceWords}
              tone={balanceTone}
              direction={balanceDirection}
              hint="Liability minus projected withholding — positive means withholding falls short."
            />
          </div>

          <p className="drill-hint">
            {`${formatCurrency(withholding.total.ytd)} withheld so far · ${
              withholding.checks_elapsed
            } of ${withholding.checks_total} checks · vest income so far ${formatCurrency(
              withholding.vest.income_ytd,
            )}`}
          </p>

          {/* Nothing at all when the server sent none: a missing prior year is the normal
              first-year case and arrives with no warning of its own, so there is no absence
              here to explain. (A prior year that exists but computes to zero DOES warn, and
              that sentence lands with the rest of them below.) */}
          {withholding.safe_harbor !== null && (
            <p className="hint">
              {`Safe harbor (approx.): 110% of ${withholding.safe_harbor.prior_year}'s total tax is ${formatCurrency(
                withholding.safe_harbor.threshold,
              )} — ${
                withholding.safe_harbor.met
                  ? 'covered by projected withholding'
                  : 'NOT covered by projected withholding'
              }`}
              <InfoHint text="Real safe harbor is per-jurisdiction; this compares all-in totals — approximate by construction." />
            </p>
          )}

          {/* The two halves of the app that both know about vest income have to agree: this
              card counts the vests, while the engine's total above it knows only what the
              inputs form BELOW was told — which is where the reader has to go to fix it. */}
          {Number(withholding.vest.income_projected) > 0 && (
            <p className="hint">
              {`This year's vests imply ≈${formatCurrency(
                withholding.vest.income_projected,
              )} of W-2 income at vest prices — make sure your W-2 inputs below include it.`}
            </p>
          )}

          {/* What the estimate ASSUMED, in the order it bites: the check grid, the FICA
              stacking, and the quote the future half rides — the balance above moves with the
              stock, which is the one thing a reader would otherwise not guess. "Tends to err
              toward owing more" rather than a flat promise: the stacking leans that way, but
              additional-Medicare convexity can run the other, and an even grid is
              direction-neutral. */}
          <p className="drill-hint">
            Checks are estimated on an even calendar grid, and vest FICA stacks on top of salary
            rather than by date — an approximation that tends to err toward owing more. Future
            vests are valued at the latest quote. Supplemental rates: 22% federal + 10.23% CA.
          </p>

          {/* Advisory, never an error banner: the estimate CAME BACK — these are the honest
              asterisks on what it was computed from (an unpriced vest, a profile that could not
              be used, a missing quote), and each one names a piece that was left out. */}
          {withholding.warnings.map((warning) => (
            // Text-as-key: a fixed list of distinct sentences rendered straight from the
            // payload (VestingSchedulePanel's).
            <p className="hint" key={warning}>
              {warning}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
