import { useId } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
// panels.css first, shell.css second: both files define `.segmented` rules at the same
// specificity, so source order decides the winner. Pinning the order here (rather than
// relying on whatever the importing page happens to load first) makes the control
// self-sufficient — its variant rules always land on top of the legacy base.
import '../panels.css'
import './shell.css'

// The ONE "pick one of N" control (2026-09-03 shell spec §8). Four visual variants, each
// with the semantics its use deserves: toggle/chips are pressed-button groups, tabs are a
// real tablist (arrow keys, roving tabindex, aria-controls), steps carry aria-current.
export type SegmentedVariant = 'toggle' | 'tabs' | 'steps' | 'chips'

export interface SegmentedOption<V extends string> {
  value: V
  label: ReactNode
  disabled?: boolean
  /** Small trailing badge (a count, a "tie" pill). */
  badge?: ReactNode
  title?: string
}

type SegmentedProps<V extends string> = {
  options: readonly SegmentedOption<V>[]
  ariaLabel: string
  size?: 'sm' | 'md'
  /** tabs only: the id of the panel each tab controls, by value. */
  panelIds?: Partial<Record<V, string>>
} & (
  | { variant: SegmentedVariant; multiple?: false; value: V; onChange: (next: V) => void }
  // A tablist has exactly one selected tab, so `variant: 'tabs'` with `multiple` is not a
  // valid ARIA combination — the type excludes it rather than leaving it to review.
  | {
      variant: Exclude<SegmentedVariant, 'tabs'>
      multiple: true
      value: readonly V[]
      onChange: (next: V[]) => void
    }
)

export default function Segmented<V extends string>(props: SegmentedProps<V>) {
  const { variant, options, ariaLabel, size = 'md', panelIds } = props
  // Ids come from useId, not the label: two groups can legitimately share a label on one
  // page, and a value may contain characters an id cannot.
  const idBase = useId()
  const tabId = (value: V) => `${idBase}-tab-${encodeURIComponent(value)}`

  const isOn = (value: V): boolean =>
    props.multiple ? props.value.includes(value) : props.value === value

  const select = (value: V) => {
    if (props.multiple) {
      const current = props.value
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      // Consumers get a canonical order (the options' own) rather than click order, so
      // URL params and equality checks stay stable.
      props.onChange(options.filter((o) => next.includes(o.value)).map((o) => o.value))
    } else {
      props.onChange(value)
    }
  }

  // Tabs move with the arrow keys and wrap; the active tab is the only one in the tab order
  // (WAI-ARIA tabs pattern). Disabled tabs are skipped.
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (variant !== 'tabs' || props.multiple) return
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const enabled = options.filter((o) => !o.disabled)
    if (enabled.length === 0) return
    const position = enabled.findIndex((o) => o.value === options[index].value)
    const step = event.key === 'ArrowRight' ? 1 : -1
    const next = enabled[(position + step + enabled.length) % enabled.length]
    props.onChange(next.value)
    document.getElementById(tabId(next.value))?.focus()
  }

  // Roving tabindex needs exactly one tab in the page's tab order. The selected tab claims
  // it, but when it is disabled — or when `value` is stale and matches no option — the
  // first enabled tab takes over, so the tablist can never fall out of reach.
  const focusable =
    options.find((o) => !o.disabled && isOn(o.value))?.value ??
    options.find((o) => !o.disabled)?.value

  const role = variant === 'tabs' ? 'tablist' : 'group'
  const className = ['segmented', `segmented-${variant}`, size === 'sm' ? 'segmented-sm' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} role={role} aria-label={ariaLabel}>
      {options.map((option, index) => {
        const on = isOn(option.value)
        // The key stays off this object: React 19 warns when a key is spread in with the rest
        // of the props, so each branch passes it directly.
        const common = {
          type: 'button' as const,
          className: on ? 'active' : undefined,
          disabled: option.disabled,
          title: option.title,
          onClick: () => select(option.value),
        }
        if (variant === 'tabs') {
          return (
            <button
              key={option.value}
              {...common}
              id={tabId(option.value)}
              role="tab"
              aria-selected={on}
              aria-controls={panelIds?.[option.value]}
              tabIndex={option.value === focusable ? 0 : -1}
              onKeyDown={(event) => onTabKey(event, index)}
            >
              {option.label}
              {option.badge !== undefined && <span className="segmented-badge">{option.badge}</span>}
            </button>
          )
        }
        return (
          <button
            key={option.value}
            {...common}
            aria-pressed={variant === 'steps' ? undefined : on}
            aria-current={variant === 'steps' && on ? 'step' : undefined}
          >
            {option.label}
            {option.badge !== undefined && <span className="segmented-badge">{option.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
