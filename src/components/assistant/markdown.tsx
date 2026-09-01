// Hand-rolled, sanitizing-by-construction markdown → React nodes (spec §9): every piece
// of text flows through React children (auto-escaped), and no construct ever becomes an
// <a>, <img>, or raw HTML. Supported: paragraphs, #-headings (rendered as styled
// <strong> — the page owns the heading outline), -/* and 1. lists, pipe tables, fenced
// code, and inline `code` / **bold** / *italic*. Links render as "label (url)" text.
import type { ReactNode } from 'react'

const INLINE_TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g

export function renderInline(text: string): ReactNode[] {
  // A capturing split interleaves the separators with the gaps, and adjacent tokens leave
  // empty gaps behind; drop them so runs of text stay contiguous.
  const parts = text.split(INLINE_TOKEN).filter((part) => part !== '')
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    // Plain text on purpose: the model must not mint navigation (spec §13).
    if (link) return `${link[1]} (${link[2]})`
    // A bare string, not a <span>: React escapes strings exactly the same way, so the
    // sanitization contract is untouched, and it keeps the text a DIRECT child of whatever
    // wraps it. That matters — an interposed <span> would make the enclosing <strong>/<th>
    // textless to anything reading a node's own text (getByText, and screen readers that
    // flatten by node).
    return part
  })
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')
}

function tableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

export function renderMarkdown(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }
    // Fenced code: swallow to the closing fence (or EOF — stream-in-progress armor).
    if (line.trimStart().startsWith('```')) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // the closing fence, when present
      out.push(
        <pre key={key++}>
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      out.push(
        <p key={key++} className="md-heading-row">
          <strong className="md-heading">{renderInline(heading[2])}</strong>
        </p>,
      )
      i += 1
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>)
        i += 1
      }
      out.push(<ul key={key++}>{items}</ul>)
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(
          <li key={items.length}>{renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>,
        )
        i += 1
      }
      out.push(<ol key={key++}>{items}</ol>)
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = tableCells(line)
      i += 2 // header + divider
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(tableCells(lines[i]))
        i += 1
      }
      out.push(
        <table key={key++} className="md-table">
          <thead>
            <tr>
              {header.map((cell, c) => (
                <th key={c}>{renderInline(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{renderInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      )
      continue
    }
    // Paragraph: greedy to the next blank/structural line.
    const para: string[] = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !lines[i].trimStart().startsWith('```') &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1]))
    ) {
      para.push(lines[i])
      i += 1
    }
    out.push(<p key={key++}>{renderInline(para.join(' '))}</p>)
  }
  return out
}
