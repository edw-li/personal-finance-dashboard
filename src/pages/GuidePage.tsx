import PageFrame from '../components/shell/PageFrame'

export default function GuidePage() {
  return (
    <div className="page guide-page">
      <PageFrame title="Guide" resource={{ status: 'ready' }}>
        <p className="empty-note">The guide is being written.</p>
      </PageFrame>
    </div>
  )
}
