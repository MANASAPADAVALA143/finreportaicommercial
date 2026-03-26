import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // GitHub Pages uses subpath; Vercel serves from domain root (VERCEL=1 during build).
  base:
    process.env.VERCEL === '1'
      ? '/'
      : mode === 'production'
        ? '/finreportaicommercial/'
        : '/',
  server: {
    port: 3006,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
}));
