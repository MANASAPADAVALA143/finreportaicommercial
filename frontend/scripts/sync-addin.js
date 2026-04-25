/**
 * Cross-platform copy: repo/excel-addin/src/* → frontend/public/addin/
 * Optional: excel-addin/assets/* → public/addin/assets/
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');
const repoRoot = join(frontendRoot, '..');
const srcDir = join(repoRoot, 'excel-addin', 'src');
const assetsSrc = join(repoRoot, 'excel-addin', 'assets');
const destDir = join(frontendRoot, 'public', 'addin');
const assetsDest = join(destDir, 'assets');

function copyDirContents(from, to) {
  if (!existsSync(from)) {
    console.error('sync-addin: missing folder:', from);
    process.exit(1);
  }
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const fp = join(from, name);
    const tp = join(to, name);
    const st = statSync(fp);
    if (st.isDirectory()) {
      cpSync(fp, tp, { recursive: true });
    } else {
      cpSync(fp, tp);
    }
  }
}

copyDirContents(srcDir, destDir);
if (existsSync(assetsSrc)) {
  mkdirSync(assetsDest, { recursive: true });
  copyDirContents(assetsSrc, assetsDest);
}

console.log('sync-addin: copied excel-addin → public/addin');
