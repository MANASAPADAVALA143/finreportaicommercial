import axios from "axios";
import { getIfrsTenantId } from "./ifrsTenant";

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || "http://localhost:8000";
const BASE_URL = `${API_BASE.replace(/\/$/, "")}/api/ifrs`;
const BOARD_PACK_BASE = `${API_BASE.replace(/\/$/, "")}/api/board-pack`;

const headers = (tenantId?: string) => ({
  "X-Tenant-ID": (tenantId && tenantId.trim()) || getIfrsTenantId(),
});

export type HarnessTier = "blocked" | "needs_review" | "auto_confirmed" | "confirmed" | "auto_fixed";

export type HarnessSummary = {
  harness_score: number;
  ready_to_generate: boolean;
  auto_confirmed: number;
  needs_review: number;
  blocked: number;
  auto_fixed: number;
};

export type IFRSMapping = {
  id: number;
  trial_balance_line_id: number;
  gl_code: string;
  gl_description: string;
  debit_amount?: number;
  credit_amount?: number;
  net_amount?: number;
  ifrs_statement:
    | "financial_position"
    | "profit_loss"
    | "cash_flows"
    | "equity"
    | "other_comprehensive_income";
  ifrs_line_item: string;
  ifrs_section: string;
  ifrs_sub_section?: string | null;
  mapping_source: "ai_suggested" | "user_confirmed" | "user_overridden" | "tally_suggested" | "template_suggested";
  ai_confidence_score: number;
  ai_reasoning?: string | null;
  is_confirmed: boolean;
  needs_review?: boolean;
  validator_checked?: boolean;
  validator_passed?: boolean;
  validator_issues?: { rule_id?: string; severity?: string }[] | null;
  validator_score?: number | null;
  is_contra?: boolean;
  locked?: boolean;
  harness_tier?: HarnessTier;
};

export type IFRSLineItemMasterRow = {
  name: string;
  statement: string;
  section: string;
  is_calculated: boolean;
  standard?: string | null;
};

export type StatementLineItem = {
  id: number;
  statement_id: number;
  ifrs_section: string;
  ifrs_sub_section?: string | null;
  ifrs_line_item: string;
  amount: number;
  is_calculated: boolean;
  is_subtotal: boolean;
  is_total: boolean;
  is_manual_override: boolean;
  display_order: number;
  indent_level: number;
};

export type GeneratedStatementPayload = {
  statement_id: number;
  statement_type:
    | "financial_position"
    | "profit_loss"
    | "cash_flows"
    | "equity"
    | "other_comprehensive_income";
  status: string;
  currency: string;
  period_start?: string | null;
  period_end?: string | null;
  generated_at?: string | null;
  line_items: StatementLineItem[];
};

export const ifrsService = {
  async uploadTrialBalance(file: File, companyName = "Uploaded Entity") {
    const form = new FormData();
    form.append("file", file);
    form.append("company_name", companyName);
    form.append("auto_map", "true");
    // Do not set Content-Type: axios sets multipart boundary automatically; a bare
    // "multipart/form-data" breaks parsing and causes 400 / flaky CORS errors.
    const { data } = await axios.post(`${BASE_URL}/trial-balance/upload`, form, {
      headers: headers(),
    });
    return data as { trial_balance_id: number; lines_count: number; status: string; message?: string };
  },

  async getTrialBalance(tbId: number) {
    const { data } = await axios.get(`${BASE_URL}/trial-balance/${tbId}`, { headers: headers() });
    return data;
  },

  async mapWithAI(tbId: number) {
    const { data } = await axios.post(`${BASE_URL}/trial-balance/${tbId}/map-with-ai`, {}, { headers: headers() });
    return data;
  },

  async getMappings(tbId: number) {
    const { data } = await axios.get(`${BASE_URL}/trial-balance/${tbId}/mappings`, { headers: headers() });
    return data as {
      trial_balance_id: number;
      trial_balance_status: string;
      counts: {
        trial_balance_lines?: number;
        total_mappings: number;
        confirmed: number;
        needs_review: number;
        ai_suggested_pending: number;
      };
      harness?: HarnessSummary;
      mappings: IFRSMapping[];
    };
  },

  async validateMappings(tbId: number) {
    const { data } = await axios.post(`${BASE_URL}/trial-balance/${tbId}/validate-mappings`, {}, { headers: headers() });
    return data as Record<string, unknown>;
  },

  async updateMapping(mappingId: number, payload: Partial<IFRSMapping>) {
    const { data } = await axios.patch(`${BASE_URL}/mapping/${mappingId}`, payload, { headers: headers() });
    return data;
  },

  async bulkConfirm(mappingIds: number[]) {
    const { data } = await axios.post(
      `${BASE_URL}/mapping/bulk-confirm`,
      { mapping_ids: mappingIds },
      { headers: headers() }
    );
    return data as { updated: number };
  },

  async confirmHighConfidence(tbId: number, threshold = 0.85) {
    const { data } = await axios.post(
      `${BASE_URL}/trial-balance/${tbId}/confirm-high-confidence`,
      { threshold },
      { headers: headers() }
    );
    return data as { confirmed: number; skipped_blocked: number; threshold: number; confirmed_ids: number[] };
  },

  async getLineItemMaster() {
    const { data } = await axios.get(`${BASE_URL}/line-item-master`, { headers: headers() });
    return data as { items: IFRSLineItemMasterRow[]; count: number };
  },

  async getTemplates() {
    const { data } = await axios.get(`${BASE_URL}/mapping-templates`, { headers: headers() });
    return data;
  },

  async createTemplate(payload: { template_name: string; industry?: string; trial_balance_id: number; is_default?: boolean }) {
    const { data } = await axios.post(`${BASE_URL}/mapping-templates`, payload, { headers: headers() });
    return data;
  },

  async saveTemplateFromCoa(
    payload: {
      template_name: string;
      industry?: string;
      is_default?: boolean;
      company_name?: string;
      currency?: string;
      entries: Array<{
        gl_code: string;
        gl_description: string;
        ifrs_statement: string;
        ifrs_section: string;
        ifrs_line_item: string;
        ifrs_sub_section?: string | null;
      }>;
    },
    tenantId?: string
  ) {
    const { data } = await axios.post(`${BASE_URL}/mapping-templates/from-coa`, payload, {
      headers: headers(tenantId),
    });
    return data as {
      id: number;
      template_name: string;
      entries_saved: number;
      is_default: boolean;
      tenant_id: string;
    };
  },

  async generateStatements(tbId: number) {
    const { data } = await axios.post(`${BASE_URL}/trial-balance/${tbId}/generate-statements`, {}, { headers: headers() });
    return data as {
      trial_balance_id: number;
      statements: Record<string, { section: string; line_item: string; amount: number; is_subtotal: boolean; is_total: boolean; indent_level: number }[]>;
      generated_at: string;
    };
  },

  async getStatements(tbId: number) {
    const { data } = await axios.get(`${BASE_URL}/trial-balance/${tbId}/statements`, { headers: headers() });
    return data as {
      trial_balance_id: number;
      statements: Record<string, GeneratedStatementPayload>;
    };
  },

  async getSingleStatement(statementId: number) {
    const { data } = await axios.get(`${BASE_URL}/statements/${statementId}`, { headers: headers() });
    return data;
  },

  async updateLineItem(lineId: number, amount: number) {
    const { data } = await axios.patch(`${BASE_URL}/statement-line/${lineId}`, { amount }, { headers: headers() });
    return data;
  },

  async generateNotes(tbId: number) {
    const { data } = await axios.post(`${BASE_URL}/trial-balance/${tbId}/generate-notes`, {}, { headers: headers() });
    return data as { trial_balance_id: number; notes: Record<string, unknown> };
  },

  async getNotes(tbId: number) {
    const { data } = await axios.get(`${BASE_URL}/trial-balance/${tbId}/notes`, { headers: headers() });
    return data as { trial_balance_id: number; notes: unknown[]; count: number };
  },

  async getNote(noteId: number) {
    const { data } = await axios.get(`${BASE_URL}/notes/${noteId}`, { headers: headers() });
    return data as {
      note: {
        id: number;
        user_edited_content?: string;
        ai_generated_content?: string;
        status?: string;
        word_count?: number;
      };
    };
  },

  async updateNote(noteId: number, user_edited_content: string) {
    const { data } = await axios.patch(
      `${BASE_URL}/notes/${noteId}`,
      { user_edited_content },
      { headers: headers() }
    );
    return data as { ok: boolean; note: unknown };
  },

  async regenerateNote(noteId: number) {
    const { data } = await axios.post(`${BASE_URL}/notes/${noteId}/regenerate`, {}, { headers: headers() });
    return data as { ok: boolean; note: { user_edited_content?: string; ai_generated_content?: string } };
  },

  async runComplianceCheck(tbId: number) {
    const { data } = await axios.post(`${BASE_URL}/trial-balance/${tbId}/compliance-check`, {}, { headers: headers() });
    return data as {
      trial_balance_id: number;
      checks: unknown[];
      summary: {
        total: number;
        passed: number;
        failed: number;
        critical_failures: number;
        compliance_score: number;
        audit_ready: boolean;
      };
    };
  },

  async getComplianceResults(tbId: number) {
    const { data } = await axios.get(`${BASE_URL}/trial-balance/${tbId}/compliance-results`, { headers: headers() });
    return data as {
      trial_balance_id: number;
      checks: unknown[];
      summary: {
        total: number;
        passed: number;
        failed: number;
        critical_failures: number;
        compliance_score: number;
        audit_ready: boolean;
      };
    };
  },

  async generateCommentary(tbId: number) {
    const { data } = await axios.post(
      `${BASE_URL}/trial-balance/${tbId}/generate-commentary`,
      {},
      { headers: headers() }
    );
    return data as { trial_balance_id: number; ok: boolean; commentary_types: string[] };
  },

  async detectRisks(tbId: number) {
    const { data } = await axios.post(`${BASE_URL}/trial-balance/${tbId}/detect-risks`, {}, { headers: headers() });
    return data as { trial_balance_id: number; ok: boolean; risk_flags: number };
  },

  async generateBoardPack(tbId: number, watermark: "DRAFT" | "FINAL" | "CONFIDENTIAL") {
    const { data } = await axios.post(
      `${BASE_URL}/trial-balance/${tbId}/generate-board-pack`,
      { watermark },
      { headers: headers() }
    );
    return data as {
      board_pack_id: number;
      pdf_path: string;
      public_url: string;
      view_url: string;
      download_url: string;
      pages: number;
    };
  },

  getBoardPackUrl(token: string): string {
    return `${BOARD_PACK_BASE}/view/${token}`;
  },

  downloadBoardPack(token: string): void {
    const url = `${BOARD_PACK_BASE}/download/${token}`;
    window.open(url, "_blank", "noopener,noreferrer");
  },

  // ── UAE CT Bridge ──────────────────────────────────────────────────────────

  async generateCTBridge(
    tbId: number,
    inputs: {
      entertainment_expense?: number;
      fines_penalties?: number;
      non_business_expenses?: number;
      non_qualifying_depreciation?: number;
      dividend_income_uae_sub?: number;
      qualifying_capital_gains?: number;
      qualifying_free_zone_income?: number;
      is_free_zone_person?: boolean;
      qualifying_income_pct?: number;
      revenue_override?: number;
    } = {}
  ) {
    const { data } = await axios.post(
      `${BASE_URL}/trial-balance/${tbId}/ct-bridge`,
      inputs,
      { headers: headers() }
    );
    return data as {
      trial_balance_id: number;
      company_name: string;
      period_end: string;
      currency: string;
      ifrs_pbt: number;
      revenue: number;
      adjustments: {
        description: string;
        amount: number;
        add_back: boolean;
        note: string;
        ifrs_reference?: string;
      }[];
      total_add_backs: number;
      total_deductions: number;
      taxable_income: number;
      ct_rate: number;
      ct_rate_pct: number;
      ct_liability: number;
      effective_rate_pct: number;
      small_business_relief: boolean;
      sbr_threshold: number;
      free_zone_eligible: boolean;
      free_zone_note: string;
      rate_note: string;
    };
  },

  async getCTBridge(tbId: number) {
    const { data } = await axios.get(
      `${BASE_URL}/trial-balance/${tbId}/ct-bridge`,
      { headers: headers() }
    );
    return data as {
      trial_balance_id: number;
      company_name: string;
      period_end: string;
      currency: string;
      ifrs_pbt: number;
      adjustments: { description: string; amount: number; add_back: boolean; note: string }[];
      taxable_income: number;
      ct_rate: number;
      ct_rate_pct: number;
      ct_liability: number;
      small_business_relief: boolean;
      free_zone_eligible: boolean;
      inputs: Record<string, unknown>;
      calculated_at: string;
    };
  },

  // ── Export Downloads ───────────────────────────────────────────────────────

  downloadExport(tbId: number, format: "excel" | "pdf" | "word"): void {
    const ext = format === "excel" ? "excel" : format;
    const url = `${BASE_URL}/trial-balance/${tbId}/export/${ext}`;
    // Create a hidden anchor and click it — preserves auth headers via same-origin
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", "");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  async finalizeBoardPack(boardPackId: number, reviewedBy = "board") {
    const { data } = await axios.post(
      `${BOARD_PACK_BASE}/${boardPackId}/finalize`,
      { reviewed_by: reviewedBy },
      { headers: headers() }
    );
    return data as {
      board_pack_id: number;
      pdf_path: string;
      public_url: string;
      download_url: string;
      pages: number;
      watermark: string;
    };
  },
};

