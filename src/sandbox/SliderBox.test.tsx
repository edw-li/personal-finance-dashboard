import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SliderBox, { snapToStep } from './SliderBox'

afterEach(cleanup)

function mount(over: Partial<Parameters<typeof SliderBox>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <SliderBox
      id="trad"
      label="Traditional 401(k)"
      kind="percent"
      value="0.15"
      actual="0.13"
      min="0"
      max="0.5"
      step="0.005"
      onChange={onChange}
      {...over}
    />,
  )
  return onChange
}

const range = () => screen.getByRole('slider', { name: 'Traditional 401(k) slider' }) as HTMLInputElement
const box = () => screen.getByLabelText('Traditional 401(k)') as HTMLInputElement

describe('SliderBox', () => {
  it('runs the slider on the fraction and the box on the percent', () => {
    mount()
    expect(range().value).toBe('0.15')
    expect(box().value).toBe('15%') // AmountInput's blurred echo of "15"
    fireEvent.focus(box())
    expect(box().value).toBe('15')
  })

  it('drag emits commit=false with a step-snapped wire value; release emits commit=true', () => {
    const onChange = mount()
    fireEvent.change(range(), { target: { value: '0.15500000000000003' } })
    expect(onChange).toHaveBeenLastCalledWith('0.155', false)
    fireEvent.mouseUp(range())
    expect(onChange).toHaveBeenLastCalledWith('0.155', true)
    fireEvent.keyDown(range(), { key: 'ArrowRight' })
    fireEvent.change(range(), { target: { value: '0.16' } })
    fireEvent.keyUp(range(), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('0.16', true)
  })

  it('the box commits on blur and Enter, shifting the percent back to the fraction', () => {
    const onChange = mount()
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '17.5' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(box())
    expect(onChange).toHaveBeenLastCalledWith('0.175', true)
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '20' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('0.2', true)
  })

  it('refuses a box value outside the track in the box’s own vocabulary, spending no change', () => {
    const onChange = mount()
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '60' } })
    fireEvent.blur(box())
    expect(screen.getByRole('alert').textContent).toBe('Traditional 401(k) must be between 0% and 50%')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: 'abc' } })
    fireEvent.blur(box())
    expect(screen.getByRole('alert').textContent).toBe('Traditional 401(k) must be a number')
  })

  it('shows the actual as a tick and a caption that resets the knob alone, plus the delta chip', () => {
    const onChange = mount()
    const tick = document.querySelector('.slider-box-tick') as HTMLElement
    expect(tick.style.left).toBe('26%') // (0.13 − 0) / 0.5
    const caption = screen.getByRole('button', { name: 'actual 13%' })
    expect(screen.getByText('+2.0 pp').className).toContain('delta-chip-positive')
    fireEvent.click(caption)
    expect(onChange).toHaveBeenCalledWith('0.13', true)
  })

  it('a not-set value sits on the actual and wears the derived badge instead of a chip', () => {
    mount({ value: '', actual: '0.06', min: '-0.5', max: '0.5', step: '0.001' })
    expect(range().value).toBe('0.06')
    expect(screen.getByText('derived')).toBeTruthy()
    expect(document.querySelector('.delta-chip')).toBeNull()
    expect(box().value).toBe('') // the echo is the placeholder, not a value
    expect(box().placeholder).toBe('6')
  })

  it('money kind: no shifting, dollar chip', () => {
    const onChange = mount({ kind: 'money', value: '250', actual: '100.00', min: '0', max: '500', step: '5' })
    expect(box().value).toBe('$250.00')
    expect(screen.getByText('+$150.00')).toBeTruthy()
    fireEvent.change(range(), { target: { value: '255.00000001' } })
    expect(onChange).toHaveBeenLastCalledWith('255', false)
  })

  it('announces the knob in the box’s vocabulary, not the raw fraction', () => {
    mount()
    // Without this a screen reader reads the range's number: "0.15" for fifteen percent.
    expect(range().getAttribute('aria-valuetext')).toBe('15%')
    fireEvent.change(range(), { target: { value: '0.155' } })
    expect(range().getAttribute('aria-valuetext')).toBe('15.5%')
    cleanup()
    mount({ kind: 'money', value: '250', actual: '100.00', min: '0', max: '500', step: '5' })
    expect(range().getAttribute('aria-valuetext')).toBe('$250.00')
  })

  it('points the box at its own error message while one is showing', () => {
    mount()
    expect(box().getAttribute('aria-describedby')).toBeNull()
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '60' } })
    fireEvent.blur(box())
    const alert = screen.getByRole('alert')
    expect(alert.id).not.toBe('')
    expect(box().getAttribute('aria-describedby')).toBe(alert.id)
  })

  // canonicalAmount is deliberately IDEMPOTENT — "+15" and "200000." come back verbatim —
  // and decimal.ts's exact arithmetic THROWS on a leading "+". Unnormalized, the box's own
  // range check was the throw site, so a perfectly ordinary keystroke took the card down
  // before any onChange fired.
  it('normalizes the spellings canonicalAmount hands back verbatim', () => {
    const onChange = mount()
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '+15' } })
    fireEvent.blur(box())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith('0.15', true)

    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '17.' } })
    fireEvent.blur(box())
    expect(onChange).toHaveBeenLastCalledWith('0.17', true)

    // ".5" is half a percent, not a refusal: the leading zero the wire grammar wants is
    // added here rather than left for the codec to drop.
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '.5' } })
    fireEvent.blur(box())
    expect(onChange).toHaveBeenLastCalledWith('0.005', true)
  })

  it('normalizes a money box the same way, and still refuses what is left', () => {
    const onChange = mount({ kind: 'money', value: '250', actual: '100.00', min: '0', max: '500', step: '5' })
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '+300.' } })
    fireEvent.blur(box())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith('300', true)

    // Nothing normalization can rescue still earns the box's OWN sentence, never a throw.
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '+' } })
    fireEvent.blur(box())
    expect(screen.getByRole('alert').textContent).toBe('Traditional 401(k) must be a number')
  })

  it('snapToStep uses the step’s own decimals', () => {
    expect(snapToStep('0.15500000000000003', '0.005')).toBe('0.155')
    expect(snapToStep('255.00000001', '5')).toBe('255')
    expect(snapToStep('-0.0500000001', '0.001')).toBe('-0.05')
  })
})
