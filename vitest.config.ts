import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { existsSync } from 'node:fs'

// Integration tests must never load .env.local -- that file points at production, and
// these tests create/delete real rows. They load .env.test instead (checked into git,
// safe: it only holds the standard local-Supabase-CLI default keys, which only work
// against a `supabase start` instance on this machine, never a real remote project).
const envFile = process.env.VITEST_INTEGRATION ? '.env.test' : '.env.local'
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
  },
})
