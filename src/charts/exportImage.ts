// The PNG export's caption strip (chart spec §14) and the clipboard's Blob. Pure DOM/canvas
// work, no React, no echarts — testable with a stubbed Image and 2d context. Where the canvas
// cannot draw (jsdom, a blocked canvas) the RAW snapshot comes back uncaptioned: an export
// must never fail on decoration.
export interface CaptionInput {
  title: string
  caption?: string
  /** formatDate(today) — passed in so the module stays clock-free. */
  exportedOn: string
  /** The resolved theme's tokens: the strip is painted in the palette the chart was drawn in. */
  surface: string
  ink: string
  muted: string
}

/** EChart snapshots at pixelRatio 2 (ChartExportMenu); the strip is laid out in that scale. */
const SCALE = 2
const STRIP = 64 * SCALE
const PAD = 16 * SCALE
const FONT = "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('export image failed to decode'))
    image.src = src
  })
}

export async function captionedPng(dataUrl: string, input: CaptionInput): Promise<string> {
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (context === null) return dataUrl
  canvas.width = image.width
  canvas.height = image.height + STRIP
  context.fillStyle = input.surface
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = input.ink
  context.font = `600 ${13 * SCALE}px ${FONT}`
  context.fillText(input.title, PAD, 24 * SCALE)
  context.fillStyle = input.muted
  context.font = `${11 * SCALE}px ${FONT}`
  context.fillText([input.caption, `Exported ${input.exportedOn}`].filter(Boolean).join(' · '), PAD, 44 * SCALE)
  context.drawImage(image, 0, STRIP)
  return canvas.toDataURL('image/png')
}

/** `data:<mime>;base64,<body>` → Blob, without a fetch (jsdom has none for data URLs). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body = ''] = dataUrl.split(',')
  const mime = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream'
  const bytes = atob(body)
  const buffer = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i)
  return new Blob([buffer], { type: mime })
}
