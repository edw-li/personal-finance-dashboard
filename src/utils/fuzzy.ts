/**
 * Subsequence fuzzy match — the command palette's ranking (2026-08-25 polish §9; no
 * library by design). null = the query is NOT a subsequence of the text. Otherwise an
 * integer score per query character: 3 for extending a consecutive run, 2 for landing on
 * a word head (index 0 or after a space), 1 for a scattered hit — so "port" ranks
 * "Portfolio" first and "nw" still reaches "Net worth" through its word heads.
 * Case-insensitive; the empty query matches everything at 0.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (q === '') return 0
  // One greedy pass is LEFTMOST-biased, and leftmost is not always best: in "Ask
  // assistant" the query "assistant" has its a-s stolen by "As"k, leaving the real word
  // to be matched scattered — scoring below a plain "Assistant" that means less. So try
  // the alignment that starts at each WORD HEAD (plus 0) and keep the strongest; the
  // leftmost pass is still among them, so no score can drop. Word heads only — starting
  // mid-word is what the greedy pass already explores.
  let best: number | null = null
  for (let start = 0; start < t.length; start++) {
    if (start !== 0 && t[start - 1] !== ' ') continue
    const score = greedy(q, t, start)
    if (score !== null && (best === null || score > best)) best = score
  }
  return best
}

/** The leftmost greedy alignment of `query` in `target`, ignoring everything before
 *  `start`. Word-head and run bonuses are still measured against the FULL target, so a
 *  later start never invents a bonus the text does not have. */
function greedy(query: string, target: string, start: number): number | null {
  let score = 0
  let searchFrom = start
  let lastHit = start - 2 // never adjacent to a first hit at `start`
  for (const ch of query) {
    const hit = target.indexOf(ch, searchFrom)
    if (hit === -1) return null
    if (hit === lastHit + 1) score += 3
    else if (hit === 0 || target[hit - 1] === ' ') score += 2
    else score += 1
    lastHit = hit
    searchFrom = hit + 1
  }
  return score
}
