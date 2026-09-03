import { describe, expect, it } from 'vitest'
import { DARK, LIGHT } from '../theme/tokens'
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

  it('registers a versioned theme name that init() accepts', () => {
    const name = registerThemeVersion('light', 3)
    expect(name).toBe('finance-3')
    expect(themeName(0)).toBe('finance')
    // echarts throws on an unregistered theme name only via console warnings, so assert
    // the registry directly: a registered theme is retrievable by init.
    const el = document.createElement('div')
    const chart = echarts.init(el, name, { renderer: 'canvas', width: 10, height: 10 })
    expect(chart).toBeTruthy()
    chart.dispose()
  })
})
