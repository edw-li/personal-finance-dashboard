import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
// importing from 'vitest/config' also loads vitest's `test` augmentation of UserConfig,
// so no triple-slash reference is needed (tseslint bans it once this import exists)
import { configDefaults } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  build: {
    // The echarts subset is one indivisible LAZY chunk (674.33 kB raw / 229.72 kB gzip),
    // reached only from the six chart routes — the entry is 248.57 kB and never loads it.
    // Raising the advisory limit documents that it is deliberate, not forgotten; the
    // headroom is small on purpose, so pulling more echarts modules in trips it again.
    chunkSizeWarningLimit: 700,
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
    exclude: [...configDefaults.exclude, '.worktrees/**'],
  },
})
