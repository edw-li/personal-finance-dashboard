export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>{title}</h1>
      <p style={{ color: 'var(--muted)' }}>Coming soon.</p>
    </div>
  )
}
