import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ifrsService } from "../../services/ifrs.service";
import CompliancePanel, { ComplianceRow, ComplianceSummary } from "./CompliancePanel";

type NoteRow = {
  id: number;
  note_number: number;
  note_code: string;
  note_title: string;
  title?: string;
  status: string;
  word_count: number;
  content?: string;
};

function statusLabel(status: string): { icon: string; text: string } {
  switch (status) {
    case "complete":
      return { icon: "✅", text: "Complete" };
    case "user_editing":
      return { icon: "⚠️", text: "Editing" };
    case "ai_generating":
      return { icon: "🔄", text: "Generating" };
    case "ai_draft":
      return { icon: "📝", text: "AI draft" };
    default:
      return { icon: "⬜", text: "Not started" };
  }
}

type Props = {
  trialBalanceId: number;
};

export default function DisclosureNotesPage({ trialBalanceId }: Props) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenId, setRegenId] = useState<number | null>(null);
  const [showCompliance, setShowCompliance] = useState(false);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [checks, setChecks] = useState<ComplianceRow[]>([]);
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const lastLoadedDraft = useRef("");

  const loadNotes = useCallback(async () => {
    setLoadingList(true);
    try {
      const data = await ifrsService.getNotes(trialBalanceId);
      const list = (data.notes || []) as NoteRow[];
      setNotes(list);
      setSelectedId((prev) => {
        if (list.length === 0) return null;
        if (prev != null && list.some((n) => n.id === prev)) return prev;
        return list[0].id;
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err?.response?.data?.detail || "Failed to load notes");
    } finally {
      setLoadingList(false);
    }
  }, [trialBalanceId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const selected = notes.find((n) => n.id === selectedId);

  useEffect(() => {
    if (!selectedId) {
      setDraft("");
      lastLoadedDraft.current = "";
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await ifrsService.getNote(selectedId);
        const n = data.note as {
          user_edited_content?: string;
          ai_generated_content?: string;
        };
        const text = n.user_edited_content || n.ai_generated_content || "";
        if (!cancelled) {
          setDraft(text);
          lastLoadedDraft.current = text;
        }
      } catch {
        if (!cancelled) {
          setDraft("");
          lastLoadedDraft.current = "";
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const completeCount = notes.filter((n) => n.status === "complete").length;

  const persistDraft = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await ifrsService.updateNote(selectedId, draft);
      lastLoadedDraft.current = draft;
      toast.success("Saved");
      await loadNotes();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const runCompliance = async () => {
    setComplianceLoading(true);
    try {
      const data = await ifrsService.runComplianceCheck(trialBalanceId);
      setChecks((data.checks || []) as ComplianceRow[]);
      setSummary((data.summary || null) as ComplianceSummary | null);
      setShowCompliance(true);
      toast.success("Compliance check complete");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err?.response?.data?.detail || "Compliance check failed");
    } finally {
      setComplianceLoading(false);
    }
  };

  const loadComplianceOnly = async () => {
    try {
      const data = await ifrsService.getComplianceResults(trialBalanceId);
      setChecks((data.checks || []) as ComplianceRow[]);
      setSummary((data.summary || null) as ComplianceSummary | null);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-10">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Notes</h3>
          <span className="text-xs text-slate-500">
            {completeCount} / {notes.length || 10} complete
          </span>
        </div>
        <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-blue-600 transition-all"
            style={{ width: `${notes.length ? (completeCount / notes.length) * 100 : 0}%` }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={generating}
            onClick={async () => {
              setGenerating(true);
              try {
                await ifrsService.generateNotes(trialBalanceId);
                toast.success("Notes generated");
                await loadNotes();
              } catch (e: unknown) {
                const err = e as { response?: { data?: { detail?: string } } };
                toast.error(err?.response?.data?.detail || "Generation failed (check API keys / wait for LLM)");
              } finally {
                setGenerating(false);
              }
            }}
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? "Generating (may take 1–2 min)…" : "Generate all notes"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCompliance((v) => {
                const next = !v;
                if (next) void loadComplianceOnly();
                return next;
              });
            }}
            className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-200"
          >
            {showCompliance ? "Hide compliance" : "View compliance"}
          </button>
        </div>
        <ul className="mt-4 max-h-[480px] space-y-1 overflow-y-auto text-sm">
          {loadingList && <li className="text-slate-500">Loading…</li>}
          {!loadingList &&
            notes.map((n) => {
              const st = statusLabel(n.status);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(n.id)}
                    className={`flex w-full flex-col rounded-lg border px-2 py-2 text-left ${
                      selectedId === n.id ? "border-blue-500 bg-blue-50" : "border-transparent hover:bg-slate-50"
                    }`}
                  >
                    <span className="font-semibold text-slate-900">
                      {st.icon} {n.note_code} — {n.note_title}
                    </span>
                    <span className="text-xs text-slate-500">{st.text}</span>
                  </button>
                </li>
              );
            })}
          {!loadingList && notes.length === 0 && (
            <li className="text-slate-500">No notes yet. Run Generate all notes.</li>
          )}
        </ul>
      </div>

      <div className="space-y-4 lg:col-span-7">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {selected ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {selected.note_code} — {selected.note_title}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {statusLabel(selected.status).text} · {draft.split(/\s+/).filter(Boolean).length} words
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      await persistDraft();
                    }}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Mark complete
                  </button>
                  <button
                    type="button"
                    disabled={regenId === selected.id}
                    onClick={async () => {
                      setRegenId(selected.id);
                      try {
                        const data = await ifrsService.regenerateNote(selected.id);
                        const n = data.note as { user_edited_content?: string; ai_generated_content?: string };
                        setDraft(n.user_edited_content || n.ai_generated_content || "");
                        toast.success("Regenerated");
                        await loadNotes();
                      } catch (e: unknown) {
                        const err = e as { response?: { data?: { detail?: string } } };
                        toast.error(err?.response?.data?.detail || "Regenerate failed");
                      } finally {
                        setRegenId(null);
                      }
                    }}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-50"
                  >
                    {regenId === selected.id ? "Regenerating…" : "Regenerate"}
                  </button>
                </div>
              </div>
              <textarea
                className="min-h-[320px] w-full rounded-lg border border-slate-200 p-3 font-mono text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (selectedId && draft !== lastLoadedDraft.current) void persistDraft();
                }}
              />
              <p className="mt-2 text-xs text-slate-500">Auto-saves on blur if you changed the text.</p>
            </>
          ) : (
            <p className="text-sm text-slate-500">Select a note or generate notes first.</p>
          )}
        </div>

        {showCompliance && (
          <CompliancePanel checks={checks} summary={summary} loading={complianceLoading} onRunCheck={() => void runCompliance()} />
        )}
      </div>
    </div>
  );
}
