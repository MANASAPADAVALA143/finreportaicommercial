import axios from "axios";

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || "http://localhost:8000";
const ERP_BASE = `${API_BASE.replace(/\/$/, "")}/api/erp`;
const TENANT = (import.meta.env.VITE_TENANT_ID && String(import.meta.env.VITE_TENANT_ID).trim()) || "default";

const headers = () => ({ "X-Tenant-ID": TENANT });

export type ErpConnectionRow = {
  id: number;
  connection_name: string;
  erp_type: string;
  tally_host: string;
  tally_port: number;
  tally_company_name: string;
  status: string;
  default_currency: string;
  last_sync_at: string | null;
};

export const erpService = {
  async testTallyConnection(host: string, port: number) {
    const { data } = await axios.post(
      `${ERP_BASE}/tally/test-connection`,
      { host, port },
      { headers: { "Content-Type": "application/json" } }
    );
    return data as {
      connected: boolean;
      companies?: string[];
      tally_version?: string;
      error?: string;
    };
  },

  async saveTallyConnection(payload: {
    connection_name: string;
    tally_host?: string;
    tally_port?: number;
    tally_company_name: string;
    default_currency?: string;
    fiscal_year_start?: string;
  }) {
    const { data } = await axios.post(`${ERP_BASE}/tally/connect`, payload, {
      headers: { ...headers(), "Content-Type": "application/json" },
    });
    return data as { id: number; status: string; companies?: string[]; tally_version?: string };
  },

  async getConnections() {
    const { data } = await axios.get(`${ERP_BASE}/connections`, { headers: headers() });
    return data as { connections: ErpConnectionRow[] };
  },

  async deleteConnection(id: number) {
    await axios.delete(`${ERP_BASE}/connections/${id}`, { headers: headers() });
  },

  async importFromTally(connectionId: number, periodFrom: string, periodTo: string, years?: number[]) {
    const { data } = await axios.post(
      `${ERP_BASE}/tally/import-tb`,
      { connection_id: connectionId, period_from: periodFrom, period_to: periodTo, years: years || [] },
      { headers: { ...headers(), "Content-Type": "application/json" } }
    );
    return data as {
      trial_balance_id: number;
      lines_count: number;
      auto_mapped: number;
      needs_ai_count: number;
      ai_mappings_created: number;
      sync_log_id: number;
      status: string;
    };
  },

  async importMultiYear(connectionId: number, companyName: string, years: number[]) {
    const { data } = await axios.post(
      `${ERP_BASE}/tally/import-multi-year`,
      { connection_id: connectionId, company_name: companyName, years },
      { headers: { ...headers(), "Content-Type": "application/json" } }
    );
    return data;
  },

  async quickImport(payload: {
    host: string;
    port: number;
    company_name: string;
    period_from: string;
    period_to: string;
    currency: string;
  }) {
    const { data } = await axios.post(`${ERP_BASE}/tally/quick-import`, payload, {
      headers: { ...headers(), "Content-Type": "application/json" },
    });
    return data as {
      trial_balance_id: number;
      lines_count: number;
      auto_mapped: number;
      needs_ai_count: number;
      ai_mappings_created: number;
      status: string;
    };
  },

  async getSyncLogs(limit = 50) {
    const { data } = await axios.get(`${ERP_BASE}/tally/sync-logs`, {
      headers: headers(),
      params: { limit },
    });
    return data as { logs: Record<string, unknown>[] };
  },
};
