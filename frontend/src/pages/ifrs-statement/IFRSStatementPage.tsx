import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import TrialBalanceUpload from "../../components/ifrs/TrialBalanceUpload";
import GLMappingReview from "../../components/ifrs/GLMappingReview";
import StatementViewer from "../../components/ifrs/StatementViewer";
import DisclosureNotesPage from "../../components/ifrs/DisclosureNotesPage";
import {
  GeneratedStatementPayload,
  ifrsService,
  IFRSMapping,
  HarnessSummary,
  IfrsModulePreview,
  BalanceCheck,
  CashFlowRecon,
  SoceCheck,
} from "../../services/ifrs.service";
import { formatApiError } from "../../utils/apiError";
import { validateFS, type FSValidationResult } from "../../services/fsValidation.service";
import { useSyncIfrsTenant } from "../../hooks/useSyncIfrsTenant";

const steps = ["Upload", "Map GL", "Review", "Generate", "Disclosures"] as const;

export default function IFRSStatementPage() {
  const tenantId = useSyncIfrsTenant();
  const [step, setStep] = useState<(typeof steps)[number]>("Upload");
  const [tbId, setTbId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>("uploaded");
  const [mappings, setMappings] = useState<IFRSMapping[]>([]);
  const [counts, setCounts] = useState({
    trial_balance_lines: 0,
    total_mappings: 0,
    confirmed: 0,
    needs_review: 0,
    ai_suggested_pending: 0,
  });
  const [harness, setHarness] = useState<HarnessSummary | null>(null);
  const [statements, setStatements] = useState<Record<string, GeneratedStatementPayload>>({});
  const [generating, setGenerating] = useState(false);
  const [boardWatermark, setBoardWatermark] = useState<"DRAFT" | "CONFIDENTIAL" | "FINAL">("DRAFT");
  const [boardGenerating, setBoardGenerating] = useState(false);
  const [boardPack, setBoardPack] = useState<{
    board_pack_id: number;
    view_url: string;
    download_url: string;
    pages: number;
    watermark: string;
  } | null>(null);
  const [fsValidation, setFsValidation] = useState<FSValidationResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [modulePreview, setModulePreview] = useState<IfrsModulePreview | null>(null);
  const [applyIfrs16, setApplyIfrs16] = useState(true);
  const [applyIfrs15, setApplyIfrs15] = useState(true);
  const [applyIfrs9, setApplyIfrs9] = useState(true);
  const [ifrsAdjBanner, setIfrsAdjBanner] = useState<string | null>(null);
  const [priorTbId, setPriorTbId] = useState<number | null>(null);
  const [balanceCheck, setBalanceCheck] = useState<BalanceCheck | null>(null);
  const [cashRecon, setCashRecon] = useState<CashFlowRecon | null>(null);
  const [soceCheck, setSoceCheck] = useState<SoceCheck | null>(null);
  /** Require an explicit harness payload with ready_to_generate true (null harness = not loaded / not ready). */
  const harnessAllowsGenerate = harness?.ready_to_generate === true;
  const canGenerateStatements =
    (status === "mapped" || status === "statements_generated") && harnessAllowsGenerate;
  const hasProfitLossStatement = Boolean(statements.profit_loss?.line_items?.length);

  const refreshMappings = async () => {
    if (!tbId) return;
    try {
      const data = await ifrsService.getMappings(tbId);
      setMappings(data.mappings || []);
      const c = data.counts;
      setCounts({
        trial_balance_lines: c?.trial_balance_lines ?? 0,
        total_mappings: c?.total_mappings ?? 0,
        confirmed: c?.confirmed ?? 0,
        needs_review: c?.needs_review ?? 0,
        ai_suggested_pending: c?.ai_suggested_pending ?? 0,
      });
      setHarness(data.harness ?? null);
      setStatus(data.trial_balance_status || status);
    } catch (e: unknown) {
      toast.error(formatApiError(e) || "Failed to fetch mappings");
    }
  };

  useEffect(() => {
    if (!tbId) return;
    void refreshMappings();
    const id = window.setInterval(() => void refreshMappings(), 4000);
    return () => window.clearInterval(id);
  }, [tbId]);

  useEffect(() => {
    if (!tbId) return;
    void ifrsService
      .getIfrsModulePreview(tbId)
      .then((p) => {
        setModulePreview(p);
        if (p.ifrs16.skip_recommended) setApplyIfrs16(false);
        if (p.ifrs15.skip_recommended) setApplyIfrs15(false);
        if (p.ifrs9.skip_recommended) setApplyIfrs9(false);
        if (p.already_injected_count > 0) {
          setIfrsAdjBanner("Statements include IFRS 16/15/9 module adjustments");
        }
      })
      .catch(() => setModulePreview(null));
  }, [tbId]);

  const refreshStatements = async () => {
    if (!tbId) return;
    try {
      const data = await ifrsService.getStatements(tbId);
      setStatements(data.statements || {});
      if (data.balance_check) setBalanceCheck(data.balance_check);
      if (data.cash_flow_reconciliation) setCashRecon(data.cash_flow_reconciliation);
      if (data.soce_check) setSoceCheck(data.soce_check);
      if (data.prior_trial_balance_id) setPriorTbId(data.prior_trial_balance_id);
    } catch (e: unknown) {
      toast.error(formatApiError(e) || "Failed to load statements");
    }
  };

  const currentIndex = useMemo(() => steps.indexOf(step), [step]);

  useEffect(() => {
    if (step !== "Disclosures" || !tbId) return;
    void refreshStatements();
  }, [step, tbId]);

  useEffect(() => {
    if (step !== "Generate" || !tbId) return;
    void refreshStatements();
  }, [step, tbId]);

  useEffect(() => {
    if (!Object.keys(statements).length) return;
    const now = new Date();
    const periodStart = `${now.getFullYear()}-01-01`;
    const periodEnd = now.toISOString().slice(0, 10);
    void validateFS(periodStart, periodEnd)
      .then(setFsValidation)
      .catch(() => setFsValidation(null));
  }, [statements]);

  const handleExportExcel = async () => {
    if (!tbId) {
      toast.error("Generate statements before exporting");
      return;
    }
    setExporting(true);
    try {
      await ifrsService.downloadExport(tbId, "excel");
      toast.success("Excel exported");
    } catch (e: unknown) {
      toast.error(formatApiError(e) || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const runGenerate = async () => {
    if (!tbId) return;
    setGenerating(true);
    try {
      const result = await ifrsService.generateStatements(tbId, {
        apply_ifrs16: applyIfrs16,
        apply_ifrs15: applyIfrs15,
        apply_ifrs9: applyIfrs9,
        prior_trial_balance_id: priorTbId,
      });
      if (result.balance_check) setBalanceCheck(result.balance_check);
      if (result.cash_flow_reconciliation) setCashRecon(result.cash_flow_reconciliation);
      if (result.soce_check) setSoceCheck(result.soce_check);
      const adj = result.ifrs_module_adjustments;
      if (adj?.applied_count) {
        toast.success(adj.message);
        setIfrsAdjBanner("Statements include IFRS 16/15/9 module adjustments");
      } else {
        toast.success("IFRS statements generated");
        setIfrsAdjBanner(null);
      }
      await refreshStatements();
      try {
        const p = await ifrsService.getIfrsModulePreview(tbId);
        setModulePreview(p);
      } catch {
        /* preview refresh is optional */
      }
      setStep("Generate");
    } catch (e: unknown) {
      toast.error(formatApiError(e) || "Statement generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const moduleToggles = (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">IFRS module adjustments</p>
      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input type="checkbox" className="mt-0.5" checked={applyIfrs16} onChange={(e) => setApplyIfrs16(e.target.checked)} />
        <span>
          Apply IFRS 16 lease adjustments ({modulePreview?.ifrs16.count ?? 0} leases found)
          {modulePreview?.ifrs16.skip_reason && (
            <span className="block text-xs text-amber-800">{modulePreview.ifrs16.skip_reason} — deselect if already in TB</span>
          )}
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input type="checkbox" className="mt-0.5" checked={applyIfrs15} onChange={(e) => setApplyIfrs15(e.target.checked)} />
        <span>
          Apply IFRS 15 revenue adjustments ({modulePreview?.ifrs15.count ?? 0} contracts found)
          {modulePreview?.ifrs15.skip_reason && (
            <span className="block text-xs text-amber-800">{modulePreview.ifrs15.skip_reason} — deselect if already in TB</span>
          )}
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input type="checkbox" className="mt-0.5" checked={applyIfrs9} onChange={(e) => setApplyIfrs9(e.target.checked)} />
        <span>
          Apply IFRS 9 ECL adjustments ({modulePreview?.ifrs9.count ?? 0} portfolios found)
          {modulePreview?.ifrs9.skip_reason && (
            <span className="block text-xs text-amber-800">{modulePreview.ifrs9.skip_reason} — deselect if already in TB</span>
          )}
        </span>
      </label>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 p-6 relative">
      {fsValidation && step === "Generate" && (
        <div className="fixed top-4 right-4 z-40 flex flex-col gap-2 max-w-xs">
          {fsValidation.checks.map((c) => (
            <div
              key={c.check}
              className={`rounded-lg border px-4 py-3 text-xs shadow-lg ${
                c.passed
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : "bg-red-50 border-red-200 text-red-900"
              }`}
            >
              <p className="font-semibold">{c.passed ? "✓" : "⚠"} {c.message}</p>
            </div>
          ))}
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            disabled={exporting}
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export to Excel"}
          </button>
        </div>
      )}
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">IFRS Statement — Week 3</h1>
            <p className="text-sm text-slate-600">Statements + disclosure notes + compliance checks</p>
            <p className="text-xs text-slate-500">Tenant: <span className="font-mono">{tenantId}</span></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/ifrs/agentic"
              className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white ring-1 ring-violet-500 hover:bg-violet-500"
            >
              AI IFRS Generator <span className="opacity-90 text-[10px] font-bold">AGENTIC</span>
            </Link>
            <Link to="/dashboard" className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200">
              Back to Dashboard
            </Link>
          </div>
        </div>

        <div className="mb-6 rounded-xl border bg-white p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {steps.map((s, i) => (
              <button
                key={s}
                onClick={() => setStep(s)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  i <= currentIndex ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {i + 1}. {s}
              </button>
            ))}
          </div>
        </div>

        {step === "Upload" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-4">
              <p className="text-sm text-slate-700">
                <strong>First time?</strong> Optionally{" "}
                <Link
                  to="/ifrs-statement/onboarding"
                  className="font-semibold text-blue-700 hover:text-blue-900 underline"
                >
                  set up a company mapping template
                </Link>{" "}
                so GL codes auto-map from your saved Chart of Accounts. You can still upload a trial balance
                without onboarding — company name is captured on upload below.
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-sm font-semibold text-slate-800">How do you want to provide the trial balance?</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <span className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900 ring-1 ring-blue-200">
                  Upload file (below)
                </span>
                <span className="rounded-lg bg-violet-50 px-3 py-2 text-sm font-medium text-violet-900 ring-1 ring-violet-200">
                  Use sample data (server upload)
                </span>
                <Link
                  to="/erp/tally"
                  className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-slate-200 hover:bg-slate-100"
                >
                  Import from Tally
                </Link>
              </div>
            </div>
            <TrialBalanceUpload
              onUploaded={(id) => {
                setTbId(id);
                setStep("Map GL");
              }}
            />
            {tbId && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4">
                <p className="text-sm font-semibold text-amber-950">Upload prior period TB (for Cash Flow + SOCE)</p>
                <p className="mt-1 text-xs text-amber-900">
                  Optional. Same GL codes as the current TB. If skipped, Cash Flow notes that opening balances are unavailable
                  and SOCE shows “Opening as per prior TB — not uploaded”.
                </p>
                {priorTbId ? (
                  <p className="mt-2 text-sm text-emerald-800">Prior period TB linked: #{priorTbId}</p>
                ) : (
                  <div className="mt-3">
                    <TrialBalanceUpload
                      linkAsPriorFor={tbId}
                      title="Prior period trial balance"
                      onUploaded={(id) => {
                        setPriorTbId(id);
                        toast.success(`Prior period TB #${id} linked`);
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === "Map GL" && (
          <div className="space-y-4 rounded-xl border bg-white p-5">
            <p className="text-sm text-slate-600">Trial Balance ID: {tbId ?? "-"}</p>
            {counts.trial_balance_lines > 0 && (
              <p className="text-sm text-slate-600">
                Trial balance lines loaded: <span className="font-semibold text-slate-800">{counts.trial_balance_lines}</span>
              </p>
            )}
            <p className="text-sm">
              Mapping status: <span className="font-semibold">{status}</span>
            </p>
            <div className="rounded-lg border border-blue-100 bg-blue-50/80 p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-800">Where are the GL rows?</p>
              <p className="mt-1">
                The editable mapping grid is on the <strong>Review</strong> step (next). This step only starts or re-runs AI mapping.
                After upload, mapping runs in the background — open <strong>Review</strong> and wait until counts update from 0.
              </p>
              {status === "mapping_in_progress" && (
                <p className="mt-2 text-slate-600">
                  <strong>mapping_in_progress:</strong> the server is still assigning IFRS lines (or clearing old rows between batches). Refresh appears automatically every few seconds once you open Review.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={!tbId}
                onClick={async () => {
                  if (!tbId) return;
                  try {
                    await ifrsService.mapWithAI(tbId);
                    toast.success("AI mapping job started");
                    setStatus("mapping_in_progress");
                    setStep("Review");
                  } catch (e: unknown) {
                    toast.error(formatApiError(e) || "AI mapping failed");
                  }
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Run / Re-run AI Mapping
              </button>
              <button onClick={() => setStep("Review")} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                Go to Review
              </button>
            </div>
          </div>
        )}

        {step === "Review" && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-white p-4 space-y-3">
              {moduleToggles}
              <button
                disabled={!tbId || !canGenerateStatements || generating}
                onClick={() => void runGenerate()}
                className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
                title={
                  !harnessAllowsGenerate
                    ? "CFO AI Harness: resolve blocked mappings first"
                    : canGenerateStatements
                      ? "Generate IFRS statements"
                      : "Complete GL mapping first"
                }
              >
                {generating ? "Generating 4 IFRS statements..." : "🏛️ Generate IFRS Statements"}
              </button>
            </div>
            <GLMappingReview trialBalanceId={tbId || 0} mappings={mappings} harness={harness} onRefresh={refreshMappings} />
          </div>
        )}

        {step === "Generate" && (
          <div className="space-y-4">
            {ifrsAdjBanner && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
                {ifrsAdjBanner}
              </div>
            )}
            {balanceCheck && (
              <div
                className={`rounded-lg border px-4 py-3 text-sm font-semibold ${
                  balanceCheck.balanced
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-red-200 bg-red-50 text-red-900"
                }`}
              >
                {balanceCheck.balanced
                  ? `✅ IAS 1 Compliant — Assets = Liabilities + Equity (AED ${balanceCheck.difference.toLocaleString(undefined, { minimumFractionDigits: 2 })} difference)`
                  : `❌ Out of balance — Difference: AED ${balanceCheck.difference.toLocaleString(undefined, { minimumFractionDigits: 2 })} — Review GL mapping${
                      balanceCheck.gap_section ? ` (${balanceCheck.gap_section})` : ""
                    }`}
              </div>
            )}
            {cashRecon && (
              <div
                className={`rounded-lg border px-4 py-3 text-sm ${
                  cashRecon.ties ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950"
                }`}
              >
                {cashRecon.ties
                  ? `Closing cash AED ${cashRecon.closing_cash.toLocaleString(undefined, { minimumFractionDigits: 2 })} ties to Balance Sheet cash AED ${cashRecon.balance_sheet_cash.toLocaleString(undefined, { minimumFractionDigits: 2 })} ✅`
                  : `Closing cash AED ${cashRecon.closing_cash.toLocaleString(undefined, { minimumFractionDigits: 2 })} — Balance Sheet shows AED ${cashRecon.balance_sheet_cash.toLocaleString(undefined, { minimumFractionDigits: 2 })} — Difference AED ${cashRecon.difference.toLocaleString(undefined, { minimumFractionDigits: 2 })} ⚠️`}
                {cashRecon.note && <p className="mt-1 text-xs font-normal">{cashRecon.note}</p>}
              </div>
            )}
            {soceCheck?.opening_note && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
                SOCE: {soceCheck.opening_note}
              </div>
            )}
            <div className="rounded-lg border bg-white p-4 space-y-3">
              {moduleToggles}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  disabled={!tbId || generating}
                  onClick={() => void runGenerate()}
                  className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
                >
                  {generating ? "Generating 4 IFRS statements..." : "🏛️ Generate IFRS Statements"}
                </button>
                <button
                  onClick={() => void refreshStatements()}
                  className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Refresh Statements
                </button>
                <button
                  type="button"
                  disabled={!tbId || !Object.keys(statements).length}
                  onClick={() => setStep("Disclosures")}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Next: Disclosures
                </button>
              </div>
            </div>
            <StatementViewer statements={statements} tbId={tbId ?? undefined} />

            {hasProfitLossStatement && (
              <div className="mt-6 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50/50 p-6 shadow-sm">
                {!boardPack ? (
                  <>
                    <h3 className="text-lg font-bold text-slate-900">📊 Board Pack Ready to Generate</h3>
                    <p className="mt-1 text-sm text-slate-600">Includes:</p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
                      <li>✅ Executive Summary (AI commentary)</li>
                      <li>✅ P&L Statement</li>
                      <li>✅ Balance Sheet</li>
                      <li>✅ Variance Analysis</li>
                      <li>✅ Risk Dashboard</li>
                      <li>✅ Strategic Recommendations</li>
                    </ul>
                    <p className="mt-4 text-sm font-semibold text-slate-800">Watermark:</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["DRAFT", "CONFIDENTIAL", "FINAL"] as const).map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => setBoardWatermark(w)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                            boardWatermark === w
                              ? "bg-blue-600 text-white ring-blue-600"
                              : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={!tbId || boardGenerating}
                      onClick={async () => {
                        if (!tbId) return;
                        setBoardGenerating(true);
                        try {
                          const res = await ifrsService.generateBoardPack(tbId, boardWatermark);
                          setBoardPack({
                            board_pack_id: res.board_pack_id,
                            view_url: res.view_url,
                            download_url: res.download_url,
                            pages: res.pages,
                            watermark: boardWatermark,
                          });
                          toast.success("Board pack PDF generated");
                        } catch (e: unknown) {
                          toast.error(formatApiError(e) || "Board pack generation failed");
                        } finally {
                          setBoardGenerating(false);
                        }
                      }}
                      className="mt-5 w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 sm:w-auto"
                    >
                      {boardGenerating ? "Generating…" : "📄 Generate Board Pack PDF"}
                    </button>
                    <p className="mt-3 text-xs text-slate-500">Generation takes ~15 seconds</p>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg font-bold text-emerald-900">
                      ✅ Board Pack Generated — {boardPack.pages} pages
                    </h3>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const token = boardPack.view_url.split("/view/")[1];
                          if (token) ifrsService.downloadBoardPack(token);
                        }}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                      >
                        ⬇ Download PDF
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const token = boardPack.view_url.split("/view/")[1];
                          if (!token) return;
                          const url = ifrsService.getBoardPackUrl(token);
                          try {
                            await navigator.clipboard.writeText(url);
                            toast.success("Shareable link copied");
                          } catch {
                            toast.error("Could not copy link");
                          }
                        }}
                        className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200"
                      >
                        🔗 Copy Shareable Link
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const token = boardPack.view_url.split("/view/")[1];
                          if (token) window.open(ifrsService.getBoardPackUrl(token), "_blank", "noopener,noreferrer");
                        }}
                        className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200"
                      >
                        👁 Preview in Browser
                      </button>
                    </div>
                    <p className="mt-4 text-xs font-medium text-slate-600">Share link (no login needed):</p>
                    <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <code className="block max-w-full flex-1 overflow-x-auto rounded bg-slate-900/90 px-3 py-2 text-xs text-slate-100">
                        {(() => {
                          const token = boardPack.view_url.split("/view/")[1];
                          return token ? ifrsService.getBoardPackUrl(token) : "";
                        })()}
                      </code>
                      <button
                        type="button"
                        onClick={async () => {
                          const token = boardPack.view_url.split("/view/")[1];
                          if (!token) return;
                          try {
                            await navigator.clipboard.writeText(ifrsService.getBoardPackUrl(token));
                            toast.success("Copied");
                          } catch {
                            toast.error("Copy failed");
                          }
                        }}
                        className="rounded-lg bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-800"
                      >
                        📋 Copy
                      </button>
                    </div>
                    {boardPack.watermark !== "FINAL" && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await ifrsService.finalizeBoardPack(boardPack.board_pack_id);
                            setBoardPack((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    view_url: res.public_url,
                                    download_url: res.download_url,
                                    pages: res.pages,
                                    watermark: res.watermark,
                                  }
                                : null
                            );
                            toast.success("Marked as final — DRAFT watermark removed");
                          } catch (e: unknown) {
                            toast.error(formatApiError(e) || "Finalize failed");
                          }
                        }}
                        className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                      >
                        ✅ Mark as Final
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {step === "Disclosures" && tbId && (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-100 bg-amber-50/80 p-3 text-sm text-amber-950">
              Generate notes after statements exist. First run can take 1–2 minutes (multiple LLM calls).
            </div>
            <DisclosureNotesPage trialBalanceId={tbId} />
          </div>
        )}
      </div>
    </div>
  );
}

