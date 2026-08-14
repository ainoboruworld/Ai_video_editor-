import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ave/editor-core': path.resolve(__dirname, '../../packages/editor-core/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4001', changeOrigin: true },
      '/media': { target: 'http://localhost:4001', changeOrigin: true },
    },
  },
});
