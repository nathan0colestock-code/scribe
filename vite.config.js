import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src',
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
