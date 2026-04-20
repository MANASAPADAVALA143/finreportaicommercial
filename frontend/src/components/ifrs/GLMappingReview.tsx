import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import MappingStatusBadge from "./MappingStatusBadge";
import { IFRSMapping, IFRSLineItemMasterRow, ifrsService, HarnessSummary, HarnessTier } from "../../services/ifrs.service";
import { formatApiError } from "../../utils/apiError";

const STATEMENTS = [
  "financial_position",
  "profit_loss",
  "other_comprehensive_income",
  "cash_flows",
  "equity",
] as const;

/** Section labels must match `STATEMENT_STRUCTURE` in backend `statement_generator.py` / AI prompt. */
const SECTION_BY_STATEMENT: Record<string, string[]> = {
  financial_position: [
    "Non-current Assets",
    "Current Assets",
    "Equity",
    "Non-current Liabilities",
    "Current Liabilities",
  ],
  profit_loss: ["Revenue", "Cost of Sales", "Operating Expenses", "Finance Items", "Tax"],
  other_comprehensive_income: [
    "OCI — items that may be reclassified",
    "OCI — items that will not be reclassified",
  ],
  cash_flows: ["Operating Activities", "Investing Activities", "Financing Activities"],
  equity: ["Share Capital", "Reserves", "Retained Earnings"],
};

type Props = {
  trialBalanceId: number;
  mappings: IFRSMapping[];
  harness: HarnessSummary | null;
  onRefresh: () => Promise<void>;
};

function harnessBadge(tier: HarnessTier | undefined) {
  switch (tier) {
    case "blocked":
      return { label: "BLOCKED", className: "bg-rose-100 text-rose-800 ring-rose-200" };
    case "auto_confirmed":
      return { label: "PASSED", className: "bg-emerald-100 text-emerald-800 ring-emerald-200" };
    case "confirmed":
      return { label: "CONFIRMED", className: "bg-blue-100 text-blue-800 ring-blue-200" };
    case "auto_fixed":
      return { label: "AUTO-FIX", className: "bg-violet-100 text-violet-800 ring-violet-200" };
    default:
      return { label: "REVIEW", className: "bg-amber-100 text-amber-800 ring-amber-200" };
  }
}

function rowShellClass(tier: HarnessTier | undefined, selected: boolean): string {
  const base = selected ? "border-l-4 border-l-blue-500" : "";
  switch (tier) {
    case "blocked":
      return `border-rose-300 bg-rose-50 ${base}`;
    case "auto_confirmed":
      return `border-emerald-300 bg-emerald-50 ${base}`;
    case "confirmed":
      return `border-blue-200 bg-blue-50/60 ${base}`;
    case "auto_fixed":
      return `border-violet-300 bg-violet-50 ${base}`;
    default:
      return `border-amber-200 bg-amber-50/50 ${base}`;
  }
}

export default function GLMappingReview({ trialBalanceId, mappings, harness, onRefresh }: Props) {
  const [filter, setFilter] = useState<"all" | "needs_review" | "confirmed">("all");
  const [q, setQ] = useState("");
  const [selectedMappingId, setSelectedMappingId] = useState<number | null>(mappings[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const [showCritical, setShowCritical] = useState(false);
  const [validating, setValidating] = useState(false);

  const filtered = useMemo(() => {
    return mappings.filter((m) => {
      if (filter === "needs_review" && !(m.needs_review && !m.is_confirmed)) return false;
      if (filter === "confirmed" && !m.is_confirmed) return false;
      const s = q.trim().toLowerCase();
      if (!s) return true;
      return m.gl_code.toLowerCase().includes(s) || m.gl_description.toLowerCase().includes(s);
    });
  }, [mappings, filter, q]);

  const selected = filtered.find((m) => m.id === selectedMappingId) || filtered[0] || null;

  useEffect(() => {
    if (!filtered.length) {
      setSelectedMappingId(null);
      return;
    }
    const exists = filtered.some((m) => m.id === selectedMappingId);
    if (!exists) {
      setSelectedMappingId(filtered[0].id);
    }
  }, [filtered, selectedMappingId]);

  const counts = useMemo(() => {
    const confirmed = mappings.filter((m) => m.is_confirmed).length;
    const needsReview = mappings.filter((m) => m.needs_review && !m.is_confirmed).length;
    return { total: mappings.length, confirmed, needsReview };
  }, [mappings]);

  const criticalRows = useMemo(() => {
    return mappings.filter((m) =>
      (m.validator_issues || []).some((i) => i.severity === "critical")
    );
  }, [mappings]);

  const highConfidenceIds = useMemo(
    () => mappings.filter((m) => !m.is_confirmed && (m.ai_confidence_score || 0) >= 0.85).map((m) => m.id),
    [mappings]
  );

  const saveOne = async (m: IFRSMapping) => {
    try {
      await ifrsService.updateMapping(m.id, {
        ifrs_statement: m.ifrs_statement,
        ifrs_line_item: m.ifrs_line_item,
        ifrs_section: m.ifrs_section,
        is_confirmed: true,
      });
      toast.success("Mapping confirmed");
      await onRefresh();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Could not update mapping");
    }
  };

  const confirmAllHigh = async () => {
    if (!highConfidenceIds.length) {
      toast("No high confidence suggestions pending");
      return;
    }
    try {
      const res = await ifrsService.bulkConfirm(highConfidenceIds);
      toast.success(`Confirmed ${res.updated} mappings`);
      await onRefresh();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Bulk confirm failed");
    }
  };

  const h = harness;

  return (
    <div className="space-y-4">
      {h && (
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100/80 p-4 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900">🛡️ CFO AI Harness — Validation Results</h3>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <div>
              <p className="text-xs font-medium text-slate-500">Harness score</p>
              <p className="text-2xl font-bold text-slate-900">{h.harness_score}%</p>
            </div>
            <div className="h-10 flex-1 min-w-[120px] max-w-md rounded-full bg-slate-200">
              <div
                className={`h-10 rounded-full transition-all ${h.harness_score >= 85 ? "bg-emerald-500" : h.harness_score >= 60 ? "bg-amber-500" : "bg-rose-500"}`}
                style={{ width: `${Math.min(100, h.harness_score)}%` }}
              />
            </div>
          </div>
          <ul className="mt-3 grid gap-1 text-sm text-slate-700 sm:grid-cols-2">
            <li>✅ Auto-confirmed: <span className="font-semibold">{h.auto_confirmed}</span></li>
            <li>⚠️ Needs review: <span className="font-semibold">{h.needs_review}</span></li>
            <li>❌ Blocked: <span className="font-semibold text-rose-700">{h.blocked}</span></li>
            <li>🔧 Auto-fixed: <span className="font-semibold text-violet-700">{h.auto_fixed}</span></li>
          </ul>
          <p className={`mt-2 text-sm font-semibold ${h.ready_to_generate ? "text-emerald-700" : "text-amber-800"}`}>
            {h.ready_to_generate
              ? "Ready to generate statements"
              : h.blocked > 0
                ? `Resolve ${h.blocked} validator-blocked row(s) (critical/error), then re-run the validator.`
                : `Confirm mappings or re-run AI mapping until confidence is ≥70% on pending rows (${h.needs_review} in review).`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowCritical((s) => !s)}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              {showCritical ? "Hide" : "View"} critical issues ({criticalRows.length})
            </button>
            <button
              type="button"
              disabled={!trialBalanceId || validating}
              onClick={async () => {
                if (!trialBalanceId) return;
                setValidating(true);
                try {
                  await ifrsService.validateMappings(trialBalanceId);
                  toast.success("Validator re-run complete");
                  await onRefresh();
                } catch (e: unknown) {
                  toast.error(formatApiError(e) || "Validator failed");
                } finally {
                  setValidating(false);
                }
              }}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {validating ? "Running…" : "Run validator again"}
            </button>
          </div>
          {showCritical && criticalRows.length > 0 && (
            <ul className="mt-3 max-h-40 space-y-2 overflow-auto rounded-lg border border-rose-200 bg-rose-50/80 p-2 text-xs text-rose-950">
              {criticalRows.map((m) => (
                <li key={m.id}>
                  <span className="font-mono font-semibold">{m.gl_code}</span> — {m.gl_description}
                  {(m.validator_issues || [])
                    .filter((i) => i.severity === "critical")
                    .map((i) => (
                      <span key={i.rule_id} className="ml-1 text-rose-800">
                        ({i.rule_id})
                      </span>
                    ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-lg border bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-slate-700">
            {counts.confirmed} / {counts.total} confirmed | {counts.needsReview} need review
          </div>
          <button
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            onClick={confirmAllHigh}
          >
            Confirm All High Confidence (&gt;85%)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="rounded-xl border bg-white p-3 lg:col-span-2">
          <div className="mb-3 flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search GL code/description"
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <div className="mb-3 flex gap-2 text-xs">
            <button className={`rounded px-2 py-1 ${filter === "all" ? "bg-slate-900 text-white" : "bg-slate-100"}`} onClick={() => setFilter("all")}>All</button>
            <button className={`rounded px-2 py-1 ${filter === "needs_review" ? "bg-amber-600 text-white" : "bg-slate-100"}`} onClick={() => setFilter("needs_review")}>Needs Review</button>
            <button className={`rounded px-2 py-1 ${filter === "confirmed" ? "bg-emerald-600 text-white" : "bg-slate-100"}`} onClick={() => setFilter("confirmed")}>Confirmed</button>
          </div>
          <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
            {filtered.map((m) => {
              const tier = m.harness_tier as HarnessTier | undefined;
              const shell = rowShellClass(tier, selected?.id === m.id);
              const hb = harnessBadge(tier);
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedMappingId(m.id)}
                  className={`w-full rounded-lg border p-3 text-left ${shell}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{m.gl_code}</p>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${hb.className}`}>{hb.label}</span>
                      <MappingStatusBadge confidence={m.ai_confidence_score} source={m.mapping_source} is_confirmed={m.is_confirmed} />
                    </div>
                  </div>
                  <p className="truncate text-xs text-slate-600">{m.gl_description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 lg:col-span-3">
          {!selected ? (
            <p className="text-sm text-slate-500">Select a GL row to review mapping.</p>
          ) : (
            <Detail
              key={selected.id}
              trialBalanceId={trialBalanceId}
              value={selected}
              editing={editing}
              onEditing={setEditing}
              onSave={saveOne}
              onRefresh={onRefresh}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({
  value,
  editing,
  onEditing,
  onSave,
  onRefresh,
}: {
  trialBalanceId: number;
  value: IFRSMapping;
  editing: boolean;
  onEditing: (v: boolean) => void;
  onSave: (m: IFRSMapping) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [local, setLocal] = useState<IFRSMapping>(value);
  const [lineMaster, setLineMaster] = useState<IFRSLineItemMasterRow[]>([]);
  const pct = Math.round((local.ai_confidence_score || 0) * 100);

  useEffect(() => {
    let cancelled = false;
    ifrsService
      .getLineItemMaster()
      .then((r) => {
        if (!cancelled) setLineMaster(r.items || []);
      })
      .catch(() => {
        if (!cancelled) setLineMaster([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const lineOptions = useMemo(() => {
    return lineMaster.filter((r) => r.statement === local.ifrs_statement && r.section === local.ifrs_section);
  }, [lineMaster, local.ifrs_statement, local.ifrs_section]);

  const setStatement = (v: string) => {
    setLocal((s) => ({
      ...s,
      ifrs_statement: v as IFRSMapping["ifrs_statement"],
      ifrs_section: SECTION_BY_STATEMENT[v]?.[0] || "",
    }));
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-slate-500">GL Account</p>
        <p className="text-lg font-bold text-slate-900">{local.gl_code}</p>
        <p className="text-sm text-slate-600">{local.gl_description}</p>
        <p className="mt-1 text-xs text-slate-500">
          Amount:{" "}
          <span className="font-semibold text-slate-700">
            {(local.net_amount ?? 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </p>
      </div>

      <div className="rounded-lg border bg-slate-50 p-3">
        <p className="text-xs font-semibold text-slate-600">AI Suggestion</p>
        <div className="mt-2 grid grid-cols-1 gap-1 text-sm text-slate-700">
          <p>
            Statement: <span className="font-medium">{local.ifrs_statement}</span>
          </p>
          <p>
            Line Item: <span className="font-medium">{local.ifrs_line_item}</span>
          </p>
          <p>
            Section: <span className="font-medium">{local.ifrs_section}</span>
          </p>
        </div>
        {local.needs_review ? (
          <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
            Needs Review
          </span>
        ) : (
          <span className="mt-2 inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            High Confidence
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">IFRS Statement</span>
          <select disabled={!editing} value={local.ifrs_statement} onChange={(e) => setStatement(e.target.value)} className="w-full rounded-lg border px-3 py-2">
            {STATEMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Section</span>
          <select disabled={!editing} value={local.ifrs_section} onChange={(e) => setLocal((s) => ({ ...s, ifrs_section: e.target.value }))} className="w-full rounded-lg border px-3 py-2">
            {(SECTION_BY_STATEMENT[local.ifrs_statement] || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-slate-600">Line Item</span>
          {!editing ? (
            <p className="rounded-lg border bg-slate-50 px-3 py-2 text-sm text-slate-800">{local.ifrs_line_item}</p>
          ) : lineOptions.length > 0 ? (
            <select
              value={local.ifrs_line_item}
              onChange={(e) => setLocal((s) => ({ ...s, ifrs_line_item: e.target.value }))}
              className="w-full rounded-lg border px-3 py-2"
            >
              <option value="">Select line item…</option>
              {local.ifrs_line_item &&
                !lineOptions.some((o) => o.name === local.ifrs_line_item) && (
                  <option value={local.ifrs_line_item}>{local.ifrs_line_item} (current)</option>
                )}
              {lineOptions.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.name}
                  {o.is_calculated ? " (contra)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={local.ifrs_line_item}
              onChange={(e) => setLocal((s) => ({ ...s, ifrs_line_item: e.target.value }))}
              className="w-full rounded-lg border px-3 py-2"
              placeholder="Type line item (cash flow / equity / custom)"
            />
          )}
          {editing &&
            lineOptions.length === 0 &&
            local.ifrs_statement !== "cash_flows" &&
            local.ifrs_statement !== "equity" && (
            <p className="mt-1 text-xs text-amber-700">
              No master lines for this section — re-seed <code className="text-[11px]">ifrs_line_item_master</code> or check section label.
            </p>
          )}
        </label>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
          <span>AI Confidence</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-200">
          <div className={`h-2 rounded-full ${pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {local.ai_reasoning && (
        <details className="rounded-lg border bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">AI Reasoning</summary>
          <p className="mt-2 text-sm text-slate-600">{local.ai_reasoning}</p>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={async () => {
            await onSave(local);
            onEditing(false);
          }}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          title="Press Enter to confirm"
        >
          ✅ Confirm
        </button>
        <button onClick={() => onEditing(!editing)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
          ✏️ {editing ? "Cancel Edit" : "Edit"}
        </button>
        <button onClick={async () => onRefresh()} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300">
          Skip
        </button>
        <span className="text-xs text-slate-500">Hint: Press Enter to confirm, → for next</span>
      </div>
    </div>
  );
}

