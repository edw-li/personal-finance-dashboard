import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
// importing from 'vitest/config' also loads vitest's `test` augmentation of UserConfig,
// so no triple-slash reference is needed (tseslint bans it once this import exists)
import { configDefaults } from 'vitest/config'

// The build's identity (2026-09-03 shell spec §12), stamped into the bundle at build time
// and shown in the sidebar footer: the one string that tells two open tabs apart and turns
// a bug report into a diff. Any failure — no git, no repo, a tarball checkout — is a
// "dev" build, never a broken build: the hash is diagnostics, not a dependency.
//
// BUILD_HASH wins over the git probe because the Docker build has neither git nor the repo
// (.dockerignore excludes .git), so the probe there ALWAYS falls through to "dev" — the one
// place the hash matters most. The Dockerfile takes it as a build arg and exports it here.
function buildHash(): string {
  const injected = process.env.BUILD_HASH?.trim()
  if (injected) return injected
  try {
    return (
      execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || 'dev'
    )
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  plugins: [react()],
  // Evaluated ONCE, when the config loads: a dev server keeps the hash it booted with, so
  // commits made mid-session only show up after a restart. Builds are one-shot, so prod is
  // always exact.
  define: { __BUILD_HASH__: JSON.stringify(buildHash()) },
  build: {
    // The echarts subset is one indivisible LAZY chunk, reached only from the chart
    // routes — the entry (~249 kB) never loads it. Raising the advisory limit documents
    // that it is deliberate, not forgotten; the headroom is small on purpose, so pulling
    // more echarts modules in trips it again. History: 678.97 kB at the 700 limit; the
    // dataZoom component took it to 694.77; ScatterChart (net-worth note markers) pushes
    // past 700, hence 720; SankeyChart (the /spending and /paycheck flow cards) lands at
    // 723.95 (724.53 with the shared marks module), hence 730; the chart grammar's
    // MarkArea/MarkPoint/Aria components (2026-09-04) push past it, hence 760.
    chunkSizeWarningLimit: 760,
  },
  server: {
    proxy: {
      // 127.0.0.1, not localhost: Node >=17 resolves localhost to ::1 first, but
      // uvicorn binds IPv4 only — every dev API call would 500 with ECONNREFUSED ::1.
      '/api': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'jsdom',
    // .worktrees holds full checkouts during plan execution; without this exclude,
    // vitest runs their duplicate test files against a second React install and fails.
    exclude: [...configDefaults.exclude, '.worktrees/**', '.claude/worktrees/**'],
  },
})
