import { createContext, useContext } from 'react'
import type { SetupStatus } from '../api/guide'
import { EMPTY_GUIDE_PROGRESS, isSetupTaskId } from '../prefs/guideProgress'
import type { GuideProgress } from '../prefs/guideProgress'
import { getLocal, setLocal } from '../prefs/prefsStore'

export type SetupTaskState = 'detected' | 'done' | 'skipped' | 'pending'
export function setupTaskState(id: string, progress: GuideProgress, status: SetupStatus | null): SetupTaskState {
  return progress.tasks[id] ?? (status?.steps[id]?.complete ? 'detected' : 'pending')
}
export const SETUP_LABELS: Record<SetupTaskState, string> = {
  detected: 'Found in your data', done: 'Marked done', skipped: 'Not needed', pending: 'To do',
}
export function rememberSetupTask(id: string) {
  if (!isSetupTaskId(id)) return
  const progress = getLocal('guide_progress') ?? EMPTY_GUIDE_PROGRESS
  if (progress.lastTask !== id) setLocal('guide_progress', { ...progress, lastTask: id })
}
export interface SetupProgressValue {
  progress: GuideProgress
  status: SetupStatus | null
  busy: boolean
  error: string | null
  refresh: () => void
  mark: (id: string, value: 'done' | 'skipped' | null) => void
}
export const SetupProgressContext = createContext<SetupProgressValue | null>(null)
export const useSetupProgress = () => useContext(SetupProgressContext)
