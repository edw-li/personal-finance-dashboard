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

  it('chips with multiple: the new array comes back in options order, not click order', () => {
    // Consumers (and their URL serialisers) get one canonical order regardless of which
    // chip the user happened to hit first.
    const onChange = vi.fn()
    render(
      <Segmented
        variant="chips"
        ariaLabel="Accounts"
        multiple
        options={[{ value: 'a', label: 'Checking' }, { value: 'b', label: 'HYSA' }]}
        value={['b']}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Checking' }))
    expect(onChange).toHaveBeenCalledWith(['a', 'b'])
  })

  it('tabs: ArrowRight skips a disabled tab and focus follows to the tab it lands on', () => {
    const onChange = vi.fn()
    render(
      <Segmented
        variant="tabs"
        ariaLabel="Records"
        options={[
          { value: 'tx', label: 'Transactions' },
          { value: 'div', label: 'Dividends', disabled: true },
          { value: 'lots', label: 'Lots' },
        ]}
        value="tx"
        onChange={onChange}
      />,
    )
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Transactions' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('lots')
    // Roving tabindex means selection alone is invisible: the browser focus has to land on
    // the tab the arrow key chose, or the keyboard user has no idea where they are.
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Lots' }))
  })

  it('tabs: a value matching no option still leaves the first enabled tab reachable', () => {
    // A stale scope (deleted account, renamed range) used to make every tab tabIndex=-1,
    // dropping the whole tablist out of the tab order.
    const options: { value: string; label: string; disabled?: boolean }[] = [
      { value: 'a', label: 'A', disabled: true },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ]
    render(
      <Segmented variant="tabs" ariaLabel="Stale" options={options} value="gone" onChange={vi.fn()} />,
    )
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('tabindex')).toBe('-1')
    expect(screen.getByRole('tab', { name: 'B' }).getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('tab', { name: 'C' }).getAttribute('tabindex')).toBe('-1')
  })

  it('tabs: ids are unique across same-labelled groups and safe for values with spaces', () => {
    const options = [
      { value: 'this year', label: 'This year' },
      { value: 'last year', label: 'Last year' },
    ] as const
    render(
      <>
        <Segmented variant="tabs" ariaLabel="Window" options={options} value="this year" onChange={vi.fn()} />
        <Segmented variant="tabs" ariaLabel="Window" options={options} value="this year" onChange={vi.fn()} />
      </>,
    )
    const ids = screen.getAllByRole('tab').map((tab) => tab.id)
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4) // two groups sharing a label must not share ids
    expect(ids.every((id) => id.length > 0 && !/\s/.test(id))).toBe(true)
  })
})
