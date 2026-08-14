import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
// importing from 'vitest/config' also loads vitest's `test` augmentation of UserConfig,
// so no triple-slash reference is needed (tseslint bans it once this import exists)
import { configDefaults } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
    // .worktrees holds full checkouts during plan execution; without this exclude,
    // vitest runs their duplicate test files against a second React install and fails.
    exclude: [...configDefaults.exclude, '.worktrees/**'],
  },
})
