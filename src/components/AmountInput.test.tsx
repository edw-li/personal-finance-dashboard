import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import AmountInput from './AmountInput'
import type { AmountKind } from './AmountInput'

afterEach(cleanup)

// The component is controlled; every test drives it through real parent state.
function Harness({ initial, kind }: { initial: string; kind?: AmountKind }) {
  const [value, setValue] = useState(initial)
  return <AmountInput aria-label="Amount" value={value} onValueChange={setValue} kind={kind} />
}

const box = () => screen.getByLabelText('Amount') as HTMLInputElement

it('shows the formatted echo while blurred and the raw state while focused', () => {
  render(<Harness initial="1500.00" />)
  expect(box().value).toBe('$1,500.00')
  fireEvent.focus(box())
  expect(box().value).toBe('1500.00')
  fireEvent.blur(box())
  expect(box().value).toBe('$1,500.00')
})

it('formats per kind', () => {
  render(<Harness initial="12.345678" kind="shares" />)
  expect(box().value).toBe('12.345678')
  cleanup()
  render(<Harness initial="13" kind="percent" />)
  expect(box().value).toBe('13%')
  cleanup()
  render(<Harness initial="2" kind="plain" />)
  expect(box().value).toBe('2')
})

it('selects all on focus (type-to-replace)', () => {
  render(<Harness initial="1500.00" />)
  fireEvent.focus(box())
  expect(box().selectionStart).toBe(0)
  expect(box().selectionEnd).toBe('1500.00'.length)
})

it('canonicalizes tolerant text on blur', () => {
  render(<Harness initial="" />)
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value: '$1,600' } })
  fireEvent.blur(box())
  expect(box().value).toBe('$1,600.00') // state '1600', blurred echo formats it
  fireEvent.focus(box())
  expect(box().value).toBe('1600') // the canonical state, raw
})

it('evaluates =-expressions on blur (money kind)', () => {
  render(<Harness initial="" />)
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value: '=1200+34.56' } })
  fireEvent.blur(box())
  fireEvent.focus(box())
  expect(box().value).toBe('1234.56')
})

it('refuses =-expressions on non-money kinds — "=1/8" must never 2dp-round into a shares column', () => {
  render(<Harness initial="" kind="shares" />)
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value: '=1/8' } })
  fireEvent.blur(box())
  expect(box().value).toBe('=1/8') // verbatim, uncommitted
  expect(box().getAttribute('aria-invalid')).toBe('true')
})

it('leaves unparseable text verbatim and flags aria-invalid', () => {
  render(<Harness initial="" />)
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value: 'abc' } })
  fireEvent.blur(box())
  expect(box().value).toBe('abc')
  expect(box().getAttribute('aria-invalid')).toBe('true')
})

it('never flags a blank as invalid', () => {
  render(<Harness initial="" />)
  expect(box().getAttribute('aria-invalid')).toBeNull()
})

it('Escape restores the value the field had on focus', () => {
  render(<Harness initial="1500.00" />)
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value: '9' } })
  fireEvent.keyDown(box(), { key: 'Escape' })
  expect(box().value).toBe('1500.00')
})

// A parent that COUNTS writes. Upstream, every onValueChange marks the draft dirty (and
// some setters do more), so "how many times" is itself part of the contract, not just
// "what value" — these tests would pass on a component that writes a no-op change.
function CountingHarness({ initial, onWrite }: { initial: string; onWrite: () => void }) {
  const [value, setValue] = useState(initial)
  return (
    <AmountInput
      aria-label="Amount"
      value={value}
      onValueChange={(next) => {
        onWrite()
        setValue(next)
      }}
    />
  )
}

it('an untouched focus+blur writes nothing (draft-dirt guarantee, component half)', () => {
  let writes = 0
  render(<CountingHarness initial="1500.00" onWrite={() => (writes += 1)} />)
  fireEvent.focus(box())
  fireEvent.blur(box())
  expect(writes).toBe(0)
})

it('Escape on an untouched cell is left to the container', () => {
  let writes = 0
  render(<CountingHarness initial="1500.00" onWrite={() => (writes += 1)} />)
  fireEvent.focus(box())
  // Not consumed: a parent modal's Escape-to-close must still see it.
  expect(fireEvent.keyDown(box(), { key: 'Escape' })).toBe(true)
  expect(writes).toBe(0)
})

it('Escape that actually reverts consumes the event', () => {
  render(<Harness initial="1500.00" />)
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value: '9' } })
  // fireEvent returns false when preventDefault was called: the cancelled edit is OURS,
  // it must not also close the dialog around us.
  expect(fireEvent.keyDown(box(), { key: 'Escape' })).toBe(false)
  expect(box().value).toBe('1500.00')
})

it('a reverting Escape is withheld from the container; an untouched one reaches it', () => {
  let seen = 0
  function ModalHarness() {
    const [value, setValue] = useState('1500.00')
    return (
      <div onKeyDown={() => (seen += 1)}>
        <AmountInput aria-label="Amount" value={value} onValueChange={setValue} />
      </div>
    )
  }
  render(<ModalHarness />)
  fireEvent.focus(box())
  fireEvent.keyDown(box(), { key: 'Escape' })
  expect(seen).toBe(1) // untouched: the container's Escape-to-close still fires
  fireEvent.change(box(), { target: { value: '9' } })
  fireEvent.keyDown(box(), { key: 'Escape' })
  expect(seen).toBe(1) // the revert is ours — the dialog around us must not also close
})

it('Escape reselects the restored value after the microtask', async () => {
  render(<Harness initial="1500.00" />)
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value: '9' } })
  fireEvent.keyDown(box(), { key: 'Escape' })
  await Promise.resolve() // the reselect is queued as a microtask, after React's flush
  expect(box().value).toBe('1500.00')
  expect(box().selectionStart).toBe(0)
  expect(box().selectionEnd).toBe('1500.00'.length)
})

it('autoFocus mounts focused, raw, and fully selected', () => {
  function AutoHarness() {
    const [value, setValue] = useState('1500.00')
    return <AmountInput autoFocus aria-label="Amount" value={value} onValueChange={setValue} />
  }
  render(<AutoHarness />)
  expect(document.activeElement).toBe(box())
  expect(box().value).toBe('1500.00') // raw, not the '$1,500.00' echo
  expect(box().selectionStart).toBe(0)
  expect(box().selectionEnd).toBe('1500.00'.length)
})

it('keeps the focus select-all through the click that focused the field', () => {
  render(<Harness initial="1500.00" />)
  expect(fireEvent.mouseUp(box())).toBe(true) // unfocused: no selection to protect
  // The real click order: mousedown lands while the field is still UNfocused (so it cannot
  // disarm the guard), focus arms it, and the mouseup that completes the click is swallowed.
  fireEvent.mouseDown(box())
  fireEvent.focus(box())
  expect(fireEvent.mouseUp(box())).toBe(false)
  // Click-then-click on an already-focused field places the caret, like a spreadsheet.
  expect(fireEvent.mouseUp(box())).toBe(true)
  fireEvent.blur(box())
  expect(fireEvent.mouseUp(box())).toBe(true)
  fireEvent.mouseDown(box())
  fireEvent.focus(box())
  expect(fireEvent.mouseUp(box())).toBe(false) // every refocus re-arms the guard
})

it('a click on an ALREADY-focused field positions the caret normally', () => {
  render(<Harness initial="1500.00" />)
  // A REAL .focus(), not fireEvent.focus: this test turns on document.activeElement, and
  // fireEvent.focus only dispatches the event — it never moves focus.
  box().focus()
  // The mousedown of a click on a focused field disarms the one-shot guard…
  fireEvent.mouseDown(box())
  // …so its mouseup is NOT prevented and the browser may place the caret. Without this,
  // a keyboard (Tab) focus would leave the guard armed until some later, unrelated click.
  expect(fireEvent.mouseUp(box())).toBe(true)
})

it('only the left button drives the select guard', () => {
  render(<Harness initial="1500.00" />)
  box().focus()
  // A right-click must neither disarm the one-shot (its mousedown) nor be swallowed (its
  // mouseup opens the context menu) — the still-pending left click has a selection to keep.
  fireEvent.mouseDown(box(), { button: 2 })
  expect(fireEvent.mouseUp(box(), { button: 2 })).toBe(true)
  expect(fireEvent.mouseUp(box())).toBe(false)
})

it('a half-typed percent echoes without the orphan point', () => {
  render(<Harness initial="13." kind="percent" />)
  expect(box().value).toBe('13%') // display-only: the state stays the verbatim '13.'
  fireEvent.focus(box())
  expect(box().value).toBe('13.')
})

// ─── The data-entry-scope keyboard protocol (spec §3.4) ──────────────────────────────
// `primaryDisabled` is the only addition to the planned harness: it feeds the dead-end
// pin below without a second near-identical copy of this markup.
function ScopeHarness({
  onPrimary,
  primaryDisabled,
}: {
  onPrimary?: () => void
  primaryDisabled?: boolean
}) {
  const [a, setA] = useState('1.00')
  const [b, setB] = useState('2.00')
  return (
    <div data-entry-scope="">
      <AmountInput aria-label="First" value={a} onValueChange={setA} />
      <AmountInput aria-label="Second" value={b} onValueChange={setB} />
      <button type="button" data-entry-primary="" disabled={primaryDisabled} onClick={onPrimary}>
        Next step
      </button>
    </div>
  )
}

// A scope whose middle cell is disabled — the case that stalls a naive index walk.
function DisabledCellHarness() {
  const [a, setA] = useState('1.00')
  const [c, setC] = useState('3.00')
  return (
    <div data-entry-scope="">
      <AmountInput aria-label="First" value={a} onValueChange={setA} />
      <AmountInput aria-label="Middle" value="2.00" onValueChange={() => {}} disabled />
      <AmountInput aria-label="Last" value={c} onValueChange={setC} />
      <button type="button" data-entry-primary="">
        Next step
      </button>
    </div>
  )
}

const first = () => screen.getByLabelText('First') as HTMLInputElement
const second = () => screen.getByLabelText('Second') as HTMLInputElement
const last = () => screen.getByLabelText('Last') as HTMLInputElement

it('Enter advances to the next cell; Shift+Enter goes back', () => {
  render(<ScopeHarness />)
  first().focus()
  fireEvent.keyDown(first(), { key: 'Enter' })
  expect(document.activeElement).toBe(second())
  fireEvent.keyDown(second(), { key: 'Enter', shiftKey: true })
  expect(document.activeElement).toBe(first())
})

it('ArrowDown/ArrowUp traverse like Enter', () => {
  render(<ScopeHarness />)
  first().focus()
  fireEvent.keyDown(first(), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(second())
  fireEvent.keyDown(second(), { key: 'ArrowUp' })
  expect(document.activeElement).toBe(first())
})

it('a modified arrow is left to the browser (Shift+ArrowDown selects, it does not traverse)', () => {
  render(<ScopeHarness />)
  first().focus()
  expect(fireEvent.keyDown(first(), { key: 'ArrowDown', shiftKey: true })).toBe(true)
  expect(document.activeElement).toBe(first())
})

it('a chorded Enter does not traverse (Alt+Enter is the platform’s, not ours)', () => {
  render(<ScopeHarness />)
  first().focus()
  expect(fireEvent.keyDown(first(), { key: 'Enter', altKey: true })).toBe(true)
  expect(document.activeElement).toBe(first())
})

it('traversal skips a disabled cell instead of stalling on it', () => {
  render(<DisabledCellHarness />)
  first().focus()
  fireEvent.keyDown(first(), { key: 'Enter' })
  expect(document.activeElement).toBe(last())
  fireEvent.keyDown(last(), { key: 'Enter', shiftKey: true })
  expect(document.activeElement).toBe(first())
})

it('an Enter confirming an IME composition does not traverse', () => {
  render(<ScopeHarness />)
  first().focus()
  fireEvent.keyDown(first(), { key: 'Enter', isComposing: true })
  expect(document.activeElement).toBe(first())
})

it('Enter on the last cell focuses the primary action', () => {
  render(<ScopeHarness />)
  second().focus()
  fireEvent.keyDown(second(), { key: 'Enter' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next step' }))
})

it('a disabled primary is a dead end: focus stays on the last cell', () => {
  // The decided behavior, not an accident of focus(): the wizard's Next disables while the
  // step is invalid, and Enter must not fling focus to somewhere arbitrary.
  render(<ScopeHarness primaryDisabled />)
  second().focus()
  fireEvent.keyDown(second(), { key: 'Enter' })
  expect(document.activeElement).toBe(second())
})

it('Ctrl+Enter and Ctrl+S click the primary action from any cell', () => {
  let clicks = 0
  render(<ScopeHarness onPrimary={() => (clicks += 1)} />)
  first().focus()
  fireEvent.keyDown(first(), { key: 'Enter', ctrlKey: true })
  fireEvent.keyDown(first(), { key: 's', ctrlKey: true })
  expect(clicks).toBe(2)
})

it('Ctrl+Shift+S belongs to the browser (Edge Web Capture / Firefox screenshot), not to save', () => {
  let clicks = 0
  render(<ScopeHarness onPrimary={() => (clicks += 1)} />)
  first().focus()
  expect(fireEvent.keyDown(first(), { key: 's', ctrlKey: true, shiftKey: true })).toBe(true)
  expect(clicks).toBe(0)
})

it('Ctrl+Enter with a disabled primary is a no-op', () => {
  let clicks = 0
  render(<ScopeHarness primaryDisabled onPrimary={() => (clicks += 1)} />)
  first().focus()
  fireEvent.keyDown(first(), { key: 'Enter', ctrlKey: true })
  expect(clicks).toBe(0) // click() on a disabled control dispatches nothing — no half-submit
})

it('commits the edited cell when Enter moves focus away', () => {
  // Real .focus() throughout: fireEvent.focus dispatches the event without moving
  // activeElement, and this test needs jsdom's genuine focus transfer — the traversal's
  // second().focus() is what blurs first(), and that blur is what commits.
  render(<ScopeHarness />)
  first().focus()
  fireEvent.change(first(), { target: { value: '$1,600' } })
  fireEvent.keyDown(first(), { key: 'Enter' })
  expect(document.activeElement).toBe(second())
  // act(): a bare .focus() only QUEUES the focused re-render here, and it is precisely the
  // echo → raw swap that exposes the committed state.
  act(() => first().focus())
  expect(first().value).toBe('1600') // canonical, so the traversal really did commit
})

it('outside a scope, Enter is left to native implicit submission', () => {
  let submitted = 0
  function RowForm() {
    const [v, setV] = useState('')
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submitted += 1
        }}
      >
        <AmountInput aria-label="Amount" value={v} onValueChange={setV} />
        <button type="submit">Add</button>
      </form>
    )
  }
  render(<RowForm />)
  // jsdom does not run implicit submission itself; the contract under test is that the
  // component did NOT preventDefault outside a scope.
  const event = fireEvent.keyDown(box(), { key: 'Enter' })
  expect(event).toBe(true) // fireEvent returns false when preventDefault was called
  expect(submitted).toBe(0)
})
