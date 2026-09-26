import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Map art (public/maps/*/level.glb); lets tests import a map's .glb with `?inline`.
  assetsInclude: ['**/*.glb'],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
