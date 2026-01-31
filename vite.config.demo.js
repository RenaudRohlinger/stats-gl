import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: 'public',
  resolve: {
    alias: {
      'three/tsl': 'https://unpkg.com/three@0.182.0/build/three.tsl.js',
      'three/webgpu': 'https://unpkg.com/three@0.182.0/build/three.webgpu.js',
      'three/addons/': 'https://unpkg.com/three@0.182.0/examples/jsm/',
      'three': 'https://unpkg.com/three@0.182.0/build/three.webgpu.js',
    },
  },
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        webgl: resolve(__dirname, 'webgl.html'),
        webgpu: resolve(__dirname, 'webgpu.html'),
        worker: resolve(__dirname, 'worker.html'),
        worker_tsl: resolve(__dirname, 'worker_tsl.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
});
