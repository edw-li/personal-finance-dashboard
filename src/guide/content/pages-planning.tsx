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
  {
    id: 'page-calendar',
    title: 'Calendar',
    purpose:
      'Every dated thing the household’s money touches — vests, paydays, ESPP dates, ex-dividends, tax deadlines, card dates, the monthly reminder and your own events — composed on read.',
    to: '/calendar',
    keywords: ['calendar', 'events', 'deadline', 'payday', 'ics', 'reminder'],
    tasks: [
      {
        id: 'calendar-navigate',
        title: 'Move around the calendar',
        where: 'Calendar',
        steps: [
          'Use ‹ and ›, **Today**, or **Jump to month**.',
          'In the grid, arrows move a day or a week, Home and End the week’s ends, PageUp and PageDown the month.',
          'Switch **Grid** and **List** with the view toggle — the list shows the month on screen, hidden rows dimmed.',
        ],
        to: '/calendar',
        keywords: ['navigate', 'list view', 'grid'],
      },
      {
        id: 'calendar-add-event',
        title: 'Add your own event',
        where: 'Calendar → Add event',
        steps: [
          'Press **Add event**; fill **Date** and **Title**, and **Note (optional)** if you want one.',
          'With two people on the roster, **Person** tags it; **Household** leaves it shared.',
          'Fill **Amount (optional)** and **Direction**, then **Repeats** — and **Until (optional)** when it repeats.',
          'Press **Save event** — the grid lands on that date.',
        ],
        to: '/calendar?add=1',
        watch: ['Without an amount the direction is saved as **No direction** — money out of nothing is not a fact.'],
        keywords: ['custom event', 'reminder', 'add event', 'new event'],
      },
      {
        id: 'calendar-edit-event',
        title: 'Edit or delete your event',
        where: 'Calendar → Grid',
        steps: [
          'Click the chip, press **Edit**, change it, press **Save changes**.',
          '**Delete** offers **Undo** in the toast; the restored event is a new row.',
        ],
        to: '/calendar',
        watch: ['A repeating series is anchored to its start — editing one occurrence edits the series.'],
      },
      {
        id: 'calendar-override',
        title: 'Mark a generated event done, hide it, or enter your figure',
        where: 'Calendar → Grid',
        steps: [
          'Click the chip. A deadline offers **Mark done**, and **Reopen** afterwards.',
          '**Hide** takes any generated event off the grid; **Unhide** from the list view brings it back.',
          'Press **Your figure**, type **Amount you paid**, press **Save figure**; **Use the estimate** clears it.',
        ],
        to: '/calendar',
        keywords: ['done', 'hide event', 'your figure', 'override'],
      },
      {
        id: 'calendar-export-ics',
        title: 'Download these months as a calendar file',
        where: 'Calendar → Add to calendar (.ics)',
        steps: [
          'Press **Add to calendar (.ics)** — the server composes the month on screen with one either side.',
          'The file carries your overrides, your own events and the reminder alarms; it is a snapshot, not a subscription.',
        ],
        to: '/calendar',
        keywords: ['ics', 'download calendar', 'export'],
      },
      {
        id: 'calendar-subscribe',
        title: 'Subscribe a phone or desktop calendar',
        where: 'Settings → Integrations → Calendar feed',
        steps: [
          'Type a label for the device — the box takes “phone, laptop” — and press **New feed link**.',
          'Press **Copy** while the link is on screen: it is shown once. Then press **Done**.',
          'Google: Other calendars, From URL. Apple: File, New Calendar Subscription.',
          'Press **Revoke** on a link when a device is gone.',
        ],
        to: '/settings?section=integrations#calendar',
        watch: ['The link is the credential — anyone holding it can read the feed, amounts included.'],
        keywords: ['subscribe', 'feed', 'phone calendar', 'google calendar', 'apple calendar', 'ical'],
      },
      {
        id: 'calendar-reminder-day',
        title: 'Set the monthly update reminder day',
        where: 'Settings → Integrations → Calendar feed → Monthly update reminder day',
        steps: [
          'Type a day from 1 to 28 — every month has one — and press **Save reminder day**.',
          'The reminder lands on that day each month, on the calendar and in the feed, with an alarm three days before.',
        ],
        to: '/settings?section=integrations#calendar',
        keywords: ['reminder', 'monthly reminder', 'reminder day'],
      },
    ],
    more: [
      {
        id: 'calendar-open-day',
        title: 'Open a day',
        where: 'Calendar → Grid',
        steps: [
          'Click the day number, or the more chip when a day is full; Enter on a focused cell does the same.',
          '**Add event on** that date sits in the drawer; Escape closes it and returns focus to the cell.',
        ],
        to: '/calendar',
      },
      {
        id: 'calendar-follow',
        title: 'Follow an event to its page',
        where: 'Calendar → Grid',
        steps: ['A generated event carries an **Open** link to the page that owns it — a card, a grant, a tax year.'],
        to: '/calendar',
      },
      {
        id: 'calendar-source-health',
        title: 'Read what the calendar could not see',
        where: 'Calendar → Sources',
        steps: ['The source list under the grid names every generator, its status, and the server’s reason when it is not plainly on.'],
        to: '/calendar',
      },
    ],
    watch: [
      'A subscription link is a credential — revoke it when a device is gone.',
      'Done, hide and your figure apply to generated events; your own events are edited directly.',
      'Hidden events are reachable only from the list view — that is where **Unhide** lives.',
    ],
  },
]
