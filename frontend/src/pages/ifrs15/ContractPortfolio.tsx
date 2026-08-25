import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Calculator, ChevronDown, ChevronUp, FileUp, Plus, RefreshCw } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import {
  calculateRecognition,
  extractIFRS15Contract,
  fetchIFRS15Contracts,
  fetchIFRS15PortfolioSummary,
  postRecognitionJE,
  saveIFRS15Contract,
  type ClauseScan,
  type ExtractionValidation,
  type IFRS15Contract,
} from '../../services/ifrs15.service';

function fmt(n: number) { return `AED ${(n ?? 0).toLocaleString('en-AE', { maximumFractionDigits: 0 })}`; }

function riskColor(risk?: string) {
  const r = (risk ?? '').toUpperCase();
  if (r === 'HIGH') return 'text-red-400';
  if (r === 'MEDIUM') return 'text-amber-400';
  if (r === 'LOW') return 'text-yellow-300';
  return 'text-emerald-400';
}

function CalcSummary({ calc }: { calc: Record<string, unknown> }) {
  const balances = (calc.contract_balances ?? {}) as Record<string, number>;
  const txPrice = Number(calc.transaction_price ?? 0);
  const revenue = Number(balances.revenue_recognized_to_date ?? calc.revenue_recognized_to_date ?? 0);
  const liability = Number(balances.contract_liability_amount ?? 0);
  const asset = Number(balances.contract_asset_amount ?? 0);
  const jeCount = Array.isArray(calc.journal_entries) ? calc.journal_entries.length : 0;
  const sched = (calc.recognition_schedule ?? calc.revenue_schedule) as unknown[] | undefined;

  return (
    <div className="mt-2 p-3 bg-gray-800/60 rounded-lg border border-gray-700 text-xs space-y-1">
      <p className="font-semibold text-violet-300">Full IFRS 15 calculation</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <span>Transaction price: <strong>{fmt(txPrice)}</strong></span>
        <span>Revenue recognised: <strong>{fmt(revenue)}</strong></span>
        <span>Contract liability: <strong>{fmt(liability)}</strong></span>
        <span>Contract asset: <strong>{fmt(asset)}</strong></span>
      </div>
      <p className="text-gray-500">
        {jeCount} journal entries · {sched?.length ?? 0} schedule periods
      </p>
    </div>
  );
}

export default function ContractPortfolio() {
  const { activeCompanyId } = useCompany();
  const fileRef = useRef<HTMLInputElement>(null);
  const [contracts, setContracts] = useState<IFRS15Contract[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [calcBusyId, setCalcBusyId] = useState<string | null>(null);
  const [extractionReview, setExtractionReview] = useState<{
    validation?: ExtractionValidation;
    clauseScan?: ClauseScan;
    contractType?: string;
  } | null>(null);
  const [form, setForm] = useState({
    customer_name: '', contract_date: format(new Date(), 'yyyy-MM-dd'),
    contract_value_aed: 0,
    performance_obligations: [{ description: '', allocated_transaction_price_aed: 0, satisfaction_method: 'over_time', start_date: '', end_date: '' }],
  });

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const [c, s] = await Promise.all([fetchIFRS15Contracts(activeCompanyId), fetchIFRS15PortfolioSummary(activeCompanyId)]);
      setContracts(c);
      setSummary(s);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Load failed'); }
    finally { setLoading(false); }
  }, [activeCompanyId]);

  useEffect(() => { void load(); }, [load]);

  async function handleUpload(file: File) {
    if (!activeCompanyId) return;
    try {
      const res = await extractIFRS15Contract(file, activeCompanyId);
      const ex = res.extracted_data ?? {};
      setExtractionReview({
        validation: res.validation,
        clauseScan: res.clause_scan,
        contractType: res.contract_type_detected,
      });
      setForm({
        customer_name: String(ex.customer_name ?? ''),
        contract_date: String(ex.contract_date ?? form.contract_date),
        contract_value_aed: Number(ex.contract_value_aed ?? 0),
        performance_obligations: (ex.performance_obligations ?? form.performance_obligations).map((o: Record<string, unknown>) => ({
          description: String(o.description ?? ''),
          allocated_transaction_price_aed: Number(o.standalone_selling_price_aed ?? o.allocated_transaction_price_aed ?? 0),
          satisfaction_method: String(o.satisfaction_method ?? 'over_time'),
          start_date: String(o.start_date ?? ''),
          end_date: String(o.end_date ?? ''),
        })),
      });
      setShowForm(true);
      const conf = res.validation?.overall_confidence;
      toast.success(conf != null ? `Extracted (${conf}% confidence) — review and save` : 'Contract extracted — review and save');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Extraction failed'); }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleSave() {
    if (!activeCompanyId) return;
    try {
      await saveIFRS15Contract(form, activeCompanyId);
      toast.success('Contract saved');
      setShowForm(false);
      setExtractionReview(null);
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
  }

  async function handleRunFullCalc(c: IFRS15Contract) {
    if (!activeCompanyId) return;
    setCalcBusyId(c.id);
    try {
      const rec = await calculateRecognition({
        contract_id: c.id,
        obligation_index: 0,
        method: 'engine',
        method_data: {},
      }, activeCompanyId);
      toast.success(`Full IFRS 15 calc complete — ${fmt(rec.transaction_price ?? 0)} transaction price`);
      void load();
      setExpandedId(c.id);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Calculation failed'); }
    finally { setCalcBusyId(null); }
  }

  async function handlePostJE(c: IFRS15Contract) {
    if (!activeCompanyId) return;
    try {
      const rec = await calculateRecognition({
        contract_id: c.id, obligation_index: 0, method: 'time_elapsed', method_data: {},
      }, activeCompanyId);
      const res = await postRecognitionJE({
        contract_id: c.id, obligation_index: 0,
        period_date: format(new Date(), 'yyyy-MM-dd'),
        amount_aed: rec.journal_entry_amount ?? rec.incremental_recognition ?? 0,
      }, activeCompanyId);
      toast.success(`Revenue JE posted (${res.je_ids?.length ?? 0} entries)`);
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'JE failed'); }
  }

  if (!activeCompanyId) return <div className="min-h-screen bg-gray-950 text-gray-100 p-6 flex items-center justify-center"><p className="text-gray-400">Select a company.</p></div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-start flex-wrap gap-4">
          <div>
            <p className="text-xs text-violet-400 uppercase tracking-widest">IFRS 15</p>
            <h1 className="text-2xl font-bold">Contract Portfolio</h1>
            <Link to="/r2r/rev-rec" className="text-xs text-violet-400">← Rev Rec Reconciliation</Link>
          </div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} />
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1 text-xs bg-gray-800 px-3 py-2 rounded-lg border border-gray-700"><FileUp size={14} /> Upload Contract</button>
            <button onClick={() => { setExtractionReview(null); setShowForm(true); }} className="flex items-center gap-1 text-xs bg-violet-800 px-3 py-2 rounded-lg"><Plus size={14} /> New Contract</button>
            <button onClick={() => void load()} className="text-xs bg-gray-800 px-3 py-2 rounded-lg"><RefreshCw size={14} className={loading ? 'animate-spin inline' : 'inline'} /></button>
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { l: 'Contracts', v: String(summary.total_contracts) },
              { l: 'Contract value', v: fmt(summary.total_contract_value_aed) },
              { l: 'Recognised YTD', v: fmt(summary.total_recognised_ytd_aed) },
              { l: 'Remaining', v: fmt(summary.total_remaining_aed) },
            ].map((c) => (
              <div key={c.l} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500">{c.l}</p><p className="text-lg font-bold text-violet-400">{c.v}</p>
              </div>
            ))}
          </div>
        )}

        <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-800/80 text-gray-400"><tr>
              {['', 'Customer', 'Value', 'Recognised', 'Remaining', 'Calc', 'Status', 'Actions'].map((h) => <th key={h || 'exp'} className="px-3 py-3 text-left">{h}</th>)}
            </tr></thead>
            <tbody>
              {contracts.map((c) => (
                <Fragment key={c.id}>
                  <tr className="border-t border-gray-800">
                    <td className="px-2 py-3">
                      {(c.has_calculation || c.calculation_results) && (
                        <button type="button" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} className="text-gray-500 hover:text-violet-400">
                          {expandedId === c.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-3">{c.customer_name}</td>
                    <td className="px-3 py-3">{fmt(c.contract_value_aed)}</td>
                    <td className="px-3 py-3">{fmt(c.total_recognised_aed)}</td>
                    <td className="px-3 py-3">{fmt(c.total_remaining_aed)}</td>
                    <td className="px-3 py-3">
                      {c.has_calculation ? (
                        <span className="text-emerald-400">Engine ✓</span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">{c.status}</td>
                    <td className="px-3 py-3 space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => void handleRunFullCalc(c)}
                        disabled={calcBusyId === c.id}
                        className="text-amber-400 hover:text-amber-300 inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Calculator size={12} />
                        {calcBusyId === c.id ? 'Calculating…' : 'Full IFRS 15 calc'}
                      </button>
                      <button onClick={() => void handlePostJE(c)} className="text-violet-400 hover:text-violet-300">Post JE (simple)</button>
                    </td>
                  </tr>
                  {expandedId === c.id && c.calculation_results && (
                    <tr className="border-t border-gray-800/50">
                      <td colSpan={8} className="px-4 py-2">
                        <CalcSummary calc={c.calculation_results} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
            <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-lg w-full p-6 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-bold">Save Contract</h2>

              {extractionReview && (
                <div className="space-y-2 text-xs border border-gray-700 rounded-lg p-3 bg-gray-800/40">
                  {extractionReview.contractType && (
                    <p><span className="text-gray-500">Detected type:</span> {extractionReview.contractType}</p>
                  )}
                  {extractionReview.validation && (
                    <div>
                      <p>
                        <span className="text-gray-500">Extraction confidence:</span>{' '}
                        <strong className={extractionReview.validation.overall_confidence != null && extractionReview.validation.overall_confidence >= 70 ? 'text-emerald-400' : 'text-amber-400'}>
                          {extractionReview.validation.overall_confidence ?? '—'}%
                        </strong>
                        {extractionReview.validation.is_valid ? ' · Valid' : ' · Needs review'}
                      </p>
                      {(extractionReview.validation.warnings ?? []).map((w) => (
                        <p key={w} className="text-amber-400/90">⚠ {w}</p>
                      ))}
                      {(extractionReview.validation.errors ?? []).map((e) => (
                        <p key={e} className="text-red-400/90">✕ {e}</p>
                      ))}
                    </div>
                  )}
                  {extractionReview.clauseScan && (
                    <div>
                      <p>
                        <span className="text-gray-500">Clause scan:</span>{' '}
                        <span className={riskColor(extractionReview.clauseScan.overall_risk)}>
                          {extractionReview.clauseScan.overall_risk ?? 'CLEAN'}
                        </span>
                        {' '}({extractionReview.clauseScan.clauses_found ?? 0} clauses
                        {extractionReview.clauseScan.high_severity ? `, ${extractionReview.clauseScan.high_severity} high` : ''})
                      </p>
                      {extractionReview.clauseScan.summary && (
                        <p className="text-gray-400 mt-1">{extractionReview.clauseScan.summary}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" placeholder="Customer name" value={form.customer_name} onChange={(e) => setForm((p) => ({ ...p, customer_name: e.target.value }))} />
              <input type="number" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" placeholder="Contract value AED" value={form.contract_value_aed} onChange={(e) => setForm((p) => ({ ...p, contract_value_aed: Number(e.target.value) }))} />
              <button onClick={() => void handleSave()} className="w-full bg-violet-700 py-2 rounded-lg text-sm">Save to Register</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
