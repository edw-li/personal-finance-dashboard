import type { ButtonHTMLAttributes, Ref } from 'react'
import BusyButton from './BusyButton'
import type { SaveState } from './useSaveState'

export type SaveButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  state: SaveState
  /** React 19 ref-as-prop, passed through to the BusyButton. */
  ref?: Ref<HTMLButtonElement>
}

/**
 * A form's primary Save (2026-09-25 polish spec D3; contract C3): a BusyButton that is busy while its
 * state saves, and quiet — aria-disabled, titled "No changes to save" — while there is nothing to save:
 * the form is clean, or was just saved and not touched since. A caller's own aria-disabled (an invalid
 * form) still stands while there is something to save.
 */
export function SaveButton({ state, title, ...rest }: SaveButtonProps) {
  const nothingToSave = state.status === 'clean' || state.status === 'saved'
  return (
    <BusyButton
      {...rest}
      busy={state.status === 'saving'}
      aria-disabled={nothingToSave ? true : rest['aria-disabled']}
      title={nothingToSave ? 'No changes to save' : title}
    />
  )
}
