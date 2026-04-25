/* global Office, Excel */

const LS_KEY = 'finreportai_api_base';

/** Chat turns in memory */
const chatHistory = [];

function getApiBase() {
  const s = localStorage.getItem(LS_KEY);
  if (s && String(s).trim()) return String(s).trim().replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    const o = window.location.origin;
    if (o.includes('localhost') || o.includes('127.0.0.1')) return '';
  }
  return 'https://finreportai.railway.app';
}

function apiUrl(path) {
  const base = getApiBase();
  if (!path.startsWith('/')) path = '/' + path;
  return (base || '') + path;
}

function setStatus(t) {
  const el = document.getElementById('status-bar');
  if (el) el.textContent = t || '';
}

function setThinking(on) {
  const el = document.getElementById('thinking');
  if (el) el.classList.toggle('hidden', !on);
}

function addToChat(role, text) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'claude');
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function addMeta(text) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'msg meta';
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function getChatHistoryPayload() {
  return chatHistory.slice(-10).map((h) => ({ role: h.role, message: h.message }));
}

async function readSheetContext() {
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    sheet.load('name');
    const used = sheet.getUsedRangeOrNullObject();
    used.load(['isNullObject', 'values', 'address', 'rowIndex', 'rowCount', 'columnCount']);
    await ctx.sync();
    if (used.isNullObject) {
      return { sheetName: sheet.name, data: [], address: '' };
    }
    const values = used.values || [];
    const slice = values.slice(0, 30);
    return {
      sheetName: sheet.name,
      data: slice,
      address: used.address,
    };
  });
}

function flattenForSheet(obj, prefix) {
  const rows = [];
  if (obj == null) return rows;
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    rows.push([prefix || 'value', String(obj)]);
    return rows;
  }
  if (Array.isArray(obj)) {
    rows.push([prefix || 'array', JSON.stringify(obj).slice(0, 5000)]);
    return rows;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? prefix + '.' + k : k;
      if (v == null) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        rows.push([key, String(v)]);
      } else if (Array.isArray(v)) {
        rows.push([key, JSON.stringify(v).slice(0, 3000)]);
      } else if (typeof v === 'object') {
        rows.push(...flattenForSheet(v, key));
      }
    }
  }
  return rows;
}

async function writeResults(result) {
  const pairs = flattenForSheet(result, '');
  if (!pairs.length) {
    addMeta('No scalar fields to write.');
    return;
  }
  await Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const used = sheet.getUsedRangeOrNullObject();
    used.load(['isNullObject', 'rowIndex', 'rowCount']);
    await ctx.sync();
    const startRow = used.isNullObject ? 0 : used.rowIndex + used.rowCount + 2;
    const header = [['FinReportAI — ' + new Date().toLocaleString(), '']];
    const body = pairs.map(([a, b]) => [a, b]);
    const all = header.concat(body);
    const range = sheet.getRangeByIndexes(startRow, 0, all.length, 2);
    range.values = all;
    range.format.font.name = 'IBM Plex Mono';
    const titleCell = sheet.getRangeByIndexes(startRow, 0, 1, 1);
    titleCell.format.font.bold = true;
    titleCell.format.font.color = '#00D4B8';
    await ctx.sync();
  });
}

function num(x) {
  if (x == null || x === '') return 0;
  const n = Number(String(x).replace(/[,£$€]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function buildPvmBody(rows) {
  try {
    if (!rows || rows.length < 2) return { demo: true };
    const h0 = String(rows[0][0] || '').toLowerCase();
    if (h0.includes('product') && rows[1].length >= 5) {
      const products = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r[0] == null || r[0] === '') break;
        products.push({
          name: String(r[0]),
          actual_units: num(r[1]),
          actual_price: num(r[2]),
          budget_units: num(r[3]),
          budget_price: num(r[4]),
        });
      }
      if (!products.length) return { demo: true };
      const actual_revenue = products.reduce((s, p) => s + p.actual_units * p.actual_price, 0);
      const budget_revenue = products.reduce((s, p) => s + p.budget_units * p.budget_price, 0);
      return {
        actual_revenue: actual_revenue || 1,
        budget_revenue: budget_revenue || 1,
        prior_year_revenue: budget_revenue * 0.92,
        products,
        regions: [],
      };
    }
    return { demo: true };
  } catch {
    return { demo: true };
  }
}

function buildVarianceBody(rows) {
  try {
    if (!rows || rows.length < 2) return null;
    const hdr = rows[0].map((c) => String(c || '').toLowerCase());
    const ia = hdr.findIndex((h) => h.includes('account') || h.includes('name') || h.includes('category'));
    const id = hdr.findIndex((h) => h.includes('department') || h.includes('dept'));
    const ib = hdr.findIndex((h) => h === 'budget' || (h.includes('budget') && !h.includes('actual')));
    const ix = hdr.findIndex((h) => h === 'actual' || (h.includes('actual') && !h.includes('budget')));
    if (ib < 0 || ix < 0) return null;
    const line_items = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      line_items.push({
        account: String(row[ia >= 0 ? ia : 0] || 'Line ' + r),
        department: String(row[id >= 0 ? id : 1] || 'All Depts'),
        budget: num(row[ib]),
        actual: num(row[ix]),
      });
    }
    return line_items.length ? { line_items } : null;
  } catch {
    return null;
  }
}

function buildMonteBody() {
  return { n_simulations: 3000, months: 12 };
}

function buildThreeStatementBody() {
  return { company_name: 'Excel Model', projection_years: 5, scenario: 'base' };
}

function buildArrBody(rows) {
  try {
    if (!rows || rows.length < 2) return { months: [] };
    const hdr = rows[0].map((c) => String(c || '').toLowerCase());
    const col = (sub) => hdr.findIndex((h) => h.includes(sub));
    const months = [];
    for (let r = 1; r < Math.min(rows.length, 14); r++) {
      const row = rows[r];
      if (!row) continue;
      const im = col('month');
      months.push({
        month: String(im >= 0 && row[im] != null && row[im] !== '' ? row[im] : 'M' + r),
        beginning_arr: num(row[col('beginning')]),
        new_arr: num(row[col('new')]),
        expansion: num(row[col('expansion')]),
        contraction: num(row[col('contraction')]),
        churn: num(row[col('churn')]),
        ending_arr: num(row[col('ending')]),
        mrr: num(row[col('mrr')]),
      });
    }
    return { months: months.some((m) => m.beginning_arr) ? months : [] };
  } catch {
    return { months: [] };
  }
}

function buildHeadcountBody(rows) {
  try {
    if (!rows || rows.length < 2) return {};
    const hdr = rows[0].map((c) => String(c || '').toLowerCase());
    const departments = [];
    const id = hdr.findIndex((h) => h.includes('department') || h.includes('dept'));
    const ic = hdr.findIndex((h) => h.includes('current') && h.includes('hc'));
    const ib = hdr.findIndex((h) => h.includes('budget') && h.includes('hc'));
    const is = hdr.findIndex((h) => h.includes('salary'));
    const io = hdr.findIndex((h) => h.includes('open'));
    if (id < 0) return {};
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[id]) continue;
      departments.push({
        department: String(row[id]),
        current_hc: num(row[ic >= 0 ? ic : 1]),
        budget_hc: num(row[ib >= 0 ? ib : 2]),
        avg_salary: num(row[is >= 0 ? is : 3]),
        open_roles: num(row[io >= 0 ? io : 4]),
      });
    }
    return departments.length ? { departments } : {};
  } catch {
    return {};
  }
}

function buildSensitivityBody() {
  return { variable1: 'revenue', variable2: 'opex_pct', steps: 9 };
}

function buildBoardPackBody(ctx) {
  return {
    company_name: 'Board Pack',
    period: new Date().toISOString().slice(0, 10),
    cfo_name: 'CFO',
    key_message_1: 'Generated from FinReportAI Excel Add-in.',
    variance_summary: 'See worksheet: ' + (ctx.sheetName || ''),
    forecast_summary: 'Sheet preview rows: ' + (ctx.data ? ctx.data.length : 0),
  };
}

function openHtmlDashboard(html) {
  if (!html || typeof html !== 'string') return;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const u = URL.createObjectURL(blob);
  window.open(u, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(u), 60_000);
}

function buildWaterfallHtml(result) {
  const wf = result.waterfall_data || [];
  const rows = wf.map((w) => '<tr><td>' + w.name + '</td><td style="text-align:right">' + Number(w.value).toLocaleString() + '</td></tr>').join('');
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>PVM</title></head><body style="font-family:system-ui;padding:24px">' +
    '<h1>PVM waterfall</h1><table border="1" cellpadding="6" cellspacing="0">' +
    rows +
    '</table></body></html>'
  );
}

const ENDPOINTS = {
  pvm: '/api/fpa/pvm-analysis',
  variance: '/api/fpa/variance/calculate',
  montecarlo: '/api/fpa/monte-carlo',
  arr: '/api/fpa/arr-dashboard',
  headcount: '/api/fpa/headcount',
  sensitivity: '/api/fpa/sensitivity',
  boardpack: '/api/reports/board-pack',
};

async function runModule(moduleKey) {
  const context = await readSheetContext();
  setStatus('Running ' + moduleKey + '…');
  setButtonsDisabled(true);
  const rows = context.data || [];
  let body;
  let path = ENDPOINTS[moduleKey];
  if (moduleKey === 'pvm') body = buildPvmBody(rows);
  else if (moduleKey === 'variance') {
    body = buildVarianceBody(rows);
    if (!body) {
      body = {
        line_items: [
          { account: 'Sample', department: 'All Depts', budget: 100000, actual: 108000 },
          { account: 'Sample 2', department: 'Ops', budget: 50000, actual: 47000 },
        ],
      };
      addMeta('Variance: using sample line_items — add Account, Department, Budget, Actual columns for real data.');
    }
  } else if (moduleKey === 'montecarlo') body = buildMonteBody();
  else if (moduleKey === 'arr') body = buildArrBody(rows);
  else if (moduleKey === 'headcount') body = { ...buildHeadcountBody(rows), total_revenue: 45_000_000, revenue_target: 52_000_000 };
  else if (moduleKey === 'sensitivity') body = buildSensitivityBody();
  else if (moduleKey === 'boardpack') body = buildBoardPackBody(context);
  else body = {};

  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  const result = await res.json();
  await writeResults(result);
  if (result.html_preview) openHtmlDashboard(result.html_preview);
  else if (moduleKey === 'pvm' && result.waterfall_data) openHtmlDashboard(buildWaterfallHtml(result));
  const c = result.commentary || result.executive_summary || '';
  if (c) addToChat('claude', (moduleKey + ' complete.\n\n').slice(0, 200) + String(c).slice(0, 400));
  else addMeta(moduleKey + ' complete.');
  setStatus('Complete');
  setButtonsDisabled(false);
}

function setButtonsDisabled(disabled) {
  document.querySelectorAll('button.module').forEach((b) => {
    b.disabled = !!disabled;
  });
}

async function sendMessage(userMessage) {
  addToChat('user', userMessage);
  chatHistory.push({ role: 'user', message: userMessage });
  setThinking(true);
  const context = await readSheetContext();
  const res = await fetch(apiUrl('/api/chat/ask'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: userMessage,
      context: JSON.stringify(context),
      history: getChatHistoryPayload().slice(0, -1),
    }),
  });
  if (!res.ok) {
    setThinking(false);
    throw new Error(await res.text());
  }
  const data = await res.json();
  const reply = data.response || '';
  addToChat('claude', reply);
  chatHistory.push({ role: 'assistant', message: reply });
  setThinking(false);
  const act = data.trigger_action;
  if (act) {
    const moduleMap = {
      run_pvm: 'pvm',
      run_variance: 'variance',
      run_monte_carlo: 'montecarlo',
      run_arr: 'arr',
      run_headcount: 'headcount',
      run_sensitivity: 'sensitivity',
      run_board_pack: 'boardpack',
    };
    const m = moduleMap[act];
    if (m) await runModule(m);
  }
}

async function sendGreeting(context) {
  setThinking(true);
  try {
    const res = await fetch(apiUrl('/api/chat/ask'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:
          'Give a short greeting (max 2 sentences). Mention the sheet name and that you can run PVM, variance, Monte Carlo, ARR, headcount, sensitivity, or board pack from the buttons.',
        context: JSON.stringify(context),
        history: [],
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    addToChat('claude', data.response || 'FinReportAI ready.');
    chatHistory.push({ role: 'assistant', message: data.response || '' });
  } catch (e) {
    addMeta('Chat unavailable: ' + (e && e.message ? e.message : String(e)));
  } finally {
    setThinking(false);
  }
}

async function initApp() {
  const cfg = document.getElementById('cfg-api-base');
  if (cfg) cfg.value = localStorage.getItem(LS_KEY) || '';
  const disp = document.getElementById('api-url-display');
  const base = getApiBase();
  if (disp) disp.textContent = base ? 'API: ' + base : 'API: (same origin /api → proxy)';

  try {
    const context = await readSheetContext();
    await sendGreeting(context);
  } catch (e) {
    addMeta('Could not read sheet: ' + (e && e.message ? e.message : String(e)));
  }
}

function wireUi() {
  document.getElementById('btn-send').addEventListener('click', async () => {
    const inp = document.getElementById('chat-input');
    const v = (inp && inp.value) || '';
    if (!v.trim()) return;
    inp.value = '';
    try {
      await sendMessage(v.trim());
    } catch (e) {
      addMeta('Send failed: ' + (e && e.message ? e.message : String(e)));
      setThinking(false);
    }
  });
  document.getElementById('btn-clear').addEventListener('click', () => {
    const box = document.getElementById('chat-messages');
    if (box) box.innerHTML = '';
    chatHistory.length = 0;
  });
  document.getElementById('chat-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') document.getElementById('btn-send').click();
  });
  document.getElementById('btn-save-cfg').addEventListener('click', () => {
    const v = (document.getElementById('cfg-api-base').value || '').trim();
    if (v) localStorage.setItem(LS_KEY, v.replace(/\/$/, ''));
    else localStorage.removeItem(LS_KEY);
    const disp = document.getElementById('api-url-display');
    const base = getApiBase();
    if (disp) disp.textContent = base ? 'API: ' + base : 'API: (same origin /api → proxy)';
    setStatus('Settings saved');
  });
  document.getElementById('btn-test').addEventListener('click', async () => {
    try {
      const r = await fetch(apiUrl('/health'));
      const j = await r.json();
      setStatus('API OK: ' + JSON.stringify(j));
    } catch (e) {
      setStatus('API test failed: ' + (e && e.message ? e.message : String(e)));
    }
  });
  document.querySelectorAll('button.module').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const m = btn.getAttribute('data-module');
      if (!m) return;
      try {
        await runModule(m);
      } catch (e) {
        addMeta(m + ' failed: ' + (e && e.message ? e.message : String(e)));
        setStatus('');
        setButtonsDisabled(false);
      }
    });
  });
}

Office.onReady((info) => {
  if (info.host === Office.HostType.Excel) {
    wireUi();
    initApp();
  } else {
    document.body.innerHTML = '<p style="padding:16px;font-family:system-ui">Open this add-in in Excel.</p>';
  }
});
