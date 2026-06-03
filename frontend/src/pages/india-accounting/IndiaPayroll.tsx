/**
 * India Payroll — PF/ESI/Professional Tax/Gratuity
 */
import { useEffect, useState } from 'react';
import { Users, Zap, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import * as svc from '../../services/indiaAccounting.service';
import type { IndiaPayrollRun, IndiaEmployee } from '../../services/indiaAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);
const INR = (v: number) => `₹${v.toLocaleString('en-IN')}`;

export default function IndiaPayroll() {
  const [runs, setRuns]         = useState<IndiaPayrollRun[]>([]);
  const [employees, setEmployees] = useState<IndiaEmployee[]>([]);
  const [period, setPeriod]     = useState(THIS_PERIOD);
  const [loading, setLoading]   = useState(true);
  const [running, setRunning]   = useState(false);
  const [posting, setPosting]   = useState('');
  const [seeding, setSeeding]   = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [slips, setSlips]       = useState<any[]>([]);
  const [error, setError]       = useState('');
  const [msg, setMsg]           = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([svc.listPayrollRuns(), svc.listEmployees()])
      .then(([r, e]) => { setRuns(r.runs); setEmployees(e.employees); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSeedEmployees = async () => {
    setSeeding(true); setError(''); setMsg('');
    try {
      const r = await svc.seedEmployees();
      setMsg(r.seeded > 0 ? `Seeded ${r.seeded} sample employees` : 'Employees already seeded');
      load();
    } catch (e: any) { setError(e.message); } finally { setSeeding(false); }
  };

  const handleRunPayroll = async () => {
    setRunning(true); setError(''); setMsg('');
    try {
      const r = await svc.runPayroll(period);
      setMsg(`Payroll run for ${period} — ${r.total_employees} employees, Net Pay ${INR(r.total_net_pay)}`);
      load();
    } catch (e: any) { setError(e.message); } finally { setRunning(false); }
  };

  const handlePost = async (runId: string) => {
    setPosting(runId); setError('');
    try {
      await svc.postPayroll(runId);
      setMsg('Payroll posted to GL with PF/ESI/PT/Gratuity entries');
      load();
    } catch (e: any) { setError(e.message); } finally { setPosting(''); }
  };

  const handleExpand = async (runId: string) => {
    if (expandedRun === runId) { setExpandedRun(null); return; }
    setExpandedRun(runId);
    const s = await svc.getPayslips(runId).catch(() => ({ slips: [] }));
    setSlips(s.slips);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users size={20} className="text-cyan-400" /> Payroll
          </h1>
          <p className="text-gray-400 text-sm mt-1">PF · ESI · Professional Tax · Gratuity provision</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm" />
          {employees.length === 0 && (
            <button onClick={handleSeedEmployees} disabled={seeding}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium">
              {seeding ? 'Seeding…' : 'Seed 5 Employees'}
            </button>
          )}
          <button onClick={handleRunPayroll} disabled={running}
            className="flex items-center gap-2 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium">
            <Zap size={14} /> {running ? 'Running…' : 'Run Payroll'}
          </button>
          <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg"><RefreshCw size={14} /></button>
        </div>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-cyan-900/40 text-cyan-300 border border-cyan-700'}`}>
          {error || msg}
        </div>
      )}

      {/* Statutory rates reference */}
      <div className="bg-cyan-900/20 border border-cyan-800/40 rounded-xl p-4 mb-6">
        <p className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-3">Statutory Deductions</p>
        <div className="flex flex-wrap gap-4">
          {[
            { label: 'PF Employee', value: '12% of basic' },
            { label: 'PF Employer', value: '12% (EPS 8.33% + EPF 3.67%)' },
            { label: 'ESI Employee', value: '0.75% of gross (≤₹21,000)' },
            { label: 'ESI Employer', value: '3.25% of gross' },
            { label: 'Prof. Tax',    value: '₹200/month (most states)' },
            { label: 'Gratuity Prov.', value: '4.81% of basic' },
          ].map(b => (
            <div key={b.label} className="bg-gray-900/60 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500">{b.label}</p>
              <p className="text-sm font-bold text-cyan-400">{b.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Employees summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
          <p className="text-xs text-gray-400">Active Employees</p>
          <p className="text-2xl font-bold text-white mt-1">{employees.length}</p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
          <p className="text-xs text-gray-400">Total Payroll Runs</p>
          <p className="text-2xl font-bold text-white mt-1">{runs.length}</p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
          <p className="text-xs text-gray-400">Latest Net Pay</p>
          <p className="text-2xl font-bold text-cyan-400 mt-1">
            {runs.length > 0 ? INR(runs[0].total_net_pay) : '—'}
          </p>
        </div>
      </div>

      {/* Payroll runs */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80">
              <th className="px-4 py-3 text-left w-6"></th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Period</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Employees</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Gross</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">PF (Emp+Er)</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">ESI (Emp+Er)</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">PT</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Net Pay</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Gratuity</th>
              <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  {Array.from({ length: 11 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-700 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-gray-500">
                  No payroll runs. {employees.length === 0 ? 'Seed employees first, then' : ''} Click "Run Payroll".
                </td>
              </tr>
            ) : (
              runs.map(run => (
                <>
                  <tr key={run.id}
                    className="border-b border-gray-700/30 hover:bg-gray-700/20 cursor-pointer"
                    onClick={() => handleExpand(run.id)}>
                    <td className="px-4 py-3 text-gray-500">
                      {expandedRun === run.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </td>
                    <td className="px-4 py-3 font-mono text-cyan-400 text-xs">{run.period}</td>
                    <td className="px-4 py-3 text-right text-white text-xs">{run.total_employees}</td>
                    <td className="px-4 py-3 text-right text-white text-xs">{INR(run.total_gross)}</td>
                    <td className="px-4 py-3 text-right text-amber-400 text-xs">
                      {INR(run.total_pf_employee + run.total_pf_employer)}
                    </td>
                    <td className="px-4 py-3 text-right text-orange-400 text-xs">
                      {INR(run.total_esi_employee + run.total_esi_employer)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs">{INR(run.total_pt)}</td>
                    <td className="px-4 py-3 text-right text-cyan-400 font-medium text-xs">{INR(run.total_net_pay)}</td>
                    <td className="px-4 py-3 text-right text-purple-400 text-xs">{INR(run.total_gratuity_provision)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${run.status === 'posted' ? 'border-emerald-700 text-emerald-400 bg-emerald-900/20' : 'border-amber-700 text-amber-400 bg-amber-900/20'}`}>
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {run.status === 'draft' && (
                        <button
                          onClick={e => { e.stopPropagation(); handlePost(run.id); }}
                          disabled={!!posting}
                          className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-2 py-1 rounded text-white"
                        >
                          {posting === run.id ? '…' : 'Post to GL'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedRun === run.id && slips.length > 0 && (
                    <tr key={`${run.id}-slips`}>
                      <td colSpan={11} className="bg-gray-900/60 px-6 py-4 border-b border-gray-700">
                        <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">Payslips — {run.period}</p>
                        <div className="overflow-x-auto">
                          <table className="text-xs w-full">
                            <thead>
                              <tr className="text-gray-500">
                                <th className="text-left py-1 pr-4 font-normal">Employee</th>
                                <th className="text-right py-1 pr-4 font-normal">Gross</th>
                                <th className="text-right py-1 pr-4 font-normal">PF Emp</th>
                                <th className="text-right py-1 pr-4 font-normal">PF Er</th>
                                <th className="text-right py-1 pr-4 font-normal">ESI</th>
                                <th className="text-right py-1 pr-4 font-normal">PT</th>
                                <th className="text-right py-1 pr-4 font-normal">Net Pay</th>
                                <th className="text-right py-1 font-normal">Gratuity</th>
                              </tr>
                            </thead>
                            <tbody>
                              {slips.map((s, i) => (
                                <tr key={i} className="border-t border-gray-800">
                                  <td className="py-1 pr-4 text-gray-300">{s.employee_name}</td>
                                  <td className="py-1 pr-4 text-right text-white">{INR(s.gross)}</td>
                                  <td className="py-1 pr-4 text-right text-amber-400">{INR(s.pf_employee)}</td>
                                  <td className="py-1 pr-4 text-right text-amber-300">{INR(s.pf_employer)}</td>
                                  <td className="py-1 pr-4 text-right text-orange-400">{INR(s.esi_employee + s.esi_employer)}</td>
                                  <td className="py-1 pr-4 text-right text-gray-400">{INR(s.professional_tax)}</td>
                                  <td className="py-1 pr-4 text-right text-cyan-400 font-medium">{INR(s.net_pay)}</td>
                                  <td className="py-1 text-right text-purple-400">{INR(s.gratuity_provision)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
