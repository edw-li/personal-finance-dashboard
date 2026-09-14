import { Link } from 'react-router-dom'
import type { GuideCard } from '../types'

// Chapter: Start here (2026-09-14 guide spec §5.1). Card ids are fixed by the spec:
// start-what · start-organized · start-setup · start-next. G1 owns everything below the
// exemplar; the exemplar shows the voice (task-first, sentence case, the em-dash consequence
// clause, honest about what is not saved) and the shape (purpose + body, no tasks).
export const START_CARDS: GuideCard[] = [
  {
    id: 'start-what',
    title: 'What this dashboard does',
    purpose:
      'A self-hosted dashboard for one household\u2019s money: you enter balances, spending and take-home once a month, prices refresh on a schedule, and everything else is computed from those entries.',
    tasks: [],
    body: (
      <>
        <p className="guide-body">
          Nothing leaves your server except price lookups and, if you turn it on, the questions you ask
          the assistant. Two people can be tracked; most pages have a <b className="guide-label">Whose</b>{' '}
          chip in the sticky row under the title.
        </p>
        <p className="guide-body">
          Three rhythms: set it up once in <Link to="/settings?section=household">Settings</Link>, update it
          every month in <Link to="/update">Monthly update</Link>, and refresh tax tables and contribution
          limits once a year on <Link to="/taxes">Taxes</Link> and{' '}
          <Link to="/settings?section=planning">Settings → Planning</Link>.
        </p>
      </>
    ),
  },
]
