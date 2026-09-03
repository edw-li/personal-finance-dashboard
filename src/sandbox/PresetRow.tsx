import './sandbox.css'

// Preset chips (2026-09-03 planning-sandboxes spec §8.4): each sets several knobs at once,
// `immediate`. A preset is a function of the baseline payload and reference data already on
// the page — the URL carries the expanded knobs, never the preset's name. One whose datum is
// missing renders disabled with a `title` naming what to enter and where.
export interface Preset {
  id: string
  label: string
  apply: () => void
  disabled?: boolean
  title?: string
}

export default function PresetRow({
  presets,
  ariaLabel = 'Presets',
}: {
  presets: Preset[]
  ariaLabel?: string
}) {
  if (presets.length === 0) return null
  return (
    <div className="chip-row sandbox-presets" role="group" aria-label={ariaLabel}>
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="chip"
          disabled={preset.disabled}
          title={preset.title}
          onClick={preset.apply}
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}
