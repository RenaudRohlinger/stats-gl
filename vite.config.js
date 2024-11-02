import { defineConfig } from 'vite';

const entries = ['./lib/main.ts'];

export default defineConfig({
  optimizeDeps: {
    include: ['three'], // optionally specify dependency name
    esbuildOptions: {
      supported: {
        'top-level-await': true,
      },
    },
  },
  resolve: {
    alias: {
      'three/ShaderChunk': 'three/examples/jsm/shaders/ShaderChunk',
      'three/UniformsLib': 'three/examples/jsm/shaders/UniformsLib',
      'three/addons': 'three/examples/jsm',
      'three/tsl': 'three/webgpu',
      three: 'three/webgpu',
    },
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
