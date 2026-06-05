import { getCompanyConfig } from './companyService';

export type AgentAutonomyConfig = {
  high_value_threshold_inr: number;
  auto_approve_min_confidence: number;
  auto_approve_max_risk_score: number;
  require_human_new_vendor: boolean;
  require_human_critical_risk: boolean;
  require_human_duplicate: boolean;
  sla_hours_before_escalation: number;
};

const DEFAULTS: AgentAutonomyConfig = {
  high_value_threshold_inr: 500000,
  auto_approve_min_confidence: 90,
  auto_approve_max_risk_score: 30,
  require_human_new_vendor: true,
  require_human_critical_risk: true,
  require_human_duplicate: true,
  sla_hours_before_escalation: 4,
};

function coerceAgentConfig(raw: unknown): AgentAutonomyConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const o = raw as Record<string, unknown>;
  return {
    high_value_threshold_inr: Number(o.high_value_threshold_inr ?? DEFAULTS.high_value_threshold_inr),
    auto_approve_min_confidence: Number(o.auto_approve_min_confidence ?? DEFAULTS.auto_approve_min_confidence),
    auto_approve_max_risk_score: Number(o.auto_approve_max_risk_score ?? DEFAULTS.auto_approve_max_risk_score),
    require_human_new_vendor: Boolean(o.require_human_new_vendor ?? DEFAULTS.require_human_new_vendor),
    require_human_critical_risk: Boolean(o.require_human_critical_risk ?? DEFAULTS.require_human_critical_risk),
    require_human_duplicate: Boolean(o.require_human_duplicate ?? DEFAULTS.require_human_duplicate),
    sla_hours_before_escalation: Number(o.sla_hours_before_escalation ?? DEFAULTS.sla_hours_before_escalation),
  };
}

/** Per-tenant agent thresholds from `company_config.agent_config` (JSON). */
export async function getAgentAutonomyConfig(): Promise<AgentAutonomyConfig> {
  const row = await getCompanyConfig();
  return coerceAgentConfig(row?.agent_config);
}

