import { defineConfig } from 'vite';

const entries = ['./lib/main.ts'];

export default defineConfig({
  server: {
    // 6000 is browser-blocked (X11 on the fetch-spec bad-ports list -> ERR_UNSAFE_PORT)
    port: 6001,
    strictPort: true,
  },
  optimizeDeps: {
    esbuildOptions: {
      supported: {
        'top-level-await': true,
      },
    },
  },
  resolve: {
  },
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
        preserveModules: true, // false for threejs module
        preserveModulesRoot: 'src',
        sourcemapExcludeSources: true,
      },
    },
  },
});
