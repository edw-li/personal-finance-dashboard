import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GuideCard from './GuideCard'
import { FIXTURE_GUIDE } from './testing/fixtures'

afterEach(cleanup)

const pageCard = FIXTURE_GUIDE[2].cards[0]         // page-example: 1 visible task, 2 folded, 2 card watch lines
const numberedCard = FIXTURE_GUIDE[1].cards[1]     // routine-checklist: numbered, 2 tasks
const proseCard = FIXTURE_GUIDE[0].cards[0]        // start-what: no tasks

function renderCard(card = pageCard, entry = '/guide?section=pages') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <GuideCard card={card} />
    </MemoryRouter>,
  )
}

const rail = () => screen.getByRole('tablist', { name: 'Tasks on Example' })
const detail = () => document.querySelector('.guide-detail') as HTMLElement

describe('GuideCard (master–detail)', () => {
  it('renders head, purpose, views and Open link, then a rail beside a detail', () => {
    renderCard()
    const card = document.getElementById('page-example') as HTMLElement
    expect(within(card).getByRole('heading', { level: 2, name: 'Example' })).toBeTruthy()
    expect(within(card).getByText('An example page.')).toBeTruthy()
    expect(within(card).getByText('Views: Overview · Accounts')).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Open Example →' }).getAttribute('href')).toBe('/net-worth')
    expect(card.querySelector('.guide-md .guide-rail-col .guide-rail')).toBeTruthy()
    expect(card.querySelector('.guide-md .guide-detail-col .guide-detail')).toBeTruthy()
    expect(rail().getAttribute('aria-orientation')).toBe('vertical')
  })

  it('rows keep the task ids, the first visible task is selected, and the detail shows it', () => {
    renderCard()
    const row = document.getElementById('example-add') as HTMLElement
    expect(row.getAttribute('role')).toBe('tab')
    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(row.textContent).toContain('Add an example')
    expect(row.textContent).toContain('Accounts → Example roster')
    expect(detail().getAttribute('role')).toBe('tabpanel')
    expect(detail().getAttribute('aria-labelledby')).toBe('example-add')
    expect(row.getAttribute('aria-controls')).toBe(detail().id)
    expect(within(detail()).getByRole('heading', { level: 4, name: 'Add an example' })).toBeTruthy()
    const steps = Array.from(detail().querySelectorAll('ol.guide-steps > li')).map((li) => li.textContent)
    expect(steps).toEqual(['Open Accounts.', 'Press Add example.'])
    expect(detail().querySelectorAll('b.guide-label')).toHaveLength(2)
    expect(within(detail()).getByText('Blank means not entered — it is never a zero.')).toBeTruthy()
    expect(within(detail()).getByRole('link', { name: 'Go →' }).getAttribute('href')).toBe('/net-worth?section=accounts')
  })

  it('renders the card-level Watch out in the detail column', () => {
    renderCard()
    const col = document.querySelector('.guide-detail-col') as HTMLElement
    expect(within(col).getByRole('heading', { level: 3, name: 'Watch out' })).toBeTruthy()
    expect(within(col).getByText('The example is entered as a negative number — a positive one inflates the total.')).toBeTruthy()
    // A watch line goes through renderSteps too, so a trap can name the control it is about.
    expect(col.querySelector('ul.guide-watch b.guide-label')?.textContent).toBe('Example')
  })

  it('folds the long tail behind a More row that expands in place, and selecting a folded row shows it', () => {
    renderCard()
    const more = screen.getByRole('button', { name: 'More tasks (2)' })
    const fold = document.getElementById('page-example-fold') as HTMLElement
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(fold.getAttribute('data-open')).toBe('false')
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(fold.getAttribute('data-open')).toBe('true')
    expect(screen.getByRole('button', { name: 'Fewer tasks' })).toBeTruthy()
    fireEvent.click(document.getElementById('example-export') as HTMLElement)
    expect(document.getElementById('example-export')?.getAttribute('aria-selected')).toBe('true')
    expect(within(detail()).getByRole('heading', { level: 4, name: 'Export the example' })).toBeTruthy()
  })

  it('a hash naming a folded task selects it and opens the fold on arrival', () => {
    renderCard(pageCard, '/guide?section=pages#example-table')
    expect(document.getElementById('page-example-fold')?.getAttribute('data-open')).toBe('true')
    expect(document.getElementById('example-table')?.getAttribute('aria-selected')).toBe('true')
    expect(within(detail()).getByRole('heading', { level: 4, name: 'Show the table' })).toBeTruthy()
  })

  it('arrow keys move the selection and Home/End jump', () => {
    renderCard(numberedCard, '/guide?section=routines')
    const first = document.getElementById('checklist-open') as HTMLElement
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.getElementById('checklist-after')?.getAttribute('aria-selected')).toBe('true')
    expect(within(detail()).getByRole('heading', { level: 4, name: 'Look afterwards' })).toBeTruthy()
    fireEvent.keyDown(document.getElementById('checklist-after') as HTMLElement, { key: 'Home' })
    expect(first.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(first, { key: 'End' })
    expect(document.getElementById('checklist-after')?.getAttribute('aria-selected')).toBe('true')
  })

  it('keeps one tab stop in the rail: the first visible row when the selected one is folded away', () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'More tasks (2)' }))
    fireEvent.click(document.getElementById('example-export') as HTMLElement)
    expect(document.getElementById('example-export')?.getAttribute('tabindex')).toBe('0')
    fireEvent.click(screen.getByRole('button', { name: 'Fewer tasks' }))
    // The shut fold is aria-hidden, so its rows leave the tab order even though one is selected.
    expect(document.getElementById('example-export')?.getAttribute('tabindex')).toBe('-1')
    expect(document.getElementById('example-add')?.getAttribute('tabindex')).toBe('0')
  })

  // The rail is its own scroller (max-height 70vh): focus with preventScroll holds the PAGE
  // still, so the row itself has to be brought into the rail's view.
  it('brings the row an arrow key lands on into the rail\u2019s view', () => {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
    try {
      renderCard(numberedCard, '/guide?section=routines')
      fireEvent.keyDown(document.getElementById('checklist-open') as HTMLElement, { key: 'ArrowDown' })
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
      expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('checklist-after'))
    } finally {
      if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original)
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('a numbered card shows 1-based numbers on its rows', () => {
    renderCard(numberedCard, '/guide?section=routines')
    expect(Array.from(document.querySelectorAll('.guide-rail-num')).map((n) => n.textContent)).toEqual(['1', '2'])
  })

  it('a prose card renders body and no rail, Open link or detail', () => {
    renderCard(proseCard, '/guide')
    const card = document.getElementById('start-what') as HTMLElement
    expect(card.querySelector('.guide-md')).toBeNull()
    expect(within(card).queryByRole('tablist')).toBeNull()
    expect(within(card).queryByRole('link')).toBeNull()
  })
})
