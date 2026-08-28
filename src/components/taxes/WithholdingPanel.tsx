import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchWithholding } from '../../api/taxes'
import InfoHint from '../InfoHint'
import StatTile from '../StatTile'
import type { WithholdingOut } from '../../types/api'
import { formatCurrency, formatPct } from '../../utils/format'
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
  //
  // NULL is its own state, and the reason this is not a bare Number(): the server sends null
  // for the liability AND the balance when it REFUSED to price the year (a married year with
  // no bracket table for its filing status), and Number(null) is 0 — which this card used to
  // render as a confident "dead even" beside a $0.00 balance. Nothing is known there, so the
  // tile says nothing and the missing-brackets call to action below explains why.
  const balance =
    withholding === null || withholding.balance_projected === null
      ? null
      : Number(withholding.balance_projected)
  // Owing is the BAD direction, so the tone is the inverse of the number's sign — and the
  // glyph follows the NUMBER (a balance that grew points up however unwelcome it is), which is
  // exactly the case StatTile's explicit `direction` exists for.
  const balanceTone: Tone =
    balance === null || balance === 0 ? 'neutral' : balance > 0 ? 'negative' : 'positive'
  const balanceDirection =
    balance === null || balance === 0 ? undefined : balance > 0 ? 'up' : 'down'
  const balanceWords =
    balance === null
      ? 'no liability to compare'
      : balance > 0
        ? 'to pay at filing'
        : balance < 0
          ? 'refund expected'
          : 'dead even'

  // Which partner story this card is telling. The SOURCE picks the words (it is the
  // server's own decision, and the only field that can say "a profile exists"); the LEG
  // supplies the figures. A 'simulated' source with no leg would be a server bug — the
  // heading would say simulated and the rows would fall back to the entered ones rather
  // than crash on a null.
  const partnerSimulated = withholding !== null && withholding.partner_source === 'simulated'
  const partnerLeg = withholding === null ? null : withholding.partner_salary

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
              value={formatCurrency(balance === null ? null : Math.abs(balance))}
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

          {/* The partner mini-section: read-only on purpose. The inputs form BELOW this card
              already edits all three rows (they are seeded per-person definitions, so it
              renders an editable cell for each in the partner column), and a second editor
              here would be two write paths racing over one row. Simulated mode swaps the two
              tracker rows for the leg the server computed — the rows stay editable below,
              they simply stop being this card's answer. */}
          {withholding.partner_wages !== null && (
            <div className="withholding-partner">
              <h3 className="eyebrow">
                {partnerSimulated ? 'Partner — simulated' : 'Partner — entered, not simulated'}
              </h3>
              <dl className="withholding-partner-facts">
                <div>
                  <dt>W-2 wages</dt>
                  {/* Both modes: wages are the year's W-2 inputs, never the simulation —
                      the liability beside them is computed on exactly these. */}
                  <dd>{formatCurrency(withholding.partner_wages)}</dd>
                </div>
                {partnerSimulated ? (
                  <>
                    <div>
                      <dt>Withheld so far</dt>
                      <dd>{formatCurrency(partnerLeg === null ? null : partnerLeg.ytd)}</dd>
                    </div>
                    <div>
                      {/* NOT "Projected withholding": that is the label of this card's own
                          stat tile, which carries the HOUSEHOLD total. Two rows spelled the
                          same with different money on one card is the ambiguity this whole
                          batch exists to remove. */}
                      <dt>Projected for the year</dt>
                      <dd>{formatCurrency(partnerLeg === null ? null : partnerLeg.projected)}</dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <dt>Federal withheld</dt>
                      <dd>
                        {withholding.partner_withheld_fed === null
                          ? 'not entered'
                          : formatCurrency(withholding.partner_withheld_fed)}
                      </dd>
                    </div>
                    <div>
                      <dt>State withheld</dt>
                      <dd>
                        {withholding.partner_withheld_state === null
                          ? 'not entered'
                          : formatCurrency(withholding.partner_withheld_state)}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              {partnerSimulated ? (
                partnerLeg !== null && (
                  <p className="drill-hint">
                    {`Simulated from their paycheck profile — ${partnerLeg.checks_elapsed} of ${partnerLeg.checks_total} checks at their all-in withholding %. Their entered W-2 withholding rows are ignored while that profile exists.`}
                  </p>
                )
              ) : (
                <p className="drill-hint">
                  Your side is simulated from paycheck profiles; your partner&rsquo;s is
                  entered. Edit all three in the inputs form below. Partner amounts are already
                  counted once in each total above — don&rsquo;t add them again.
                </p>
              )}
            </div>
          )}

          {/* One sentence, and only when it is real money: the trap is a THRESHOLD mismatch,
              so a negative gap (over-withholding) is left in the payload and out of the copy. */}
          {Number(withholding.additional_medicare_gap) > 0 && (
            <p className="hint withholding-trap">
              {`Additional Medicare gap ≈${formatCurrency(
                withholding.additional_medicare_gap,
              )}: each employer withholds the 0.9% surtax only above $200,000 of its own wages, but this return owes it on its combined wages above a lower threshold — wages that stay under the per-employer line still leave this much unwithheld.`}
              <InfoHint text="Form 8959. Close it with a W-4 line 4(c) extra-withholding amount or a quarterly estimated payment." />
            </p>
          )}

          {/* Not "those lines compute as 0": the engine REFUSES a married year whose tables
              are missing rather than walking a single filer's thresholds, which is why the
              two tiles above read "—". This is the call to action that owns that state. */}
          {withholding.brackets_missing_for_status.length > 0 && (
            <p className="hint withholding-cta">
              {`No ${withholding.brackets_missing_for_status.join(
                ', ',
              )} bracket table for this year’s filing status — the tax engine cannot price the year until they exist. Add them in the brackets editor below, or clone another year’s and edit the thresholds.`}
            </p>
          )}

          {/* Nothing at all when the server sent none: a missing prior year is the normal
              first-year case and arrives with no warning of its own, so there is no absence
              here to explain. (A prior year that exists but computes to zero DOES warn, and
              that sentence lands with the rest of them below.) The multiplier is the SERVER'S
              — 110% only above the IRC 6654(d)(1)(C) prior-year AGI gate, 100% at or below it
              — never a literal here, or a low-AGI year reads as an arithmetic error next to a
              threshold that equals the figure beside it. */}
          {withholding.safe_harbor !== null && (
            <p className="hint">
              {`Safe harbor (approx.): ${formatPct(withholding.safe_harbor.multiplier, {
                signed: false,
                decimals: 0,
              })} of ${withholding.safe_harbor.prior_year}'s total tax is ${formatCurrency(
                withholding.safe_harbor.threshold,
              )} — ${
                withholding.safe_harbor.met
                  ? 'covered by projected withholding'
                  : 'NOT covered by projected withholding'
              }`}
              <InfoHint text="Real safe harbor is per-jurisdiction; this compares all-in totals — approximate by construction." />
            </p>
          )}

          {/* The wedding-year note: the reference return is last year's, so on the first
              married year it was filed under another status. The number is still the legal
              safe harbor — a labelling matter, never a math one. */}
          {withholding.safe_harbor !== null &&
            withholding.safe_harbor.prior_filing_status !== withholding.filing_status && (
              <p className="hint">
                {`That reference return was filed as ${withholding.safe_harbor.prior_filing_status.replaceAll(
                  '_',
                  ' ',
                )} — still the legal safe harbor, just a different household.`}
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
