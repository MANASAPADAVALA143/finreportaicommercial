/**
 * Company Setup Wizard — 6-step onboarding before /uae-full
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { useNavigate } from 'react-router-dom';
import {
  Building2, CheckCircle2, ChevronLeft, ChevronRight, Loader2,
  Upload, Users, BookOpen, Scale, Settings, ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import * as setup from '../../services/companySetup.service';
import type { CompanyProfile, SetupAccount } from '../../services/companySetup.service';

const STEPS = [
  { n: 1, label: 'Company Profile', icon: Building2 },
  { n: 2, label: 'Chart of Accounts', icon: BookOpen },
  { n: 3, label: 'Opening Balances', icon: Scale },
  { n: 4, label: 'Accounting Controls', icon: Settings },
  { n: 5, label: 'Users & Roles', icon: Users },
  { n: 6, label: 'Review & Activate', icon: ClipboardCheck },
];

const LEGAL_TYPES = ['LLC', 'FZE', 'Branch', 'Sole Proprietor', 'Other'];
const INDUSTRIES = ['Trading', 'Services', 'Manufacturing', 'Real Estate', 'Other'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-teal-500 focus:outline-none';
const inputErrorCls = 'w-full bg-gray-800 border border-red-600 rounded-lg px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none';
const labelCls = 'block text-xs font-medium text-gray-400 mb-1';
const fieldErrorCls = 'mt-1 text-xs text-red-400';

type CoaCsvRow = { code: string; name: string; type: string; sub_type: string };

function normalizeCoaHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

function mapCoaCsvRow(raw: Record<string, string>): CoaCsvRow | null {
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!k) continue;
    norm[normalizeCoaHeader(k)] = (v ?? '').trim();
  }
  const code = norm.code || norm.account_code || '';
  const name = norm.name || norm.account_name || '';
  if (!code || !name) return null;
  return {
    code,
    name,
    type: norm.type || norm.account_type || 'Expense',
    sub_type: norm.sub_type || norm.account_sub_type || norm.sub || '',
  };
}

function parseCoaCsvContent(text: string): CoaCsvRow[] {
  const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return (result.data || []).map(mapCoaCsvRow).filter((r): r is CoaCsvRow => r !== null);
}

export default function CompanySetupWizard() {
  const navigate = useNavigate();
  const { accessToken } = useAuth();
  const { loadCompanies, setActiveCompany } = useCompany();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [profile, setProfile] = useState<Partial<CompanyProfile>>({
    base_currency: 'AED',
    reporting_standard: 'IFRS',
    financial_year_start: 1,
  });
  const [coaOption, setCoaOption] = useState<'default' | 'csv' | 'blank'>('default');
  const [accounts, setAccounts] = useState<SetupAccount[]>([]);
  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvParsedRows, setCsvParsedRows] = useState<CoaCsvRow[]>([]);
  const [csvDragOver, setCsvDragOver] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [openingDate, setOpeningDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [balances, setBalances] = useState<Record<string, { debit: number; credit: number; prior?: number }>>({});
  const [controls, setControls] = useState({
    je_approval_threshold_aed: 50000,
    allow_backdating: true,
    max_backdate_days: 30,
    require_docs_account_ids: [] as string[],
    dual_approval_account_ids: [] as string[],
  });
  const [workspaceUsers, setWorkspaceUsers] = useState<{ user_id: string; name: string; email: string }[]>([]);
  const [moduleOptions, setModuleOptions] = useState<Record<string, string[]>>({});
  const [roleAssignments, setRoleAssignments] = useState<Record<string, Record<string, string>>>({});
  const [review, setReview] = useState<Record<string, unknown> | null>(null);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const status = await setup.getSetupStatus(accessToken);
      if (status.draft_company) {
        setProfile(status.draft_company);
        setStep(Math.max(1, status.draft_company.setup_step || 1));
      } else if (status.has_active_company) {
        setProfile({ base_currency: 'AED', reporting_standard: 'IFRS', financial_year_start: 1 });
        setStep(1);
        setAccounts([]);
      }
      const coa = await setup.listCoA(accessToken).catch(() => ({ accounts: [], count: 0 }));
      setAccounts(coa.accounts);
      const ctrl = await setup.getControls(accessToken).catch(() => ({ controls: null }));
      if (ctrl.controls) {
        setControls({
          je_approval_threshold_aed: Number(ctrl.controls.je_approval_threshold_aed) || 50000,
          allow_backdating: Boolean(ctrl.controls.allow_backdating ?? true),
          max_backdate_days: Number(ctrl.controls.max_backdate_days) || 30,
          require_docs_account_ids: (ctrl.controls.require_docs_account_ids as string[]) || [],
          dual_approval_account_ids: (ctrl.controls.dual_approval_account_ids as string[]) || [],
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load setup');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void loadInitial(); }, [loadInitial]);

  const balanceTotals = useMemo(() => {
    let dr = 0, cr = 0;
    for (const b of Object.values(balances)) {
      dr += b.debit || 0;
      cr += b.credit || 0;
    }
    return { dr, cr, balanced: Math.abs(dr - cr) < 0.01 };
  }, [balances]);

  const handleLogo = async (file: File) => {
    try {
      const url = await setup.uploadLogo(accessToken, file);
      setProfile(p => ({ ...p, logo_url: url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Logo upload failed');
    }
  };

  const clearCsvImport = () => {
    setCsvText('');
    setCsvFileName('');
    setCsvParsedRows([]);
    if (csvInputRef.current) csvInputRef.current.value = '';
  };

  const processCsvFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a .csv file');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const rows = parseCoaCsvContent(text);
      if (rows.length === 0) {
        setError('No valid account rows found. Expected columns: code, name, type, sub_type (or account_code, account_name, account_type, account_sub_type)');
        clearCsvImport();
        return;
      }
      setError('');
      setCsvText(text);
      setCsvFileName(file.name);
      setCsvParsedRows(rows);
    };
    reader.onerror = () => setError('Failed to read CSV file');
    reader.readAsText(file);
  };

  const handleCoaOptionChange = (opt: 'default' | 'csv' | 'blank') => {
    setCoaOption(opt);
    if (opt !== 'csv') clearCsvImport();
  };

  const validateProfile = (): boolean => {
    const errors: Record<string, string> = {};
    if (!profile.company_name?.trim()) {
      errors.company_name = 'Company name is required';
    }
    if (profile.trn?.trim() && !/^\d{15}$/.test(profile.trn.trim())) {
      errors.trn = 'TRN must be exactly 15 digits';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveProfile = async () => {
    setError('');
    if (!validateProfile()) return;
    setSaving(true);
    try {
      const res = await setup.saveProfile(accessToken, profile);
      setProfile(res.profile);
      setFieldErrors({});
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveCoA = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await setup.setupCoA(accessToken, coaOption, coaOption === 'csv' ? csvText : undefined);
      setAccounts(res.accounts);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CoA setup failed');
    } finally {
      setSaving(false);
    }
  };

  const saveOpening = async () => {
    if (!balanceTotals.balanced && balanceTotals.dr + balanceTotals.cr > 0) {
      setError('Opening balances must balance (total debits = total credits)');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const lines = accounts.map(a => ({
        account_code: a.code,
        account_name: a.name,
        debit: balances[a.code]?.debit || 0,
        credit: balances[a.code]?.credit || 0,
        prior_year: balances[a.code]?.prior,
      }));
      await setup.saveOpeningBalances(accessToken, openingDate, lines);
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Opening balances failed');
    } finally {
      setSaving(false);
    }
  };

  const saveControlsStep = async () => {
    setSaving(true);
    setError('');
    try {
      await setup.saveControls(accessToken, controls);
      setStep(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Controls save failed');
    } finally {
      setSaving(false);
    }
  };

  const loadUsers = useCallback(async () => {
    try {
      const data = await setup.listSetupUsers(accessToken);
      setWorkspaceUsers(data.users);
      setModuleOptions(data.module_options);
      const map: Record<string, Record<string, string>> = {};
      for (const r of data.roles) {
        map[r.user_id] = map[r.user_id] || {};
        map[r.user_id][r.module] = r.role;
      }
      setRoleAssignments(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    }
  }, [accessToken]);

  useEffect(() => {
    if (step === 5) void loadUsers();
  }, [step, loadUsers]);

  const saveRoles = async () => {
    setSaving(true);
    setError('');
    try {
      const assignments: { user_id: string; module: string; role: string }[] = [];
      for (const [userId, mods] of Object.entries(roleAssignments)) {
        for (const [mod, role] of Object.entries(mods)) {
          if (role) assignments.push({ user_id: userId, module: mod, role });
        }
      }
      await setup.saveRoles(accessToken, assignments);
      const rev = await setup.getReview(accessToken);
      setReview(rev);
      setStep(6);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Roles save failed');
    } finally {
      setSaving(false);
    }
  };

  const activate = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await setup.activateCompany(accessToken);
      await loadCompanies();
      if (res.profile?.id) setActiveCompany(res.profile.id);
      navigate(res.redirect || '/uae-full');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activation failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
      </div>
    );
  }

  const StepIcon = STEPS[step - 1]?.icon ?? Building2;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <StepIcon className="w-8 h-8 text-teal-400" />
            <div>
              <h1 className="text-2xl font-bold">Company Setup</h1>
              <p className="text-gray-400 text-sm">Step {step} of 6 — {STEPS[step - 1]?.label}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              onClick={() => navigate('/uae-suite')}
              className="px-3 py-1.5 rounded-lg border border-indigo-500/40 text-indigo-300 hover:bg-indigo-900/30"
            >
              UAE Taxation (AP + Tax) →
            </button>
            <button
              type="button"
              onClick={() => navigate('/uae-select')}
              className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-400 hover:text-white hover:bg-gray-800"
            >
              All modules
            </button>
          </div>
        </div>

        <div className="flex gap-8">
          <nav className="hidden md:block w-48 shrink-0 space-y-1">
            {STEPS.map(s => {
              const Icon = s.icon;
              const active = s.n === step;
              const done = s.n < step;
              return (
                <div
                  key={s.n}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                    active ? 'bg-teal-900/40 text-teal-300' : done ? 'text-gray-400' : 'text-gray-600'
                  }`}
                >
                  {done ? <CheckCircle2 className="w-4 h-4 text-teal-500" /> : <Icon className="w-4 h-4" />}
                  {s.label}
                </div>
              );
            })}
          </nav>

          <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">{error}</div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Company Name *</label>
                    <input
                      className={fieldErrors.company_name ? inputErrorCls : inputCls}
                      value={profile.company_name || ''}
                      onChange={e => {
                        setProfile(p => ({ ...p, company_name: e.target.value }));
                        if (fieldErrors.company_name) {
                          setFieldErrors(fe => {
                            const next = { ...fe };
                            delete next.company_name;
                            return next;
                          });
                        }
                      }}
                    />
                    {fieldErrors.company_name && <p className={fieldErrorCls}>{fieldErrors.company_name}</p>}
                  </div>
                  <div>
                    <label className={labelCls}>Trade Name</label>
                    <input className={inputCls} value={profile.trade_name || ''} onChange={e => setProfile(p => ({ ...p, trade_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Legal Type</label>
                    <select className={inputCls} value={profile.legal_type || ''} onChange={e => setProfile(p => ({ ...p, legal_type: e.target.value }))}>
                      <option value="">Select…</option>
                      {LEGAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>TRN (15 digits)</label>
                    <input
                      className={fieldErrors.trn ? inputErrorCls : inputCls}
                      value={profile.trn || ''}
                      maxLength={15}
                      onChange={e => {
                        setProfile(p => ({ ...p, trn: e.target.value.replace(/\D/g, '') }));
                        if (fieldErrors.trn) {
                          setFieldErrors(fe => {
                            const next = { ...fe };
                            delete next.trn;
                            return next;
                          });
                        }
                      }}
                    />
                    {fieldErrors.trn && <p className={fieldErrorCls}>{fieldErrors.trn}</p>}
                  </div>
                  <div>
                    <label className={labelCls}>Industry</label>
                    <select className={inputCls} value={profile.industry || ''} onChange={e => setProfile(p => ({ ...p, industry: e.target.value }))}>
                      <option value="">Select…</option>
                      {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Financial Year Start</label>
                    <select className={inputCls} value={profile.financial_year_start || 1} onChange={e => setProfile(p => ({ ...p, financial_year_start: Number(e.target.value) }))}>
                      {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Logo</label>
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg cursor-pointer text-sm hover:border-teal-600">
                    <Upload className="w-4 h-4" />
                    Upload logo
                    <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void handleLogo(f); }} />
                  </label>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  {(['default', 'csv', 'blank'] as const).map(opt => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => handleCoaOptionChange(opt)}
                      className={`px-4 py-2 rounded-lg text-sm border ${coaOption === opt ? 'border-teal-500 bg-teal-900/30 text-teal-300' : 'border-gray-700 text-gray-400'}`}
                    >
                      {opt === 'default' ? 'UAE Default CoA' : opt === 'csv' ? 'Import CSV' : 'Start Blank'}
                    </button>
                  ))}
                </div>
                {coaOption === 'csv' && (
                  <div className="space-y-3">
                    <input
                      ref={csvInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) processCsvFile(f);
                      }}
                    />
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => csvInputRef.current?.click()}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') csvInputRef.current?.click(); }}
                      onDragOver={e => { e.preventDefault(); setCsvDragOver(true); }}
                      onDragLeave={e => { e.preventDefault(); setCsvDragOver(false); }}
                      onDrop={e => {
                        e.preventDefault();
                        setCsvDragOver(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) processCsvFile(f);
                      }}
                      className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
                        csvDragOver ? 'border-teal-500 bg-teal-900/20' : 'border-gray-600 bg-gray-800/50 hover:border-teal-600'
                      }`}
                    >
                      <Upload className="w-8 h-8 text-gray-400" />
                      <p className="text-sm text-gray-300">Drag and drop your CSV file here</p>
                      <p className="text-xs text-gray-500">or click to browse</p>
                      <p className="text-xs text-gray-600">Accepts .csv files only</p>
                    </div>
                    {csvFileName && (
                      <p className="text-sm text-gray-400">
                        Selected file: <span className="text-teal-300">{csvFileName}</span>
                      </p>
                    )}
                    {csvParsedRows.length > 0 && (
                      <>
                        <p className="text-sm text-teal-400">{csvParsedRows.length} accounts ready to import</p>
                        <div className="overflow-x-auto border border-gray-700 rounded-lg">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-800">
                              <tr>
                                <th className="text-left px-3 py-2">Code</th>
                                <th className="text-left px-3 py-2">Name</th>
                                <th className="text-left px-3 py-2">Type</th>
                                <th className="text-left px-3 py-2">Sub-type</th>
                              </tr>
                            </thead>
                            <tbody>
                              {csvParsedRows.slice(0, 5).map((row, i) => (
                                <tr key={`${row.code}-${i}`} className="border-t border-gray-800">
                                  <td className="px-3 py-2 font-mono">{row.code}</td>
                                  <td className="px-3 py-2">{row.name}</td>
                                  <td className="px-3 py-2">{row.type}</td>
                                  <td className="px-3 py-2">{row.sub_type || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {csvParsedRows.length > 5 && (
                          <p className="text-xs text-gray-500">Showing first 5 of {csvParsedRows.length} rows</p>
                        )}
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void saveCoA()}
                          className="flex items-center gap-2 px-5 py-2 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm font-medium disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Import {csvParsedRows.length} Accounts</>}
                        </button>
                      </>
                    )}
                  </div>
                )}
                {accounts.length > 0 && (
                  <p className="text-sm text-gray-400">{accounts.length} accounts loaded</p>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  Optional — leave debits and credits at zero to skip, or enter your opening trial balance. You can return later from Company Setup.
                </p>
                <div>
                  <label className={labelCls}>Opening Balance Date</label>
                  <input type="date" className={inputCls} value={openingDate} onChange={e => setOpeningDate(e.target.value)} />
                </div>
                <div className="overflow-x-auto border border-gray-700 rounded-lg max-h-96">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-800 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Code</th>
                        <th className="text-left px-3 py-2">Account</th>
                        <th className="text-right px-3 py-2">Debit</th>
                        <th className="text-right px-3 py-2">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map(a => (
                        <tr key={a.id} className="border-t border-gray-800">
                          <td className="px-3 py-1">{a.code}</td>
                          <td className="px-3 py-1">{a.name}</td>
                          <td className="px-3 py-1">
                            <input type="number" className="w-24 bg-gray-900 border border-gray-700 rounded px-1 text-right ml-auto block"
                              value={balances[a.code]?.debit || ''} onChange={e => setBalances(b => ({ ...b, [a.code]: { ...b[a.code], debit: Number(e.target.value) || 0, credit: b[a.code]?.credit || 0 } }))} />
                          </td>
                          <td className="px-3 py-1">
                            <input type="number" className="w-24 bg-gray-900 border border-gray-700 rounded px-1 text-right ml-auto block"
                              value={balances[a.code]?.credit || ''} onChange={e => setBalances(b => ({ ...b, [a.code]: { ...b[a.code], credit: Number(e.target.value) || 0, debit: b[a.code]?.debit || 0 } }))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={`text-sm ${balanceTotals.balanced ? 'text-teal-400' : 'text-amber-400'}`}>
                  Debits: {balanceTotals.dr.toFixed(2)} | Credits: {balanceTotals.cr.toFixed(2)}
                  {!balanceTotals.balanced && balanceTotals.dr + balanceTotals.cr > 0 && ' — must balance'}
                </div>
                {balanceTotals.balanced && balanceTotals.dr === 0 && balanceTotals.cr === 0 && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveOpening()}
                    className="text-sm text-teal-400 hover:text-teal-300 underline"
                  >
                    Skip opening balances for now (save zeros and continue) →
                  </button>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4 max-w-md">
                <div>
                  <label className={labelCls}>JE Approval Threshold (AED)</label>
                  <input type="number" className={inputCls} value={controls.je_approval_threshold_aed}
                    onChange={e => setControls(c => ({ ...c, je_approval_threshold_aed: Number(e.target.value) }))} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={controls.allow_backdating} onChange={e => setControls(c => ({ ...c, allow_backdating: e.target.checked }))} />
                  Allow backdating
                </label>
                <div>
                  <label className={labelCls}>Max Backdate Days</label>
                  <input type="number" className={inputCls} value={controls.max_backdate_days}
                    onChange={e => setControls(c => ({ ...c, max_backdate_days: Number(e.target.value) }))} />
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                {workspaceUsers.map(u => (
                  <div key={u.user_id} className="border border-gray-700 rounded-lg p-3">
                    <div className="font-medium text-sm mb-2">{u.name} <span className="text-gray-500">({u.email})</span></div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {Object.entries(moduleOptions).map(([mod, roles]) => (
                        <div key={mod}>
                          <label className={labelCls}>{mod.toUpperCase()}</label>
                          <select className={inputCls} value={roleAssignments[u.user_id]?.[mod] || ''}
                            onChange={e => setRoleAssignments(r => ({ ...r, [u.user_id]: { ...r[u.user_id], [mod]: e.target.value } }))}>
                            <option value="">—</option>
                            {roles.map(role => <option key={role} value={role}>{role}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {step === 6 && review && (
              <div className="space-y-3 text-sm">
                <p><span className="text-gray-500">Company:</span> {(review.profile as CompanyProfile)?.company_name}</p>
                <p><span className="text-gray-500">Accounts:</span> {String(review.account_count)}</p>
                <p><span className="text-gray-500">Periods:</span> {Array.isArray(review.periods) ? review.periods.length : 0} generated</p>
                <p className="text-teal-400">Ready to activate and start UAE accounting.</p>
              </div>
            )}

            <div className="flex justify-between mt-8 pt-4 border-t border-gray-800">
              <button type="button" disabled={step <= 1 || saving} onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-1 px-4 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-30">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              {step < 6 ? (
                <button type="button" disabled={saving || (step === 2 && coaOption === 'csv')} onClick={() => {
                  if (step === 1) void saveProfile();
                  else if (step === 2) void saveCoA();
                  else if (step === 3) void saveOpening();
                  else if (step === 4) void saveControlsStep();
                  else if (step === 5) void saveRoles();
                }}
                  className="flex items-center gap-1 px-5 py-2 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm font-medium disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Next <ChevronRight className="w-4 h-4" /></>}
                </button>
              ) : (
                <button type="button" disabled={saving} onClick={() => void activate()}
                  className="flex items-center gap-1 px-5 py-2 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm font-medium disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Activate <CheckCircle2 className="w-4 h-4" /></>}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
