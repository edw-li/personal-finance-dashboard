// The sidebar's "Search or jump…" row asks the palette to open through this bus rather than
// a shared context — the palette is mounted once in Layout and must answer from anywhere
// (2026-09-03 shell spec §9). Same shape as the assistant drawer's open bus.
const EVENT = 'finance:palette-open'

export function requestPaletteOpen(): void {
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function onPaletteOpen(handler: () => void): () => void {
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
