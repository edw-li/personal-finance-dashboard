// Adapter for the audited lane flow drivers. Explicitly restricted to V's writable local twin.
// Import this instead of the historical scratch audit-lib; token contents never leave the harness.
import { configuration, launch, open as openContext, settle, sleep } from './harness.mjs'
export { launch, settle, sleep }
const config = configuration({ writable: true })
export const BASE = config.base
export const API_BASE = config.apiBase
export const provenance = { productHead: config.productHead, probeHead: config.head, sourceSha256: config.source?.sha256, acquiredAt: config.source?.acquiredAt }
export function open(browser, options = {}) {
  const { writes = false, theme = 'dark', width = 1440, height = 900, ...rest } = options
  return openContext(browser, { ...config, writable: writes === true }, { theme, width, height, ...rest })
}
