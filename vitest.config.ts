import { defineConfig, defaultExclude } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { existsSync } from 'node:fs'

// Integration tests must never load .env.local -- that file points at production, and
// these tests create/delete real rows. They load .env.test instead (checked into git,
// safe: it only holds the standard local-Supabase-CLI default keys, which only work
// against a `supabase start` instance on this machine, never a real remote project).
const isIntegration = Boolean(process.env.VITEST_INTEGRATION)
const envFile = isIntegration ? '.env.test' : '.env.local'
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}

// Picking the env file was not enough on its own: a plain `vitest run` loads .env.local
// AND still collects the integration tests, which then create rows straight in production
// (it happened on 2026-09-04, and again on 2026-09-05). These two guards make that
// impossible rather than merely discouraged.
if (isIntegration) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!url.includes('127.0.0.1') && !url.includes('localhost')) {
    throw new Error(
      `Integration tests only run against a local Supabase. NEXT_PUBLIC_SUPABASE_URL is "${url}". ` +
        'Start one with `supabase start` and make sure .env.test is the file being loaded.'
    )
  }
}

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
    // Vercel runs the app in UTC. Running the suite in the developer's own zone (BRT here) let a
    // whole class of date bug pass unseen: the code read the server's calendar day, the test
    // asserted against that same server's calendar day, and both shifted together. Matching
    // production is what makes those assertions mean anything.
    env: { TZ: 'UTC' },
    // Integration tests all hit one local Postgres and create users through the same auth server,
    // so running files in parallel makes them fight: whole files failed to start on some runs and
    // an RLS assertion failed on others, differently each time. Sequential is the honest setting
    // for a shared-database suite -- a suite that fails at random is one nobody believes.
    fileParallelism: !isIntegration,
    // Outside integration mode the env in memory is production's, so these files are not
    // skipped by convention -- they are never collected in the first place.
    exclude: isIntegration ? defaultExclude : [...defaultExclude, '**/*.integration.test.ts'],
  },
})
