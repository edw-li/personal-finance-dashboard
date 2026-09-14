import { Link } from 'react-router-dom'
import { renderSteps } from './renderSteps'
import type { GuideTask } from './types'

// One task = one <li> with its own id (an anchor the palette and pointer tasks target), a
// verb-first h4, the on-screen path, numbered steps, its own traps, and the Go link. The
// list is an <ol> because the tasks on a card are in the order a reader does them.
export default function GuideTaskList({ tasks }: { tasks: GuideTask[] }) {
  return (
    <ol className="guide-tasks">
      {tasks.map((task) => (
        <li key={task.id} id={task.id} className="guide-task">
          <h4 className="guide-task-title">{task.title}</h4>
          <p className="guide-where">
            <span className="guide-where-label">Where:</span> {task.where}
          </p>
          <ol className="guide-steps">
            {task.steps.map((step, index) => (
              <li key={index}>{renderSteps(step)}</li>
            ))}
          </ol>
          {task.watch && task.watch.length > 0 && (
            <ul className="guide-task-watch">
              {task.watch.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {task.to && (
            <Link className="guide-go" to={task.to}>
              Go →
            </Link>
          )}
        </li>
      ))}
    </ol>
  )
}
