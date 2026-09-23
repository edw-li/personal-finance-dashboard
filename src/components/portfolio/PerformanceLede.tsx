import type { LedeText } from './benchmarkLede'

/** The performance cards' one-line answer (2026-09-23 spec §C8), set the same way on Portfolio and
 *  the Overview (code review 9): the words in the strip's muted ink, the figure in its bold ink. */
export default function PerformanceLede({ line }: { line: LedeText }) {
  return (
    <>
      {line.text}
      {line.amount !== null && (
        <>
          {' '}
          <b>{line.amount}</b>
        </>
      )}
    </>
  )
}
