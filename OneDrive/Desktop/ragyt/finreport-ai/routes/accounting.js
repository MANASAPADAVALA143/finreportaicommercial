'use strict';

const express = require('express');
const router = express.Router();
const { db, nextInvoiceNumber, nextClaimNumber, nextAssetNumber, logAgentAction } = require('../database/accounting');
const { AccountingAgent } = require('../agents/accounting_agent');

// ─── Helper: run agent in background ────────────────────────────────────────
function runAgentAsync(agent, method, ...args) {
  setImmediate(async () => {
    try { await agent[method](...args); } catch (e) { console.error(`Agent error [${method}]:`, e.message); }
  });
}

// ─── ENTITIES ───────────────────────────────────────────────────────────────

router.get('/entities', (req, res) => {
  const entities = db.prepare('SELECT * FROM entities ORDER BY created_at DESC').all();
  res.json({ entities, total: entities.length });
});

router.get('/entities/:id', (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  res.json(entity);
});

router.post('/entities', (req, res) => {
  const { name, country, currency, tax_scheme, tax_number, tax_rate_default, fiscal_year_end,
    accounting_method, industry, conversion_date, integration_mode } = req.body;
  if (!name || !country || !currency) return res.status(400).json({ error: 'name, country, currency required' });
  const result = db.prepare(`
    INSERT INTO entities (name, country, currency, tax_scheme, tax_number, tax_rate_default,
      fiscal_year_end, accounting_method, industry, conversion_date, integration_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, country, currency, tax_scheme || '', tax_number || '',
    tax_rate_default || 0, fiscal_year_end || '12-31',
    accounting_method || 'ACCRUAL', industry || '', conversion_date || null, integration_mode || 'STANDALONE');
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, entity });
});

router.patch('/entities/:id', (req, res) => {
  const allowed = ['name', 'tax_number', 'tax_scheme', 'tax_rate_default', 'industry',
    'fiscal_year_end', 'accounting_method', 'integration_mode', 'onboarding_complete'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields' });
  const set = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE entities SET ${set} WHERE id = ?`).run(...Object.values(updates), req.params.id);
  res.json({ success: true, entity: db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id) });
});

// ─── CHART OF ACCOUNTS ──────────────────────────────────────────────────────

router.get('/entities/:id/accounts', (req, res) => {
  const { account_type } = req.query;
  let q = 'SELECT * FROM accounts WHERE entity_id = ?';
  const params = [req.params.id];
  if (account_type) { q += ' AND account_type = ?'; params.push(account_type); }
  q += ' ORDER BY code ASC';
  const accounts = db.prepare(q).all(...params);
  res.json({ accounts, total: accounts.length });
});

router.post('/entities/:id/accounts', (req, res) => {
  const { code, name, account_type, sub_type, currency, tax_code, description, conversion_balance } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });
  const result = db.prepare(`
    INSERT INTO accounts (entity_id, code, name, account_type, sub_type, currency, tax_code, description, conversion_balance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, code, name, account_type || '', sub_type || '',
    currency || '', tax_code || '', description || '', conversion_balance || 0);
  res.status(201).json({ success: true, account: db.prepare('SELECT * FROM accounts WHERE id = ?').get(result.lastInsertRowid) });
});

router.put('/entities/:id/accounts/:aid', (req, res) => {
  const { code, name, account_type, sub_type, tax_code, description, is_active } = req.body;
  db.prepare(`
    UPDATE accounts SET code=?, name=?, account_type=?, sub_type=?, tax_code=?, description=?, is_active=?
    WHERE id=? AND entity_id=?
  `).run(code, name, account_type, sub_type, tax_code, description, is_active ? 1 : 0, req.params.aid, req.params.id);
  res.json({ success: true });
});

router.delete('/entities/:id/accounts/:aid', (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id = ? AND entity_id = ?').run(req.params.aid, req.params.id);
  res.json({ success: true });
});

// AI generate COA
router.post('/entities/:id/accounts/ai-generate', async (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        messages: [{
          role: 'user',
          content: `Generate a complete Chart of Accounts for:
Country: ${entity.country}
Industry: ${entity.industry || 'General Business'}
Tax Scheme: ${entity.tax_scheme || 'NONE'}
Accounting Standard: IFRS/Local GAAP
Currency: ${entity.currency}

Return a JSON array (no markdown, no prose, just the array) with 80+ accounts, each with:
{ "code": "1010", "name": "Bank - Operating Account", "account_type": "Asset", "sub_type": "Bank", "description": "...", "tax_code": "" }

Account types: Asset, Liability, Equity, Revenue, Expense
Include: all asset types (cash, AR, prepaid, fixed assets), liabilities (AP, loans, tax payable), equity (share capital, retained earnings), revenue (sales, other income), COGS, operating expenses (rent, salaries, utilities, software, travel, marketing, insurance, depreciation), tax accounts.
Follow ${entity.country} local naming conventions.`
        }]
      })
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    let raw = (data.content?.[0]?.text || '').trim();
    const match = raw.match(/\[[\s\S]*\]/);
    const accounts = JSON.parse(match ? match[0] : raw);

    const insertAcc = db.prepare(`
      INSERT INTO accounts (entity_id, code, name, account_type, sub_type, description, tax_code, ai_suggested)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const insertMany = db.transaction((items) => {
      for (const a of items) {
        insertAcc.run(entity.id, a.code || '', a.name, a.account_type || '', a.sub_type || '', a.description || '', a.tax_code || '');
      }
    });
    insertMany(accounts);
    res.json({ success: true, count: accounts.length, accounts });
  } catch (err) {
    console.error('AI CoA error:', err.message);
    res.status(500).json({ error: 'AI generation failed', detail: err.message });
  }
});

// ─── CONTACTS ───────────────────────────────────────────────────────────────

router.get('/entities/:id/contacts', (req, res) => {
  const { contact_type, status } = req.query;
  let q = 'SELECT * FROM contacts WHERE entity_id = ?';
  const params = [req.params.id];
  if (contact_type) { q += ' AND contact_type = ?'; params.push(contact_type); }
  if (status) { q += ' AND status = ?'; params.push(status); }
  q += ' ORDER BY display_name ASC';
  const contacts = db.prepare(q).all(...params);
  res.json({ contacts, total: contacts.length });
});

router.post('/entities/:id/contacts', (req, res) => {
  const { contact_type, display_name, company_name, email, phone, country,
    tax_number, payment_terms, credit_limit } = req.body;
  if (!display_name) return res.status(400).json({ error: 'display_name required' });
  const result = db.prepare(`
    INSERT INTO contacts (entity_id, contact_type, display_name, company_name, email, phone, country, tax_number, payment_terms, credit_limit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, contact_type || 'CUSTOMER', display_name, company_name || '',
    email || '', phone || '', country || '', tax_number || '',
    payment_terms || 30, credit_limit || null);
  res.status(201).json({ success: true, contact: db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid) });
});

router.put('/entities/:id/contacts/:cid', (req, res) => {
  const { display_name, company_name, email, phone, country, tax_number, payment_terms, credit_limit, status } = req.body;
  db.prepare(`
    UPDATE contacts SET display_name=?, company_name=?, email=?, phone=?, country=?, tax_number=?, payment_terms=?, credit_limit=?, status=?
    WHERE id=? AND entity_id=?
  `).run(display_name, company_name, email, phone, country, tax_number, payment_terms, credit_limit, status, req.params.cid, req.params.id);
  res.json({ success: true });
});

router.delete('/entities/:id/contacts/:cid', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ? AND entity_id = ?').run(req.params.cid, req.params.id);
  res.json({ success: true });
});

// ─── TAX RATES ──────────────────────────────────────────────────────────────

router.get('/entities/:id/tax-rates', (req, res) => {
  const rates = db.prepare('SELECT * FROM tax_rates WHERE entity_id = ? ORDER BY rate ASC').all(req.params.id);
  res.json({ tax_rates: rates, total: rates.length });
});

router.post('/entities/:id/tax-rates', (req, res) => {
  const { name, rate, tax_type } = req.body;
  if (!name || rate === undefined) return res.status(400).json({ error: 'name and rate required' });
  const result = db.prepare(`
    INSERT INTO tax_rates (entity_id, name, rate, tax_type) VALUES (?, ?, ?, ?)
  `).run(req.params.id, name, rate, tax_type || 'OUTPUT');
  res.status(201).json({ success: true, tax_rate: db.prepare('SELECT * FROM tax_rates WHERE id = ?').get(result.lastInsertRowid) });
});

router.delete('/entities/:id/tax-rates/:rid', (req, res) => {
  db.prepare('DELETE FROM tax_rates WHERE id = ? AND entity_id = ?').run(req.params.rid, req.params.id);
  res.json({ success: true });
});

// ─── INVOICES (AR) ──────────────────────────────────────────────────────────

router.get('/entities/:id/invoices', (req, res) => {
  const { status, invoice_type } = req.query;
  let q = `SELECT i.*, c.display_name as customer_name
    FROM invoices i LEFT JOIN contacts c ON c.id = i.customer_id
    WHERE i.entity_id = ?`;
  const params = [req.params.id];
  if (status) { q += ' AND i.status = ?'; params.push(status); }
  if (invoice_type) { q += ' AND i.invoice_type = ?'; params.push(invoice_type); }
  q += ' ORDER BY i.created_at DESC';
  const invoices = db.prepare(q).all(...params);
  res.json({ invoices, total: invoices.length });
});

router.get('/entities/:id/invoices/:iid', (req, res) => {
  const inv = db.prepare(`
    SELECT i.*, c.display_name as customer_name, c.email as customer_email
    FROM invoices i LEFT JOIN contacts c ON c.id = i.customer_id
    WHERE i.id = ? AND i.entity_id = ?
  `).get(req.params.iid, req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const lines = db.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ?').all(inv.id);
  res.json({ ...inv, line_items: lines });
});

router.post('/entities/:id/invoices', (req, res) => {
  const { invoice_type, customer_id, status, issue_date, due_date, currency,
    reference, notes, is_recurring, recurring_frequency, line_items } = req.body;
  const invType = invoice_type || 'INVOICE';
  let invNum;
  if (invType === 'INVOICE') invNum = nextInvoiceNumber(req.params.id);
  else if (invType === 'QUOTE') invNum = 'QUO-' + Date.now();
  else if (invType === 'CREDIT_NOTE') invNum = 'CN-' + Date.now();
  else invNum = 'RCP-' + Date.now();

  const lines = Array.isArray(line_items) ? line_items : [];
  let subtotal = 0, taxTotal = 0;
  for (const li of lines) {
    const qty = li.quantity || 1;
    const price = li.unit_price || 0;
    const discount = li.discount_type === 'PERCENT' ? (price * qty * (li.discount_value || 0) / 100)
      : (li.discount_value || 0);
    const lineAmt = (qty * price) - discount;
    const lineTax = lineAmt * ((li.tax_rate || 0) / 100);
    li._amount = lineAmt;
    li._tax = lineTax;
    subtotal += lineAmt;
    taxTotal += lineTax;
  }
  const total = subtotal + taxTotal;

  const invResult = db.prepare(`
    INSERT INTO invoices (entity_id, invoice_number, invoice_type, customer_id, status, issue_date, due_date,
      currency, subtotal, tax_amount, total, amount_due, reference, notes, is_recurring, recurring_frequency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, invNum, invType, customer_id || null,
    status || 'DRAFT', issue_date || null, due_date || null,
    currency || 'USD', subtotal, taxTotal, total, total,
    reference || '', notes || '', is_recurring ? 1 : 0, recurring_frequency || null);

  const invId = invResult.lastInsertRowid;
  const insertLine = db.prepare(`
    INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, account_id, tax_rate, tax_amount, amount, discount_type, discount_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const li of lines) {
    insertLine.run(invId, li.description || '', li.quantity || 1, li.unit_price || 0,
      li.account_id || null, li.tax_rate || 0, li._tax, li._amount,
      li.discount_type || null, li.discount_value || 0);
  }

  res.status(201).json({
    success: true,
    invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(invId)
  });
});

router.patch('/entities/:id/invoices/:iid/status', (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  db.prepare('UPDATE invoices SET status = ? WHERE id = ? AND entity_id = ?').run(status, req.params.iid, req.params.id);
  res.json({ success: true, status });
});

router.delete('/entities/:id/invoices/:iid', (req, res) => {
  db.prepare('DELETE FROM invoice_line_items WHERE invoice_id = ?').run(req.params.iid);
  db.prepare('DELETE FROM invoices WHERE id = ? AND entity_id = ?').run(req.params.iid, req.params.id);
  res.json({ success: true });
});

// ─── EXPENSE CLAIMS ─────────────────────────────────────────────────────────

router.get('/entities/:id/expenses', (req, res) => {
  const { status } = req.query;
  let q = `SELECT ec.*, c.display_name as vendor_name
    FROM expense_claims ec LEFT JOIN contacts c ON c.id = ec.vendor_id
    WHERE ec.entity_id = ?`;
  const params = [req.params.id];
  if (status) { q += ' AND ec.status = ?'; params.push(status); }
  q += ' ORDER BY ec.expense_date DESC';
  const claims = db.prepare(q).all(...params);
  res.json({ claims, total: claims.length });
});

router.post('/entities/:id/expenses', (req, res) => {
  const { vendor_id, account_id, expense_date, amount, tax_amount, expense_type,
    description, payment_method } = req.body;
  if (!amount) return res.status(400).json({ error: 'amount required' });
  const claimNum = nextClaimNumber(req.params.id);
  const receiptNum = 'RCP-' + String(Date.now()).slice(-6);
  const result = db.prepare(`
    INSERT INTO expense_claims (entity_id, claim_number, receipt_number, vendor_id, account_id,
      expense_date, amount, tax_amount, expense_type, description, payment_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, claimNum, receiptNum, vendor_id || null, account_id || null,
    expense_date || null, amount, tax_amount || 0, expense_type || '',
    description || '', payment_method || 'PERSONAL');
  res.status(201).json({ success: true, claim: db.prepare('SELECT * FROM expense_claims WHERE id = ?').get(result.lastInsertRowid) });
});

router.patch('/entities/:id/expenses/:eid/status', (req, res) => {
  const { status, approved_by } = req.body;
  db.prepare('UPDATE expense_claims SET status = ?, approved_by = ?, approved_at = datetime(\'now\') WHERE id = ? AND entity_id = ?')
    .run(status, approved_by || 'admin', req.params.eid, req.params.id);
  res.json({ success: true, status });
});

// OCR receipt via Claude Vision
router.post('/entities/:id/expenses/ocr', async (req, res) => {
  const { image_base64, media_type } = req.body;
  if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image_base64 } },
            { type: 'text', text: 'Extract from this receipt: vendor_name, total_amount (number only), currency (3-letter code), date (YYYY-MM-DD), expense_category (Travel/Meals/Equipment/Software/Office/Other), tax_amount (number). Return JSON only, no prose.' }
          ]
        }]
      })
    });
    const data = await response.json();
    const raw = (data.content?.[0]?.text || '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    res.json(JSON.parse(match ? match[0] : raw));
  } catch (err) {
    res.status(500).json({ error: 'OCR failed', detail: err.message });
  }
});

// ─── FIXED ASSETS ───────────────────────────────────────────────────────────

router.get('/entities/:id/fixed-assets', (req, res) => {
  const assets = db.prepare("SELECT * FROM fixed_assets WHERE entity_id = ? ORDER BY created_at DESC").all(req.params.id);
  res.json({ assets, total: assets.length });
});

router.post('/entities/:id/fixed-assets', (req, res) => {
  const { name, asset_type, purchase_date, purchase_price, useful_life_years,
    depreciation_method, depreciation_rate } = req.body;
  if (!name || !purchase_price) return res.status(400).json({ error: 'name and purchase_price required' });
  const assetNum = nextAssetNumber(req.params.id);
  const result = db.prepare(`
    INSERT INTO fixed_assets (entity_id, asset_number, name, asset_type, purchase_date, purchase_price,
      useful_life_years, depreciation_method, depreciation_rate, net_book_value, accumulated_depreciation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(req.params.id, assetNum, name, asset_type || 'Equipment', purchase_date || null,
    purchase_price, useful_life_years || 5, depreciation_method || 'SLM',
    depreciation_rate || (1 / (useful_life_years || 5)), purchase_price);
  res.status(201).json({ success: true, asset: db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(result.lastInsertRowid) });
});

router.patch('/entities/:id/fixed-assets/:aid/dispose', (req, res) => {
  const { disposal_date, disposal_amount } = req.body;
  db.prepare("UPDATE fixed_assets SET status = 'DISPOSED', disposal_date = ?, disposal_amount = ? WHERE id = ? AND entity_id = ?")
    .run(disposal_date, disposal_amount || 0, req.params.aid, req.params.id);
  res.json({ success: true });
});

// ─── BANK ACCOUNTS ──────────────────────────────────────────────────────────

router.get('/entities/:id/bank-accounts', (req, res) => {
  const accounts = db.prepare("SELECT * FROM bank_accounts WHERE entity_id = ? ORDER BY created_at DESC").all(req.params.id);
  res.json({ accounts, total: accounts.length });
});

router.post('/entities/:id/bank-accounts', (req, res) => {
  const { bank_name, account_number, account_type, currency, current_balance, account_id } = req.body;
  if (!bank_name) return res.status(400).json({ error: 'bank_name required' });
  const result = db.prepare(`
    INSERT INTO bank_accounts (entity_id, account_id, bank_name, account_number, account_type, currency, current_balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, account_id || null, bank_name, account_number || '',
    account_type || 'CHECKING', currency || 'USD', current_balance || 0);
  res.status(201).json({ success: true, bank_account: db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(result.lastInsertRowid) });
});

router.get('/entities/:id/bank-accounts/:bid/transactions', (req, res) => {
  const { match_status } = req.query;
  let q = 'SELECT * FROM bank_transactions WHERE bank_account_id = ?';
  const params = [req.params.bid];
  if (match_status) { q += ' AND match_status = ?'; params.push(match_status); }
  q += ' ORDER BY transaction_date DESC';
  const txns = db.prepare(q).all(...params);
  res.json({ transactions: txns, total: txns.length });
});

router.post('/entities/:id/bank-accounts/:bid/transactions', (req, res) => {
  const { transaction_date, description, amount, reference } = req.body;
  if (amount === undefined) return res.status(400).json({ error: 'amount required' });
  const result = db.prepare(`
    INSERT INTO bank_transactions (bank_account_id, transaction_date, description, amount, reference)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.bid, transaction_date || null, description || '', amount, reference || '');
  res.status(201).json({ success: true, transaction: db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(result.lastInsertRowid) });
});

// Import bank statement (CSV rows as JSON)
router.post('/entities/:id/bank-accounts/:bid/import', (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });
  const insertTxn = db.prepare(`
    INSERT INTO bank_transactions (bank_account_id, transaction_date, description, amount, reference)
    VALUES (?, ?, ?, ?, ?)
  `);
  const importMany = db.transaction((items) => {
    for (const r of items) insertTxn.run(req.params.bid, r.date, r.description || '', r.amount, r.reference || '');
  });
  importMany(rows);
  res.json({ success: true, imported: rows.length });
});

// ─── DASHBOARD ──────────────────────────────────────────────────────────────

router.get('/entities/:id/dashboard', (req, res) => {
  const eid = req.params.id;
  const { date_from = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10),
    date_to = new Date().toISOString().slice(0, 10) } = req.query;

  const revenue = db.prepare(`
    SELECT COALESCE(SUM(total), 0) as total FROM invoices
    WHERE entity_id = ? AND invoice_type = 'INVOICE' AND status IN ('SENT','PAID')
    AND issue_date BETWEEN ? AND ?
  `).get(eid, date_from, date_to)?.total || 0;

  const expenses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM expense_claims
    WHERE entity_id = ? AND status IN ('APPROVED','PAID') AND expense_date BETWEEN ? AND ?
  `).get(eid, date_from, date_to)?.total || 0;

  const ar = db.prepare(`
    SELECT COALESCE(SUM(amount_due), 0) as total FROM invoices
    WHERE entity_id = ? AND status IN ('SENT','OVERDUE')
  `).get(eid)?.total || 0;

  const overdueCount = db.prepare(`
    SELECT COUNT(*) as n FROM invoices WHERE entity_id = ? AND status = 'OVERDUE'
  `).get(eid)?.n || 0;

  const cashBalance = db.prepare(`
    SELECT COALESCE(SUM(current_balance), 0) as total FROM bank_accounts WHERE entity_id = ?
  `).get(eid)?.total || 0;

  const pendingDecisions = db.prepare(`
    SELECT COUNT(*) as n FROM human_decision_items WHERE entity_id = ? AND status = 'PENDING'
  `).get(eid)?.n || 0;

  const pendingExpenses = db.prepare(`
    SELECT COUNT(*) as n FROM expense_claims WHERE entity_id = ? AND status = 'UNCLAIMED'
  `).get(eid)?.n || 0;

  const topCustomers = db.prepare(`
    SELECT c.display_name, COALESCE(SUM(i.total),0) as total_sales
    FROM invoices i JOIN contacts c ON c.id = i.customer_id
    WHERE i.entity_id = ? AND i.invoice_type = 'INVOICE'
    GROUP BY i.customer_id ORDER BY total_sales DESC LIMIT 10
  `).all(eid);

  const recentInvoices = db.prepare(`
    SELECT i.*, c.display_name as customer_name FROM invoices i
    LEFT JOIN contacts c ON c.id = i.customer_id
    WHERE i.entity_id = ? ORDER BY i.created_at DESC LIMIT 10
  `).all(eid);

  // Monthly revenue for chart (last 6 months)
  const monthlyRevenue = db.prepare(`
    SELECT strftime('%Y-%m', issue_date) as month, COALESCE(SUM(total),0) as total
    FROM invoices WHERE entity_id = ? AND invoice_type = 'INVOICE' AND status IN ('SENT','PAID')
    AND issue_date >= date('now', '-6 months')
    GROUP BY month ORDER BY month ASC
  `).all(eid);

  res.json({
    kpis: {
      total_income: revenue,
      total_expenses: expenses,
      net_profit: revenue - expenses,
      cash_balance: cashBalance,
      accounts_receivable: ar,
      overdue_count: overdueCount,
      pending_decisions: pendingDecisions,
      pending_expenses: pendingExpenses
    },
    top_customers: topCustomers,
    recent_invoices: recentInvoices,
    monthly_revenue: monthlyRevenue,
    date_from,
    date_to
  });
});

// ─── AGENT OPERATIONS ───────────────────────────────────────────────────────

router.post('/entities/:id/agent/run', async (req, res) => {
  const { task_type } = req.body;
  if (!task_type) return res.status(400).json({ error: 'task_type required' });
  const agent = new AccountingAgent(req.params.id);
  const methods = {
    DAILY_AR_SWEEP: 'runDailyArSweep',
    EXPENSE_REVIEW: 'runExpenseReview',
    BANK_MATCHING: 'runBankMatching',
    DEPRECIATION_CALC: 'runDepreciationCalculation'
  };
  const method = methods[task_type];
  if (!method) return res.status(400).json({ error: `Unknown task_type: ${task_type}` });

  // Create task record first so we can return ID immediately
  const taskResult = db.prepare(`
    INSERT INTO agent_tasks (entity_id, agent_name, task_type, status, trigger_type, input_data, steps_log)
    VALUES (?, 'AccountingAgent (NEXUS-C)', ?, 'RUNNING', 'MANUAL', '{}', '[]')
  `).run(req.params.id, task_type);
  const taskId = taskResult.lastInsertRowid;
  agent.taskId = taskId;

  runAgentAsync(agent, method);
  res.json({ success: true, task_id: taskId, status: 'RUNNING', task_type });
});

router.get('/entities/:id/agent/tasks', (req, res) => {
  const tasks = db.prepare(`
    SELECT * FROM agent_tasks WHERE entity_id = ? ORDER BY started_at DESC LIMIT 50
  `).all(req.params.id);
  res.json({ tasks, total: tasks.length });
});

router.get('/entities/:id/agent/tasks/:tid', (req, res) => {
  const task = db.prepare('SELECT * FROM agent_tasks WHERE id = ? AND entity_id = ?').get(req.params.tid, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  try { task.steps_log = JSON.parse(task.steps_log || '[]'); } catch { task.steps_log = []; }
  try { task.output_data = JSON.parse(task.output_data || 'null'); } catch {}
  res.json(task);
});

router.get('/entities/:id/agent/decisions', (req, res) => {
  const { status = 'PENDING' } = req.query;
  const items = db.prepare(`
    SELECT * FROM human_decision_items WHERE entity_id = ? AND status = ?
    ORDER BY CASE urgency WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, created_at ASC
  `).all(req.params.id, status);
  const parsed = items.map(item => {
    try { item.context_data = JSON.parse(item.context_data || '{}'); } catch {}
    return item;
  });
  res.json({ items: parsed, total: parsed.length });
});

router.post('/entities/:id/agent/decisions/:did/decide', (req, res) => {
  const { status, action, notes } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  const item = db.prepare('SELECT * FROM human_decision_items WHERE id = ? AND entity_id = ?').get(req.params.did, req.params.id);
  if (!item) return res.status(404).json({ error: 'Decision item not found' });

  db.prepare(`
    UPDATE human_decision_items
    SET status = ?, human_decision = ?, human_notes = ?, decided_by = 'admin', decided_at = datetime('now')
    WHERE id = ?
  `).run(status, action || status, notes || '', req.params.did);

  logAgentAction(req.params.id, item.agent_task_id, 'HUMAN_DECISION',
    `Human ${status}: ${item.title}`,
    { status: 'PENDING' }, { status, notes }, false, item.id);

  res.json({ success: true, status, decision_id: req.params.did });
});

router.get('/entities/:id/agent/action-log', (req, res) => {
  const log = db.prepare(`
    SELECT * FROM agent_action_log WHERE entity_id = ? ORDER BY timestamp DESC LIMIT 100
  `).all(req.params.id);
  res.json({ log, total: log.length });
});

// ─── NEXUS-C CHAT ───────────────────────────────────────────────────────────

router.post('/entities/:id/agent/chat', async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  // Fetch quick context
  const pendingDecisions = db.prepare("SELECT COUNT(*) as n FROM human_decision_items WHERE entity_id = ? AND status = 'PENDING'").get(req.params.id)?.n || 0;
  const overdue = db.prepare("SELECT COUNT(*) as n, COALESCE(SUM(amount_due),0) as total FROM invoices WHERE entity_id = ? AND status IN ('SENT','OVERDUE') AND due_date < date('now')").get(req.params.id);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: `You are NEXUS-C, the intelligent accounting assistant for ${entity.name}.
Country: ${entity.country} | Currency: ${entity.currency} | Tax Scheme: ${entity.tax_scheme || 'N/A'}
Today: ${new Date().toISOString().slice(0, 10)}

Current status:
- Pending human decisions: ${pendingDecisions}
- Overdue invoices: ${overdue?.n || 0} worth ${entity.currency} ${(overdue?.total || 0).toLocaleString()}

You can help with:
- Answering questions about financial position and trends
- Explaining accounting concepts (IFRS, GST, VAT, depreciation)
- Suggesting actions and flagging when human approval is needed
- Drafting reports and summaries
Be concise, professional, and actionable. Always mention when a task requires human approval.`,
        messages
      })
    });
    const data = await response.json();
    res.json({ response: data.content?.[0]?.text || '', usage: data.usage });
  } catch (err) {
    res.status(500).json({ error: 'Chat failed', detail: err.message });
  }
});

module.exports = router;
