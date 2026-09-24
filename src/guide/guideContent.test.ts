import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { NAV_ITEMS } from '../components/navItems'
import { SETTINGS_SECTIONS } from '../components/paletteRegistry'
import { allIds, chapterOf } from './anchors'
import { GUIDE } from './content'
import type { GuideCard, GuideTask } from './types'

// The guide rots the moment a route, view, anchor or button label changes and nobody edits
// src/guide/content. These fences make that a failing test instead of a stranded reader
// (2026-09-14 guide spec §8). They read page sources as text — the paletteRegistry.test.ts
// technique — because view ids and card anchors are literals, not exports.

const SRC = path.resolve(__dirname, '..')
const ROUTES = new Set(NAV_ITEMS.map((item) => item.to))
const NAV_LABELS = new Set(NAV_ITEMS.map((item) => item.label))
const QUERY_ALLOW = new Set(['section', 'month', 'owner', 'range', 'step', 'view', 'add', 'date', 'tab', 'ticker', 'drill', 'trend', 'card', 'year', 'comp', 'lot', 'grant', 'profile', 'whatif'])

/** route → page component file, read off routeChunks.ts so the two cannot drift. */
function pageFiles(): Map<string, string> {
  const text = readFileSync(path.join(SRC, 'components/routeChunks.ts'), 'utf8')
  const map = new Map<string, string>()
  for (const match of text.matchAll(/'([^']+)': \(\) => import\('\.\.\/pages\/(\w+)'\)/g)) {
    map.set(match[1], path.join(SRC, 'pages', `${match[2]}.tsx`))
  }
  return map
}
const PAGE_FILES = pageFiles()

/** A page's tab strip as { id, label }[]: the constant its useLocalSections() call names
 *  (PAGE_SECTIONS on eight pages, SECTIONS on Spending and Projection), read as a literal in
 *  either quoting style. [] when the page has no strip (Overview, Monthly update, Calendar). */
function pageSections(route: string): { id: string; label: string }[] {
  const file = PAGE_FILES.get(route)
  if (!file || !existsSync(file)) return []
  const text = readFileSync(file, 'utf8')
  const name = text.match(/useLocalSections(?:<[^>]+>)?\(\s*([A-Za-z_]+)\s*,/)?.[1]
  if (!name) return []
  const literal = text.match(new RegExp(`const ${name}(?::[^=]+)? = (\\[[\\s\\S]*?\\]) as const`))?.[1]
  if (!literal) return []
  return Array.from(literal.matchAll(/["']?id["']?:\s*["']([a-z-]+)["'],\s*["']?label["']?:\s*["']([^"']+)["']/g)).map((m) => ({ id: m[1], label: m[2] }))
}

const AREA_DIRS: Record<string, string> = {
  '/': 'overview', '/update': 'monthly', '/net-worth': 'networth', '/portfolio': 'portfolio', '/spending': 'spending',
  '/credit-cards': 'creditcards', '/paycheck': 'paycheck', '/comp': 'comp', '/espp': 'espp', '/taxes': 'taxes',
  '/projection': 'projection', '/calendar': 'calendar', '/settings': 'settings',
}

/** Non-test .tsx AND .ts sources: preset chip labels (taxScenario.ts, paycheckScenario.ts),
 *  assistant starters (samples.ts) and palette labels (paletteRegistry.ts) are UI text too. */
function tsxUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsxUnder(full))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** Sources that may carry `id="<anchor>"` for a page: the page file plus its component area. */
function anchorSources(route: string): string {
  const files = [PAGE_FILES.get(route), ...tsxUnder(path.join(SRC, 'components', AREA_DIRS[route] ?? '__none__'))].filter((f): f is string => !!f && existsSync(f))
  return files.map((f) => readFileSync(f, 'utf8')).join('\n')
}

/** Every non-test .tsx under src/ except the guide itself — the label fence's haystack. */
const UI_TEXT = tsxUnder(SRC)
  .filter((f) => !f.includes(`${path.sep}guide${path.sep}`))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')
const VIEW_LABELS = new Set(Array.from(PAGE_FILES.keys()).flatMap((route) => pageSections(route).map((s) => s.label)))

const allCards: { card: GuideCard; chapter: string }[] = GUIDE.flatMap((chapter) => chapter.cards.map((card) => ({ card, chapter: chapter.id })))
const allTasks: { task: GuideTask; card: GuideCard }[] = allCards.flatMap(({ card }) => [...card.tasks, ...(card.more ?? [])].map((task) => ({ task, card })))
const allLinks: { to: string; owner: string }[] = [
  ...allCards.filter(({ card }) => card.to).map(({ card }) => ({ to: card.to!, owner: card.id })),
  ...allTasks.filter(({ task }) => task.to).map(({ task }) => ({ to: task.to!, owner: task.id })),
]
const guideIds = new Set(allIds())

function parse(to: string): { pathname: string; params: URLSearchParams; hash: string } {
  const url = new URL(to, 'http://x')
  return { pathname: url.pathname, params: url.searchParams, hash: url.hash.slice(1) }
}

describe('guide content — link fence (spec §8.1)', () => {
  it('every link is a sidebar route or the guide itself', () => {
    const bad = allLinks.filter(({ to }) => !ROUTES.has(parse(to).pathname))
    expect(bad).toEqual([])
  })

  it('every ?section= names a view the target page really has', () => {
    const bad = allLinks.filter(({ to }) => {
      const { pathname, params } = parse(to)
      const section = params.get('section')
      if (!section) return false
      const ids = pathname === '/guide' ? GUIDE.map((c) => c.id) : pageSections(pathname).map((s) => s.id)
      return !ids.includes(section)
    })
    expect(bad).toEqual([])
  })

  it('every #hash exists: a guide id, a Settings card id, or an id="…" in the target page or its components', () => {
    const settingsIds = new Set([...SETTINGS_SECTIONS.map((s) => s.id), 'sec-household', 'sec-planning', 'sec-account', 'sec-integrations', 'sec-data'])
    const bad = allLinks.filter(({ to }) => {
      const { pathname, hash } = parse(to)
      if (!hash) return false
      if (pathname === '/guide') return !guideIds.has(hash)
      if (pathname === '/settings') return !settingsIds.has(hash)
      return !anchorSources(pathname).includes(`id="${hash}"`)
    })
    expect(bad).toEqual([])
  })

  it('uses only the arrival parameters the app consumes', () => {
    const bad = allLinks.filter(({ to }) => Array.from(parse(to).params.keys()).some((key) => !QUERY_ALLOW.has(key)))
    expect(bad).toEqual([])
  })

  it('a pointer task has exactly one step and a real destination outside the guide', () => {
    // Content lanes run in parallel and merge one at a time, so a pointer that named another
    // chapter's anchor would fail this fence on whichever lane merged first (spec §5.1).
    const pointers = allTasks.filter(({ task }) => task.id.endsWith('-pointer'))
    const bad = pointers.filter(({ task }) => task.steps.length !== 1 || !task.to || task.to.startsWith('/guide'))
    expect(bad.map(({ task }) => task.id)).toEqual([])
  })
})

describe('guide content — label fence (spec §8.2)', () => {
  // Placeholders (<Month>, <person>) and figures ($X, 15 %) are prose in either position.
  const placeholder = (text: string) => /[<>]/.test(text) || /^[\d$]/.test(text)
  // Generic locations ("Any chart", "Every headline tile") only ever describe WHERE a reader
  // is; a **Label** in a step names a control, and a control has a literal in the source.
  const exemptSegment = (text: string) => placeholder(text) || /^(Any|Every|The) /.test(text)

  // Steps AND watch lines, card-level and task-level: GuideCard and TaskDetail render all
  // three through renderSteps, so **Label** is a claim about the UI wherever it appears.
  const boldText: { owner: string; text: string }[] = [
    ...allTasks.flatMap(({ task }) => [...task.steps, ...(task.watch ?? [])].map((text) => ({ owner: task.id, text }))),
    ...allCards.flatMap(({ card }) => (card.watch ?? []).map((text) => ({ owner: card.id, text }))),
  ]

  it('every **Label** in a step or a watch line is text that exists somewhere in the UI', () => {
    const missing: string[] = []
    for (const { owner, text } of boldText) {
      for (const match of text.matchAll(/\*\*(.+?)\*\*/g)) {
        const label = match[1]
        if (!placeholder(label) && !UI_TEXT.includes(label)) missing.push(`${owner}: ${label}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every segment of a Where path is a page, a view, or text that exists in the UI', () => {
    const missing: string[] = []
    for (const { task } of allTasks) {
      // ' → ' walks into a place; ' · ' lists alternatives ('Overview · Spending · Net worth').
      for (const segment of task.where.split(/ → | · /).map((s) => s.trim())) {
        if (!segment || exemptSegment(segment)) continue
        if (NAV_LABELS.has(segment) || VIEW_LABELS.has(segment) || UI_TEXT.includes(segment)) continue
        missing.push(`${task.id}: ${segment}`)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('guide content — completeness, shape and uniqueness (spec §8.3)', () => {
  it('every sidebar page has a card somewhere in the guide', () => {
    const covered = new Set(allCards.map(({ card }) => card.to).filter(Boolean))
    const missing = NAV_ITEMS.map((item) => item.to).filter((route) => route !== '/guide' && !covered.has(route))
    expect(missing).toEqual([])
  })

  it('card and task ids are unique, kebab-case, and every id resolves to its chapter', () => {
    const ids = [...allCards.map(({ card }) => card.id), ...allTasks.map(({ task }) => task.id)]
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(dupes).toEqual([])
    expect(ids.filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))).toEqual([])
    expect(ids.filter((id) => chapterOf(id) === undefined)).toEqual([])
  })

  it('every task has a title, a where and at least one step of at most 160 characters', () => {
    const bad = allTasks.filter(({ task }) => !task.title || !task.where || task.steps.length === 0 || task.steps.some((s) => s.length > 160))
    expect(bad.map(({ task }) => task.id)).toEqual([])
  })

  it('page cards show 3–8 tasks, carry at most 5 card-level traps, and name the page’s views exactly', () => {
    const bad: string[] = []
    for (const { card } of allCards) {
      if (!card.to || card.to.startsWith('/guide') || !ROUTES.has(card.to)) continue
      if (card.tasks.length < 3 || card.tasks.length > 8) bad.push(`${card.id}: ${card.tasks.length} visible tasks`)
      if ((card.watch?.length ?? 0) > 5) bad.push(`${card.id}: ${card.watch!.length} watch lines`)
      const expected = pageSections(card.to).map((s) => s.label)
      if (expected.length > 0 && JSON.stringify(card.views ?? []) !== JSON.stringify(expected)) bad.push(`${card.id}: views ${JSON.stringify(card.views)} ≠ ${JSON.stringify(expected)}`)
      if (expected.length === 0 && card.views) bad.push(`${card.id}: views given for a page without a tab strip`)
    }
    expect(bad).toEqual([])
  })

  it('the Pages chapter is in sidebar order', () => {
    const pages = GUIDE.find((c) => c.id === 'pages')!.cards.map((card) => card.to).filter((to): to is string => !!to)
    const order = NAV_ITEMS.map((item) => item.to)
    const sorted = [...pages].sort((a, b) => order.indexOf(a) - order.indexOf(b))
    expect(pages).toEqual(sorted)
  })
})

// The time model in the reader's words (2026-09-23 spec §T11): the glossary names the balance
// date and the words the pages now use, and the monthly rhythm is the two-part update.
describe('guide content — the time model (2026-09-23 spec §T11)', () => {
  afterEach(cleanup)
  const bodyText = (id: string): string => {
    const card = allCards.find(({ card }) => card.id === id)?.card
    expect(card, id).toBeDefined()
    return render(createElement(MemoryRouter, null, card?.body)).container.textContent ?? ''
  }

  it('the glossary defines the balance date, provisional balances, a month’s story, due and overdue, and partly entered spending', () => {
    const glossary = bodyText('ref-glossary')
    for (const [term, definition] of [
      ['Balances as of', 'The day your balances describe — the 1st of the month.'],
      ['Provisional balances', 'Recorded before their date; final once saved again on or after it.'],
      ['A month’s story', 'Its spending and take-home, and the net-worth change from its 1st to the next 1st.'],
      ['Due · overdue', 'balances are due on the 1st and overdue from the 7th'],
      ['Partly entered spending', 'it counts once you save the month again after it ends or confirm it is complete'],
    ]) {
      expect(glossary, term).toContain(term)
      expect(glossary, term).toContain(definition)
    }
    expect(glossary).toContain('overdue from the 16th of the next month')
  })

  it('the monthly rhythm is balances on the 1st and last month’s spending once it has posted', () => {
    expect(bodyText('start-next')).toContain('balances on the 1st; last month’s spending once it has posted')
  })
})

// After lanes R and W landed: the setup steps name the new Plan until (year) field and the filing
// status's own door, W8's **Change…** — not a "Filing status" control that no longer exists.
describe('guide content — the setup steps follow the merged pages', () => {
  const stepsOf = (id: string) => allTasks.find(({ task }) => task.id === id)?.task.steps.join(' ') ?? ''

  it('names Plan until (year) among the plan assumptions', () => {
    expect(stepsOf('setup-limits')).toContain('withdrawal rate, Plan until (year), ESPP ticker and discount')
  })

  it('says Up next keeps one monthly-update row (lane T code review, decision (b))', () => {
    expect(stepsOf('overview-up-next')).toContain('at most one payday and one monthly update')
  })

  it('sets a new year’s filing status with Change…', () => {
    expect(stepsOf('setup-taxes')).toContain('set its filing status with **Change…**')
    expect(stepsOf('setup-taxes')).not.toContain('**Filing status**')
  })
})

describe('guide content — the Projection card claims no direction it cannot know', () => {
  it('names both ways the model’s omissions move the money-lasts share (2026-09-24 review minor 3)', () => {
    const card = allCards.find(({ card }) => card.id === 'page-projection')?.card
    const line = card?.watch?.find((text) => text.includes('Social Security'))
    expect(line).toContain('flatters')
    expect(line).toContain('understates')
    expect(line).not.toMatch(/leans hopeful/)
  })
})

// The user's coverage list (spec §5.4). Live since lane V retired the pending list: every
// content lane has landed, so a missing id is a hole in the guide, not a lane still working.
describe('guide content — required coverage (spec §5.4)', () => {
  const REQUIRED = [
    'accounts-add', 'accounts-owner', 'cards-owner', 'paycheck-person', 'update-balances', 'update-spending', 'update-close',
    'portfolio-transaction', 'portfolio-security', 'portfolio-classify', 'cards-add', 'cards-multipliers', 'cards-credit-add',
    'paycheck-profile-add', 'paycheck-try-it', 'comp-grant-add', 'comp-focal-add', 'espp-offering-add', 'espp-lot-add',
    'espp-lot-sold', 'taxes-year-create', 'taxes-tables', 'taxes-inputs', 'taxes-will-i-owe', 'taxes-whatif-sale',
    'projection-assumptions', 'projection-retire-month', 'calendar-add-event', 'calendar-subscribe', 'assistant-ask', 'assistant-key',
  ]
  it('every task the owner asked for exists', () => {
    expect(REQUIRED.filter((id) => !guideIds.has(id))).toEqual([])
  })
})
