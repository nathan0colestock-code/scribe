import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src',
  // publicDir is resolved relative to `root`, so `../public` points at the
  // repo-root public/ directory. Vite copies its contents verbatim into dist/
  // at build time (manifest.json, sw.js, offline.html, icons).
  publicDir: '../public',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3748',
      '/ws': { target: 'ws://localhost:3748', ws: true },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
