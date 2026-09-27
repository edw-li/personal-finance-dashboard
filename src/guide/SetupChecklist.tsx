import type { GuideTask } from './types'
import { SETUP_LABELS, setupTaskState, useSetupProgress } from './setupProgress'
import { getLocal } from '../prefs/prefsStore'

export function SetupSummary({ tasks, onSelect }: { tasks: GuideTask[]; onSelect: (id: string) => void }) {
  const setup = useSetupProgress()
  if (!setup) return null
  const completed = tasks.filter((task) => setupTaskState(task.id, setup.progress, setup.status) !== 'pending').length
  const pending = tasks.filter((task) => setupTaskState(task.id, setup.progress, setup.status) === 'pending')
  const resume = pending.find((task) => task.id === setup.progress.lastTask) ?? pending[0]
  return (
    <div className="guide-setup-summary">
      <div>
        <strong>{completed} of {tasks.length} steps ready</strong>
        <progress value={completed} max={tasks.length} aria-label="Setup progress" />
        <p>Saved records count automatically. Review the evidence, or mark a step done or not needed.</p>
        <p className="guide-status-note" role="status">{setup.error ? `${setup.error}. ${setup.status ? 'Showing the last check.' : 'Automatic checks are unavailable; your marks are kept.'}` : setup.busy ? 'Checking your saved data…' : setup.status ? `Checked for ${setup.status.year} · ${new Date(setup.status.checked_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Sign in to check your saved data.'}</p>
      </div>
      <div className="guide-summary-actions">
        {resume && <button type="button" className="button" onClick={() => {
          const last = getLocal('guide_progress')?.lastTask
          onSelect((pending.find((task) => task.id === last) ?? resume).id)
        }}>Continue setup →</button>}
        <button type="button" className="button" disabled={setup.busy} onClick={setup.refresh}>Refresh status</button>
      </div>
    </div>
  )
}

export function SetupTaskProgress({ taskId }: { taskId: string }) {
  const setup = useSetupProgress()
  if (!setup || !taskId.startsWith('setup-')) return null
  const state = setupTaskState(taskId, setup.progress, setup.status)
  return (
    <div className="guide-setup-evidence">
      <strong>{state === 'pending' && !setup.status ? 'Not checked yet' : SETUP_LABELS[state]}</strong>
      <p>{setup.status?.steps[taskId]?.evidence ?? 'You can record your own progress while the automatic check is unavailable.'}</p>
      <div className="guide-progress-actions">
        <button type="button" className="button" aria-pressed={state === 'done'} onClick={() => setup.mark(taskId, 'done')}>Mark done</button>
        <button type="button" className="button" aria-pressed={state === 'skipped'} onClick={() => setup.mark(taskId, 'skipped')}>Not needed</button>
        {setup.progress.tasks[taskId] && <button type="button" className="button" onClick={() => setup.mark(taskId, null)}>Clear my mark</button>}
        <button type="button" className="button" disabled={setup.busy} onClick={setup.refresh}>{setup.busy ? 'Checking…' : 'Check again'}</button>
      </div>
      {setup.error && <p role="status">{setup.error}. Your marks are kept; try Check again.</p>}
    </div>
  )
}
