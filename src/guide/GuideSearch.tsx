import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { buildGuideIndex, searchExcerpt, searchGuide } from './search'

export default function GuideSearch() {
  const [query, setQuery] = useState('')
  const entries = useMemo(() => buildGuideIndex(), [])
  const results = searchGuide(query, entries)
  return <div className="guide-search" role="search" aria-label="Guide">
    <label htmlFor="guide-search">Find instructions or a definition</label>
    <div className="guide-search-input">
      <input id="guide-search" type="search" value={query} placeholder="Try ‘add a card’, ‘blank’, or ‘FI target’" aria-describedby="guide-search-status"
        onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setQuery('') } }} />
      {query && <button type="button" className="button" onClick={() => { setQuery(''); document.getElementById('guide-search')?.focus() }}>Clear</button>}
    </div>
    <p id="guide-search-status" role="status" className="guide-status-note">{query.trim() ? `${results.length} result${results.length === 1 ? '' : 's'}${results.length > 15 ? ' · Showing the first 15; add a word to narrow your search.' : ''}` : 'Search all chapters, setup steps and reference material.'}</p>
    {query.trim() && <div className="guide-search-results">
      {results.length ? <ul>{results.slice(0, 15).map((entry) => <li key={entry.id}>
        <Link to={entry.to} onClick={() => setQuery('')}><strong>{entry.title}</strong><span>{entry.chapter} · {entry.card} · {entry.kind}</span><p>{searchExcerpt(entry.text, query)}</p></Link>
      </li>)}</ul> : <p>No matching instructions. Try a page name or a shorter phrase, such as “budget” or “tax year”.</p>}
    </div>}
  </div>
}
