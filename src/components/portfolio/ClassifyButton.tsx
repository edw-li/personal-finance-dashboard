// The one verb that closes the "Unclassified" gap (2026-09-13 polish §13), spelled the same
// wherever it appears — the ranked row, the slice detail, the targets form. Primary by default;
// the targets form passes the quiet class because Save/Activate are that form's primaries.
export default function ClassifyButton({ count, onClick, className = 'button button-primary' }: {
  count: number
  onClick: () => void
  className?: string
}) {
  return (
    <button type="button" className={`${className} allocation-classify`} onClick={onClick}>
      Classify these {count} {count === 1 ? 'holding' : 'holdings'}
    </button>
  )
}
