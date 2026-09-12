// The "Seeing:" chip's sentence (2026-09-09 audit item 8). Pure, and its own module rather
// than a closure inside AssistantDrawer.tsx so the wording — the one place the app tells a
// reader what its answers are about — can be pinned by unit tests.
//
// It printed raw view keys: "Taxes · year: 2026 · filingStatus: single", which is the
// drawer's implementation talking, not the reader's screen. Every segment below is a phrase
// a reader would use, and a key this file has no words for is DROPPED. That is the rule:
// an unspellable segment is worth less than nothing, because a reader who cannot parse the
// chip stops trusting the whole answer.
import { FILING_STATUSES, FILING_STATUS_LABELS } from '../../api/taxes'
import type { AssistantContextIn, FilingStatus, PersonOut } from '../../types/api'
import { formatDate, formatMonth } from '../../utils/format'
import { NAV_ITEMS } from '../navItems'

// The shell's own month grammar (`month=YYYY-MM`, src/components/shell/useScope.ts), with
// the legacy full date it rewrites. The month half is fenced 01–12 because formatMonth
// indexes a name array with it.
const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/
const YEAR = /^\d{4}$/

function pageLabel(route: string): string {
  return NAV_ITEMS.find((item) => item.to === route)?.label ?? route
}

/** The month the assistant's builders read, in the order they read it (search first). */
function monthPhrase(context: AssistantContextIn): string | null {
  const raw = context.search.month ?? context.view.month ?? context.view.focusMonth
  if (typeof raw !== 'string' || !MONTH_PARAM.test(raw)) return null
  return formatMonth(raw)
}

/** The scope chips' own words. `null` IS a value here — "the whole household" — which is
 *  why an absent key and a null one part company. A person id resolves through the roster
 *  or is omitted: "owner 2" tells a reader nothing they did not already know. */
function ownerPhrase(context: AssistantContextIn, people: PersonOut[]): string | null {
  if (!('owner' in context.view)) return null
  const raw = context.view.owner
  if (raw === null || raw === 'all') return 'Household'
  if (raw === 'joint') return 'Joint'
  return people.find((person) => String(person.id) === String(raw))?.name ?? null
}

function yearPhrase(context: AssistantContextIn): string | null {
  const raw = context.view.year
  if (typeof raw === 'number') return String(raw)
  return typeof raw === 'string' && YEAR.test(raw) ? raw : null
}

function filingPhrase(context: AssistantContextIn): string | null {
  const raw = context.view.filingStatus
  if (typeof raw !== 'string' || !(FILING_STATUSES as readonly string[]).includes(raw)) return null
  return FILING_STATUS_LABELS[raw as FilingStatus]
}

/** What the drawer is looking at, as a sentence: the page, then whatever narrows it.
 *
 *  `people` resolves an owner id to a name; without it (the roster fetch has not landed, or
 *  failed) the owner segment is simply absent. */
export function describeContext(
  context: AssistantContextIn,
  people: PersonOut[] = [],
): string {
  const ticker = context.view.ticker
  // A scenario is in play — the projection section now RUNS it, so the chip has to admit
  // the answer is about a what-if and not the household's derived plan.
  const whatif = context.view.whatif
  const segments = [
    pageLabel(context.route),
    monthPhrase(context),
    ownerPhrase(context, people),
    typeof context.view.profileEffectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(context.view.profileEffectiveDate) ? `profile from ${formatDate(context.view.profileEffectiveDate)}` : null,
    typeof ticker === 'string' && ticker !== '' ? ticker : null,
    yearPhrase(context),
    filingPhrase(context),
    Array.isArray(whatif) && whatif.length > 0 ? 'what-if' : null,
  ]
  return segments.filter((segment): segment is string => segment !== null).join(' · ')
}
