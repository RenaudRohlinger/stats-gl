import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'public',
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
