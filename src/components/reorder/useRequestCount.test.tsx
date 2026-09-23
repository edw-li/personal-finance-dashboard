import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useRequestCount } from './useRequestCount'

afterEach(cleanup)

interface Deferred {
  promise: Promise<string>
  resolve: (value: string) => void
  reject: (reason: unknown) => void
}

/** A request the test answers by hand. */
function deferred(): Deferred {
  let resolve: (value: string) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type Outcome = { value: string } | { reason: unknown }

/** Shows `busy`, and one button per request. A click tracks that request's `run` and hands the
 *  test what `track` gave back: the settled promise's outcome, or the error it threw at once. */
function Probe({
  runs,
  onSettled,
  onThrew,
}: {
  runs: (() => Promise<string>)[]
  onSettled: (outcome: Outcome) => void
  onThrew: (err: unknown) => void
}) {
  const { busy, track } = useRequestCount()
  const launch = (run: () => Promise<string>) => {
    let tracked: Promise<string>
    try {
      tracked = track(run)
    } catch (err) {
      onThrew(err)
      return
    }
    tracked.then(
      (value) => onSettled({ value }),
      (reason: unknown) => onSettled({ reason }),
    )
  }
  return (
    <>
      <p data-testid="busy">{busy ? 'busy' : 'idle'}</p>
      {runs.map((run, index) => (
        <button key={index} type="button" onClick={() => launch(run)}>
          {`request ${index + 1}`}
        </button>
      ))}
    </>
  )
}

function mount(runs: (() => Promise<string>)[]) {
  const settled: Outcome[] = []
  const threw: unknown[] = []
  render(
    <Probe
      runs={runs}
      onSettled={(outcome) => settled.push(outcome)}
      onThrew={(err) => threw.push(err)}
    />,
  )
  return { settled, threw }
}

const busy = () => screen.getByTestId('busy').textContent
const start = (n: number) => fireEvent.click(screen.getByRole('button', { name: `request ${n}` }))

describe('useRequestCount', () => {
  it('is idle at rest', () => {
    mount([])
    expect(busy()).toBe('idle')
  })

  it('is busy from the start of a request until it settles, and hands its answer on', async () => {
    const save = deferred()
    const { settled } = mount([() => save.promise])
    start(1)
    expect(busy()).toBe('busy')
    await act(async () => save.resolve('saved'))
    expect(busy()).toBe('idle')
    expect(settled).toEqual([{ value: 'saved' }])
  })

  it('stays busy when the first of two overlapping requests settles — a count, not a flag', async () => {
    const save = deferred()
    const undo = deferred()
    mount([() => save.promise, () => undo.promise])
    start(1)
    start(2)
    await act(async () => save.resolve('saved'))
    expect(busy()).toBe('busy')
    await act(async () => undo.resolve('restored'))
    expect(busy()).toBe('idle')
  })

  it('counts a request that fails back down, and its failure still reaches the caller', async () => {
    const save = deferred()
    const { settled } = mount([() => save.promise])
    start(1)
    const failure = new Error('offline')
    await act(async () => save.reject(failure))
    expect(busy()).toBe('idle')
    expect(settled).toEqual([{ reason: failure }])
  })

  it('a run that throws before it returns a promise leaves the count balanced and rethrows', async () => {
    const failure = new Error('threw at once')
    const later = deferred()
    const { threw } = mount([
      () => {
        throw failure
      },
      () => later.promise,
    ])
    start(1)
    expect(threw).toEqual([failure])
    expect(busy()).toBe('idle')
    // Balanced, not merely hidden: a later request still counts back down to idle.
    start(2)
    expect(busy()).toBe('busy')
    await act(async () => later.resolve('saved'))
    expect(busy()).toBe('idle')
  })
})
