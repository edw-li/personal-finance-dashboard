import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
// importing from 'vitest/config' also loads vitest's `test` augmentation of UserConfig,
// so no triple-slash reference is needed (tseslint bans it once this import exists)
import { configDefaults } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  build: {
    // The echarts subset is one indivisible LAZY chunk, reached only from the chart
    // routes — the entry (~249 kB) never loads it. Raising the advisory limit documents
    // that it is deliberate, not forgotten; the headroom is small on purpose, so pulling
    // more echarts modules in trips it again. History: 678.97 kB at the 700 limit; the
    // dataZoom component took it to 694.77; ScatterChart (net-worth note markers) pushes
    // past 700, hence 720; SankeyChart (the /spending and /paycheck flow cards) pushes
    // past 720, hence 770.
    chunkSizeWarningLimit: 770,
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
