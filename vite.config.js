import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'lib/main.ts'),
      name: 'Stats-Gl',
      // the proper extensions will be added
      fileName: 'stats-gl',
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {
        },
      },
    },
  },
})