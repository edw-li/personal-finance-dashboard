export interface GuideProgress {
  tasks: Record<string, 'done' | 'skipped'>
  lastTask: string | null
}

export const EMPTY_GUIDE_PROGRESS: GuideProgress = { tasks: {}, lastTask: null }
export const isSetupTaskId = (value: unknown): value is string =>
  typeof value === 'string' && /^setup-[a-z][a-z0-9-]{0,79}$/.test(value)

export function isGuideProgress(value: unknown): value is GuideProgress {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => key !== 'tasks' && key !== 'lastTask')) return false
  if (item.lastTask !== null && !isSetupTaskId(item.lastTask)) return false
  if (typeof item.tasks !== 'object' || item.tasks === null || Array.isArray(item.tasks)) return false
  const entries = Object.entries(item.tasks)
  return entries.length <= 50 && entries.every(([id, status]) => isSetupTaskId(id) && (status === 'done' || status === 'skipped'))
}
