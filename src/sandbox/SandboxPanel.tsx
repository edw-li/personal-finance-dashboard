import { useState } from 'react'
import type { ReactNode } from 'react'
import InfoHint from '../components/InfoHint'
import Feed from '../components/shell/Feed'
import { useToast } from '../components/ToastProvider'
import type { Sandbox } from './useSandbox'
import './sandbox.css'

// The sandbox card frame (2026-09-03 planning-sandboxes spec §8.1): eyebrow with the hint
// ("— nothing is saved"), a header toggle with aria-expanded, Reset to actual (disabled when
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
  closedHint?: ReactNode
  sandbox: Sandbox<S, R>
  resetLabel?: string
  presets?: ReactNode
  children: ReactNode
  compare?: ReactNode
  staleNoun?: string
  skeletonHeight?: number
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
  closedHint,
  sandbox,
  resetLabel = 'Reset to actual',
  presets,
  children,
  compare,
  staleNoun = 'this scenario',
  skeletonHeight = 160,
  apply,
  hidePins = false,
}: SandboxPanelProps<S, R>) {
  return (
    <section className="card sandbox-card">
      <div className="sandbox-header">
        <h2 className="eyebrow">
          {eyebrow}
          <InfoHint text={hint} />
        </h2>
        <div className="sandbox-header-actions">
          {open && (
            <button type="button" className="button" disabled={sandbox.empty} onClick={sandbox.reset}>
              {resetLabel}
            </button>
          )}
          <button type="button" className="button" aria-expanded={open} onClick={onToggle}>
            {open ? toggleLabels.close : toggleLabels.open}
          </button>
        </div>
      </div>
      {!open ? (
        closedHint
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
    <div className="sandbox-pins">
      <input
        className="field-input"
        aria-label="Pin label"
        placeholder="Name this scenario"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button
        type="button"
        className="button"
        disabled={sandbox.empty}
        onClick={() => {
          sandbox.pin(label)
          setLabel('')
        }}
      >
        Pin this scenario
      </button>
      {sandbox.pins.map((pin) => (
        <span key={pin.id} className="chip sandbox-pin-chip">
          {pin.label}
          <button type="button" aria-label={`Unpin ${pin.label}`} onClick={() => sandbox.unpin(pin.id)}>
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
