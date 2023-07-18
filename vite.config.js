import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  server: {
    open: '/demo/',
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'lib/main.ts'),
      name: 'Stats-Gl',
      fileName: (format) => `stats-gl.${format}.js`,
    },
    rollupOptions: {
      output: {},
    },
  },
})