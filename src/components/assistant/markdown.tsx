// Hand-rolled, sanitizing-by-construction markdown → React nodes (spec §9): every piece
// of text flows through React children (auto-escaped), and no construct ever becomes an
// <a>, <img>, or raw HTML. Supported: paragraphs, #-headings (rendered as styled
// <strong> — the page owns the heading outline), -/* and 1. lists, pipe tables, fenced
// code, and inline `code` / **bold** / *italic*. Links render as "label (url)" text.
//
// This runs on every streamed token, against text that is usually a TRUNCATED prefix of a
// real document, so two properties are load-bearing throughout: every regex is linear, and
// every unterminated construct degrades to something renderable instead of throwing.
import type { ReactNode } from 'react'

// Emphasis runs must be flanked by non-space: a lone `*` between spaces is multiplication,
// not markup, and finance answers are full of it ("$5 * 12 = $60" must keep its asterisk).
const INLINE_TOKEN =
  /(`[^`]+`|\*\*[^*\s](?:[^*]*[^*\s])?\*\*|\*[^*\s](?:[^*]*[^*\s])?\*|\[[^\]]+\]\([^)]+\))/g

const BULLET_ITEM = /^\s*[-*]\s+/
const ORDERED_ITEM = /^\s*(\d+)\.\s+/
const HEADING = /^(#{1,6})\s+(.*)$/

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
  // Three linear passes, deliberately NOT one regex. The obvious pattern for this
  // (`[\s:|-]+\|[\s:|-]*`) puts `|` inside the class AND requires a literal `|`, so the two
  // overlap: on a long pipe/dash line that ultimately fails, the engine retries every split
  // point and the check goes quadratic (seconds on a pasted table, per candidate line, per
  // streamed token). Anchored `^[\s:|-]+$` has no such ambiguity.
  const t = line.trim()
  return t.includes('|') && t.includes('-') && /^[\s:|-]+$/.test(t)
}

function isFence(line: string): boolean {
  return line.trimStart().startsWith('```')
}

function startsTable(lines: string[], i: number): boolean {
  return lines[i].includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])
}

// The single source of truth for "line i opens a new block". Both greedy sweeps below (the
// paragraph run and the table-row run) consult it, so neither can disagree with the
// dispatcher about where its block ended — the bug that let a later `## Cost | Rev` heading
// get swallowed as a fourth table row just because it contained a pipe.
function startsNewBlock(lines: string[], i: number): boolean {
  const line = lines[i]
  return (
    BULLET_ITEM.test(line) ||
    ORDERED_ITEM.test(line) ||
    HEADING.test(line) ||
    isFence(line) ||
    startsTable(lines, i)
  )
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
    if (isFence(line)) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !isFence(lines[i])) {
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
    const heading = HEADING.exec(line)
    if (heading) {
      out.push(
        <p key={key++} className="md-heading-row">
          <strong className="md-heading">{renderInline(heading[2])}</strong>
        </p>,
      )
      i += 1
      continue
    }
    if (BULLET_ITEM.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && BULLET_ITEM.test(lines[i])) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(BULLET_ITEM, ''))}</li>)
        i += 1
      }
      out.push(<ul key={key++}>{items}</ul>)
      continue
    }
    if (ORDERED_ITEM.test(line)) {
      // Honour the model's numbering: an answer that continues "3. …" after prose means it,
      // and a browser would otherwise silently renumber it to 1.
      const first = Number(ORDERED_ITEM.exec(line)?.[1] ?? 1)
      const items: ReactNode[] = []
      while (i < lines.length && ORDERED_ITEM.test(lines[i])) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(ORDERED_ITEM, ''))}</li>)
        i += 1
      }
      out.push(
        <ol key={key++} start={first === 1 ? undefined : first}>
          {items}
        </ol>,
      )
      continue
    }
    if (startsTable(lines, i)) {
      const header = tableCells(line)
      i += 2 // header + divider
      const rows: string[][] = []
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        lines[i].includes('|') &&
        !startsNewBlock(lines, i)
      ) {
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
    while (i < lines.length && lines[i].trim() !== '' && !startsNewBlock(lines, i)) {
      para.push(lines[i])
      i += 1
    }
    out.push(<p key={key++}>{renderInline(para.join(' '))}</p>)
  }
  return out
}
