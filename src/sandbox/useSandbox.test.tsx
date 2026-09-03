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
      <button onClick={() => sb.set({ a: '3' }, { immediate: true })}>commit3</button>
      <button onClick={() => sb.set((s) => ({ ...s, b: '9' }), { immediate: true, drop: ['whatif-lot'] })}>b9</button>
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
