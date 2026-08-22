import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
