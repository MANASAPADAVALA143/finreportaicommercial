/**
 * Accruals Engine — AI pattern detection + mandatory UAE EOSB
 */
import { useEffect, useState } from 'react';
import { Zap, AlertCircle, CheckCircle2, RefreshCw, Shield } from 'lucide-react';
import * as svc from '../../services/uaeFullAccounting.service';
import type { Accrual } from '../../services/uaeFullAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);

const STATUS_STYLE: Record<string, string> = {
  suggested: 'bg-amber-900/40 text-amber-400 border-amber-700',
  approved:  'bg-blue-900/40 text-blue-400 border-blue-700',
  posted:    'bg-green-900/40 text-green-400 border-green-700',
  reversed:  'bg-gray-700 text-gray-400 border-gray-600',
};

export default function Accruals() {
  const [accruals, setAccruals]     = useState<Accrual[]>([]);
  const [period, setPeriod]         = useState(THIS_PERIOD);
  const [suggesting, setSuggesting] = useState(false);
  const [posting, setPosting]       = useState<string>('');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [msg, setMsg]               = useState('');

  const load = () => {
    setLoading(true);
    svc.listAccruals(period)
      .then(d => setAccruals(d.accruals))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [period]);

  const handleSuggest = async () => {
    setSuggesting(true); setError(''); setMsg('');
    try {
      const r = await svc.suggestAccruals(period);
      setMsg(`AI found ${r.count} accrual suggestions for ${period}`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSuggesting(false);
    }
  };

  const handlePost = async (id: string) => {
    setPosting(id); setError('');
    try {
      await svc.postAccrualRoute(id);
      setMsg('Accrual posted — GL journal entry created + reversal scheduled');
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPosting('');
    }
  };

  const mandatory   = accruals.filter(a => a.is_mandatory);
  const suggested   = accruals.filter(a => !a.is_mandatory && a.status === 'suggested');
  const posted      = accruals.filter(a => a.status === 'posted');
  const totalAmount = accruals.filter(a => a.status !== 'reversed').reduce((s, a) => s + a.amount, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Accruals Engine</h1>
          <p className="text-gray-400 text-sm mt-1">AI pattern detection + mandatory UAE EOSB</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month" value={period}
            onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
          />
          <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg"><RefreshCw size={14} /></button>
          <button
            onClick={handleSuggest}
            disabled={suggesting}
            className="flex items-center gap-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Zap size={14} /> {suggesting ? 'Analysing…' : 'AI Suggest Accruals'}
          </button>
        </div>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-amber-900/40 text-amber-300 border border-amber-700'}`}>
          {error || msg}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Mandatory (EOSB)', value: String(mandatory.length), color: 'text-red-400' },
          { label: 'AI Suggested',     value: String(suggested.length), color: 'text-amber-400' },
          { label: 'Posted',           value: String(posted.length),    color: 'text-green-400' },
          { label: 'Total AED',        value: totalAmount.toLocaleString(), color: 'text-white' },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-lg font-bold ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* EOSB Mandatory Section */}
      {mandatory.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={14} className="text-red-400" />
            <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider">Mandatory — UAE Labour Law</h2>
          </div>
          <div className="space-y-2">
            {mandatory.map(a => (
              <div key={a.id} className="bg-red-900/20 border border-red-800/50 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{a.description}</p>
                    <p className="text-xs text-gray-400 mt-1">{a.account_code} • {a.accrual_type}</p>
                    {a.ai_reasoning && (
                      <p className="text-xs text-gray-500 mt-1 italic">{a.ai_reasoning}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-white">AED {a.amount.toLocaleString()}</span>
                    <span className={`text-xs border px-2 py-0.5 rounded-full ${STATUS_STYLE[a.status] ?? ''}`}>
                      {a.status}
                    </span>
                    {a.status === 'suggested' && (
                      <button
                        onClick={() => handlePost(a.id)}
                        disabled={!!posting}
                        className="text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 px-3 py-1.5 rounded-lg text-white"
                      >
                        {posting === a.id ? 'Posting…' : 'Post Now'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Suggestions */}
      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 mb-2 animate-pulse h-20" />
        ))
      ) : accruals.filter(a => !a.is_mandatory).length === 0 ? (
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-12 text-center">
          <Zap size={24} className="text-amber-400 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No accruals for {period}</p>
          <p className="text-gray-600 text-xs mt-1">Click "AI Suggest Accruals" to analyse recurring patterns</p>
        </div>
      ) : (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">AI Suggested & Posted</h2>
          <div className="space-y-2">
            {accruals.filter(a => !a.is_mandatory).map(a => (
              <div key={a.id} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{a.description}</p>
                    <p className="text-xs text-gray-400 mt-1">{a.account_code} • {a.accrual_type}</p>
                    {a.ai_reasoning && (
                      <p className="text-xs text-gray-500 mt-1 italic">{a.ai_reasoning}</p>
                    )}
                    {a.ai_confidence !== undefined && (
                      <div className="flex items-center gap-1 mt-1">
                        <div className="h-1 w-24 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full"
                            style={{ width: `${(a.ai_confidence ?? 0) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{Math.round((a.ai_confidence ?? 0) * 100)}% confidence</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-white">AED {a.amount.toLocaleString()}</span>
                    <span className={`text-xs border px-2 py-0.5 rounded-full ${STATUS_STYLE[a.status] ?? ''}`}>
                      {a.status}
                    </span>
                    {a.status === 'suggested' && (
                      <button
                        onClick={() => handlePost(a.id)}
                        disabled={!!posting}
                        className="text-xs bg-amber-700 hover:bg-amber-600 disabled:opacity-50 px-3 py-1.5 rounded-lg text-white"
                      >
                        {posting === a.id ? 'Posting…' : 'Post'}
                      </button>
                    )}
                    {a.status === 'posted' && <CheckCircle2 size={14} className="text-green-400" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
