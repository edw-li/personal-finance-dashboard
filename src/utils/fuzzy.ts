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
  let score = 0
  let searchFrom = 0
  let lastHit = -2 // never adjacent to a first hit at index 0
  for (const ch of q) {
    const hit = t.indexOf(ch, searchFrom)
    if (hit === -1) return null
    if (hit === lastHit + 1) score += 3
    else if (hit === 0 || t[hit - 1] === ' ') score += 2
    else score += 1
    lastHit = hit
    searchFrom = hit + 1
  }
  return score
}
