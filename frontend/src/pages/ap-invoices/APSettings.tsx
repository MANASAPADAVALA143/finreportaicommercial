/**
 * APSettings.tsx — AP InvoiceFlow Settings
 * Approval workflows, notification preferences, company settings, pipeline configuration
 */
import { useState } from 'react';
import { Settings, Bell, Users, Workflow, Building2, Save, CheckCircle } from 'lucide-react';

type SettingTab = 'general' | 'approvals' | 'notifications' | 'pipeline';

const inputCls = 'w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500';
const labelCls = 'block text-xs font-medium text-slate-400 mb-1';

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)}
      className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-slate-700'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function APSettings() {
  const [tab, setTab] = useState<SettingTab>('general');
  const [saved, setSaved] = useState(false);

  // General settings
  const [company, setCompany] = useState('Gnanova Technologies Pvt. Ltd.');
  const [currency, setCurrency] = useState('AED');
  const [taxType, setTaxType] = useState('VAT');
  const [taxRate, setTaxRate] = useState('5');
  const [dueDays, setDueDays] = useState('30');
  const [timezone, setTimezone] = useState('Asia/Dubai');

  // Approval settings
  const [autoApproveBelow, setAutoApproveBelow] = useState('5000');
  const [requirePO, setRequirePO] = useState(true);
  const [cfoBeyond, setCfoBeyond] = useState('100000');
  const [approvalSteps, setApprovalSteps] = useState([
    { label: 'Finance Manager', email: 'finance@company.com', threshold: '50000' },
    { label: 'CFO',             email: 'cfo@company.com',     threshold: '100000' },
  ]);

  // Notification settings
  const [notifs, setNotifs] = useState({
    newInvoice:     true,
    approvalNeeded: true,
    overdue:        true,
    highRisk:       true,
    bulkImport:     false,
    weeklyDigest:   true,
  });

  // Pipeline settings
  const [aiExtract, setAiExtract]       = useState(true);
  const [ifrsClassify, setIfrsClassify] = useState(true);
  const [riskScore, setRiskScore]       = useState(true);
  const [threeWay, setThreeWay]         = useState(true);
  const [autoGL, setAutoGL]             = useState(false);
  const [n8nWebhook, setN8nWebhook]     = useState('');

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const TABS: { key: SettingTab; label: string; icon: typeof Settings }[] = [
    { key: 'general',       label: 'General',       icon: Building2 },
    { key: 'approvals',     label: 'Approvals',     icon: Workflow },
    { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'pipeline',      label: 'Pipeline',      icon: Settings },
  ];

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-slate-400" /> Settings
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">Configure AP InvoiceFlow for your organisation</p>
        </div>
        <button onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">
          {saved ? <><CheckCircle className="w-4 h-4" /> Saved!</> : <><Save className="w-4 h-4" /> Save Settings</>}
        </button>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-slate-700 pb-0">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors
              ${tab === key ? 'text-white border-blue-500 bg-slate-800' : 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* ── General tab ── */}
      {tab === 'general' && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 space-y-5 max-w-2xl">
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><Building2 className="w-4 h-4" /> Company Settings</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><label className={labelCls}>Company Name</label>
              <input value={company} onChange={e => setCompany(e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Default Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value)} className={inputCls}>
                {['AED','USD','EUR','GBP','INR','SAR','QAR','KWD'].map(c => <option key={c}>{c}</option>)}
              </select></div>
            <div><label className={labelCls}>Tax Type</label>
              <select value={taxType} onChange={e => setTaxType(e.target.value)} className={inputCls}>
                {['VAT','GST','Sales Tax','None'].map(t => <option key={t}>{t}</option>)}
              </select></div>
            <div><label className={labelCls}>Default Tax Rate (%)</label>
              <input type="number" value={taxRate} onChange={e => setTaxRate(e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Default Payment Terms (days)</label>
              <input type="number" value={dueDays} onChange={e => setDueDays(e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Timezone</label>
              <select value={timezone} onChange={e => setTimezone(e.target.value)} className={inputCls}>
                {['Asia/Dubai','Asia/Kolkata','America/New_York','Europe/London','America/Los_Angeles'].map(z => <option key={z}>{z}</option>)}
              </select></div>
          </div>
        </div>
      )}

      {/* ── Approvals tab ── */}
      {tab === 'approvals' && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 space-y-6 max-w-2xl">
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><Workflow className="w-4 h-4" /> Approval Workflow</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white font-medium">Require PO for all invoices</p>
                <p className="text-xs text-slate-400">Invoices without a PO number are flagged for review</p>
              </div>
              <Toggle value={requirePO} onChange={setRequirePO} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelCls}>Auto-approve below ({currency})</label>
                <input type="number" value={autoApproveBelow} onChange={e => setAutoApproveBelow(e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>CFO approval required above ({currency})</label>
                <input type="number" value={cfoBeyond} onChange={e => setCfoBeyond(e.target.value)} className={inputCls} /></div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Approval Steps</p>
              {approvalSteps.map((step, i) => (
                <div key={i} className="grid grid-cols-3 gap-3 mb-3 bg-slate-800 rounded-lg p-3">
                  <div><label className={labelCls}>Role</label>
                    <input value={step.label} onChange={e => setApprovalSteps(p => p.map((s, j) => j === i ? { ...s, label: e.target.value } : s))}
                      className={inputCls} /></div>
                  <div><label className={labelCls}>Email</label>
                    <input value={step.email} onChange={e => setApprovalSteps(p => p.map((s, j) => j === i ? { ...s, email: e.target.value } : s))}
                      className={inputCls} /></div>
                  <div><label className={labelCls}>Threshold ({currency})</label>
                    <input type="number" value={step.threshold} onChange={e => setApprovalSteps(p => p.map((s, j) => j === i ? { ...s, threshold: e.target.value } : s))}
                      className={inputCls} /></div>
                </div>
              ))}
              <button onClick={() => setApprovalSteps(p => [...p, { label: '', email: '', threshold: '' }])}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium">+ Add approval step</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Notifications tab ── */}
      {tab === 'notifications' && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 space-y-5 max-w-2xl">
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><Bell className="w-4 h-4" /> Notification Preferences</h2>
          <div className="space-y-4">
            {([
              { key: 'newInvoice',     label: 'New invoice uploaded',         desc: 'Notify when a new invoice is submitted' },
              { key: 'approvalNeeded', label: 'Approval required',            desc: 'Notify approvers when an invoice needs sign-off' },
              { key: 'overdue',        label: 'Overdue invoice alert',        desc: 'Alert when a payment is past due date' },
              { key: 'highRisk',       label: 'High-risk invoice flagged',    desc: 'Immediate alert on high-risk AI flags' },
              { key: 'bulkImport',     label: 'Bulk import completed',        desc: 'Summary notification after bulk upload' },
              { key: 'weeklyDigest',   label: 'Weekly AP digest',             desc: 'Weekly summary: totals, overdue, approvals' },
            ] as const).map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                <div>
                  <p className="text-sm text-white font-medium">{label}</p>
                  <p className="text-xs text-slate-400">{desc}</p>
                </div>
                <Toggle value={notifs[key]} onChange={v => setNotifs(p => ({ ...p, [key]: v }))} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Pipeline tab ── */}
      {tab === 'pipeline' && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 space-y-5 max-w-2xl">
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><Settings className="w-4 h-4" /> 8-Step Pipeline Configuration</h2>
          <p className="text-xs text-slate-400">Enable or disable each pipeline stage for incoming invoices.</p>
          <div className="space-y-3">
            {([
              { label: 'AI Extraction',          desc: 'Claude AI extracts fields from scanned invoices',     value: aiExtract,     set: setAiExtract },
              { label: 'IFRS Classification',    desc: 'Auto-classify expenses by IFRS category',             value: ifrsClassify,  set: setIfrsClassify },
              { label: 'Risk Scoring',           desc: 'Flag duplicate, high-value, or unusual invoices',     value: riskScore,     set: setRiskScore },
              { label: '3-Way Matching',         desc: 'Match invoice ↔ PO ↔ GRN automatically',             value: threeWay,      set: setThreeWay },
              { label: 'Auto GL Coding',         desc: 'Auto-assign GL codes from IFRS category mapping',     value: autoGL,        set: setAutoGL },
            ] as const).map(({ label, desc, value, set }) => (
              <div key={label} className="flex items-center justify-between py-2.5 border-b border-slate-800 last:border-0">
                <div>
                  <p className="text-sm text-white font-medium">{label}</p>
                  <p className="text-xs text-slate-400">{desc}</p>
                </div>
                <Toggle value={value} onChange={set} />
              </div>
            ))}
          </div>

          <div className="pt-2">
            <label className={labelCls}>n8n Webhook URL (for invoice pipeline automation)</label>
            <input
              value={n8nWebhook}
              onChange={e => setN8nWebhook(e.target.value)}
              placeholder="https://your-n8n.app/webhook/ap-invoice"
              className={inputCls}
            />
            <p className="text-[11px] text-slate-500 mt-1">Leave blank to skip n8n and use direct Supabase insert.</p>
          </div>

          <div className="bg-blue-900/20 border border-blue-800/40 rounded-lg p-3">
            <p className="text-xs text-blue-300 font-medium mb-1">InvoiceFlow AI Agent</p>
            <p className="text-xs text-slate-400">
              AI extraction uses InvoiceFlow's FastAPI agent at{' '}
              <code className="text-blue-400 text-[11px]">https://apinvoice-production.up.railway.app</code>.
              Override via <code className="text-blue-400 text-[11px]">VITE_AP_AGENT_URL</code> in your .env.
            </p>
          </div>
        </div>
      )}

      {saved && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2 bg-green-700 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium">
          <CheckCircle className="w-4 h-4" /> Settings saved
        </div>
      )}
    </div>
  );
}
