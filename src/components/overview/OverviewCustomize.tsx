import { DEFAULT_OVERVIEW_LAYOUT, OVERVIEW_CARDS, OVERVIEW_TILES } from '../../prefs/overviewLayout'
import type { OverviewLayout } from '../../prefs/overviewLayout'

const LABELS = { net_worth: 'Net worth', portfolio: 'Portfolio', living_spending: 'Living spending', tax: 'Estimated tax', ytd: 'Year to date', performance: 'Portfolio performance', spending: 'Recent living spending', money_flow: 'Money flow' }
export default function OverviewCustomize({ value, onChange }: { value: OverviewLayout; onChange: (value: OverviewLayout) => void }) {
  return <details className="overview-customize"><summary className="button">Customize</summary>
    <div className="overview-customize-menu">
      {(['tiles', 'cards'] as const).map(group => <fieldset key={group}><legend>{group === 'tiles' ? 'Summary tiles' : 'Deeper views'}</legend>
        {(group === 'tiles' ? OVERVIEW_TILES : OVERVIEW_CARDS).map(id => {
          const items = value[group] as string[]
          const index = items.indexOf(id)
          const move = (direction: number) => { const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange({ ...value, [group]: next }) }
          return <div className="overview-customize-row" key={id}><label><input type="checkbox" checked={index >= 0} disabled={group === 'tiles' && index >= 0 && items.length === 1}
            onChange={e => onChange({ ...value, [group]: e.target.checked ? [...items, id] : items.filter(item => item !== id) })} />{LABELS[id]}</label>
            <span>{index >= 0 ? index + 1 : 'Hidden'}</span>
            <button className="button" aria-label={`Move ${LABELS[id]} earlier`} disabled={index <= 0} onClick={() => move(-1)}>↑</button>
            <button className="button" aria-label={`Move ${LABELS[id]} later`} disabled={index < 0 || index === items.length - 1} onClick={() => move(1)}>↓</button>
          </div>
        })}
      </fieldset>)}
      <button className="button" onClick={() => onChange(DEFAULT_OVERVIEW_LAYOUT)}>Reset to defaults</button>
    </div>
  </details>
}
