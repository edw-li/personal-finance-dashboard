import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { HouseholdOut, PersonOut } from '../../types/api'
import HouseholdCard from './HouseholdCard'

vi.mock('../../api/household', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/household')>()),
  fetchHousehold: vi.fn(),
  createPerson: vi.fn(),
  updatePerson: vi.fn(),
  putMarriageDate: vi.fn(),
}))
import { createPerson, fetchHousehold, putMarriageDate, updatePerson } from '../../api/household'

const ME: PersonOut = { id: 1, name: 'Me', is_primary: true }
const PARTNER: PersonOut = { id: 2, name: 'Partner', is_primary: false }

function household(over: Partial<HouseholdOut> = {}): HouseholdOut {
  return { people: [ME], marriage_date: null, ...over }
}

beforeEach(() => {
  vi.mocked(fetchHousehold).mockResolvedValue(household())
  vi.mocked(createPerson).mockResolvedValue(PARTNER)
  vi.mocked(updatePerson).mockResolvedValue({ ...ME, name: 'Ed' })
  vi.mocked(putMarriageDate).mockResolvedValue({ marriage_date: '2026-09-19' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('lists the household, marks the primary member and seeds the date box', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(
    household({ people: [ME, PARTNER], marriage_date: '2026-09-19' }),
  )
  const onPeopleChange = vi.fn()
  render(<HouseholdCard onPeopleChange={onPeopleChange} />)

  expect(await screen.findByText('Me')).toBeTruthy()
  expect(screen.getByText('Partner')).toBeTruthy()
  // Primary is a badge, not a control: the flag never moves for the life of the database.
  expect(screen.getByText('Primary')).toBeTruthy()
  expect((screen.getByLabelText('Marriage date') as HTMLInputElement).value).toBe('2026-09-19')
  // Lifted to the page so the Accounts card's owner select is never a render behind this
  // one: a partner added here must be selectable there without a reload.
  await waitFor(() => expect(onPeopleChange).toHaveBeenCalledWith([ME, PARTNER]))
})

it('adds a member on the trimmed name and refetches', async () => {
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  await screen.findByText('Me')

  fireEvent.change(screen.getByLabelText('Add a household member'), {
    target: { value: '  Partner  ' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add member' }))

  await waitFor(() => expect(vi.mocked(createPerson)).toHaveBeenCalledWith('Partner'))
  // The list is re-read rather than patched locally: the server owns the ordering
  // (primary first, then by id).
  await waitFor(() => expect(vi.mocked(fetchHousehold)).toHaveBeenCalledTimes(2))
})

it('renames a member through the inline editor', async () => {
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  await screen.findByText('Me')

  fireEvent.click(screen.getByRole('button', { name: 'Rename Me' }))
  fireEvent.change(screen.getByLabelText('New name for Me'), { target: { value: 'Ed' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

  await waitFor(() => expect(vi.mocked(updatePerson)).toHaveBeenCalledWith(1, 'Ed'))
  await waitFor(() => expect(vi.mocked(fetchHousehold)).toHaveBeenCalledTimes(2))
})

it('saves the marriage date and sends an explicit null when cleared', async () => {
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  await screen.findByLabelText('Marriage date')

  fireEvent.change(screen.getByLabelText('Marriage date'), { target: { value: '2026-09-19' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save marriage date' }))
  await waitFor(() => expect(vi.mocked(putMarriageDate)).toHaveBeenCalledWith('2026-09-19'))
  expect(await screen.findByText(/^Saved/)).toBeTruthy()

  vi.mocked(putMarriageDate).mockResolvedValue({ marriage_date: null })
  fireEvent.change(screen.getByLabelText('Marriage date'), { target: { value: '' } })
  // The sentence describes the date that WAS saved — the next keystroke moves on.
  expect(screen.queryByText(/^Saved/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Save marriage date' }))
  await waitFor(() => expect(vi.mocked(putMarriageDate)).toHaveBeenLastCalledWith(null))
})

it('renders a rejected add verbatim and keeps the typed name', async () => {
  vi.mocked(createPerson).mockRejectedValue(new ApiError("person 'Partner' already exists", 409))
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  await screen.findByText('Me')

  const box = screen.getByLabelText('Add a household member') as HTMLInputElement
  fireEvent.change(box, { target: { value: 'Partner' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add member' }))

  // The server's own sentence: it names the row that collided, which no client-side
  // paraphrase does.
  expect(await screen.findByText("person 'Partner' already exists")).toBeTruthy()
  expect(box.value).toBe('Partner')
})

it('banners a failed load and refetches on Retry', async () => {
  vi.mocked(fetchHousehold)
    .mockRejectedValueOnce(new ApiError('household unavailable', 503))
    .mockResolvedValue(household())
  render(<HouseholdCard onPeopleChange={vi.fn()} />)

  expect(
    await screen.findByText("Couldn't load the household — the server had a problem (HTTP 503)"),
  ).toBeTruthy()
  // A first load that failed knows nothing about the household — no forms are offered.
  expect(screen.queryByLabelText('Marriage date')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retry loading the household' }))
  expect(await screen.findByLabelText('Marriage date')).toBeTruthy()
  expect(vi.mocked(fetchHousehold)).toHaveBeenCalledTimes(2)
})

it('renders a validation error inline with no Retry beside it (motion spec §9)', async () => {
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  await screen.findByText('Me')
  fireEvent.submit(screen.getByRole('button', { name: 'Add member' }).closest('form')!)

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Enter a name for the new household member.')
  // Retry re-runs the FETCH: here it would invite a re-send of a form the client refused.
  expect(within(alert).queryByRole('button')).toBeNull()
})

it('is a span-4 card: a two-field form beside the wide categories table (2026-09-13 spec §7)', async () => {
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  await screen.findByRole('button', { name: 'Add member' })
  expect((document.getElementById('household') as HTMLElement).classList.contains('span-4')).toBe(true)
})


it('keeps the saved form quiet without removing its Save control from the tab order', async () => {
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  const save = await screen.findByRole('button', { name: 'Save marriage date' })
  expect(save.getAttribute('aria-disabled')).toBe('true')
  expect(save.hasAttribute('disabled')).toBe(false)
})

it('selects an inline rename and Escape restores its Rename button without leaking its error', async () => {
  vi.mocked(updatePerson).mockRejectedValueOnce(new ApiError('Name is taken', 409))
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Rename Me' }))
  const box = screen.getByLabelText('New name for Me') as HTMLInputElement
  expect(document.activeElement).toBe(box)
  expect(box.selectionStart).toBe(0)
  expect(box.selectionEnd).toBe(2)
  fireEvent.change(box, { target: { value: 'Partner' } })
  fireEvent.submit(box.closest('form')!)
  expect(await screen.findByText('Name is taken')).toBeTruthy()
  fireEvent.keyDown(box, { key: 'Escape' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename Me' }))
  expect(screen.queryByText('Name is taken')).toBeNull()
})

it('adding a member leaves a separately edited marriage date intact', async () => {
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  const date = await screen.findByLabelText('Marriage date') as HTMLInputElement
  fireEvent.change(date, { target: { value: '2027-01-01' } })
  fireEvent.change(screen.getByLabelText('Add a household member'), { target: { value: 'Partner' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add member' }))
  await waitFor(() => expect(fetchHousehold).toHaveBeenCalledTimes(2))
  expect(date.value).toBe('2027-01-01')
  expect(screen.getByRole('button', { name: 'Save marriage date' }).getAttribute('aria-disabled')).toBeNull()
})
