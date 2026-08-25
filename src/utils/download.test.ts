import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadDataUrl, downloadText, toCsv } from './download'

describe('toCsv', () => {
  it('joins headers + rows with CRLF and ends with one', () => {
    expect(toCsv(['Month', 'Total'], [['2026-06-01', '2750.00']])).toBe(
      'Month,Total\r\n2026-06-01,2750.00\r\n',
    )
  })

  it('quotes fields carrying commas, quotes or newlines — quotes doubled', () => {
    expect(
      toCsv(['Name', 'Note'], [['Food, dining', 'said "no"'], ['a\nb', 'c\rd']]),
    ).toBe('Name,Note\r\n"Food, dining","said ""no"""\r\n"a\nb","c\rd"\r\n')
  })

  it('stringifies numbers and leaves empty cells empty', () => {
    expect(toCsv(['Year', 'Tax'], [[2024, ''], [2025, 0]])).toBe(
      'Year,Tax\r\n2024,\r\n2025,0\r\n',
    )
  })

  it('serializes a headers-only table', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n')
  })
})

// jsdom's Blob implements none of text()/arrayBuffer()/stream() — FileReader is the one
// reader it does ship, so it is how a Blob's bytes are asserted here.
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

describe('the download shims', () => {
  // What each captured anchor looked like AT click time — the anchor is removed right
  // after, so reading it later would see nothing.
  let clicks: { download: string; href: string }[]

  beforeEach(() => {
    clicks = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ download: this.download, href: this.href })
    })
    // jsdom implements neither — the stubs also let the Blob be captured.
    URL.createObjectURL = vi.fn(() => 'blob:mock-1')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('downloadDataUrl clicks a temporary anchor and removes it', () => {
    downloadDataUrl('data:image/png;base64,PNG', 'spending.png')
    expect(clicks).toEqual([{ download: 'spending.png', href: 'data:image/png;base64,PNG' }])
    expect(document.querySelector('a')).toBeNull()
  })

  it('downloadText wraps the text in a typed Blob, downloads it and revokes the URL', async () => {
    downloadText('Month,Total\r\n', 'spending.csv', 'text/csv;charset=utf-8')
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect(await readBlob(blob)).toBe('Month,Total\r\n')
    expect(clicks).toEqual([{ download: 'spending.csv', href: 'blob:mock-1' }])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
  })
})
