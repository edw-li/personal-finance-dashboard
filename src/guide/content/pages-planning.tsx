import type { GuideCard } from '../types'

// Chapter: Pages — Projection, Calendar, Settings (two cards) (2026-09-14 guide spec §5.1).
// Written by lane G4 from research §5.3 P10–P12; every bold label and every `where` segment
// was grepped out of a non-test source before it was written down (spec §5.2).
export const PLANNING_CARDS: GuideCard[] = [
  {
    id: 'page-projection',
    title: 'Projection',
    purpose:
      'A retirement projection from your own records — investable balance, contribution, spend and withdrawal rate — with a fan of simulated paths. Nothing here is saved.',
    to: '/projection',
    views: ['Planning workspace', 'Historical trend'],
    keywords: ['projection', 'forecast', 'retire', 'fire', 'monte carlo', 'fi date'],
    tasks: [
      {
        id: 'projection-assumptions',
        title: 'Adjust an assumption',
        where: 'Projection → Planning workspace → Planning assumptions',
        steps: [
          'Type into **Annual return**, **Monthly contribution**, **Annual spend** or **Withdrawal rate**.',
          'Or into the model knobs: **Horizon (years)**, **Volatility**, **Inflation**, **Contribution growth**.',
          'Blank means derived — the badge names the source: **From your records**, **Settings** or **Planning default**.',
          'Enter 5 for 5%. The chart and the outcomes re-run as you type, and the address carries the scenario.',
        ],
        to: '/projection',
        keywords: ['assumptions', 'return', 'contribution', 'forecast', 'scenario'],
      },
      {
        id: 'projection-use-budgets',
        title: 'Use your budgets as annual spend',
        where: 'Projection → Planning assumptions → Annual spend',
        steps: [
          'Press **Use my budgets** — twelve times the living-category budgets in force this month becomes the annual spend.',
        ],
        to: '/projection',
        keywords: ['budgets', 'annual spend'],
      },
      {
        id: 'projection-retire-month',
        title: 'Set a retirement month',
        where: 'Projection → Planning assumptions → Retires',
        steps: [
          'Type a month for each person — a dashed rule marks it on the chart.',
          'From that month, that person\u2019s take-home, payroll deductions and employer match leave the contribution stream.',
          'Blank means that person works for the whole horizon.',
        ],
        to: '/projection',
        watch: ['Spending stays a household figure — the FI target does not move when one person retires.'],
        keywords: ['retire', 'retirement date', 'stop working'],
      },
      {
        id: 'projection-dollars',
        title: 'Switch between today\u2019s and future dollars',
        where: 'Projection → Projected investable balance',
        steps: ["Pick **Today's dollars** or **Future dollars** — display only; dates, probabilities and targets do not move."],
        to: '/projection',
        keywords: ['inflation', 'nominal', 'real dollars'],
      },
      {
        id: 'projection-pin',
        title: 'Pin and compare scenarios',
        where: 'Projection → Compare your scenarios',
        steps: [
          'Type a label and press **Pin this scenario** — at most three, kept in this browser.',
          'Pinned runs join the chart and the comparison table; **Copy link** shares the live scenario.',
        ],
        to: '/projection',
        keywords: ['pin', 'compare', 'share scenario'],
      },
      {
        id: 'projection-reset',
        title: 'Reset to the derived baseline',
        where: 'Projection → Planning assumptions',
        steps: ['Press **Reset to baseline** — every knob returns to what your records imply.'],
        to: '/projection',
      },
    ],
    more: [
      {
        id: 'projection-window',
        title: 'Change the chart window and axis',
        where: 'Projection → Projected investable balance',
        steps: ['**Next milestone** or **Full horizon**; **Linear** or **Log** — the log axis omits values at or below zero.'],
        to: '/projection',
      },
      {
        id: 'projection-historical',
        title: 'Read the historical trend',
        where: 'Projection → Historical trend',
        steps: [
          'The panel is mounted the first time you open the tab — history never gates the planning model.',
          'Every monthly net-worth snapshot draws as a dot; the span toggle sets how far the fit runs forward.',
          'Under three snapshots there is no fit — the dots stay and the footer says why.',
        ],
        to: '/projection?section=trend',
      },
      {
        id: 'projection-outcomes',
        title: 'Read the outcomes band',
        where: 'Projection → Planning workspace',
        steps: [
          '**FI target** is annual spend ÷ withdrawal rate; **FI ratio** is the investable balance against it.',
          '**Investable balance** is pre-tax, post-tax, taxable and equity from the latest snapshot — cash and liabilities excluded.',
          '**Projected FI date** is the deterministic reach month; the last tile is the share of simulated paths reaching it.',
        ],
        to: '/projection',
      },
    ],
    watch: [
      'Nothing on this page is saved — the stored withdrawal rate lives under Settings → Planning → Plan assumptions.',
      'The probability tile asks whether the target is reached within the horizon, not whether the spending lasts.',
      'RSU vests are not in the derived contribution — raise it by hand to model them.',
      'A volatility of 0 turns the fan off; it is a legitimate value, not an error.',
    ],
  },
]
