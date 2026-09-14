import type { GuideChapter } from '../types'

export const FIXTURE_GUIDE: readonly GuideChapter[] = [
  {
    id: 'start',
    label: 'Start here',
    cards: [{ id: 'start-what', title: 'What this fixture does', purpose: 'A fixture.', tasks: [] }],
  },
  {
    id: 'routines',
    label: 'Routines',
    cards: [
      {
        id: 'routine-monthly',
        title: 'The monthly fixture',
        purpose: 'Once a month.',
        to: '/update',
        tasks: [
          { id: 'update-close', title: 'Close the fixture', where: 'Review', steps: ['Press **Save and close month**.'], to: '/update?step=review' },
        ],
      },
    ],
  },
  {
    id: 'pages',
    label: 'Pages',
    cards: [
      {
        id: 'page-example',
        title: 'Example',
        purpose: 'An example page.',
        to: '/net-worth',
        views: ['Overview', 'Accounts'],
        tasks: [
          {
            id: 'example-add',
            title: 'Add an example',
            where: 'Accounts → Example roster',
            steps: ['Open **Accounts**.', 'Press **Add example**.'],
            to: '/net-worth?section=accounts',
            watch: ['Blank means not entered — it is never a zero.'],
          },
        ],
        more: [
          { id: 'example-export', title: 'Export the example', where: 'Any chart', steps: ['Press **Export**.'] },
          { id: 'example-table', title: 'Show the table', where: 'Any chart', steps: ['Press **Table**.'] },
        ],
        watch: ['The example is entered as a negative number — a positive one inflates the total.'],
      },
      {
        id: 'page-taxes',
        title: 'Taxes fixture',
        purpose: 'A second page card so the chip row has two links.',
        to: '/taxes',
        views: ['Summary', 'What-if', 'Inputs', 'Tax tables'],
        tasks: [{ id: 'taxes-fixture', title: 'Do a tax thing', where: 'Summary', steps: ['Read the totals.'] }],
      },
    ],
  },
  {
    id: 'reference',
    label: 'Reference',
    cards: [{ id: 'ref-glossary', title: 'Words', purpose: 'Definitions.', tasks: [] }],
  },
]
