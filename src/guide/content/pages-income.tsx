import type { GuideCard } from '../types'

// Chapter: Pages — the Income group and Taxes, in sidebar order (2026-09-14 guide spec §5.1).
// Written by lane G3 from research §5.3 P6–P9; every bold label and Where segment verified
// against source before it was bolded (spec §5.2), and every trap is a rule the page does not
// already print for itself (§5.3 rule 6).
export const INCOME_CARDS: GuideCard[] = [
  {
    id: 'page-paycheck',
    title: 'Paycheck',
    purpose:
      'Each person’s paycheck as the server computes it from a profile — the per-check breakdown, where it goes, contribution pace, and a sandbox to try changes.',
    to: '/paycheck',
    views: ['Summary', 'Try changes', 'Profiles'],
    keywords: ['paycheck', 'salary', 'net pay', 'withholding', 'contributions', 'hsa', '401k'],
    tasks: [
      {
        id: 'paycheck-profile-add',
        title: 'Add a paycheck profile',
        where: 'Paycheck → Profiles → Profile history',
        steps: [
          'Fill **Effective date**, **Annual salary** and **Pay periods per year** — the form refuses to save without all three.',
          'Type the contribution percents, **Withholding %**, **Dental & vision**, **HSA** and **HSA coverage**.',
          'Open **Employer 401(k) match** and **Employer HSA contribution** for the employer side.',
          'Press **Add profile** — the breakdown, the flow and the pace meters recompute from it.',
        ],
        to: '/paycheck?section=profiles',
        watch: ['A blank percent or money box saves as a real zero — every box arrived pre-filled, so clearing one is a decision.'],
        keywords: ['new profile', 'set up paycheck', 'manage paycheck'],
      },
      {
        id: 'paycheck-profile-carry-forward',
        title: 'Record a raise or an election change',
        where: 'Paycheck → Profiles → Profile history',
        steps: [
          'The form opens pre-filled from the newest profile, with an empty date and no note.',
          'Change only what moved, type the new **Effective date**, and press **Add profile**.',
          'The old row stays as history — nothing is overwritten.',
        ],
        to: '/paycheck?section=profiles',
        keywords: ['raise', 'new salary', 'election change', 'contribution change'],
      },
      {
        id: 'paycheck-person',
        title: 'Switch person',
        where: 'Paycheck → Whose',
        steps: [
          'Press a person chip in the sticky row — a paycheck belongs to one person.',
          'There is no All and no Joint here; the breakdown, flow, pace and history all follow the chip.',
          'Switching drops a pinned profile and any scenario — they belong to the person you left.',
        ],
        to: '/paycheck',
        keywords: ['partner paycheck', 'person', 'whose paycheck'],
      },
      {
        id: 'paycheck-pin-profile',
        title: 'Look at a past profile',
        where: 'Paycheck → Profiles → Profile history',
        steps: [
          'Press a row’s date chip — the page moves to **Summary** and reads that profile.',
          'Press **Show the current profile** to return to the one in force today.',
        ],
        to: '/paycheck?section=profiles',
        keywords: ['history', 'old profile', 'pin'],
      },
      {
        id: 'paycheck-try-it',
        title: 'Try a change without saving',
        where: 'Paycheck → Try changes',
        steps: [
          'Drag a slider or type a figure — the server recomputes the whole check as you go.',
          'Switch **Per check**, **Monthly** or **Annual** to compare against the real check.',
          'Chips: **Max 401(k)**, **Max HSA**, **Max ESPP**, **Stop ESPP** — a disabled one names the limit to enter first.',
          'Nothing is saved. **Reset to actual** clears it; the address carries it, so **Copy link** shares it.',
        ],
        to: '/paycheck?section=changes',
        keywords: ['what if', 'sandbox', 'try changes', 'simulate paycheck'],
      },
      {
        id: 'paycheck-apply-scenario',
        title: 'Turn a scenario into a profile',
        where: 'Paycheck → Try changes',
        steps: [
          'Press **Save as profile effective** the coming month — Profiles opens with the form filled and focused.',
          'Check every box, then press the form’s own **Add profile**; that is the only write.',
        ],
        to: '/paycheck?section=changes',
        keywords: ['apply scenario', 'save scenario'],
      },
      {
        id: 'paycheck-withholding-split',
        title: 'Enter the withholding split',
        where: 'Paycheck → Profiles → Withholding split (optional)',
        steps: [
          'Open the disclosure and type **Federal withholding %** and **State withholding %** from a paystub.',
          'Taxes then splits its balance into **Federal balance**, **California balance** and **Payroll taxes**, each with its own remedy.',
        ],
        to: '/paycheck?section=profiles',
        watch: ['Blank here means not entered, not zero — the only two boxes on this form that work that way.'],
        keywords: ['withholding split', 'federal withholding', 'state withholding'],
      },
      {
        id: 'paycheck-pace',
        title: 'Read the contribution pace meters',
        where: 'Paycheck → Summary → Contribution pace',
        steps: [
          'Each meter fills solid to what is in so far, then dimmed to where the year lands.',
          'A row with no limit entered draws no meter — it links to Settings to enter one.',
          'The ESPP row appears only once the profile contributes to ESPP.',
        ],
        to: '/paycheck',
        keywords: ['pace', 'limit', 'on track', 'max out'],
      },
    ],
    more: [
      {
        id: 'paycheck-edit-delete',
        title: 'Edit or delete a profile',
        where: 'Paycheck → Profiles → Profile history',
        steps: [
          'Press **Edit** on a row, change it, and press **Save profile**.',
          '**Delete** asks once; the page falls back to the profile in force.',
        ],
        to: '/paycheck?section=profiles',
      },
      {
        id: 'paycheck-read-breakdown',
        title: 'Read the per-check breakdown',
        where: 'Paycheck → Summary → Per-check breakdown',
        steps: [
          'Gross, each deduction and the net, in the order payroll applies them.',
          'The employer match is printed apart — it never passes through the check.',
        ],
        to: '/paycheck',
      },
      {
        id: 'paycheck-household-tile',
        title: 'See both take-home figures at once',
        where: 'Paycheck → Summary → Household take-home',
        steps: [
          'Give each person a profile in force today — the tile appears once both have one.',
          'It never narrows to one person, so it answers a different question from the chip.',
        ],
        to: '/paycheck',
      },
      {
        id: 'paycheck-monthly-net-pointer',
        title: 'Enter actual monthly take-home',
        where: 'Monthly update → Spending',
        steps: ['Actual take-home is typed in the monthly update’s spending step — this page’s monthly net is only a profile-based estimate.'],
        to: '/update?step=spending',
      },
    ],
    watch: [
      'A profile belongs to one person — there is no All or Joint on this page.',
      'Blank percent and money boxes save as a real zero; only the withholding split reads blank as not entered.',
      'Contribution percents over 100 % warn but still save — the check is modelled over-committed, not refused.',
      'Deleting a profile asks once and cannot be undone.',
    ],
  },
  {
    id: 'page-comp',
    title: 'Comp',
    purpose:
      'RSU grants and the vesting schedule they generate, focal-year history and the total-comp trajectory — one set for the household, not per person.',
    to: '/comp',
    views: ['Summary', 'Vesting', 'Manage'],
    keywords: ['comp', 'rsu', 'grant', 'vest', 'vesting', 'equity', 'focal', 'total comp'],
    tasks: [
      {
        id: 'comp-grant-add',
        title: 'Add an RSU grant',
        where: 'Comp → Manage → RSU grants',
        steps: [
          'Pick the **Kind** — **New hire** or **Refresh**. It carries the cliff, so there is no cliff box.',
          'Fill **Label**, **Grant focal year**, **Shares**, **Price at grant**, **First vest** and **Vest rounding**.',
          'Press **Add grant** — the schedule, the tiles and the calendar’s vest events are all computed from it.',
        ],
        to: '/comp?section=manage',
        watch: ['The kind is the vest timing — a new-hire grant filed as a refresh drops the first-year cliff and vests a year early.'],
        keywords: ['add grant', 'add vest', 'new grant', 'rsu grant'],
      },
      {
        id: 'comp-grant-seed',
        title: 'Seed a grant from a focal year',
        where: 'Comp → Manage → RSU grants',
        steps: [
          'A focal year holding **Refresh RSUs** and a **Grant price**, with no grant yet, offers a chip naming both.',
          'Press it — the form fills and nothing is saved. Check the boxes, then press **Add grant**.',
        ],
        to: '/comp?section=manage',
        watch: ['The chip truncates a fractional share count, because a grant counts whole shares — read it before saving.'],
        keywords: ['seed grant', 'refresh grant'],
      },
      {
        id: 'comp-focal-add',
        title: 'Record a focal year',
        where: 'Comp → Manage → Focal history',
        steps: [
          'Fill **Focal year** and **Current base** — the two the form will not save without.',
          'Add **New base**, **Unvested RSUs**, **Unvested price**, **Refresh RSUs** and **Grant price** as the letter gives them.',
          'Press **Add event**; a stored row is then changed with **Edit** and **Save event**.',
        ],
        to: '/comp?section=manage',
        watch: ['One row per focal year — a second row for a year already recorded is refused.'],
        keywords: ['focal', 'annual review', 'base salary', 'comp event', 'focal information'],
      },
      {
        id: 'comp-vesting-read',
        title: 'Read the vesting schedule',
        where: 'Comp → Vesting → Vesting schedule',
        steps: [
          'Start with the **Next vest**, **Unvested** and **Vested this year** tiles.',
          'Press a vest date in the table to expand its per-grant tranches; opening another folds the first.',
          'Nothing here is stored — every row is recomputed from the grants on each read.',
        ],
        to: '/comp?section=vesting',
        keywords: ['vesting', 'schedule', 'next vest', 'unvested'],
      },
      {
        id: 'comp-grant-edit-delete',
        title: 'Edit or delete a grant',
        where: 'Comp → Manage → RSU grants',
        steps: [
          'Press **Edit** on a row, change it, and press **Save grant**.',
          '**Delete** removes it at once with no confirm — the toast’s **Undo** re-creates it.',
        ],
        to: '/comp?section=manage',
        keywords: ['delete grant', 'edit grant'],
      },
    ],
    more: [
      {
        id: 'comp-columns',
        title: 'Show entered or computed columns',
        where: 'Comp → Manage → Focal history',
        steps: ['Pick **Entered**, **Computed** or **All** under **Columns** — a view choice, and not saved.'],
        to: '/comp?section=manage',
      },
      {
        id: 'comp-tc-read',
        title: 'Read the total-comp chart',
        where: 'Comp → Summary',
        steps: ['One bar per focal year, drawn from **Focal history** — a year with no row simply has no bar.'],
        to: '/comp',
      },
    ],
    watch: [
      'Comp is not per person — there is no owner chip, and grants and focal history are one household set.',
      'A grant whose shares or price no longer match its focal row raises a drift note — the schedule follows the grant.',
      'With no employer ticker in Settings → Plan assumptions, every future vest is unvalued.',
      'Deleting a focal row asks once and cannot be undone; deleting a grant can be undone from its toast.',
    ],
  },
]
