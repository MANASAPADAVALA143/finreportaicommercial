import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Prefer TypeScript sources over stale co-located .js (avoids wrong component loading).
  resolve: {
    extensions: ['.mjs', '.mts', '.tsx', '.ts', '.jsx', '.js', '.json'],
  },
  // Default `/` so local `vite preview`, static servers, and root hosting load JS/CSS correctly.
  // GitHub Pages: `npm run build:deploy` uses --mode github-pages for the subpath below.
  base:
    process.env.VERCEL === '1'
      ? '/'
      : mode === 'github-pages'
        ? '/finreportaicommercial/'
        : '/',
  server: {
    port: 3006,
    /** If 3006 is in use, try the next free port (local dev). */
    strictPort: false,
    /** Opens the correct URL; this project uses 3006 (not Vite’s default 5173). */
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
}));
