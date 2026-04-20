import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import TrialBalanceUpload from "../../components/ifrs/TrialBalanceUpload";
import GLMappingReview from "../../components/ifrs/GLMappingReview";
import StatementViewer from "../../components/ifrs/StatementViewer";
import DisclosureNotesPage from "../../components/ifrs/DisclosureNotesPage";
import { GeneratedStatementPayload, ifrsService, IFRSMapping, HarnessSummary } from "../../services/ifrs.service";
import { formatApiError } from "../../utils/apiError";

const steps = ["Upload", "Map GL", "Review", "Generate", "Disclosures"] as const;

export default function IFRSStatementPage() {
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

  const refreshStatements = async () => {
    if (!tbId) return;
    try {
      const data = await ifrsService.getStatements(tbId);
      setStatements(data.statements || {});
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">IFRS Statement — Week 3</h1>
            <p className="text-sm text-slate-600">Statements + disclosure notes + compliance checks</p>
          </div>
          <Link to="/dashboard" className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200">
            Back to Dashboard
          </Link>
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
            <div className="rounded-xl border bg-white p-4">
              <p className="text-sm font-semibold text-slate-800">How do you want to provide the trial balance?</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <span className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900 ring-1 ring-blue-200">
                  Upload file (below)
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
            <div className="rounded-lg border bg-white p-4">
              <button
                disabled={!tbId || !canGenerateStatements || generating}
                onClick={async () => {
                  if (!tbId) return;
                  setGenerating(true);
                  try {
                    await ifrsService.generateStatements(tbId);
                    toast.success("IFRS statements generated");
                    await refreshStatements();
                    setStep("Generate");
                  } catch (e: unknown) {
                    toast.error(formatApiError(e) || "Statement generation failed");
                  } finally {
                    setGenerating(false);
                  }
                }}
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
            <div className="rounded-lg border bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  disabled={!tbId || generating}
                  onClick={async () => {
                    if (!tbId) return;
                    setGenerating(true);
                    try {
                      await ifrsService.generateStatements(tbId);
                      toast.success("IFRS statements generated");
                      await refreshStatements();
                    } catch (e: unknown) {
                      toast.error(formatApiError(e) || "Statement generation failed");
                    } finally {
                      setGenerating(false);
                    }
                  }}
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
            <StatementViewer statements={statements} />

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

