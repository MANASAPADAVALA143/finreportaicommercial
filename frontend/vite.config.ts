import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react({ jsxRuntime: 'automatic' })],
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  },
  // Prefer TypeScript sources over stale co-located .js (avoids wrong component loading).
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    dedupe: ['react', 'react-dom'],
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
  // Static Office Add-in is served from `public/addin/` → http://localhost:3006/addin/taskpane.html
  server: {
    port: 3006,
    /** Always 3006 — never auto-increment (avoids broken bookmarks during demos). */
    strictPort: true,
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
