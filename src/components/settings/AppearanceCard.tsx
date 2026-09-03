import InfoHint from '../InfoHint'
import Segmented from '../shell/Segmented'
import { useTheme, type Density, type ThemeChoice } from '../shell/ThemeProvider'
import { setChartDecals, useChartDecals } from '../useChartDecals'
import '../panels.css'
// settings.css owns .settings-field, so the card carries its own stylesheet rather than
// depending on SettingsPage happening to import it — the family's standing convention.
import './settings.css'

// Theme and density (2026-09-03 shell spec §11). Browser-local for now — the note says so,
// because a preference that does not follow you to another device deserves a sentence.
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
  return (
    <section className="card span-6" id="appearance" role="region" aria-label="Appearance">
      <h2 className="eyebrow">
        Appearance
        <InfoHint text="Theme, density and chart patterns are remembered in this browser. System follows your operating system's light or dark setting live. Chart patterns add textures to stacked bars and pies so segments read apart without colour." />
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
      <p className="settings-note">Remembered in this browser only.</p>
    </section>
  )
}
