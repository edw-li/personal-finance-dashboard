import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { pinsKey, writePins, newPin } from './pins'
import { formatEntry, isWireDecimal, lastWins, parseEntry, parseKnob } from './scenarioUrl'
import { useSandbox, type SandboxSpec } from './useSandbox'

const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../components/ToastProvider', () => ({ useToast: () => toast }))

// A two-knob scenario and a two-sided payload, standing in for a page.
interface S {
  a?: string
  b?: string
}
interface R {
  baseline: { a: string }
  scenario: { a: string | null; b: string | null }
}
const KEYS = ['a', 'b'] as const
const decode = (entries: string[]): S => {
  const knobs = lastWins(
    entries
      .map(parseEntry)
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .map((e) => parseKnob(e, KEYS, (_k, v) => isWireDecimal(v)))
      .filter((k): k is NonNullable<typeof k> => k !== null),
    (k) => k.key,
  )
  return Object.fromEntries(knobs.map((k) => [k.key, k.value])) as S
}
const encode = (s: S): string[] => KEYS.filter((k) => s[k] !== undefined).map((k) => formatEntry(k, s[k] as string))
const isEmpty = (s: S) => s.a === undefined && s.b === undefined

const preview = vi.fn<(s: S) => Promise<R>>()
function answer(s: S): R {
  return { baseline: { a: '0' }, scenario: { a: s.a ?? null, b: s.b ?? null } }
}

function Probe({ dataKey = 'k1', enabled = true }: { dataKey?: string; enabled?: boolean }) {
  const spec: SandboxSpec<S, R> = {
    page: 'paycheck',
    decode,
    encode,
    isEmpty,
    preview,
    baselineOf: (r) => ({ baseline: r.baseline, scenario: { a: r.baseline.a, b: null } }),
    dataKey,
    enabled,
    labelFor: (s) => `a ${s.a ?? '—'}`,
  }
  const sb = useSandbox(spec)
  const location = useLocation()
  const navType = useNavigationType()
  return (
    <div>
      <span data-testid="url">{location.pathname + location.search}</span>
      <span data-testid="nav">{navType}</span>
      <span data-testid="result">{sb.result === null ? 'null' : `${sb.result.scenario.a}|${sb.result.scenario.b}`}</span>
      <span data-testid="baseline">{sb.baseline === null ? 'null' : sb.baseline.baseline.a}</span>
      <span data-testid="flags">{`${sb.busy}|${sb.stale}|${sb.error ?? ''}|${sb.errorStatus ?? ''}|${sb.empty}`}</span>
      <span data-testid="pins">{sb.pins.map((p) => p.label).join(',')}</span>
      <span data-testid="pinResults">
        {sb.pins
          .map((p) => {
            const r = sb.pinResults[p.id]
            return r === 'pending' ? 'pending' : 'error' in r ? `error:${r.error}` : `ok:${r.scenario.a}`
          })
          .join(',')}
      </span>
      <span data-testid="link">{sb.link}</span>
      <button onClick={() => sb.set({ a: '1' })}>drag1</button>
      <button onClick={() => sb.set({ a: '2' })}>drag2</button>
      {/* The pointer-up after a drag whose tick already landed: the same value, committed. */}
      <button onClick={() => sb.set({ a: '1' }, { immediate: true })}>release1</button>
      <button onClick={() => sb.set({ a: '3' }, { immediate: true })}>commit3</button>
      <button onClick={() => sb.set((s) => ({ ...s, b: '9' }), { immediate: true, drop: ['whatif-lot'] })}>b9</button>
      {/* Two writers in ONE tick — a preset chip that sets two knobs through separate calls. */}
      <button
        onClick={() => {
          sb.set({ a: '4' }, { immediate: true })
          sb.set({ b: '8' }, { immediate: true })
        }}
      >
        twoSets
      </button>
      <button onClick={sb.reset}>reset</button>
      <button onClick={() => sb.pin()}>pin</button>
      <button onClick={() => sb.pin('Named')}>pinNamed</button>
      <button onClick={() => sb.unpin(sb.pins[0]?.id ?? '')}>unpin</button>
    </div>
  )
}

function mount(entry = '/paycheck', props: { dataKey?: string; enabled?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe {...props} />
    </MemoryRouter>,
  )
}

// A ONE-SIDED page (Projection): the payload carries no baseline, so the hook has to run the
// empty scenario itself — on mount when the arrival is empty, and separately once per dataKey
// when it is not. `initialBaseline` is the page's own cached empty run.
interface OneProps {
  dataKey?: string
  initialBaseline?: R | null
  onBaseline?: (baseline: R) => void
}
function OneSided({ dataKey = 'k1', initialBaseline = null, onBaseline }: OneProps) {
  const spec: SandboxSpec<S, R> = {
    page: 'projection',
    decode,
    encode,
    isEmpty,
    preview,
    dataKey,
    initialBaseline,
    onBaseline,
  }
  const sb = useSandbox(spec)
  return (
    <div>
      <span data-testid="result">{sb.result === null ? 'null' : `${sb.result.scenario.a}|${sb.result.scenario.b}`}</span>
      <span data-testid="baseline">{sb.baseline === null ? 'null' : sb.baseline.baseline.a}</span>
    </div>
  )
}

function mountOne(entry = '/projection', props: OneProps = {}) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <OneSided {...props} />
    </MemoryRouter>,
  )
}

/** The page's cached empty run — distinguishable from anything `answer` produces. */
const SEED: R = { baseline: { a: '99' }, scenario: { a: 'seed', b: null } }

const text = (id: string) => screen.getByTestId(id).textContent
const click = (name: string) => act(() => screen.getByText(name).click())
const tick = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms)
  })
const settle = () =>
  act(async () => {
    await Promise.resolve()
  })

// A promise settled by hand — to hold two flights open and choose which lands first.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  preview.mockReset()
  preview.mockImplementation(async (s) => answer(s))
  toast.info.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useSandbox', () => {
  it('runs the empty scenario once on mount for the baseline and marks empty', async () => {
    mount()
    await settle()
    expect(preview).toHaveBeenCalledTimes(1)
    expect(preview).toHaveBeenCalledWith({})
    expect(text('baseline')).toBe('0')
    expect(text('flags')).toBe('false|false|||true')
  })

  it('collapses a drag into one trailing request, written replace-style at the tick', async () => {
    mount()
    await settle()
    click('drag1')
    click('drag2')
    expect(text('url')).toBe('/paycheck') // nothing written yet
    expect(preview).toHaveBeenCalledTimes(1)
    await tick(249)
    expect(text('url')).toBe('/paycheck')
    await tick(1)
    expect(text('url')).toBe('/paycheck?whatif=a%3A2')
    expect(text('nav')).toBe('REPLACE')
    await settle()
    expect(preview).toHaveBeenCalledTimes(2)
    expect(preview).toHaveBeenLastCalledWith({ a: '2' })
    expect(text('result')).toBe('2|null')
    expect(text('flags')).toBe('false|false|||false')
  })

  it('immediate bypasses the debounce and can drop a legacy key in the same write', async () => {
    mount('/paycheck?whatif-lot=4&year=2026')
    await settle()
    click('commit3')
    expect(text('url')).toBe('/paycheck?whatif-lot=4&year=2026&whatif=a%3A3')
    click('b9')
    expect(text('url')).toBe('/paycheck?year=2026&whatif=a%3A3&whatif=b%3A9')
    await settle()
    expect(preview).toHaveBeenLastCalledWith({ a: '3', b: '9' })
  })

  it('spends ONE request on a drag, its tick and the release that follows', async () => {
    mount()
    await settle()
    expect(preview).toHaveBeenCalledTimes(1) // the mount run
    click('drag1')
    await tick(250)
    await settle()
    expect(text('url')).toBe('/paycheck?whatif=a%3A1')
    expect(preview).toHaveBeenCalledTimes(2)
    // Pointer-up commits the value the tick already wrote. The URL does not change and the
    // last run did not fail, so there is nothing to ask (spec §17: one request per window).
    click('release1')
    await settle()
    expect(preview).toHaveBeenCalledTimes(2)
  })

  it('re-commits the same URL only to retry a run that failed', async () => {
    mount()
    await settle()
    click('commit3')
    await settle()
    expect(preview).toHaveBeenCalledTimes(2)
    click('commit3') // identical URL after a SUCCESS: nothing to ask again
    await settle()
    expect(preview).toHaveBeenCalledTimes(2)
    preview.mockRejectedValueOnce(new ApiError('lot 4 already sold', 409))
    click('b9')
    await settle()
    expect(preview).toHaveBeenCalledTimes(3)
    click('b9') // identical URL after a FAILURE: the natural retry
    await settle()
    expect(preview).toHaveBeenCalledTimes(4)
    expect(text('flags')).toBe('false|false|||false')
  })

  it('drops an EMPTY whatif entry on arrival — an empty entry is not the absence of one', async () => {
    mount('/paycheck?whatif=&whatif=a%3A5')
    await settle()
    expect(text('url')).toBe('/paycheck?whatif=a%3A5')
    expect(preview).toHaveBeenCalledTimes(1)
  })

  it('composes two immediate sets made in ONE tick instead of losing the first', async () => {
    mount()
    await settle()
    click('twoSets')
    expect(text('url')).toBe('/paycheck?whatif=a%3A4&whatif=b%3A8')
    await settle()
    expect(preview).toHaveBeenLastCalledWith({ a: '4', b: '8' })
  })

  it('is busy while a run is in flight and stale until the newer run lands', async () => {
    const slow = deferred<R>()
    mount()
    await settle()
    preview.mockReturnValueOnce(slow.promise)
    click('commit3')
    expect(text('flags')).toBe('true|false|||false') // busy: no result for this scenario yet
    await act(async () => {
      slow.resolve(answer({ a: '3' }))
    })
    expect(text('flags')).toBe('false|false|||false')
  })

  it('drops a stale sequence — the older answer never replaces the newer scenario', async () => {
    const slow = deferred<R>()
    const fast = deferred<R>()
    mount()
    await settle()
    preview.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
    click('commit3')
    click('b9')
    await act(async () => {
      fast.resolve(answer({ a: '3', b: '9' }))
    })
    expect(text('result')).toBe('3|9')
    await act(async () => {
      slow.resolve(answer({ a: '3' }))
    })
    expect(text('result')).toBe('3|9')
  })

  it('arriving with entries runs at once', async () => {
    mount('/paycheck?whatif=a%3A5')
    await settle()
    expect(preview).toHaveBeenCalledWith({ a: '5' })
    expect(text('result')).toBe('5|null')
    expect(text('flags')).toBe('false|false|||false')
  })

  it('drops garbage entries on arrival and rewrites the URL without them (replace)', async () => {
    mount('/paycheck?whatif=NVDA&whatif=a%3A5&whatif=zzz%3A1&owner=2')
    await settle()
    expect(text('url')).toBe('/paycheck?owner=2&whatif=a%3A5')
    expect(text('nav')).toBe('REPLACE')
    expect(preview).toHaveBeenCalledTimes(1)
  })

  it('keeps the last result on failure, marked stale, with the server sentence and status', async () => {
    mount()
    await settle()
    click('commit3')
    await settle()
    expect(text('result')).toBe('3|null')
    preview.mockRejectedValueOnce(new ApiError('lot 4 already sold', 409))
    click('b9')
    await settle()
    expect(text('result')).toBe('3|null')
    expect(text('flags')).toBe('false|true|lot 4 already sold|409|false')
    // A later success clears the error and un-stales.
    click('commit3')
    await settle()
    expect(text('flags')).toBe('false|false|||false')
  })

  it('shows the error alone when there is no result yet', async () => {
    preview.mockRejectedValue(new ApiError('no paycheck profiles', 404))
    mount('/paycheck?whatif=a%3A5')
    await settle()
    expect(text('result')).toBe('null')
    expect(text('flags')).toBe('false|false|no paycheck profiles|404|false')
  })

  it('reset empties the whatif family, keeps other params and restores the baseline as the result', async () => {
    mount('/paycheck?owner=2&whatif=a%3A5')
    await settle()
    click('reset')
    expect(text('url')).toBe('/paycheck?owner=2')
    await settle()
    expect(text('result')).toBe('0|null') // the baseline run's two-sided answer
    expect(text('flags')).toBe('false|false|||true')
  })

  it('does nothing while disabled, then runs when enabled', async () => {
    const { rerender } = mount('/paycheck?whatif=a%3A5', { enabled: false })
    await settle()
    expect(preview).not.toHaveBeenCalled()
    expect(text('flags')).toBe('false|false|||false')
    rerender(
      <MemoryRouter initialEntries={['/paycheck?whatif=a%3A5']}>
        <Probe enabled />
      </MemoryRouter>,
    )
    await settle()
    expect(preview).toHaveBeenCalledWith({ a: '5' })
  })

  it('names the live scenario link from the current URL', async () => {
    mount('/paycheck?owner=2&whatif=a%3A5')
    await settle()
    expect(text('link')).toBe('/paycheck?owner=2&whatif=a%3A5')
  })

  describe('one-sided pages (no baselineOf)', () => {
    it('runs the empty scenario alongside a non-empty arrival — once per dataKey', async () => {
      const { rerender } = mountOne('/projection?whatif=a%3A5')
      await settle()
      expect(preview).toHaveBeenCalledTimes(2)
      expect(preview).toHaveBeenCalledWith({ a: '5' })
      expect(preview).toHaveBeenCalledWith({})
      expect(text('result')).toBe('5|null')
      expect(text('baseline')).toBe('0')
      // A re-render on the SAME dataKey asks for neither again.
      rerender(
        <MemoryRouter initialEntries={['/projection?whatif=a%3A5']}>
          <OneSided dataKey="k1" />
        </MemoryRouter>,
      )
      await settle()
      expect(preview).toHaveBeenCalledTimes(2)
      // New data underneath: both the live run and the baseline are asked again.
      rerender(
        <MemoryRouter initialEntries={['/projection?whatif=a%3A5']}>
          <OneSided dataKey="k2" />
        </MemoryRouter>,
      )
      await settle()
      expect(preview).toHaveBeenCalledTimes(4)
      expect(preview).toHaveBeenCalledWith({})
    })

    it('an empty arrival needs no second run — the mount run IS the baseline', async () => {
      mountOne('/projection')
      await settle()
      expect(preview).toHaveBeenCalledTimes(1)
      expect(text('baseline')).toBe('0')
      expect(text('result')).toBe('null|null')
    })

    it('initialBaseline seeds the result only when the arrival is empty', async () => {
      mountOne('/projection', { initialBaseline: SEED })
      expect(text('baseline')).toBe('99')
      expect(text('result')).toBe('seed|null') // painted before the first request resolves
      cleanup()
      mountOne('/projection?whatif=a%3A5', { initialBaseline: SEED })
      expect(text('baseline')).toBe('99') // the baseline is still good…
      expect(text('result')).toBe('null') // …but it is not this scenario's answer
      await settle()
      expect(text('result')).toBe('5|null')
    })

    it('onBaseline fires once, from whichever run produced the empty answer', async () => {
      const onBaseline = vi.fn()
      mountOne('/projection', { onBaseline })
      await settle()
      expect(onBaseline).toHaveBeenCalledTimes(1)
      expect(onBaseline).toHaveBeenCalledWith(answer({}))
      cleanup()
      onBaseline.mockReset()
      mountOne('/projection?whatif=a%3A5', { onBaseline })
      await settle()
      expect(onBaseline).toHaveBeenCalledTimes(1)
      expect(onBaseline).toHaveBeenCalledWith(answer({}))
    })
  })

  describe('pins', () => {
    it('pins the live scenario with a default label, refuses a fourth with a toast, unpins', async () => {
      mount('/paycheck?whatif=a%3A5')
      await settle()
      click('pin')
      expect(text('pins')).toBe('a 5')
      expect(JSON.parse(localStorage.getItem(pinsKey('paycheck')) ?? '{}').pins[0].entries).toEqual(['a:5'])
      click('pinNamed')
      click('pinNamed')
      expect(text('pins')).toBe('a 5,Named,Named')
      click('pin')
      expect(text('pins')).toBe('a 5,Named,Named')
      expect(toast.info).toHaveBeenCalledWith('Unpin one first')
      click('unpin')
      expect(text('pins')).toBe('Named,Named')
    })

    it('refuses to pin an empty scenario', async () => {
      mount()
      await settle()
      click('pin')
      expect(text('pins')).toBe('')
    })

    it('reads stored pins, ignores corrupt storage, runs each pin and re-runs on dataKey change', async () => {
      writePins('paycheck', [newPin('Stored', ['a:7']), newPin('Bad', ['nope'])])
      const { rerender } = mount('/paycheck', { dataKey: 'k1' })
      await settle()
      expect(text('pins')).toBe('Stored') // the undecodable pin is dropped on read
      expect(preview).toHaveBeenCalledWith({ a: '7' })
      expect(text('pinResults')).toBe('ok:7')
      const calls = preview.mock.calls.length
      rerender(
        <MemoryRouter initialEntries={['/paycheck']}>
          <Probe dataKey="k2" />
        </MemoryRouter>,
      )
      await settle()
      expect(preview.mock.calls.length).toBeGreaterThan(calls)
      expect(preview).toHaveBeenLastCalledWith({ a: '7' })
    })

    it('renders a per-pin error column when its run fails', async () => {
      writePins('paycheck', [newPin('Gone', ['a:8'])])
      preview.mockImplementation(async (s) => {
        if (s.a === '8') throw new ApiError('paycheck profile not found', 404)
        return answer(s)
      })
      mount('/paycheck')
      await settle()
      expect(text('pinResults')).toBe('error:paycheck profile not found')
      expect(text('flags')).toBe('false|false|||true') // the live run is unaffected
    })
  })
})
