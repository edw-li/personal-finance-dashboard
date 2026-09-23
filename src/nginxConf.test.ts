import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The frontend image's serving contract (2026-09-23 spec §P2), pinned as text: comments may
// explain, only directives count. The local docker test in the lane report proves the
// behaviour (gzip + Vary on assets and JSON, .gz served as-is, SSE unbuffered, HTTP/2).
const ROOT = path.resolve(__dirname, '..')
const directives = (text: string) =>
  text.split('\n').map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean).join('\n')
const conf = directives(readFileSync(path.join(ROOT, 'nginx.conf'), 'utf8'))
const dockerfile = directives(readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8').replace(/\\\r?\n/g, ' '))
const gzipTypes = conf.match(/^gzip_types\s+([^;]+);/m)?.[1].split(/\s+/) ?? []

describe('nginx compression and HTTP/2', () => {
  it('compresses text assets and API JSON, prefers precompressed files and varies on encoding', () => {
    const lines = conf.split('\n')
    for (const directive of ['gzip on;', 'gzip_comp_level 5;', 'gzip_min_length 1024;', 'gzip_vary on;', 'gzip_proxied any;', 'gzip_static on;'])
      expect(lines).toContain(directive)
    expect(gzipTypes).toEqual(expect.arrayContaining([
      'application/json', 'application/javascript', 'text/javascript', 'text/css', 'image/svg+xml',
      'text/plain', 'text/calendar', 'application/manifest+json',
    ]))
  })

  it('never compresses the assistant’s event stream or a ZIP download', () => {
    expect(gzipTypes.length).toBeGreaterThan(0)
    expect(gzipTypes).not.toContain('text/event-stream')
    expect(gzipTypes.filter((type) => type.includes('zip'))).toEqual([])
  })

  it('speaks HTTP/2 on the TLS server, with the nginx >= 1.25.1 directive', () => {
    const tls = conf.slice(conf.indexOf('listen 443 ssl;'))
    expect(tls.slice(0, tls.indexOf('}'))).toContain('http2 on;')
    expect(conf).not.toMatch(/listen\s+443[^;]*\bhttp2\b/) // the deprecated listen flag
  })

  it('precompresses the built text assets once at image build and keeps the originals', () => {
    const run = dockerfile.split('\n').find((line) => line.includes('gzip -9')) ?? ''
    for (const ext of ['js', 'css', 'svg', 'html', 'json', 'txt', 'webmanifest'])
      expect(run).toContain(`'*.${ext}'`)
    expect(run).toContain('-size +1023c') // >= 1 KiB, nginx's gzip_min_length
    expect(run).toMatch(/gzip -9 -c "\$1" > "\$1\.gz"/) // -c: the original file stays
    expect(dockerfile.indexOf(run)).toBeGreaterThan(dockerfile.indexOf('FROM nginx'))
  })
})
