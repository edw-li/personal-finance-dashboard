import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import GuideCard from './GuideCard'
import { FIXTURE_GUIDE } from './testing/fixtures'

afterEach(cleanup)

const pageCard = FIXTURE_GUIDE[2].cards[0]

function renderCard(card = pageCard) {
  return render(
    <MemoryRouter initialEntries={['/guide?section=pages']}>
      <GuideCard card={card} />
    </MemoryRouter>,
  )
}

describe('GuideCard', () => {
  it('renders the four-part grammar: purpose, views, Do this, Watch out, and an Open link', () => {
    renderCard()
    const card = document.getElementById('page-example') as HTMLElement
    expect(card.tagName).toBe('SECTION')
    expect(card.className).toContain('card')
    expect(within(card).getByRole('heading', { level: 2, name: 'Example' })).toBeTruthy()
    expect(within(card).getByText('An example page.')).toBeTruthy()
    expect(within(card).getByText('Views: Overview · Accounts')).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Open Example →' }).getAttribute('href')).toBe('/net-worth')
    expect(within(card).getByRole('heading', { level: 3, name: 'Do this' })).toBeTruthy()
    expect(within(card).getByRole('heading', { level: 3, name: 'Watch out' })).toBeTruthy()
    expect(within(card).getByText('The example is entered as a negative number — a positive one inflates the total.')).toBeTruthy()
  })

  it('renders each task with its own anchor, title, where, bold-label steps, task traps and a Go link', () => {
    renderCard()
    const task = document.getElementById('example-add') as HTMLElement
    expect(task.tagName).toBe('LI')
    expect(within(task).getByRole('heading', { level: 4, name: 'Add an example' })).toBeTruthy()
    expect(within(task).getByText('Accounts → Example roster')).toBeTruthy()
    const steps = within(task).getAllByRole('listitem').filter((li) => li.closest('ol.guide-steps'))
    expect(steps.map((li) => li.textContent)).toEqual(['Open Accounts.', 'Press Add example.'])
    expect(task.querySelectorAll('ol.guide-steps b.guide-label')).toHaveLength(2)
    expect(within(task).getByText('Blank means not entered — it is never a zero.')).toBeTruthy()
    expect(within(task).getByRole('link', { name: 'Go →' }).getAttribute('href')).toBe('/net-worth?section=accounts')
  })

  it('folds the long tail behind a Disclosure that names its count and mounts on open', () => {
    renderCard()
    const details = document.querySelector('details.guide-more') as HTMLDetailsElement
    expect(details.open).toBe(false)
    const summary = screen.getByText('More tasks (2)')
    fireEvent.click(summary)
    expect(details.open).toBe(true)
    expect(document.getElementById('example-export')).toBeTruthy()
    expect(document.getElementById('example-table')).toBeTruthy()
  })

  it('omits Open, views, Do this, Watch out and More when a card has none of them', () => {
    renderCard(FIXTURE_GUIDE[0].cards[0])
    const card = document.getElementById('start-what') as HTMLElement
    expect(within(card).queryByRole('link')).toBeNull()
    expect(within(card).queryByText(/^Views:/)).toBeNull()
    expect(within(card).queryByRole('heading', { level: 3 })).toBeNull()
    expect(card.querySelector('details')).toBeNull()
  })
})
