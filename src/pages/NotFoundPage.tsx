import { Link, useLocation } from 'react-router-dom'
import PageFrame from '../components/shell/PageFrame'

// The real 404 (2026-08-25 polish §3): names the path that missed and offers the one
// useful move. Eager beside Login in App.tsx — an error surface must not wait on a chunk.
// Through PageFrame like every other page (2026-09-03 shell spec §5), permanently ready:
// there is nothing to load, and the shared title row is the point.
export default function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <div className="page">
      <PageFrame title="Not found" resource={{ status: 'ready' }}>
        <p className="empty-note">
          <span>No page at {pathname}.</span> <Link to="/">Back to the overview →</Link>
        </p>
      </PageFrame>
    </div>
  )
}
