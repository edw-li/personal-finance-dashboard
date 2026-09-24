import { cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import TableScroll from './TableScroll'

afterEach(cleanup)

describe('TableScroll', () => {
  it('is a named region a keyboard can reach, around its table, keeping the old wrapper class', () => {
    render(
      <TableScroll label="Holdings table" className="holdings-scroll">
        <table>
          <thead><tr><th>Ticker</th></tr></thead>
          <tbody><tr><td>NVDA</td></tr></tbody>
        </table>
      </TableScroll>,
    )
    const box = screen.getByRole('region', { name: 'Holdings table' })
    expect(box.className).toBe('table-scroll holdings-scroll')
    expect(box.tabIndex).toBe(0)
    expect(box.querySelector(':scope > table')).toBe(screen.getByRole('table'))
  })

  it('carries only its own class when given none, or an empty one', () => {
    render(
      <>
        <TableScroll label="Accounts table">
          <table><tbody><tr><td>x</td></tr></tbody></table>
        </TableScroll>
        <TableScroll label="Rewards matrix" className="">
          <table><tbody><tr><td>y</td></tr></tbody></table>
        </TableScroll>
      </>,
    )
    expect(screen.getByRole('region', { name: 'Accounts table' }).className).toBe('table-scroll')
    expect(screen.getByRole('region', { name: 'Rewards matrix' }).className).toBe('table-scroll')
  })

  it('hands its box to a ref, with the pinned-row heights written on it', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <TableScroll label="Dividends by month" ref={ref}>
        <table>
          <thead><tr><th>a</th></tr></thead>
          <tbody><tr><td>b</td></tr></tbody>
        </table>
      </TableScroll>,
    )
    expect(ref.current).toBe(screen.getByRole('region', { name: 'Dividends by month' }))
    // jsdom lays nothing out, so both read 0px: here only their presence matters — the values are
    // tableScrollDom.test.ts's.
    expect(ref.current!.style.getPropertyValue('--table-head-h')).toBe('0px')
    expect(ref.current!.style.getPropertyValue('--table-foot-h')).toBe('0px')
  })

  // The wiring, not the values (useScrollEdges.test.ts holds those): the box asks for 'xy', which is
  // what writes the "bottom" token tableScroll.css's fade keys on — on the default 'x' a capped box
  // would never name it, and the fade would never show.
  it('names the edge still hiding rows below, not only the sideways ones', () => {
    render(
      <TableScroll label="Transactions table">
        <table><tbody><tr><td>x</td></tr></tbody></table>
      </TableScroll>,
    )
    const box = screen.getByRole('region', { name: 'Transactions table' })
    Object.defineProperty(box, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(box, 'clientHeight', { value: 400, configurable: true })
    box.dispatchEvent(new Event('scroll'))
    expect(box.getAttribute('data-scroll-more')).toBe('bottom')
  })
})
