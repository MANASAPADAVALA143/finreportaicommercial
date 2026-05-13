'use strict';

const { db, logAgentAction } = require('../database/accounting');

const THRESHOLDS = {
  invoice_amount: parseFloat(process.env.AGENT_HUMAN_THRESHOLD_INVOICE || '10000'),
  expense_amount: parseFloat(process.env.AGENT_HUMAN_THRESHOLD_EXPENSE || '500'),
  recon_variance_pct: parseFloat(process.env.AGENT_HUMAN_THRESHOLD_RECON_PCT || '1.0'),
};

const ALWAYS_ESCALATE = new Set([
  'post_journal', 'write_off', 'delete_record', 'change_coa', 'change_tax_rate'
]);

class BaseAccountingAgent {
  constructor(entityId, agentName) {
    this.entityId = entityId;
    this.agentName = agentName;
    this.stepsLog = [];
    this.taskId = null;
  }

  _log(type, content, data) {
    const entry = { timestamp: new Date().toISOString(), type, content };
    if (data !== undefined) entry.data = data;
    this.stepsLog.push(entry);
  }

  needsHumanApproval(decisionType, amount = 0, context = {}) {
    if (ALWAYS_ESCALATE.has(decisionType)) return true;
    if (decisionType === 'post_invoice' || decisionType === 'send_invoice') {
      return amount > THRESHOLDS.invoice_amount;
    }
    if (decisionType === 'approve_expense') {
      return amount > THRESHOLDS.expense_amount;
    }
    if (decisionType === 'reconciliation') {
      return (context.variance_pct || 0) > THRESHOLDS.recon_variance_pct;
    }
    return false;
  }

  createHumanDecisionItem({ title, description, decision_type, urgency = 'NORMAL', context_data, recommendation, confidence }) {
    this._log('ESCALATE', `Creating human decision: ${title}`);
    const result = db.prepare(`
      INSERT INTO human_decision_items
        (entity_id, agent_task_id, title, description, decision_type, urgency, context_data, agent_recommendation, agent_confidence, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', datetime('now', '+24 hours'))
    `).run(
      this.entityId, this.taskId, title, description, decision_type,
      urgency, JSON.stringify(context_data), recommendation, confidence
    );
    logAgentAction(this.entityId, this.taskId, 'ESCALATE', title, null, { decision_item_id: result.lastInsertRowid }, false, result.lastInsertRowid);
    return result.lastInsertRowid;
  }

  async startTask(taskType, inputData, triggerType = 'MANUAL') {
    const result = db.prepare(`
      INSERT INTO agent_tasks (entity_id, agent_name, task_type, status, trigger_type, input_data, steps_log)
      VALUES (?, ?, ?, 'RUNNING', ?, ?, '[]')
    `).run(this.entityId, this.agentName, taskType, triggerType, JSON.stringify(inputData));
    this.taskId = result.lastInsertRowid;
    this._log('THOUGHT', `Task started: ${taskType}`);
    return this.taskId;
  }

  completeTask(status, outputData) {
    db.prepare(`
      UPDATE agent_tasks
      SET status = ?, output_data = ?, steps_log = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(status, JSON.stringify(outputData), JSON.stringify(this.stepsLog), this.taskId);
  }

  // ── Core ReAct loop ─────────────────────────────────────────────────────
  async runReactLoop(goal, tools, maxIterations = 10) {
    const messages = [{ role: 'user', content: goal }];
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      this._log('THOUGHT', `Iteration ${iteration}: calling Claude`);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: this._systemPrompt(),
          tools,
          messages
        })
      });

      if (!response.ok) {
        const err = await response.text();
        this._log('ERROR', `Claude API error: ${err}`);
        this.completeTask('FAILED', { error: err });
        return { status: 'failed', error: err, steps: this.stepsLog };
      }

      const data = await response.json();

      // Agent finished
      if (data.stop_reason === 'end_turn') {
        const text = (data.content || []).find(b => b.type === 'text')?.text || '';
        this._log('OBSERVATION', `Agent complete: ${text.slice(0, 200)}`);
        this.completeTask('COMPLETE', { result: text });
        return { status: 'complete', result: text, steps: this.stepsLog };
      }

      // Tool calls
      if (data.stop_reason === 'tool_use') {
        const toolResults = [];
        for (const block of (data.content || [])) {
          if (block.type !== 'tool_use') continue;
          this._log('ACTION', `Tool: ${block.name}`, block.input);
          const result = await this._executeTool(block.name, block.input);
          this._log('OBSERVATION', `Tool result: ${block.name}`, result);

          if (result.requires_human) {
            const itemId = this.createHumanDecisionItem(result.human_context);
            this.completeTask('WAITING_HUMAN', { decision_item_id: itemId });
            return { status: 'waiting_human', decision_item_id: itemId, steps: this.stepsLog };
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
        }
        messages.push({ role: 'assistant', content: data.content });
        messages.push({ role: 'user', content: toolResults });
      }
    }

    this.completeTask('FAILED', { error: 'max_iterations_reached' });
    return { status: 'max_iterations_reached', steps: this.stepsLog };
  }

  _systemPrompt() {
    return `You are ${this.agentName}, a specialist AI accounting agent for global accounting operations.

AUTONOMY RULES:
- AUTONOMOUS (no human needed): draft invoices, categorise transactions, flag anomalies, generate draft reports, send payment reminders, calculate depreciation.
- MUST ESCALATE to human: posting transactions, approving payments, journal entries, write-offs, deletions, any amount above threshold (invoices >$${THRESHOLDS.invoice_amount}, expenses >$${THRESHOLDS.expense_amount}).

When you need human approval, call the escalate_to_human tool with full context.
Think step-by-step. Explain your reasoning before every action.
After each tool result, assess: is this expected? Any anomalies?

Entity ID: ${this.entityId}
Time: ${new Date().toISOString()}`;
  }

  async _executeTool(name, input) {
    throw new Error(`_executeTool not implemented for tool: ${name}`);
  }
}

module.exports = { BaseAccountingAgent, THRESHOLDS };
