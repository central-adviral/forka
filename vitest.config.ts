import { defineConfig, defaultExclude } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { existsSync } from 'node:fs'

// No test run loads .env.local. That file points at production, and the strongest guarantee that
// a test cannot reach production is that its credentials are never in memory to begin with -- not
// that some other rule keeps the test from asking. CI proves it holds: the unit job runs with no
// Supabase environment at all, and every unit test mocks the client. The one that did not, and
// built a real service-role client out of .env.local, is fixed in sync-sales.test.ts.
//
// Integration tests load .env.test instead: checked into git, and safe because it holds only the
// standard local-Supabase-CLI default keys, which work against a `supabase start` instance on this
// machine and never against a real remote project.
const isIntegration = Boolean(process.env.VITEST_INTEGRATION)
if (isIntegration && existsSync('.env.test')) {
  process.loadEnvFile('.env.test')
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
