/**
 * Headless pass: load dev URL and print console errors + #root text length.
 * Start dev first: npm run dev -- --port 3020 --host 127.0.0.1
 * Then: node scripts/debug-blank.mjs http://127.0.0.1:3020/
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:3006/';
const logs = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (msg) => {
  const t = msg.type();
  const text = msg.text();
  if (t === 'error' || t === 'warning') logs.push({ t, text });
});
page.on('pageerror', (err) => logs.push({ t: 'pageerror', text: String(err) }));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);
const rootSnippet = await page.evaluate(() => {
  const r = document.getElementById('root');
  if (!r) return { exists: false };
  return {
    exists: true,
    innerHTMLLength: r.innerHTML.length,
    textPreview: (r.innerText || '').slice(0, 400),
    childCount: r.childElementCount,
  };
});
console.log('URL:', url);
console.log('root:', JSON.stringify(rootSnippet, null, 2));
console.log('console errors/warnings:', JSON.stringify(logs, null, 2));
await browser.close();
