import { useEffect, useRef, useState } from 'react'
import BusyButton from '../components/feedback/BusyButton'
import { PIN_LIMIT } from './pins'
import type { ReactNode } from 'react'
import InfoHint from '../components/InfoHint'
import { SkeletonCard } from '../components/PageSkeleton'
import Feed from '../components/shell/Feed'
import { useToast } from '../components/ToastProvider'
import type { Sandbox } from './useSandbox'
import './sandbox.css'

// The sandbox card frame (2026-09-03 planning-sandboxes spec §8.1): eyebrow with the hint
// ("— nothing is saved"), a header toggle with aria-expanded (omitted under
// `defaultOpen`, where the tab is the gate — 2026-09-13 polish spec §8), Reset to actual (disabled when
// the scenario is empty), then — open — presets · controls · the compare region (through
// Feed, so loading and stale states are the shell's) · the pin row · the Apply slot, which
// renders only when the scenario is non-empty and the page provides one. Nothing here
// posts; Apply is the PAGE's button, handed in as a node.
export interface SandboxPanelProps<S extends object, R> {
  eyebrow: string
  hint: string
  open: boolean
  onToggle: () => void
  toggleLabels?: { open: string; close: string }
  /** The panel is the sole content of its own tab (2026-09-13 polish spec §8): it renders open
   *  from the first paint and the open/close toggle is not rendered — the tab click was the ask.
   *  "Reset to actual" stays. The page's `open` is still honoured when it is true (the URL-entries
   *  arrival latch keeps working unchanged); `defaultOpen` only ever ADDS openness. */
  defaultOpen?: boolean
  closedHint?: ReactNode
  sandbox: Sandbox<S, R>
  resetLabel?: string
  /** Keeps Reset live over an EMPTY scenario, for a page that holds unfinished work outside
   *  it (the taxes what-if's override rows, 2026-09-23 spec §B7). Pin, Copy link and Apply
   *  still follow the scenario. Absent → Reset follows the scenario too. */
  canReset?: boolean
  presets?: ReactNode
  children: ReactNode
  compare?: ReactNode
  staleNoun?: string
  skeletonHeight?: number
  /** Hold the first body until the page's controls and initial preview are ready. The page
   *  clears this label once; later previews keep their controls and use Feed as usual. */
  initialLoading?: string
  apply?: ReactNode
  hidePins?: boolean
}

// R is fenced at Feed's own bound — a payload that could BE null would make "not loaded yet"
// unsayable (Feed.tsx's note); every page's what-if response is an object.
export default function SandboxPanel<S extends object, R extends NonNullable<unknown>>({
  eyebrow,
  hint,
  open,
  onToggle,
  toggleLabels = { open: 'Try it', close: 'Close' },
  defaultOpen = false,
  closedHint,
  sandbox,
  resetLabel = 'Reset to actual',
  canReset,
  presets,
  children,
  compare,
  staleNoun = 'this scenario',
  skeletonHeight = 160,
  initialLoading,
  apply,
  hidePins = false,
}: SandboxPanelProps<S, R>) {
  // One truth for "is the card open": the page's state, or the tab-owns-it flag.
  const isOpen = defaultOpen || open
  return (
    <section className="card sandbox-card">
      <div className="sandbox-header">
        <h2 className="eyebrow">
          {eyebrow}
          <InfoHint text={hint} />
        </h2>
        <div className="sandbox-header-actions">
          {isOpen && (
            <button
              type="button"
              className="button"
              disabled={!(canReset ?? !sandbox.empty)}
              onClick={sandbox.reset}
            >
              {resetLabel}
            </button>
          )}
          {/* No second gate on a tab that IS the sandbox: the toggle only exists where the card
              shares a page with other content. */}
          {!defaultOpen && (
            <button type="button" className="button" aria-expanded={isOpen} onClick={onToggle}>
              {isOpen ? toggleLabels.close : toggleLabels.open}
            </button>
          )}
        </div>
      </div>
      {!isOpen ? (
        closedHint
      ) : initialLoading !== undefined ? (
        <SkeletonCard height={skeletonHeight} label={initialLoading} />
      ) : (
        <>
          {presets}
          <div className="sandbox-controls">{children}</div>
          <Feed
            data={sandbox.result}
            error={sandbox.error}
            busy={sandbox.busy}
            staleNoun={staleNoun}
            skeleton={{ height: skeletonHeight, label: 'Running the scenario…' }}
          >
            {() => <>{compare}</>}
          </Feed>
          {!hidePins && <PinRow sandbox={sandbox} />}
          {!sandbox.empty && apply !== undefined && <div className="sandbox-apply">{apply}</div>}
        </>
      )}
    </section>
  )
}

/** Label box · Pin this scenario · pinned chips · Copy link (spec §8.5). Pins are never part
 *  of a link; Copy link copies the LIVE scenario's URL. Exported for the page tests. */
export function PinRow<S extends object, R>({ sandbox }: { sandbox: Sandbox<S, R> }) {
  const [label, setLabel] = useState('')
  const pinRowRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLInputElement>(null)
  const previousPins = useRef(sandbox.pins)
  const full = sandbox.pins.length >= PIN_LIMIT
  const pin = () => {
    if (sandbox.empty || full) return
    sandbox.pin(label)
    setLabel('')
  }
  // Both the chips and the comparison table can unpin. Wait for the resulting list so
  // either control hands focus to the same neighbour, or to the label after the last pin.
  useEffect(() => {
    const before = previousPins.current
    previousPins.current = sandbox.pins
    const removed = before.findIndex((pin) => !sandbox.pins.some((saved) => saved.id === pin.id))
    if (removed < 0) return
    const neighbour = sandbox.pins[removed] ?? sandbox.pins[removed - 1]
    const next = Array.from(pinRowRef.current?.querySelectorAll<HTMLButtonElement>('[data-pin-remove]') ?? [])
      .find((button) => button.dataset.pinRemove === neighbour?.id)
    ;(next ?? labelRef.current)?.focus()
  }, [sandbox.pins])
  const toast = useToast()
  const copy = () => {
    const url = `${window.location.origin}${sandbox.link}`
    const clipboard = navigator.clipboard
    if (clipboard === undefined) {
      toast.error('Clipboard unavailable — copy the address bar instead')
      return
    }
    clipboard.writeText(url).then(
      () => toast.success('Link copied'),
      () => toast.error('Clipboard unavailable — copy the address bar instead'),
    )
  }
  return (
    <div className="sandbox-pins" ref={pinRowRef}>
      <form className="sandbox-pin-form" onSubmit={(event) => { event.preventDefault(); pin() }}>
      <input
        ref={labelRef}
        className="field-input"
        aria-label="Pin label"
        placeholder="Name this scenario"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <BusyButton type="submit" className="button" aria-disabled={sandbox.empty || full || undefined}
        aria-describedby={full ? 'sandbox-pin-limit' : undefined}>
        Pin this scenario
      </BusyButton>
      {full && <span id="sandbox-pin-limit" className="drill-hint">Unpin one to pin another</span>}
      </form>
      {sandbox.pins.map((pin) => (
        <span key={pin.id} className="chip sandbox-pin-chip">
          {pin.label}
          <button type="button" aria-label={`Unpin ${pin.label}`} data-pin-remove={pin.id} onClick={() => sandbox.unpin(pin.id)}>
            ×
          </button>
        </span>
      ))}
      <button type="button" className="button" disabled={sandbox.empty} onClick={copy}>
        Copy link
      </button>
      <span className="drill-hint">{sandbox.pins.length}/3 pinned</span>
    </div>
  )
}
