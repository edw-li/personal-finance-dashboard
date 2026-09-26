import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

/** Import lane artifacts as historical evidence, never as assertions run on the merged head.
 * Manifest entries: { lane, head, file, status: 'passed'|'partial'|'observed', covers: string[], note? }.
 * The manifest itself belongs in ignored scratch storage because artifact paths are machine-specific.
 */
export function readEvidence(manifestFile) {
  if (!manifestFile) return []
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  if (!Array.isArray(manifest.artifacts)) throw new Error('EVIDENCE_MANIFEST needs an artifacts array')
  return manifest.artifacts.map(entry => {
    if (!['L5', 'L6', 'L7', 'L8'].includes(entry.lane) || !entry.head || !entry.file || !entry.covers?.length ||
        !['passed', 'partial', 'observed'].includes(entry.status)) throw new Error('Incomplete lane evidence entry')
    const file = path.resolve(path.dirname(manifestFile), entry.file)
    const bytes = readFileSync(file), data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
    const assertions = data.checks ?? data.results ?? (Array.isArray(data) ? data : [])
    if (!Array.isArray(assertions) || !assertions.length) throw new Error(`${entry.lane} ${path.basename(file)} contains no recognized evidence records`)
    const recognized = assertions.filter(record => entry.lane === 'L5' ? typeof record.check === 'string'
      : entry.lane === 'L6' ? typeof record.surface === 'string'
        : entry.lane === 'L7' ? typeof record.name === 'string'
          : ['dark', 'light'].includes(record.theme))
    if (recognized.length !== assertions.length) throw new Error(`${entry.lane} ${path.basename(file)} has an unrecognized record schema`)
    const error = data.error ?? null
    const errors = []
    const failures = []
    const affirmative = new Set(['ok', 'pass', 'exactUndo', 'addFlash', 'deletedBeforeToast', 'focused', 'selected', 'inView', 'fullyVisible'])
    const errorKeys = new Set(['consoleErrors', 'pageErrors', 'badResponses', 'requestFailures', 'writesBlocked', 'cleanupErrors'])
    const inspect = (value, location) => {
      if (!value || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        if (affirmative.has(key) && child === false) failures.push({ path: `${location}.${key}`, value: false })
        if (key === 'error' && child) failures.push({ path: `${location}.${key}`, value: child })
        if (errorKeys.has(key) && Array.isArray(child)) errors.push(...child.map(value => ({ path: `${location}.${key}`, value })))
        if (['dialogs', 'nativeDialogs', 'dialogCount'].includes(key) && (Array.isArray(child) ? child.length : Number(child))) errors.push({ path: `${location}.${key}`, value: child })
        if (key === 'cleanup' && Array.isArray(child)) for (const item of child) if (typeof item === 'string' && /fail|error/i.test(item)) failures.push({ path: `${location}.cleanup`, value: item })
        if (!errorKeys.has(key)) inspect(child, `${location}.${key}`)
      }
    }
    inspect(data, 'artifact')
    if (entry.status === 'passed' && (error || errors.length || failures.length)) throw new Error(`${entry.lane} ${path.basename(file)} claims passed but contains failures; mark partial and name its supplement`)
    return { ...entry, file, sha256: createHash('sha256').update(bytes).digest('hex'), recordedChecks: recognized.length, error, errors, failures, source: 'lane-browser-evidence', rerunOnMergedHead: false }
  })
}
