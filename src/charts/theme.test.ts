import { describe, expect, it, vi } from 'vitest'
import { DARK, LIGHT } from '../theme/tokens'

// Spy on the registry itself, calling through so echarts.ts's import-time registration and
// `use()` still happen for real. Without this the registration test cannot fail: echarts
// resolves an UNKNOWN theme name to its default theme (a console warning at most, never a
// throw), so init() succeeds whether or not registerTheme was ever called.
vi.mock('echarts/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('echarts/core')>()
  return { ...mod, registerTheme: vi.fn(mod.registerTheme) }
})

import { echarts, registerThemeVersion, themeName } from './echarts'
import { FINANCE_THEME, OTHER_SERIES_COLOR, PALETTE, buildTheme } from './theme'

describe('chart theme bridge', () => {
  it('the dark constants are the DARK tokens', () => {
    expect([...PALETTE]).toEqual([...DARK.palette])
    expect(OTHER_SERIES_COLOR).toBe(DARK.otherSeries)
    expect(FINANCE_THEME).toEqual(buildTheme(DARK))
  })

  it('buildTheme(LIGHT) uses the light palette and surfaces', () => {
    const light = buildTheme(LIGHT)
    expect(light.color).toEqual([...LIGHT.palette])
    expect(light.tooltip.backgroundColor).toBe(LIGHT.surface2)
    expect(light.legend.textStyle.color).toBe(LIGHT.text)
    expect(light.valueAxis.splitLine.lineStyle.color).toBe(LIGHT.gridLine)
  })

  it('carries the house motion block and the tooltip class into every theme', () => {
    for (const theme of [buildTheme(DARK), buildTheme(LIGHT)]) {
      expect(theme.animationDuration).toBe(450)
      expect(theme.animationEasing).toBe('cubicOut')
      expect(theme.animationDurationUpdate).toBe(300)
      expect(theme.animationEasingUpdate).toBe('cubicInOut')
      expect(theme.tooltip.className).toBe('chart-tip')
    }
  })

  it('registers the RESOLVED palette under the versioned name it returns', () => {
    const name = registerThemeVersion('light', 3)
    expect(name).toBe('finance-3')
    expect(themeName(0)).toBe('finance')
    // The point of the spy: name AND content, together. Returning 'finance-3' while
    // registering nothing (or registering DARK) is the failure mode worth catching —
    // it paints a white card with dark axis lines, and init() would not complain.
    expect(vi.mocked(echarts.registerTheme)).toHaveBeenCalledWith('finance-3', buildTheme(LIGHT))
    expect(vi.mocked(echarts.registerTheme)).not.toHaveBeenCalledWith('finance-3', buildTheme(DARK))
  })

  it('registers DARK for the dark palette under the same version-0 name as import time', () => {
    expect(registerThemeVersion('dark', 0)).toBe('finance')
    // LAST call, not any call: echarts.ts already registered 'finance' at import, so a
    // registerThemeVersion that registered nothing would still satisfy toHaveBeenCalledWith.
    expect(vi.mocked(echarts.registerTheme)).toHaveBeenLastCalledWith('finance', FINANCE_THEME)
  })
})
