// Chart-export shims (2026-08-25 spec §2a). A module of their own so the export menu's
// tests can vi.mock the file-drop side effects while the menu logic stays real.

/** The caller-supplied CSV shape — explicit rows, never introspected from echarts
 * options (spec Decision log). */
export interface ExportTable {
  headers: string[]
  rows: (string | number)[][]
}

/** RFC-4180 quoting: a field carrying a comma, quote, CR or LF is wrapped in quotes with
 * inner quotes doubled; rows join with CRLF and the file ends with one. UTF-8 is the
 * Blob's job (downloadText's mime) — no BOM: the data is the app's own ASCII-safe
 * figures and ISO dates. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const field = (value: string | number): string => {
    const text = String(value)
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const lines = [headers, ...rows].map((row) => row.map(field).join(','))
  return `${lines.join('\r\n')}\r\n`
}

/** Click-through a temporary anchor — the least-magic download that works everywhere. */
export function downloadDataUrl(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** Text → typed Blob → object URL → anchor; revoked after so exports don't leak blobs.
 * The revoke is DEFERRED to a macrotask: Safari has historically aborted a download when
 * the URL is revoked synchronously in the same tick as the click, and the anchor is
 * already gone by then either way. A task later still frees the blob well before the
 * page can accumulate them. */
export function downloadText(text: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  try {
    downloadDataUrl(url, filename)
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
