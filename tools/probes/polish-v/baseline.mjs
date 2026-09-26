// Measurements from the approved design §0 and the archived 2026-09-24 audit.
// Keep audit values separate from fresh observations; these are not generated fixtures.
export const baseline = {
  source: 'docs/reviews/2026-09-24-polish-audit/00-REPORT.md',
  productHead: '1694013d',
  sidebarOverflow: { '1280x800': 86, '1366x768': 118, '1536x864': 22, '1440x900': 0 },
  compactSidebarOverflow: { '1280x800': 18, '1366x768': 50 },
  pairBottomDifference: { overview: 63, trends: 69, paycheck: 95, espp: 17, card: 43 },
  changesBlank: 109,
  dataStatusBlankWithTable: 277,
  settingsHouseholdHole: 261,
  settingsIntegrationsHole: 173,
  calendarHeaderBand: 65,
  taxTableRaggedGap: [123, 142],
  allocationHeightSpread: 294,
  budgetMeterEndSpread: 7,
  paceMeterEndSpread: 27,
  netWorthMonthHeights: [145, 111, 128],
  badgeValueOffset: [17, 19],
  calendarTileBottomSpread: 22,
  settingsEditFormTop: [-54, -280],
  cardEditFormTop: -186,
  chartTableVisiblePx: 21,
  taxInputsErrorControlDistance: 1181,
  references: {
    sidebar: ['SGS-06', 'MOTION-21'],
    layout: ['OU-04', 'NWSP-08', 'TPC-01', 'PE-11', 'PCC-28', 'SGS-09', 'SGS-10', 'PCC-04', 'TPC-12', 'PE-20'],
    tiles: ['OU-03', 'NWSP-04', 'PCC-12', 'PE-02', 'PE-09', 'MOTION-01', 'TPC-18'],
    feedback: ['SGS-04', 'SGS-05', 'WF-04', 'WF-05', 'WF-06', 'PCC-19', 'TPC-06'],
  },
}

export const sizes = [[1280, 800], [1366, 768], [1440, 900], [1536, 864], [1920, 1080]]
export const themes = ['dark', 'light']
export const routes = [
  ['overview', '/'], ['networth', '/net-worth'],
  ['spending', '/spending'], ['spending-trends', '/spending?section=trends'],
  ['budgets', '/spending?section=budgets'], ['spending-history', '/spending?section=history'],
  ['portfolio', '/portfolio'], ['holdings', '/portfolio?section=holdings'],
  ['income', '/portfolio?section=income'], ['allocation', '/portfolio?section=allocation'],
  ['portfolio-manage', '/portfolio?section=manage'],
  ['espp', '/espp'], ['espp-purchase', '/espp?section=purchase'], ['espp-lots', '/espp?section=lots'],
  ['paycheck', '/paycheck'], ['profiles', '/paycheck?section=profiles'], ['paycheck-changes', '/paycheck?section=changes'],
  ['comp', '/comp'], ['vesting', '/comp?section=vesting'], ['comp-manage', '/comp?section=manage'],
  ['taxes', '/taxes'], ['tax-inputs', '/taxes?section=inputs'], ['tax-tables', '/taxes?section=tables'],
  ['tax-whatif', '/taxes?section=whatif&whatif=other_capital_gains%3A1234'],
  ['tax-whatif-sale', '/taxes?section=whatif&whatif=NVDA'],
  ['cards', '/credit-cards'], ['cards-manage', '/credit-cards?section=manage'], ['cards-lines', '/credit-cards?section=lines'],
  ['calendar', '/calendar'], ['calendar-list', '/calendar?view=list'],
  ['projection', '/projection'], ['projection-trend', '/projection?section=trend'],
  ['update-balances', '/update?step=balances'], ['update-spending', '/update?step=spending'], ['update-review', '/update?step=review'],
  ['settings-household', '/settings?section=household'], ['settings-planning', '/settings?section=planning'],
  ['settings-account', '/settings?section=account'], ['settings-integrations', '/settings?section=integrations'], ['settings-data', '/settings?section=data'],
  ['guide', '/guide'], ['guide-routines', '/guide?section=routines'], ['guide-pages', '/guide?section=pages'], ['guide-reference', '/guide?section=reference'],
]

export const pairs = [
  { name: 'overview', url: '/', a: 'Portfolio performance', b: 'Recent spending' },
  { name: 'trends', url: '/spending?section=trends', a: 'Savings rate', b: 'Category trends' },
  { name: 'paycheck', url: '/paycheck', a: '@breakdown', b: 'Where each check goes' },
  { name: 'espp', url: '/espp', a: 'Lot anatomy', b: 'vs your purchases' },
  // Resolve an actual card id/slug from the local copy at runtime.
  { name: 'card', url: '/credit-cards', a: '@credits', b: 'Credit line' },
]
