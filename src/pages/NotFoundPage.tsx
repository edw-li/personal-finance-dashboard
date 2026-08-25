import { Link, useLocation } from 'react-router-dom'
import '../components/panels.css'

// The real 404 (2026-08-25 polish §3): names the path that missed and offers the one
// useful move. Eager beside Login in App.tsx — an error surface must not wait on a chunk.
export default function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <div className="page">
      <header className="page-header">
        <h1>Not found</h1>
      </header>
      <p className="empty-note">
        <span>No page at {pathname}.</span> <Link to="/">Back to the overview →</Link>
      </p>
    </div>
  )
}
