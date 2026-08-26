import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { existsSync } from 'node:fs'

if (existsSync('.env.local')) {
  process.loadEnvFile('.env.local')
}

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
  },
})
