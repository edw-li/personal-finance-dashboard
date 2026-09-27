import { Link } from 'react-router-dom'
import type { GuideCard } from '../types'

const SOURCES = [
  { number: 'Net worth and account balances', source: 'Balances you enter for the 1st of each month. Component accounts add up to a derived parent.', place: 'Monthly update', to: '/update', when: 'Monthly; use account statements for that date.' },
  { number: 'Living spending, tax paid and cash savings', source: 'Category totals and actual take-home you enter. Category kinds decide what counts as Living, Tax or Transfer.', place: 'Monthly update', to: '/update?step=spending', when: 'After each month ends. Take-home is actual received pay, not the Paycheck estimate.' },
  { number: 'Portfolio holdings and value', source: 'Securities and dated transactions you record, valued with refreshed prices. Private assets use manual prices.', place: 'Portfolio → Manage', to: '/portfolio?section=manage', when: 'When holdings change; market prices refresh on the saved schedule.' },
  { number: 'Budget comparisons', source: 'Your category budgets, effective from a chosen month. They do not fill in actual spending.', place: 'Spending → Budgets', to: '/spending?section=budgets', when: 'When a budget changes; earlier months keep their previous budget.' },
  { number: 'Paycheck estimates and contribution pace', source: 'Effective-dated pay profiles, payroll deductions, compensation, and the year’s contribution limits.', place: 'Paycheck → Profiles', to: '/paycheck?section=profiles', when: 'When pay or elections change. Compare the estimate with a pay stub.' },
  { number: 'Stock compensation and ESPP', source: 'Grants, compensation events, offerings and lots you record, plus market quotes and plan assumptions.', place: 'Comp → Manage', to: '/comp?section=manage', when: 'When an award, raise, offering or purchase occurs; ESPP has its own editors.' },
  { number: 'Tax estimate and projected balance', source: 'The selected year’s inputs, filing status and bracket tables. Missing tables can prevent an estimate.', place: 'Taxes → Inputs', to: '/taxes?section=inputs', when: 'Set up each tax year, then update inputs as new information arrives.' },
  { number: 'FI target and Projection', source: 'Entered spending, assets, income and planning assumptions. Temporary scenario overrides are carried in the link.', place: 'Projection', to: '/projection', when: 'Recomputed from your records. Save long-term defaults in Settings → Planning.' },
  { number: 'Credit card recommendations and rewards', source: 'Your card roster, reward rules and category spending. They are not a feed of bank transactions.', place: 'Credit cards → Manage', to: '/credit-cards?section=manage', when: 'When you open, close or change a card, or its rewards change.' },
  { number: 'Calendar amounts and due dates', source: 'Dates and estimates from your saved records, plus custom events and any actual amounts you enter.', place: 'Calendar', to: '/calendar', when: 'As source records change. Read each amount’s basis before treating it as confirmed.' },
]

export const DATA_REFERENCE_CARDS: GuideCard[] = [
  {
    id: 'ref-data-sources', title: 'Where each number comes from',
    purpose: 'Use this map when a number looks wrong or you need to know where to update it.',
    keywords: ['data source', 'edit', 'change number', 'where update', 'automatic', 'manual', 'bank sync'],
    tasks: [],
    searchText: SOURCES.map((row) => Object.values(row).join(' ')).join(' '),
    body: <>
      <p className="guide-body">The dashboard does not sync your bank accounts. You supply the records below; it combines them into charts and estimates. A figure’s <b className="guide-label">About this number</b> receipt explains its calculation.</p>
      <div className="guide-source-table"><table className="data-table guide-map">
        <thead><tr><th>Information</th><th>Source</th><th>Update here</th><th>When / what to check</th></tr></thead>
        <tbody>{SOURCES.map((row) => <tr key={row.number}><th scope="row">{row.number}</th><td>{row.source}</td><td><Link to={row.to}>{row.place}</Link></td><td>{row.when}</td></tr>)}</tbody>
      </table></div>
      <p className="guide-body">One balance may appear in several views, but those views do not necessarily share an input: monthly account balances and the portfolio ledger are maintained separately. Correct the source named in the receipt.</p>
    </>,
  },
  {
    id: 'ref-get-ready', title: 'What to have ready',
    purpose: 'A short preparation list for entering records yourself or bringing over the supported workbook.',
    keywords: ['prepare', 'documents', 'statements', 'import format', 'xlsx', 'csv', 'template'],
    tasks: [
      {
        id: 'prepare-month', title: 'Prepare a month of actual figures', where: 'Monthly update',
        steps: [
          'Have account balances for the 1st, spending totals by category, and actual take-home for the calendar month.',
          'Check that the account and category names exist in Settings → Household.',
          'Enter loans and card balances as negative amounts; enter spending totals as positive amounts.',
          'Keep transfers separate from Living spending so moving money between accounts does not inflate your lifestyle cost.',
          'Review each part before closing the month; missing entries and an explicit zero are different.',
        ], to: '/update',
        example: { label: 'For an August record', value: 'Balances: August 1\nSpending + take-home: August 1–31', note: 'Balances on September 1 complete August’s net-worth change. Keep those in the September balance record.' },
      },
      {
        id: 'prepare-income', title: 'Prepare pay and investment records', where: 'Paycheck → Profiles',
        steps: [
          'Have a recent pay stub, pay schedule, annual salary, deductions and withholding elections ready.',
          'Use grant statements and ESPP confirmations for quantities, prices and dates in Comp and ESPP.',
          'Use brokerage trade history for dated Portfolio transactions; a total account balance does not populate the ledger.',
          'Keep tax-year inputs, filing status and published bracket tables ready for Taxes.',
        ], to: '/paycheck?section=profiles',
      },
      {
        id: 'prepare-workbook', title: 'Check whether your workbook is supported', where: 'Settings → Data → Import workbook',
        steps: [
          'Import accepts the dashboard’s existing workbook layout, not an arbitrary spreadsheet or bank CSV.',
          'The required sheet names are listed below; their columns and fixed layouts must also match.',
          'Recalculate and save formulas in your spreadsheet app first; import reads their saved values.',
          'Run **Dry run**, inspect every sheet’s changes and errors, then apply only the changes you expect.',
          'Keep a snapshot before importing. Sheet-covered records may overwrite edits made in the dashboard.',
        ], to: '/settings?section=data#import',
        example: { label: 'Required workbook sheets', value: 'ReferenceData\nPositions\nPortfolio\nNet Worth\nSpending\nTaxes\nESPP\nPaycheck Modeler\nFocal History', note: 'Renaming tabs alone is not enough: the importer expects the original row and column layout. If you do not have that workbook, use the individual editors and mark Import as Not needed.' },
        watch: ['Validation errors block the entire import. A dropped connection needs a check of Activity before retrying.'],
      },
    ],
  },
]
