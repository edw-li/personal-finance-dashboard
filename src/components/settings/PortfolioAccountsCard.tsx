import { useEffect, useRef, useState } from 'react'
import { ApiError, describeError } from '../../api/client'
import { fetchPortfolioAccounts, patchPortfolioAccount } from '../../api/portfolio'
import type { PersonOut, PortfolioAccountOut } from '../../types/api'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import SettingsGhost from './SettingsGhost'
import { WARM, warmSource } from './settingsPrefetch'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/** Portfolio labels have their own feed and can load independently of the net-worth roster. */
export default function PortfolioAccountsCard({ people }: { people: PersonOut[] }) {
  const [portfolioAccounts, setPortfolioAccounts] = useState<PortfolioAccountOut[]>([])
  const [portfolioLoaded, setPortfolioLoaded] = useState(false)
  const [portfolioError, setPortfolioError] = useState<string | null>(null)
  // The roster's loadError/formError split, for the second feed: a retag the server
  // REFUSED is not fixed by asking for the labels again (2026-09-05 motion spec §9).
  const [portfolioFormError, setPortfolioFormError] = useState<string | null>(null)
  const [portfolioBusy, setPortfolioBusy] = useState(false)
  const portfolioSeqRef = useRef(0)
  const loadPortfolio = (initial = false) => {
    const seq = ++portfolioSeqRef.current
    return warmSource(initial)(WARM.portfolioAccounts, fetchPortfolioAccounts)
      .then((rows) => {
        if (seq !== portfolioSeqRef.current) return
        setPortfolioAccounts(rows)
        setPortfolioError(null)
        setPortfolioLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== portfolioSeqRef.current) return
        setPortfolioError(describeError(err, 'the portfolio accounts'))
      })
  }

  // ON CHANGE, one field on the wire — the card's toggleActive idiom. person_id is the only
  // column this control owns (labels are immutable server-side this batch), and the value
  // travels EXPLICITLY: an omitted key means "leave the owner alone", so clearing the
  // select has to send null on purpose.
  const retagPortfolioAccount = (account: PortfolioAccountOut, value: string) => {
    if (portfolioBusy) return
    setPortfolioBusy(true)
    setPortfolioFormError(null)
    patchPortfolioAccount(account.id, { person_id: value === '' ? null : Number(value) })
      .then(() => loadPortfolio())
      .catch((err: unknown) => setPortfolioFormError(message(err, 'Could not retag the account.')))
      .finally(() => setPortfolioBusy(false))
  }

  useEffect(() => { loadPortfolio(true) }, [])
  const primaryName = people.find((person) => person.is_primary)?.name ?? 'the primary person'
  return (
    <section className="card span-8" id="portfolio-accounts" role="region" aria-label="Portfolio accounts">
        <h2 className="eyebrow portfolio-accounts-heading">
          Portfolio accounts
          <InfoHint text="The account labels your transactions and dividends are filed under. Owner blank = joint; a person's Portfolio view is their own labels plus the joint ones. Labels are fixed here — they are the positions' identity." />
        </h2>
        <FeedBanner
          error={portfolioError}
          retry={() => loadPortfolio()}
          retryLabel="Retry loading the portfolio accounts"
        />
        {!portfolioLoaded && portfolioError === null && <SettingsGhost height={420} />}
        {portfolioLoaded &&
          (portfolioAccounts.length === 0 ? (
            <p className="empty-note">
              No portfolio accounts yet — one appears the first time a transaction or dividend
              names an account.
            </p>
          ) : (
            <>
              <div className="settings-scroll">
                <table
                  className="data-table portfolio-accounts-table"
                  aria-label="Portfolio accounts"
                >
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioAccounts.map((account) => (
                      <tr key={account.id}>
                        {/* Read-only text, not an input: renaming a label would orphan every
                            position filed under it, and the server refuses it. */}
                        <td>{account.label}</td>
                        <td>
                          <select
                            className="field-input"
                            aria-label={`Owner for ${account.label}`}
                            value={account.person_id === null ? '' : String(account.person_id)}
                            aria-disabled={portfolioBusy || undefined}
                            onChange={(e) => retagPortfolioAccount(account, e.target.value)}
                          >
                            <option value="">Joint</option>
                            {people.map((person) => (
                              <option key={person.id} value={String(person.id)}>
                                {person.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Inline under the table the select lives in, and with NO Retry: the failure is a
                  write the server refused, which asking for the labels again cannot fix. */}
              <FeedBanner error={portfolioFormError} />
              <p className="settings-note">
                A new account label typed on a transaction or dividend is created owned by{' '}
                {primaryName} — re-tag it here. The labels themselves are fixed: they identify
                the positions.
              </p>
            </>
          ))}
    </section>
  )
}
