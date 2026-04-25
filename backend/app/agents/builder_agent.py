"""BUILDER — wraps Week 2 `generate_all_statements` (current + optional prior-year TB for comparatives)."""
from __future__ import annotations

from app.agents.base_agent import AgentContext, BaseAgent
from app.services.mapping_validator import assert_ready_for_statement_generation
from app.services.statement_generator import generate_all_statements


class BuilderAgent(BaseAgent):
    agent_id = "BUILDER"

    def run(self) -> None:
        self.ctx.emit(self.agent_id, "Generating four IFRS statements (Week 2 engine) — current year.")
        result = generate_all_statements(self.ctx.trial_balance_id, self.ctx.db)
        self.ctx.shared["builder_result"] = result

        prior_id = self.ctx.shared.get("prior_trial_balance_id")
        if prior_id and int(prior_id) != int(self.ctx.trial_balance_id):
            try:
                assert_ready_for_statement_generation(int(prior_id), self.ctx.db)
                self.ctx.emit(self.agent_id, f"Generating prior-year statements for TB #{prior_id} (IAS 1 comparative).")
                generate_all_statements(int(prior_id), self.ctx.db)
            except Exception as e:
                self.ctx.emit(
                    self.agent_id,
                    f"Prior-year TB #{prior_id} not built ({e!s}); comparatives will use vault snapshot or manual totals only.",
                )

        self.ctx.emit(self.agent_id, "Statements materialised in database.")
