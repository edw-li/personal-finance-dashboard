import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCreditCards } from '../api/creditCards'
import { fetchAccounts } from '../api/netWorth'
import { fetchSecurities } from '../api/portfolio'
import { refreshPrices } from '../api/prices'
import { fetchCategories } from '../api/spending'
import { currentMonthIso } from '../utils/months'
import { requestAssistantOpen } from './assistant/viewState'
import './CommandPalette.css'
import { onPaletteOpen } from './paletteBus'
import {
  buildEntries,
  entityEntries,
  groupMatches,
  matchEntries,
  type PaletteEntry,
} from './paletteRegistry'
import { useToast } from './ToastProvider'

const RECENT_KEY = 'commandPalette.recent'
const RECENT_MAX = 8

// The entity lists are small and change rarely; ten minutes is long enough that a sitting
// costs one round of fetches and short enough that a rename shows up the same afternoon.
const ENTITY_TTL_MS = 10 * 60 * 1000

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function pushRecent(id: string): void {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX)),
    )
  } catch {
    // Recency ranking is a nicety — a blocked localStorage must not break execution.
  }
}

/**
 * Ctrl/Cmd+K overlay (2026-08-25 polish §9, registry 2026-09-03 shell spec §9): fuzzy jump
 * over the palette registry — pages with keyword aliases, anchored Settings sections, the
 * five finished actions and lazily loaded entities — with combobox ARIA, kind-grouped
 * results and recents in localStorage. Hand-rolled: no library.
 */
export default function CommandPalette() {
  const navigate = useNavigate()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [entities, setEntities] = useState<PaletteEntry[]>([])
  const entitiesLoadedAt = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  const openPalette = () => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setActive(0)
    setOpen(true)
  }

  const closePalette = () => {
    setOpen(false)
    // The dialog contract: focus goes back where it was taken from.
    previousFocus.current?.focus()
  }

  // Entities load on the first open and refresh when older than ten minutes — the lists
  // are small and the palette must open instantly, so the fetch never gates the UI.
  // allSettled, not all: one unreachable endpoint must cost only its own group.
  useEffect(() => {
    if (!open || Date.now() - entitiesLoadedAt.current < ENTITY_TTL_MS) return
    entitiesLoadedAt.current = Date.now()
    Promise.allSettled([
      fetchSecurities(),
      fetchAccounts(),
      fetchCategories(),
      fetchCreditCards(),
    ]).then(([securities, accounts, categories, cards]) => {
      setEntities(
        entityEntries({
          securities:
            securities.status === 'fulfilled'
              ? securities.value
                  .filter((s) => s.is_active)
                  .map((s) => ({ ticker: s.ticker, name: s.name }))
              : [],
          accounts:
            accounts.status === 'fulfilled'
              ? accounts.value
                  .filter((a) => a.is_active)
                  .map((a) => ({ slug: a.slug, name: a.name, group: a.group }))
              : [],
          categories:
            categories.status === 'fulfilled'
              ? categories.value
                  .filter((c) => c.is_active)
                  .map((c) => ({ slug: c.slug, name: c.name }))
              : [],
          cards:
            cards.status === 'fulfilled'
              ? cards.value.filter((c) => c.is_active).map((c) => ({ slug: c.slug, name: c.name }))
              : [],
        }),
      )
    })
  }, [open])

  const entries = useMemo<PaletteEntry[]>(
    () => [
      ...buildEntries({
        month: currentMonthIso(),
        run: {
          // LAUNCHED, not awaited: a live refresh takes tens of seconds. The toasts are
          // the palette's report — the run started, then how it finished — so the action
          // no longer ends in silence. The catch is not optional: an unhandled rejection
          // from a fire-and-forget POST would surface long after the palette is gone.
          refreshPrices: () => {
            toast.info('Refreshing prices…')
            refreshPrices()
              .then((res) => {
                const failed = Object.keys(res.failed).length
                toast.success(
                  `Prices refreshed — ${res.updated.length} updated${failed ? `, ${failed} failed` : ''}`,
                )
              })
              .catch((err: unknown) =>
                toast.error(err instanceof Error ? err.message : 'Price refresh failed'),
              )
            navigate('/portfolio')
          },
          // The palette closes first (execute()'s contract), then the drawer opens and
          // takes focus itself — the launcher button is not involved, so no focus tug-of-war.
          askAssistant: () => requestAssistantOpen(),
        },
      }),
      ...entities,
    ],
    [entities, navigate, toast],
  )

  // Recency floats to the top of the FULL list only; a typed query ranks by score alone.
  const matches = matchEntries(query, entries, query.trim() === '' ? readRecent() : [])
  const groups = groupMatches(matches)
  // The flat order the keyboard walks: group order, then rank inside each group.
  const flat = groups.flatMap((g) => g.items)
  const activeIndex = flat.length === 0 ? -1 : Math.min(active, flat.length - 1)

  const execute = (item: PaletteEntry) => {
    pushRecent(item.id)
    // Close FIRST: the focus restore runs, then the destination's own pathname-change
    // hand-off (Layout's #main focus) takes over.
    closePalette()
    if (item.run) item.run()
    else if (item.to) navigate(item.to)
  }

  // Unkeyed on purpose (the EChart latest-handler idiom): the listener re-registers each
  // render, so it always sees the current open/close functions without a stale closure.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Alt and Shift must be CLEAR: Ctrl+Shift+K is Firefox's console, and Ctrl+Alt+K is
      // what AltGr+K reports on Windows layouts (it types a glyph). Neither is ours.
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault() // the browser's own ^K (search bar) must not fire
        if (open) closePalette()
        else openPalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // The sidebar's search row (and anything else that wants the palette) asks through the
  // bus. Unkeyed for the same latest-handler reason as the hotkey above.
  useEffect(() => onPaletteOpen(() => openPalette()))

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(() => (flat.length === 0 ? 0 : (activeIndex + 1) % flat.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(() => (flat.length === 0 ? 0 : (activeIndex - 1 + flat.length) % flat.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0) execute(flat[activeIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closePalette()
    } else if (event.key === 'Tab') {
      // The trap: the input is the palette's only tab stop; options are pointer/arrow
      // targets (aria-activedescendant carries the selection for AT).
      event.preventDefault()
    }
  }

  if (!open) return null

  return (
    <div
      className="palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePalette()
      }}
    >
      <div
        className="palette"
        // The palette's own chrome (input padding, the list's gutters) must not take the
        // focus off the input: a blur there strands the user — Tab would walk the page
        // BEHIND the overlay, and Escape is bound to the input, so it would stop closing.
        // The input itself is exempt, or clicking to place the caret would do nothing;
        // options preventDefault in their own handlers before running.
        onMouseDown={(event) => {
          if (event.target !== inputRef.current) event.preventDefault()
        }}
      >
        <input
          ref={inputRef}
          className="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-controls="palette-listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `palette-option-${flat[activeIndex].id}` : undefined
          }
          aria-label="Command palette"
          placeholder="Jump to a page or run an action…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onInputKeyDown}
        />
        {flat.length === 0 ? (
          <p className="palette-empty">No matches.</p>
        ) : (
          <ul className="palette-list" id="palette-listbox" role="listbox" aria-label="Commands">
            {groups.map((group) => (
              // role="presentation" on the wrapper li: only the leaves are options, and a
              // listbox's own children may not be plain list items.
              <li key={group.title} role="presentation" className="palette-group">
                <div className="palette-group-title" aria-hidden="true">
                  {group.title}
                </div>
                <ul role="group" aria-label={group.title}>
                  {group.items.map((item) => {
                    const index = flat.indexOf(item)
                    return (
                      <li
                        key={item.id}
                        id={`palette-option-${item.id}`}
                        role="option"
                        aria-selected={index === activeIndex}
                        className="palette-option"
                        // mousedown, not click: a click's mousedown would blur the input
                        // first, and the option must run before any focus bookkeeping
                        // reacts to that.
                        onMouseDown={(event) => {
                          event.preventDefault()
                          execute(item)
                        }}
                        onMouseMove={() => {
                          if (index !== activeIndex) setActive(index)
                        }}
                      >
                        <span>
                          {item.label}
                          {item.sub && <span className="palette-sub"> {item.sub}</span>}
                        </span>
                        <span className="palette-kind">{group.title}</span>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
