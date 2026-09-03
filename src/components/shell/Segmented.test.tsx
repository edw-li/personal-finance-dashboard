import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Segmented from './Segmented'

afterEach(cleanup)

const OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '1y', label: '1Y' },
  { value: 'ytd', label: 'YTD' },
] as const

describe('Segmented', () => {
  it('toggle: a group of pressed buttons, one active', () => {
    const onChange = vi.fn()
    render(<Segmented variant="toggle" ariaLabel="Time range" options={OPTIONS} value="1y" onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'Time range' })
    expect(group).toBeTruthy()
    expect(screen.getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'YTD' }))
    expect(onChange).toHaveBeenCalledWith('ytd')
  })

  it('tabs: a tablist whose tabs control panels and move with arrow keys', () => {
    const onChange = vi.fn()
    render(
      <Segmented
        variant="tabs"
        ariaLabel="Portfolio records"
        options={[{ value: 'tx', label: 'Transactions' }, { value: 'div', label: 'Dividends' }]}
        value="tx"
        onChange={onChange}
        panelIds={{ tx: 'panel-tx', div: 'panel-div' }}
      />,
    )
    expect(screen.getByRole('tablist', { name: 'Portfolio records' })).toBeTruthy()
    const tx = screen.getByRole('tab', { name: 'Transactions' })
    expect(tx.getAttribute('aria-selected')).toBe('true')
    expect(tx.getAttribute('aria-controls')).toBe('panel-tx')
    expect(tx.getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('tab', { name: 'Dividends' }).getAttribute('tabindex')).toBe('-1')
    fireEvent.keyDown(tx, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('div')
    fireEvent.keyDown(tx, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('div') // wraps from first to last
  })

  it('steps: the active step carries aria-current', () => {
    render(
      <Segmented
        variant="steps"
        ariaLabel="Wizard"
        options={[{ value: 'a', label: '1 Balances' }, { value: 'b', label: '2 Spending' }]}
        value="b"
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '2 Spending' }).getAttribute('aria-current')).toBe('step')
    expect(screen.getByRole('button', { name: '1 Balances' }).hasAttribute('aria-current')).toBe(false)
  })

  it('chips with multiple: toggles membership and returns the new array', () => {
    const onChange = vi.fn()
    render(
      <Segmented
        variant="chips"
        ariaLabel="Accounts"
        multiple
        options={[{ value: 'a', label: 'Checking' }, { value: 'b', label: 'HYSA' }]}
        value={['a']}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'HYSA' }))
    expect(onChange).toHaveBeenCalledWith(['a', 'b'])
    fireEvent.click(screen.getByRole('button', { name: 'Checking' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('disabled options render disabled and never fire', () => {
    const onChange = vi.fn()
    render(
      <Segmented
        variant="toggle"
        ariaLabel="X"
        options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }]}
        value="a"
        onChange={onChange}
      />,
    )
    const b = screen.getByRole('button', { name: 'B' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    fireEvent.click(b)
    expect(onChange).not.toHaveBeenCalled()
  })
})
