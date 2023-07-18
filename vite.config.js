import { resolve } from 'path'
import { defineConfig } from 'vite'

const entries = ['./lib/main.ts']

export default defineConfig({
  build: {
    minify: false,
    sourcemap: true,
    target: 'es2018',
    lib: {
      formats: ['es', 'cjs'],
      entry: entries[0],
      fileName: '[name]',
    },
    rollupOptions: {
      treeshake: false,
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        sourcemapExcludeSources: true,
      },
    },
  },
})