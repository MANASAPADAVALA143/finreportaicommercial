import { Fragment, useMemo, useState } from "react";
import { GeneratedStatementPayload, StatementLineItem } from "../../services/ifrs.service";

type Props = {
  statements: Record<string, GeneratedStatementPayload>;
};

const TABS: { key: string; label: string }[] = [
  { key: "financial_position", label: "Statement of Financial Position" },
  { key: "profit_loss", label: "Profit & Loss" },
  { key: "other_comprehensive_income", label: "Other Comprehensive Income" },
  { key: "cash_flows", label: "Cash Flows" },
  { key: "equity", label: "Statement of Changes in Equity" },
];

function money(v: number): string {
  if (v < 0) {
    return `(${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
  }
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function StatementViewer({ statements }: Props) {
  const available = TABS.filter((t) => statements[t.key]);
  const [active, setActive] = useState<string>(available[0]?.key || "financial_position");

  const current = statements[active];

  const grouped = useMemo(() => {
    if (!current?.line_items) return [];
    const sections: Record<string, StatementLineItem[]> = {};
    for (const li of current.line_items) {
      if (!sections[li.ifrs_section]) sections[li.ifrs_section] = [];
      sections[li.ifrs_section].push(li);
    }
    return Object.entries(sections);
  }, [current]);

  if (!current) {
    return <p className="rounded-lg border bg-white p-4 text-sm text-slate-500">No statements generated yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {available.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              active === tab.key ? "bg-blue-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 border-b pb-3">
          <h2 className="text-lg font-bold uppercase tracking-wide text-slate-900">{TABS.find((t) => t.key === active)?.label}</h2>
          <p className="text-xs text-slate-500">
            As at {current.period_end || "-"} | {current.currency}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <tbody>
              {grouped.map(([section, lines]) => (
                <Fragment key={section}>
                  <tr key={`${section}-header`} className="bg-slate-100">
                    <td className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700" colSpan={2}>
                      {section}
                    </td>
                  </tr>
                  {lines
                    .sort((a, b) => a.display_order - b.display_order)
                    .map((line) => (
                      <tr key={line.id} className={line.is_total ? "border-y-2 border-slate-900" : line.is_subtotal ? "border-t border-slate-500" : "border-t"}>
                        <td
                          className={`px-3 py-2 text-slate-800 ${
                            line.is_total || line.is_subtotal ? "font-bold" : "font-normal"
                          }`}
                          style={{ paddingLeft: `${12 + line.indent_level * 16}px` }}
                        >
                          {line.ifrs_line_item}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono ${line.is_total || line.is_subtotal ? "font-bold text-slate-900" : "text-slate-700"}`}>
                          {money(Number(line.amount || 0))}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
