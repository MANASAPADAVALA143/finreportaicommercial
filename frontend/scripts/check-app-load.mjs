/**
 * Loads /src/App.tsx through Vite to surface static import errors.
 * Run from frontend: node scripts/check-app-load.mjs
 */
import { createServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const vite = await createServer({ root, logLevel: 'error' });
try {
  await vite.ssrLoadModule('/src/App.tsx');
  console.log('OK: App.tsx and its static imports loaded');
} catch (e) {
  console.error('FAIL:', e);
  process.exitCode = 1;
} finally {
  await vite.close();
}
