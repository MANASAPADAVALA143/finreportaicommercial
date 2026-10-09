import type { DashboardCtx } from '../types';
import { ActivityPanel, ConsistencyPanel, ExceptionsPanel, InsightsPanel, PipelinePanel } from '../panels';
import {
  AgingPanel,
  CashFlowPanel,
  GlSpendPanel,
  IfrsPanel,
  MonthlyAmountsPanel,
  StatusDistributionPanel,
  TopVendorsPanel,
  VendorTrendPanel,
} from '../widgets';

export function OverviewTab({ ctx }: { ctx: DashboardCtx }) {
  return (
    <div className="space-y-4">
      <PipelinePanel ctx={ctx} invoices={ctx.period} />

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ExceptionsPanel ctx={ctx} />
        <ActivityPanel ctx={ctx} />
        <StatusDistributionPanel ctx={ctx} invoices={ctx.period} className="lg:col-span-2 xl:col-span-1" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <MonthlyAmountsPanel ctx={ctx} className="xl:col-span-2" />
        <CashFlowPanel ctx={ctx} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <AgingPanel ctx={ctx} />
        <IfrsPanel ctx={ctx} limit={4} />
        <TopVendorsPanel
          ctx={ctx}
          className="lg:col-span-2 xl:col-span-1"
          onSelect={() => ctx.goTab('vendors')}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <VendorTrendPanel ctx={ctx} className="xl:col-span-2" />
        <GlSpendPanel ctx={ctx} />
      </div>

      <InsightsPanel ctx={ctx} />
      <ConsistencyPanel ctx={ctx} />
    </div>
  );
}
