'use strict';

const { BaseAccountingAgent } = require('./base_agent');
const { db, nextInvoiceNumber, logAgentAction } = require('../database/accounting');

const TOOLS = [
  {
    name: 'get_overdue_invoices',
    description: 'Get all overdue invoices for the entity',
    input_schema: {
      type: 'object',
      properties: {
        days_overdue: { type: 'integer', description: 'Minimum days overdue', default: 7 },
        limit: { type: 'integer', default: 50 }
      }
    }
  },
  {
    name: 'send_payment_reminder',
    description: 'Send payment reminder to customer (autonomous — no human approval needed)',
    input_schema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'integer' },
        reminder_type: { type: 'string', enum: ['GENTLE', 'FIRM', 'FINAL'] }
      },
      required: ['invoice_id', 'reminder_type']
    }
  },
  {
    name: 'categorise_bank_transaction',
    description: 'AI-categorise an uncategorised bank transaction',
    input_schema: {
      type: 'object',
      properties: {
        transaction_id: { type: 'integer' },
        description: { type: 'string' },
        amount: { type: 'number' }
      },
      required: ['transaction_id']
    }
  },
  {
    name: 'match_bank_to_invoice',
    description: 'Match a bank credit to an outstanding invoice',
    input_schema: {
      type: 'object',
      properties: {
        bank_transaction_id: { type: 'integer' },
        invoice_id: { type: 'integer' },
        confidence: { type: 'number' }
      },
      required: ['bank_transaction_id', 'invoice_id', 'confidence']
    }
  },
  {
    name: 'create_draft_invoice',
    description: 'Create a DRAFT invoice (autonomous — does not post, human approves before sending)',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'integer' },
        line_items: { type: 'array' },
        due_date: { type: 'string' },
        notes: { type: 'string' }
      },
      required: ['customer_id', 'line_items']
    }
  },
  {
    name: 'review_expense_claim',
    description: 'Review and categorise an expense claim against policy rules',
    input_schema: {
      type: 'object',
      properties: { claim_id: { type: 'integer' } },
      required: ['claim_id']
    }
  },
  {
    name: 'calculate_depreciation',
    description: 'Calculate depreciation for all active assets',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'YYYY-MM' },
        dry_run: { type: 'boolean', default: true }
      }
    }
  },
  {
    name: 'generate_ar_aging_report',
    description: 'Generate accounts receivable aging report',
    input_schema: {
      type: 'object',
      properties: { as_at_date: { type: 'string' } }
    }
  },
  {
    name: 'get_unmatched_bank_transactions',
    description: 'Get all unmatched bank transactions',
    input_schema: {
      type: 'object',
      properties: { days_back: { type: 'integer', default: 30 } }
    }
  },
  {
    name: 'get_unclaimed_expenses',
    description: 'Get all unclaimed expense receipts',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'escalate_to_human',
    description: 'REQUIRED when action needs human approval. Creates a decision queue item and pauses the agent.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        decision_type: { type: 'string' },
        urgency: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'], default: 'NORMAL' },
        context_data: { type: 'object' },
        recommendation: { type: 'string' },
        confidence: { type: 'number' }
      },
      required: ['title', 'description', 'decision_type', 'recommendation']
    }
  }
];

class AccountingAgent extends BaseAccountingAgent {
  constructor(entityId) {
    super(entityId, 'AccountingAgent (NEXUS-C)');
  }

  async runDailyArSweep() {
    await this.startTask('DAILY_AR_SWEEP', {}, 'SCHEDULED');
    return this.runReactLoop(`
Perform the daily accounts receivable sweep for entity ${this.entityId}:
1. Find all overdue invoices (> 7 days past due)
2. For invoices 7-14 days overdue: send GENTLE reminder autonomously
3. For invoices 15-30 days overdue: send FIRM reminder autonomously
4. For invoices > 30 days overdue: escalate to human with full context and recommendation
5. Get all unmatched bank transactions and attempt to match to outstanding invoices
6. Generate AR aging report and summarise findings
Report what was done autonomously and what needs human attention.
    `.trim(), TOOLS);
  }

  async runExpenseReview() {
    await this.startTask('EXPENSE_REVIEW', {}, 'SCHEDULED');
    return this.runReactLoop(`
Review all pending expense claims for entity ${this.entityId}:
1. Get all UNCLAIMED expense receipts
2. For each: categorise based on description and amount
3. If amount < $500 and category is standard (Travel/Meals/Office/Software): mark as REVIEWED with AI suggestion
4. If amount >= $500 or unusual category: escalate to human for approval
5. Summarise: how many processed autonomously, how many escalated
    `.trim(), TOOLS);
  }

  async runBankMatching() {
    await this.startTask('BANK_MATCHING', {}, 'MANUAL');
    return this.runReactLoop(`
Perform bank transaction matching for entity ${this.entityId}:
1. Get all UNMATCHED bank transactions from last 30 days
2. For each transaction: attempt to match to outstanding invoices by amount, date proximity, and reference
3. If confidence > 90%: autonomously match
4. If confidence 70-90%: escalate to human for confirmation
5. If confidence < 70%: categorise with AI suggestion but leave UNMATCHED
6. Report match rate and any unresolved items
    `.trim(), TOOLS);
  }

  async runDepreciationCalculation(period) {
    await this.startTask('DEPRECIATION_CALC', { period }, 'MANUAL');
    return this.runReactLoop(`
Calculate depreciation for period ${period || new Date().toISOString().slice(0, 7)} for entity ${this.entityId}:
1. Calculate depreciation using SLM (Straight Line) or WDV method
2. Always escalate to human before posting — depreciation journal entries ALWAYS need approval
3. Present full calculation detail with asset-by-asset breakdown
    `.trim(), TOOLS);
  }

  async _executeTool(name, input) {
    switch (name) {
      case 'escalate_to_human':
        return { requires_human: true, human_context: { ...input, confidence: input.confidence || 0.85 } };

      case 'get_overdue_invoices': {
        const days = input.days_overdue || 7;
        const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        const invoices = db.prepare(`
          SELECT i.*, c.display_name as customer_name, c.email as customer_email
          FROM invoices i
          LEFT JOIN contacts c ON c.id = i.customer_id
          WHERE i.entity_id = ? AND i.status IN ('SENT','OVERDUE') AND i.due_date <= ?
          ORDER BY i.due_date ASC
          LIMIT ?
        `).all(this.entityId, cutoff, input.limit || 50);
        logAgentAction(this.entityId, this.taskId, 'READ', `Found ${invoices.length} overdue invoices`, null, { count: invoices.length }, true);
        return { invoices, count: invoices.length };
      }

      case 'send_payment_reminder': {
        const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND entity_id = ?').get(input.invoice_id, this.entityId);
        if (!inv) return { error: 'Invoice not found' };
        logAgentAction(this.entityId, this.taskId, 'REMINDER', `Sent ${input.reminder_type} reminder for ${inv.invoice_number}`, null, { reminder_type: input.reminder_type }, true);
        return { success: true, invoice_number: inv.invoice_number, reminder_type: input.reminder_type, sent_at: new Date().toISOString() };
      }

      case 'get_unclaimed_expenses': {
        const claims = db.prepare(`
          SELECT ec.*, c.display_name as vendor_name
          FROM expense_claims ec
          LEFT JOIN contacts c ON c.id = ec.vendor_id
          WHERE ec.entity_id = ? AND ec.status = 'UNCLAIMED'
          ORDER BY ec.expense_date DESC
        `).all(this.entityId);
        return { claims, count: claims.length };
      }

      case 'review_expense_claim': {
        const claim = db.prepare('SELECT * FROM expense_claims WHERE id = ? AND entity_id = ?').get(input.claim_id, this.entityId);
        if (!claim) return { error: 'Claim not found' };
        const needsHuman = this.needsHumanApproval('approve_expense', claim.amount);
        if (needsHuman) {
          return {
            requires_human: true,
            human_context: {
              title: `Expense Claim ${claim.claim_number} — ${claim.expense_type} $${claim.amount}`,
              description: `Expense claim requires approval: ${claim.description}. Amount $${claim.amount} exceeds autonomous threshold.`,
              decision_type: 'APPROVE',
              urgency: 'NORMAL',
              context_data: claim,
              recommendation: `Review and approve if the expense is legitimate business expense. Amount: $${claim.amount}.`,
              confidence: 0.9
            }
          };
        }
        db.prepare("UPDATE expense_claims SET status = 'CLAIMED', ai_category_suggestion = ? WHERE id = ?")
          .run(claim.expense_type || 'General', claim.id);
        logAgentAction(this.entityId, this.taskId, 'CATEGORISE', `Auto-categorised expense ${claim.claim_number}`, { status: 'UNCLAIMED' }, { status: 'CLAIMED' }, true);
        return { success: true, claim_id: claim.id, status: 'CLAIMED', category: claim.expense_type };
      }

      case 'get_unmatched_bank_transactions': {
        const daysBack = input.days_back || 30;
        const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
        const txns = db.prepare(`
          SELECT bt.*, ba.bank_name
          FROM bank_transactions bt
          JOIN bank_accounts ba ON ba.id = bt.bank_account_id
          WHERE ba.entity_id = ? AND bt.match_status = 'UNMATCHED' AND bt.transaction_date >= ?
          ORDER BY bt.transaction_date DESC
        `).all(this.entityId, cutoff);
        return { transactions: txns, count: txns.length };
      }

      case 'match_bank_to_invoice': {
        const { bank_transaction_id, invoice_id, confidence } = input;
        if (confidence >= 0.9) {
          db.prepare("UPDATE bank_transactions SET match_status = 'MATCHED', matched_invoice_id = ? WHERE id = ?")
            .run(invoice_id, bank_transaction_id);
          logAgentAction(this.entityId, this.taskId, 'MATCH', `Auto-matched bank txn ${bank_transaction_id} to invoice ${invoice_id}`, { match_status: 'UNMATCHED' }, { match_status: 'MATCHED', invoice_id }, true);
          return { success: true, matched: true, confidence };
        }
        return {
          requires_human: true,
          human_context: {
            title: `Bank Transaction Match Confirmation needed`,
            description: `Agent proposes matching bank transaction #${bank_transaction_id} to invoice #${invoice_id} with ${(confidence * 100).toFixed(0)}% confidence.`,
            decision_type: 'CONFIRM',
            urgency: 'LOW',
            context_data: { bank_transaction_id, invoice_id, confidence },
            recommendation: `Match bank transaction to invoice. Confidence: ${(confidence * 100).toFixed(0)}%. Review amounts and dates.`,
            confidence
          }
        };
      }

      case 'create_draft_invoice': {
        const invNum = nextInvoiceNumber(this.entityId);
        const subtotal = (input.line_items || []).reduce((s, li) => s + (li.amount || li.unit_price * li.quantity || 0), 0);
        const result = db.prepare(`
          INSERT INTO invoices (entity_id, invoice_number, invoice_type, customer_id, status, issue_date, due_date, currency, subtotal, total, amount_due, notes, agent_created)
          VALUES (?, ?, 'INVOICE', ?, 'DRAFT', date('now'), ?, 'USD', ?, ?, ?, ?, 1)
        `).run(this.entityId, invNum, input.customer_id, input.due_date || null, subtotal, subtotal, subtotal, input.notes || '');
        logAgentAction(this.entityId, this.taskId, 'CREATE_DRAFT', `Created draft invoice ${invNum}`, null, { invoice_id: result.lastInsertRowid }, true);
        return { success: true, invoice_id: result.lastInsertRowid, invoice_number: invNum, status: 'DRAFT', subtotal };
      }

      case 'calculate_depreciation': {
        const assets = db.prepare("SELECT * FROM fixed_assets WHERE entity_id = ? AND status = 'ACTIVE'").all(this.entityId);
        const calc = assets.map(a => {
          const monthly = a.depreciation_method === 'SLM'
            ? (a.purchase_price / ((a.useful_life_years || 5) * 12))
            : (a.net_book_value * (a.depreciation_rate || 0.2) / 12);
          return { asset_id: a.id, name: a.name, method: a.depreciation_method, monthly_depreciation: parseFloat(monthly.toFixed(2)), net_book_value: a.net_book_value };
        });
        const total = calc.reduce((s, a) => s + a.monthly_depreciation, 0);
        return {
          requires_human: true,
          human_context: {
            title: `Depreciation for ${input.period || 'current month'} — Total $${total.toFixed(2)}`,
            description: `Agent has calculated depreciation for ${assets.length} assets. Journal entries must be approved before posting.`,
            decision_type: 'APPROVE',
            urgency: 'NORMAL',
            context_data: { period: input.period, assets: calc, total_depreciation: total },
            recommendation: `Approve posting of ${assets.length} depreciation journal entries totalling $${total.toFixed(2)}.`,
            confidence: 0.99
          }
        };
      }

      case 'generate_ar_aging_report': {
        const asAt = input.as_at_date || new Date().toISOString().slice(0, 10);
        const invoices = db.prepare(`
          SELECT i.*, c.display_name as customer_name
          FROM invoices i LEFT JOIN contacts c ON c.id = i.customer_id
          WHERE i.entity_id = ? AND i.status IN ('SENT','OVERDUE') AND i.due_date <= ?
        `).all(this.entityId, asAt);
        const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91plus: 0 };
        const today = new Date(asAt);
        for (const inv of invoices) {
          const due = new Date(inv.due_date);
          const days = Math.floor((today - due) / 86400000);
          if (days <= 0) buckets.current += inv.amount_due;
          else if (days <= 30) buckets.d1_30 += inv.amount_due;
          else if (days <= 60) buckets.d31_60 += inv.amount_due;
          else if (days <= 90) buckets.d61_90 += inv.amount_due;
          else buckets.d91plus += inv.amount_due;
        }
        return { as_at: asAt, total_ar: invoices.reduce((s, i) => s + i.amount_due, 0), aging_buckets: buckets, invoice_count: invoices.length };
      }

      case 'categorise_bank_transaction': {
        const txn = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(input.transaction_id);
        if (!txn) return { error: 'Transaction not found' };
        const category = this._guessCategory(txn.description || input.description, txn.amount || input.amount);
        db.prepare('UPDATE bank_transactions SET ai_category = ?, ai_confidence = ? WHERE id = ?')
          .run(category.name, category.confidence, input.transaction_id);
        return { success: true, transaction_id: input.transaction_id, category: category.name, confidence: category.confidence };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  _guessCategory(description = '', amount = 0) {
    const d = description.toLowerCase();
    if (/salary|payroll|wages/.test(d)) return { name: 'Payroll', confidence: 0.9 };
    if (/rent|lease|office/.test(d)) return { name: 'Rent & Office', confidence: 0.88 };
    if (/aws|gcp|azure|hosting|cloud/.test(d)) return { name: 'Cloud & Software', confidence: 0.87 };
    if (/uber|lyft|taxi|transport|flight|hotel/.test(d)) return { name: 'Travel', confidence: 0.85 };
    if (/restaurant|food|meal|lunch|dinner/.test(d)) return { name: 'Meals & Entertainment', confidence: 0.83 };
    if (/insurance/.test(d)) return { name: 'Insurance', confidence: 0.88 };
    if (/marketing|ad|google|facebook|linkedin/.test(d)) return { name: 'Marketing', confidence: 0.85 };
    if (amount > 0) return { name: 'Sales Receipt', confidence: 0.6 };
    return { name: 'General Expense', confidence: 0.5 };
  }
}

module.exports = { AccountingAgent, TOOLS };
