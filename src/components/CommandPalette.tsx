import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { refreshPrices } from '../api/prices'
import { formatMonth } from '../utils/format'
import { fuzzyScore } from '../utils/fuzzy'
import { currentMonthIso } from '../utils/months'
import './CommandPalette.css'
import { NAV_ITEMS } from './navItems'

interface PaletteItem {
  id: string
  label: string
  kind: 'Go to' | 'Action'
  run: () => void
}

const RECENT_KEY = 'commandPalette.recent'
const RECENT_MAX = 8

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
 * Ctrl/Cmd+K overlay (2026-08-25 polish §9): fuzzy jump over the nav registry plus a
 * small action list, combobox ARIA, recents in localStorage. Hand-rolled — no library.
 */
export default function CommandPalette() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
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

  const items: PaletteItem[] = [
    ...NAV_ITEMS.map((item) => ({
      id: `nav:${item.to}`,
      label: item.label,
      kind: 'Go to' as const,
      run: () => navigate(item.to),
    })),
    {
      id: 'action:refresh-prices',
      label: 'Refresh prices',
      kind: 'Action' as const,
      // LAUNCHED, not awaited: a live refresh takes tens of seconds and the portfolio
      // page's own refresh status reports the run — the palette's job ends at lift-off.
      // The catch is deliberate: an unhandled rejection from a fire-and-forget POST
      // would surface as a console error long after the palette is gone.
      run: () => {
        refreshPrices().catch(() => {})
        navigate('/portfolio')
      },
    },
    {
      id: 'action:enter-update',
      label: `Enter ${formatMonth(currentMonthIso())} update`,
      kind: 'Action' as const,
      run: () => navigate('/update'),
    },
    {
      id: 'action:add-dividend',
      label: 'Add dividend',
      kind: 'Action' as const,
      run: () => navigate('/portfolio'),
    },
    {
      id: 'action:add-custom-event',
      label: 'Add custom event',
      kind: 'Action' as const,
      run: () => navigate('/calendar'),
    },
  ]

  const trimmed = query.trim()
  let filtered: PaletteItem[]
  if (trimmed === '') {
    // Recency floats to the top of the FULL list; the rest keeps registry order
    // (Array.prototype.sort is stable, and non-recent entries all rank RECENT_MAX).
    const rank = new Map(readRecent().map((id, index) => [id, index]))
    filtered = [...items].sort(
      (a, b) => (rank.get(a.id) ?? RECENT_MAX) - (rank.get(b.id) ?? RECENT_MAX),
    )
  } else {
    filtered = items
      .map((item) => ({ item, score: fuzzyScore(trimmed, item.label) }))
      .filter((entry): entry is { item: PaletteItem; score: number } => entry.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item)
  }
  const activeIndex = filtered.length === 0 ? -1 : Math.min(active, filtered.length - 1)

  const execute = (item: PaletteItem) => {
    pushRecent(item.id)
    // Close FIRST: the focus restore runs, then the destination's own pathname-change
    // hand-off (Layout's #main focus) takes over.
    closePalette()
    item.run()
  }

  // Unkeyed on purpose (the EChart latest-handler idiom): the listener re-registers each
  // render, so it always sees the current open/close functions without a stale closure.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault() // the browser's own ^K (search bar) must not fire
        if (open) closePalette()
        else openPalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(() => (filtered.length === 0 ? 0 : (activeIndex + 1) % filtered.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(() =>
        filtered.length === 0 ? 0 : (activeIndex - 1 + filtered.length) % filtered.length,
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0) execute(filtered[activeIndex])
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
      <div className="palette">
        <input
          ref={inputRef}
          className="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-controls="palette-listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `palette-option-${filtered[activeIndex].id}` : undefined
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
        {filtered.length === 0 ? (
          <p className="palette-empty">No matches.</p>
        ) : (
          <ul className="palette-list" id="palette-listbox" role="listbox" aria-label="Commands">
            {filtered.map((item, index) => (
              <li
                key={item.id}
                id={`palette-option-${item.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className="palette-option"
                // mousedown, not click: a click's mousedown would blur the input first,
                // and the option must run before any focus bookkeeping reacts to that.
                onMouseDown={(event) => {
                  event.preventDefault()
                  execute(item)
                }}
                onMouseMove={() => {
                  if (index !== activeIndex) setActive(index)
                }}
              >
                <span>{item.label}</span>
                <span className="palette-kind">{item.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
