import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'node:os'
import path from 'node:path'

/**
 * Keep Vite's optimize cache off OneDrive / the project tree.
 * Avoids Windows EPERM rmdir on node_modules/.vite/deps when the lockfile changes.
 */
const viteCacheDir = path.join(os.tmpdir(), 'vite-everything-warframe')

export default defineConfig({
  plugins: [react()],
  cacheDir: viteCacheDir,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
})
