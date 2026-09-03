// One fixture per builder (chart spec §17): a name, its form, the house aria sentence its
// mount will carry, declared exemptions for exotic forms, and a builder call over synthetic
// data. conformance.test.ts globs this folder.
import type { EChartsOption } from '../echarts'

export type FixtureKind = 'cartesian' | 'pie' | 'treemap' | 'sankey' | 'heatmap'
export type Exemption = 'grid' | 'axis' | 'legend'

export interface ChartFixture {
  name: string
  kind: FixtureKind
  /** The sentence the ChartCard mount uses — lanes copy it from here (F11). */
  ariaLabel: string
  exempt?: Exemption[]
  /** Series allowed to wear a dashed lineStyle beyond the grammar's own reference lines. */
  dashed?: string[]
  build: () => EChartsOption | null
}
