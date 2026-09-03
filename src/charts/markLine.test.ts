import { describe, expect, it } from 'vitest'
import { INK, MUTED, SURFACE_2 } from './theme'
import { formatDate, formatMonth } from '../utils/format'
import {
  MARK_LINE_LABEL, MARK_LINE_STYLE, afterArea, anchorLabel, anchorMonthLabel, annotationRules,
  arrivalRule, percentileMarks, ruleAt, todayRule, zeroLine,
} from './markLine'

const MONTHS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']

describe('anchorMonthLabel', () => {
  it('speaks the axis vocabulary — a formatMonth LABEL, never an ISO string', () => {
    // The x-axis carries formatMonth labels, so a markLine's value has to be one too.
    expect(anchorMonthLabel(MONTHS, '2026-08-14')).toBe('Aug 2026')
    expect(anchorMonthLabel(MONTHS, '2026-08-01')).toBe('Aug 2026')
  })

  it('falls FORWARD when the exact month is not on the axis', () => {
    expect(anchorMonthLabel(['2026-06-01', '2026-09-01'], '2026-08-14')).toBe('Sep 2026')
  })

  it('draws nothing it cannot honestly place', () => {
    expect(anchorMonthLabel(MONTHS, null)).toBeUndefined()
    expect(anchorMonthLabel(MONTHS, undefined)).toBeUndefined()
    expect(anchorMonthLabel(MONTHS, '')).toBeUndefined()
    expect(anchorMonthLabel([], '2026-08-14')).toBeUndefined()
    // Later than every month on the axis: clamping onto the last one would date the rule
    // to a month the event is not in.
    expect(anchorMonthLabel(MONTHS, '2027-01-01')).toBeUndefined()
  })
})

describe('the annotation vocabulary', () => {
  it('is dashed, hairline and muted — solid is reserved for data', () => {
    expect(MARK_LINE_STYLE).toEqual({ color: MUTED, width: 1, type: 'dashed' })
    expect(MARK_LINE_LABEL).toEqual({
      show: true,
      position: 'insideEndTop',
      color: MUTED,
      fontSize: 11,
    })
  })
})

describe('anchorLabel', () => {
  it('anchors a date onto a DAILY axis by the same fall-forward rule, in the axis vocabulary', () => {
    const days = ['2026-08-10', '2026-08-11', '2026-08-13']
    expect(anchorLabel(days, '2026-08-11', formatDate)).toBe('Aug 11, 2026')
    expect(anchorLabel(days, '2026-08-12', formatDate)).toBe('Aug 13, 2026') // falls forward over the gap
    expect(anchorLabel(days, '2026-08-14', formatDate)).toBeUndefined()
    expect(anchorLabel(days, null, formatDate)).toBeUndefined()
  })
  it('anchorMonthLabel is the month-bucketed form of the same rule', () => {
    expect(anchorMonthLabel(MONTHS, '2026-08-14')).toBe(anchorLabel(MONTHS, '2026-08-14', formatMonth, (iso) => `${iso.slice(0, 7)}-01`))
  })
})

describe('annotation rules', () => {
  it('ruleAt yields a labelled entry; annotationRules wraps entries in the dashed-MUTED markLine and drops the unplaceable', () => {
    expect(ruleAt(MONTHS, '2026-08-01', 'FI', formatMonth, (iso) => `${iso.slice(0, 7)}-01`)).toEqual({
      xAxis: 'Aug 2026', label: { formatter: 'FI' },
    })
    expect(arrivalRule(MONTHS, '2026-07-20', 'Coast FI')).toEqual({ xAxis: 'Jul 2026', label: { formatter: 'Coast FI' } })
    expect(arrivalRule(MONTHS, null, 'FI')).toBeUndefined()
    expect(todayRule(['2026-08-20', '2026-11-18'], '2026-09-03', formatDate)).toEqual({
      xAxis: 'Nov 18, 2026', label: { formatter: 'Today' },
    })
    expect(todayRule(['2026-08-20'], '2026-09-03', formatDate)).toBeUndefined() // everything is past
    expect(annotationRules([arrivalRule(MONTHS, '2026-08-01', 'FI'), undefined])).toEqual({
      silent: true,
      symbol: 'none',
      lineStyle: { color: MUTED, width: 1, type: 'dashed' },
      label: { show: true, position: 'insideEndTop', color: MUTED, fontSize: 11 },
      data: [{ xAxis: 'Aug 2026', label: { formatter: 'FI' } }],
    })
    expect(annotationRules([undefined])).toBeUndefined()
  })

  it('merges rules that land on the SAME category into one two-named label', () => {
    // Retiring in the month FI arrives: echarts draws one label per data entry at one
    // position, so two entries here would print two labels on the same pixel.
    expect(
      annotationRules([
        arrivalRule(MONTHS, '2026-08-01', 'Alex'),
        arrivalRule(MONTHS, '2026-08-01', 'FI'),
        arrivalRule(MONTHS, '2026-07-01', 'Coast FI'),
      ])?.data,
    ).toEqual([
      { xAxis: 'Aug 2026', label: { formatter: 'Alex · FI' } },
      { xAxis: 'Jul 2026', label: { formatter: 'Coast FI' } },
    ])
  })
})

describe('areas, marks, baselines', () => {
  it('afterArea is a SURFACE_2 wash at 0.35 with a muted inside-top label', () => {
    expect(afterArea('Aug 2030', 'Aug 2056', 'After FI')).toEqual({
      silent: true,
      itemStyle: { color: SURFACE_2, opacity: 0.35 },
      label: { show: true, position: 'insideTop', color: MUTED, fontSize: 11, formatter: 'After FI' },
      data: [[{ xAxis: 'Aug 2030' }, { xAxis: 'Aug 2056' }]],
    })
  })
  it('percentileMarks are MUTED circles with INK borders labelled by name', () => {
    const marks = percentileMarks([{ name: 'p50', label: 'Aug 2030', value: 1500000 }])
    expect(marks).toMatchObject({
      silent: true, symbol: 'circle', symbolSize: 8,
      itemStyle: { color: MUTED, borderColor: INK, borderWidth: 1 },
      data: [{ name: 'p50', coord: ['Aug 2030', 1500000] }],
    })
    expect(marks.label.formatter({ name: 'p50' })).toBe('p50')
  })
  it('merges percentile marks that share a coordinate into one circle', () => {
    // p10 and p50 arriving in the same month: two circles on one pixel, two labels on top
    // of each other. One circle, named for both.
    expect(
      percentileMarks([
        { name: 'p10', label: 'Aug 2030', value: 1500000 },
        { name: 'p50', label: 'Aug 2030', value: 1500000 },
        { name: 'p90', label: 'Aug 2032', value: 1500000 },
      ]).data,
    ).toEqual([
      { name: 'p10 · p50', coord: ['Aug 2030', 1500000] },
      { name: 'p90', coord: ['Aug 2032', 1500000] },
    ])
  })
  it('zeroLine is the solid MUTED hairline the savings-rate and card-value charts draw', () => {
    expect(zeroLine()).toEqual({
      silent: true, symbol: 'none', lineStyle: { color: MUTED, width: 1, type: 'solid' }, label: { show: false }, data: [{ yAxis: 0 }],
    })
    expect(zeroLine('x').data).toEqual([{ xAxis: 0 }])
  })
})
