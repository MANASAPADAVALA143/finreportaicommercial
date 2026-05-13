const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../accounting.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- ─── ENTITIES (replaces per-session "company") ──────────────────────────
  CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    country TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    tax_scheme TEXT,
    tax_number TEXT,
    tax_rate_default REAL DEFAULT 0,
    fiscal_year_end TEXT DEFAULT '12-31',
    accounting_method TEXT DEFAULT 'ACCRUAL',
    industry TEXT,
    conversion_date TEXT,
    integration_mode TEXT DEFAULT 'STANDALONE',
    onboarding_complete INTEGER DEFAULT 0,
    plan TEXT DEFAULT 'starter',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── CHART OF ACCOUNTS ──────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES entities(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    account_type TEXT,
    sub_type TEXT,
    currency TEXT,
    account_number TEXT,
    conversion_balance REAL DEFAULT 0,
    tax_code TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    is_bank_feed_connected INTEGER DEFAULT 0,
    ai_suggested INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── CONTACTS ───────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES entities(id),
    contact_type TEXT DEFAULT 'CUSTOMER',
    display_name TEXT NOT NULL,
    company_name TEXT,
    email TEXT,
    phone TEXT,
    country TEXT,
    tax_number TEXT,
    payment_terms INTEGER DEFAULT 30,
    credit_limit REAL,
    default_account_id INTEGER,
    status TEXT DEFAULT 'ACTIVE',
    ai_risk_score REAL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── TAX RATES ──────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS tax_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES entities(id),
    name TEXT NOT NULL,
    rate REAL NOT NULL,
    tax_type TEXT DEFAULT 'OUTPUT',
    account_id INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── INVOICES (AR) ──────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES entities(id),
    invoice_number TEXT,
    invoice_type TEXT DEFAULT 'INVOICE',
    customer_id INTEGER REFERENCES contacts(id),
    status TEXT DEFAULT 'DRAFT',
    issue_date TEXT,
    due_date TEXT,
    currency TEXT,
    subtotal REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    amount_paid REAL DEFAULT 0,
    amount_due REAL DEFAULT 0,
    reference TEXT,
    notes TEXT,
    is_recurring INTEGER DEFAULT 0,
    recurring_frequency TEXT,
    agent_created INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invoice_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    description TEXT,
    quantity REAL DEFAULT 1,
    unit_price REAL DEFAULT 0,
    account_id INTEGER,
    tax_rate REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    discount_type TEXT,
    discount_value REAL DEFAULT 0
  );

  -- ─── EXPENSE CLAIMS ─────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS expense_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES entities(id),
    claim_number TEXT,
    receipt_number TEXT,
    submitted_by TEXT DEFAULT 'admin',
    status TEXT DEFAULT 'UNCLAIMED',
    vendor_id INTEGER REFERENCES contacts(id),
    account_id INTEGER REFERENCES accounts(id),
    expense_date TEXT,
    amount REAL,
    tax_amount REAL DEFAULT 0,
    expense_type TEXT,
    description TEXT,
    receipt_url TEXT,
    payment_method TEXT DEFAULT 'PERSONAL',
    ai_category_suggestion TEXT,
    ai_confidence REAL,
    approved_by TEXT,
    approved_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── FIXED ASSETS ───────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS fixed_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES entities(id),
    asset_number TEXT,
    name TEXT,
    asset_type TEXT,
    purchase_date TEXT,
    purchase_price REAL,
    useful_life_years INTEGER,
    depreciation_method TEXT DEFAULT 'SLM',
    depreciation_rate REAL,
    accumulated_depreciation REAL DEFAULT 0,
    net_book_value REAL,
    disposal_date TEXT,
    disposal_amount REAL,
    account_id INTEGER,
    status TEXT DEFAULT 'ACTIVE',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── BANK ACCOUNTS ──────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES entities(id),
    account_id INTEGER REFERENCES accounts(id),
    bank_name TEXT,
    account_number TEXT,
    account_type TEXT DEFAULT 'CHECKING',
    currency TEXT,
    current_balance REAL DEFAULT 0,
    last_reconciled_date TEXT,
    is_feed_connected INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bank_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
    transaction_date TEXT,
    description TEXT,
    amount REAL,
    reference TEXT,
    match_status TEXT DEFAULT 'UNMATCHED',
    matched_invoice_id INTEGER,
    ai_category TEXT,
    ai_confidence REAL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── AGENT TASKS ────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS agent_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER REFERENCES entities(id),
    agent_name TEXT,
    task_type TEXT,
    status TEXT DEFAULT 'RUNNING',
    trigger_type TEXT DEFAULT 'MANUAL',
    input_data TEXT,
    output_data TEXT,
    steps_log TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  -- ─── HUMAN DECISION QUEUE ───────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS human_decision_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER REFERENCES entities(id),
    agent_task_id INTEGER REFERENCES agent_tasks(id),
    title TEXT,
    description TEXT,
    decision_type TEXT DEFAULT 'APPROVE',
    urgency TEXT DEFAULT 'NORMAL',
    context_data TEXT,
    agent_recommendation TEXT,
    agent_confidence REAL,
    status TEXT DEFAULT 'PENDING',
    human_decision TEXT,
    human_notes TEXT,
    decided_by TEXT,
    decided_at TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── AGENT ACTION LOG ───────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS agent_action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER REFERENCES entities(id),
    agent_task_id INTEGER,
    action_type TEXT,
    description TEXT,
    before_state TEXT,
    after_state TEXT,
    is_autonomous INTEGER DEFAULT 1,
    human_decision_id INTEGER,
    timestamp TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Helpers ───────────────────────────────────────────────────────────────

function nextInvoiceNumber(entityId) {
  const row = db.prepare(
    "SELECT invoice_number FROM invoices WHERE entity_id = ? AND invoice_type = 'INVOICE' ORDER BY id DESC LIMIT 1"
  ).get(entityId);
  if (!row) return 'INV-000001';
  const n = parseInt((row.invoice_number || '').replace(/\D/g, '')) || 0;
  return 'INV-' + String(n + 1).padStart(6, '0');
}

function nextClaimNumber(entityId) {
  const row = db.prepare(
    "SELECT claim_number FROM expense_claims WHERE entity_id = ? ORDER BY id DESC LIMIT 1"
  ).get(entityId);
  if (!row) return 'CLM-000001';
  const n = parseInt((row.claim_number || '').replace(/\D/g, '')) || 0;
  return 'CLM-' + String(n + 1).padStart(6, '0');
}

function nextAssetNumber(entityId) {
  const row = db.prepare(
    "SELECT asset_number FROM fixed_assets WHERE entity_id = ? ORDER BY id DESC LIMIT 1"
  ).get(entityId);
  if (!row) return 'AST-000001';
  const n = parseInt((row.asset_number || '').replace(/\D/g, '')) || 0;
  return 'AST-' + String(n + 1).padStart(6, '0');
}

function logAgentAction(entityId, taskId, actionType, description, beforeState, afterState, isAutonomous, humanDecisionId) {
  db.prepare(`
    INSERT INTO agent_action_log (entity_id, agent_task_id, action_type, description, before_state, after_state, is_autonomous, human_decision_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(entityId, taskId, actionType, description,
    JSON.stringify(beforeState), JSON.stringify(afterState),
    isAutonomous ? 1 : 0, humanDecisionId || null);
}

module.exports = { db, nextInvoiceNumber, nextClaimNumber, nextAssetNumber, logAgentAction };
