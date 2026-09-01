// Curated prompts (spec §1 "insight quick-actions" + §9 sample chips). Presets show on
// every route; route samples add page-specific starters. All of them run through the
// normal chat pipeline — nothing here is a second code path.

export interface SamplePrompt {
  label: string
  prompt: string
}

export const INSIGHT_PRESETS: SamplePrompt[] = [
  {
    label: 'Month in review',
    prompt:
      'Give me a month-in-review of my latest fully entered month: total spend vs my 12-month average, the biggest category movers, savings rate, net-worth change, and anything unusual worth a look. Cite the figures you used.',
  },
  {
    label: 'What changed in my spending?',
    prompt:
      'Compare my latest entered month of spending to the month before and to my 12-month averages. Which categories moved the most, and how do they sit against their budgets where budgets exist?',
  },
  {
    label: 'Contribution-limit pace',
    prompt:
      'Am I on pace to hit, exceed, or undershoot my 401(k), HSA, and ESPP contribution limits this year? Use my paycheck contribution pace and the limits I have entered, and flag any limit I have not entered.',
  },
]

const ROUTE_SAMPLES: Record<string, SamplePrompt[]> = {
  '/': [
    {
      label: 'Summarize my finances',
      prompt:
        'Summarize my current financial position: net worth and its trend, portfolio value, latest spending month, and effective tax rate. Keep it to a short paragraph plus a few bullets.',
    },
  ],
  '/net-worth': [
    {
      label: 'What drove last month?',
      prompt:
        'What drove my latest month-over-month net-worth change? Break it down by account group and call out the accounts that moved most.',
    },
  ],
  '/portfolio': [
    {
      label: 'Concentration check',
      prompt:
        'What are my most concentrated positions by weight, and how much of the portfolio do the top five holdings represent?',
    },
    {
      label: 'Income from holdings',
      prompt:
        'How much annual dividend income is my portfolio expected to produce at current rates, and which holdings contribute most?',
    },
  ],
  '/spending': [
    {
      label: 'Explain this month',
      prompt:
        'Explain the spending month I am looking at: total, biggest categories, movers vs the prior month, and how it compares to my typical month.',
    },
    {
      label: 'Budget check',
      prompt: 'Which categories are over or under their budgets this month, and by how much?',
    },
  ],
  '/taxes': [
    {
      label: 'Explain my marginal rate',
      prompt:
        'Explain my current marginal rates: what the next $1,000 of ordinary income costs federally and in state, and which brackets I am sitting in.',
    },
    {
      label: 'Model a sale',
      prompt:
        'If I sold 100 shares of my largest holding this year, what would happen to my total tax and take-home? Use the what-if tool and cite the deltas.',
    },
  ],
  '/projection': [
    {
      label: 'Why do my FI dates differ?',
      prompt:
        'The projection shows a deterministic FI date and Monte Carlo percentiles. Explain what each means, why they differ, and which assumptions move them most.',
    },
  ],
  '/credit-cards': [
    {
      label: 'Card lineup check',
      prompt:
        'Given my rewards matrix and spending weights, which cards earn their keep and which look droppable? Cite the estimated yearly values.',
    },
  ],
  '/espp': [
    {
      label: 'ESPP position',
      prompt:
        'Summarize my ESPP position: lots held, gains, the $25k-limit usage, and anything approaching its qualifying date.',
    },
  ],
  '/paycheck': [
    {
      label: 'Where does my check go?',
      prompt:
        'Walk through where each paycheck goes — gross to net — and how my contribution percentages translate to full-year totals.',
    },
  ],
  '/comp': [
    {
      label: 'Comp trajectory',
      prompt: 'Summarize my compensation trajectory across focal years: base, equity, and total.',
    },
  ],
}

export function samplesFor(route: string): SamplePrompt[] {
  return ROUTE_SAMPLES[route] ?? []
}
