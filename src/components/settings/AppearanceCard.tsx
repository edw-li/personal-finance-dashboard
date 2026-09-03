import { useEffect, useState } from 'react'
import { getLocal, isSynced, setLocal, subscribe, subscribeSynced } from '../../prefs/prefsStore'
import InfoHint from '../InfoHint'
import { NAV_ITEMS } from '../navItems'
import Segmented from '../shell/Segmented'
import { useTheme, type Density, type ThemeChoice } from '../shell/ThemeProvider'
import { setChartDecals, useChartDecals } from '../useChartDecals'
import '../panels.css'
// settings.css owns .settings-field, so the card carries its own stylesheet rather than
// depending on SettingsPage happening to import it — the family's standing convention.
import './settings.css'

// Theme, density and the landing page (2026-09-03 shell spec §11, data-lifecycle spec §10).
// Browser-local FIRST and then the account: prefsStore paints from this browser and syncs at
// sign-in, and the note under the fields says which of the two the reader is looking at.
const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

const DENSITIES: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

const DECALS: { value: 'off' | 'on'; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
]

export default function AppearanceCard() {
  const { theme, density, setTheme, setDensity } = useTheme()
  const decals = useChartDecals()
  const [landing, setLanding] = useState(() => getLocal('landing_page') ?? '/')
  const [synced, setSynced] = useState(isSynced)
  useEffect(() => subscribeSynced(setSynced), [])
  useEffect(() => subscribe('landing_page', setLanding), [])
  return (
    <section className="card span-6" id="appearance" role="region" aria-label="Appearance">
      <h2 className="eyebrow">
        Appearance
        <InfoHint text="Theme, density and your landing page. They paint from this browser first and follow your account once signed in — a second browser picks them up at its next sign-in. System follows your operating system's light or dark setting live. Chart patterns add textures to stacked bars and pies so segments read apart without colour." />
      </h2>
      <div className="settings-field">
        <span className="eyebrow">Theme</span>
        <Segmented
          variant="toggle"
          ariaLabel="Theme"
          options={THEMES}
          value={theme}
          onChange={setTheme}
        />
      </div>
      <div className="settings-field">
        <span className="eyebrow">Density</span>
        <Segmented
          variant="toggle"
          ariaLabel="Density"
          options={DENSITIES}
          value={density}
          onChange={setDensity}
        />
      </div>
      <div className="settings-field">
        <span className="eyebrow">Chart patterns</span>
        <Segmented
          variant="toggle"
          ariaLabel="Chart patterns"
          options={DECALS}
          value={decals ? 'on' : 'off'}
          onChange={(next) => setChartDecals(next === 'on')}
        />
      </div>
      <div className="settings-field">
        <label className="eyebrow" htmlFor="landing-page">
          Landing page
        </label>
        <select
          id="landing-page"
          className="field-input"
          value={landing}
          onChange={(e) => {
            setLanding(e.target.value)
            setLocal('landing_page', e.target.value)
          }}
        >
          {NAV_ITEMS.map((item) => (
            <option key={item.to} value={item.to}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-note">
        {synced
          ? 'Synced to your account.'
          : 'Remembered in this browser; synced to your account once signed in.'}
      </p>
    </section>
  )
}
