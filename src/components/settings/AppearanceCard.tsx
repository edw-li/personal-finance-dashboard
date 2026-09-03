import InfoHint from '../InfoHint'
import Segmented from '../shell/Segmented'
import { useTheme, type Density, type ThemeChoice } from '../shell/ThemeProvider'
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

export default function AppearanceCard() {
  const { theme, density, setTheme, setDensity } = useTheme()
  return (
    <section className="card span-6" id="appearance" role="region" aria-label="Appearance">
      <h2 className="eyebrow">
        Appearance
        <InfoHint text="Theme and density are remembered in this browser. System follows your operating system's light or dark setting live." />
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
      <p className="drill-hint">Remembered in this browser only.</p>
    </section>
  )
}
