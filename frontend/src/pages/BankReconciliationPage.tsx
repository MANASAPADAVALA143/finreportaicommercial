import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useClient } from '../context/ClientContext';

interface GLEntry {
  id: string;
  date: string;
  amount: number;
  description: string;
}
interface BankEntry {
  id: string;
  date: string;
  amount: number;
  description: string;
}
interface MatchResult {
  glEntry: GLEntry;
  bankEntry: BankEntry | null;
  status: 'MATCHED' | 'GL_ONLY' | 'BANK_ONLY' | 'TIMING_DIFF';
  category: string;
  daysDiff: number | null;
}

export function BankReconciliationPage() {
  const navigate = useNavigate();
  const { activeClient } = useClient();
  const [glFile, setGlFile] = useState<File | null>(null);
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [tolerance, setTolerance] = useState(3);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const currency = activeClient?.currency || 'INR';

  const readEntries = (file: File): Promise<any[]> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const wb = XLSX.read(e.target?.result, { type: 'binary' });
        resolve(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]));
      };
      reader.readAsBinaryString(file);
    });

  const normalise = (
    rows: Record<string, unknown>[],
    type: 'gl' | 'bank'
  ): (GLEntry | BankEntry)[] =>
    rows.map((row, i) => {
      const get = (names: string[]) => {
        const k = Object.keys(row).find((key) =>
          names.some((n) => key.toLowerCase().includes(n))
        );
        return k ? row[k] : '';
      };
      return {
        id: String(get(['id', 'ref', 'no', 'number']) || `${type}_${i}`),
        date: String(get(['date', 'posting', 'value'])),
        amount: Number(get(['amount', 'debit', 'credit', 'value'])) || 0,
        description: String(get(['description', 'narration', 'memo', 'particulars'])),
      };
    });

  const match = async () => {
    if (!glFile || !bankFile) return;
    setLoading(true);
    try {
      const [glRaw, bankRaw] = await Promise.all([readEntries(glFile), readEntries(bankFile)]);
      const glEntries = normalise(glRaw, 'gl') as GLEntry[];
      const bankEntries = normalise(bankRaw, 'bank') as BankEntry[];

      const matched = new Set<string>();
      const matchResults: MatchResult[] = [];

      glEntries.forEach((gl) => {
        const glDate = new Date(gl.date).getTime();

        const bankMatch = bankEntries.find((b) => {
          if (matched.has(b.id)) return false;
          const bankDate = new Date(b.date).getTime();
          const daysDiff = Math.abs(glDate - bankDate) / (1000 * 60 * 60 * 24);
          return Math.abs(gl.amount - b.amount) < 1 && daysDiff <= tolerance;
        });

        if (bankMatch) {
          matched.add(bankMatch.id);
          const daysDiff =
            Math.abs(new Date(gl.date).getTime() - new Date(bankMatch.date).getTime()) /
            (1000 * 60 * 60 * 24);
          matchResults.push({
            glEntry: gl,
            bankEntry: bankMatch,
            status: daysDiff === 0 ? 'MATCHED' : 'TIMING_DIFF',
            category: daysDiff === 0 ? 'Matched' : 'Deposit in Transit',
            daysDiff: Math.round(daysDiff),
          });
        } else {
          matchResults.push({
            glEntry: gl,
            bankEntry: null,
            status: 'GL_ONLY',
            category: gl.amount < 0 ? 'Outstanding Cheque' : 'Deposit in Transit',
            daysDiff: null,
          });
        }
      });

      bankEntries
        .filter((b) => !matched.has(b.id))
        .forEach((b) => {
          matchResults.push({
            glEntry: { id: '', date: '', amount: 0, description: '' },
            bankEntry: b,
            status: 'BANK_ONLY',
            category: Math.abs(b.amount) < 1000 ? 'Bank Charge' : 'Unreconciled',
            daysDiff: null,
          });
        });

      setResults(matchResults);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n: number) => {
    const sym: Record<string, string> = {
      INR: '₹',
      USD: '$',
      GBP: '£',
      AED: 'AED ',
      AUD: 'A$',
      EUR: '€',
    };
    const s = sym[currency] || '';
    return `${s}${Math.abs(n).toLocaleString()}`;
  };

  const matched = results.filter((r) => r.status === 'MATCHED').length;
  const unreconciled = results.filter(
    (r) => r.status !== 'MATCHED' && r.status !== 'TIMING_DIFF'
  ).length;
  const glTotal = results.reduce((s, r) => s + r.glEntry.amount, 0);
  const bankTotal = results
    .filter((r) => r.bankEntry)
    .reduce((s, r) => s + (r.bankEntry?.amount || 0), 0);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto', minHeight: '100vh', background: '#F8FAFC' }}>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => navigate('/r2r')}
          className="p-2 hover:bg-white rounded-lg transition flex items-center gap-2 text-gray-700"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Bank Reconciliation</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748B)', margin: 0 }}>
            {activeClient?.name} · Auto-match GL entries against bank statement
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'GL Extract', state: glFile, setState: setGlFile },
          { label: 'Bank Statement', state: bankFile, setState: setBankFile },
        ].map(({ label, state, setState }) => (
          <div
            key={label}
            style={{
              padding: 16,
              borderRadius: 10,
              background: 'var(--color-background-secondary, #F1F5F9)',
              border: '0.5px solid var(--color-border-tertiary, #E2E8F0)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{label}</div>
            <input
              type="file"
              accept=".xlsx,.csv"
              onChange={(e) => setState(e.target.files?.[0] || null)}
              style={{ fontSize: 12 }}
            />
            {state && (
              <div style={{ fontSize: 11, color: '#3B6D11', marginTop: 4 }}>✓ {state.name}</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <label
            style={{
              fontSize: 12,
              fontWeight: 500,
              display: 'block',
              marginBottom: 4,
            }}
          >
            Date Tolerance (days)
          </label>
          <input
            type="number"
            value={tolerance}
            onChange={(e) => setTolerance(Number(e.target.value))}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #E2E8F0',
              fontSize: 13,
              width: 80,
            }}
          />
        </div>
        <button
          onClick={match}
          disabled={!glFile || !bankFile || loading}
          style={{
            padding: '8px 20px',
            borderRadius: 8,
            background: '#185FA5',
            color: 'white',
            border: 'none',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {loading ? 'Matching...' : 'Run Reconciliation'}
        </button>
      </div>

      {results.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Matched', value: matched, color: '#3B6D11' },
              { label: 'Unreconciled', value: unreconciled, color: '#A32D2D' },
              { label: 'GL Balance', value: fmt(glTotal), color: '#185FA5' },
              { label: 'Bank Balance', value: fmt(bankTotal), color: '#185FA5' },
              {
                label: 'Difference',
                value: fmt(glTotal - bankTotal),
                color: Math.abs(glTotal - bankTotal) < 1 ? '#3B6D11' : '#A32D2D',
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  flex: 1,
                  minWidth: 120,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'var(--color-background-secondary, #F1F5F9)',
                  border: '0.5px solid var(--color-border-tertiary, #E2E8F0)',
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 500, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #64748B)' }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          <div style={{ overflowX: 'auto', background: 'white', borderRadius: 10, border: '1px solid #E2E8F0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--color-background-secondary, #F1F5F9)' }}>
                  {[
                    'Status',
                    'Category',
                    'GL Ref',
                    'Bank Ref',
                    'GL Date',
                    'Bank Date',
                    'Amount',
                    'Days Diff',
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontWeight: 500,
                        fontSize: 11,
                        borderBottom: '1px solid #E2E8F0',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: '1px solid #E2E8F0',
                      background: r.status === 'MATCHED' ? 'transparent' : '#FCEBEB',
                    }}
                  >
                    <td style={{ padding: '8px 10px' }}>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 7px',
                          borderRadius: 20,
                          fontWeight: 500,
                          background: r.status === 'MATCHED' ? '#EAF3DE' : '#FCEBEB',
                          color: r.status === 'MATCHED' ? '#3B6D11' : '#A32D2D',
                        }}
                      >
                        {r.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: 11 }}>{r.category}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11 }}>{r.glEntry.id}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11 }}>{r.bankEntry?.id || '—'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11 }}>{r.glEntry.date}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11 }}>{r.bankEntry?.date || '—'}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 500 }}>
                      {fmt(r.glEntry.amount || r.bankEntry?.amount || 0)}
                    </td>
                    <td
                      style={{
                        padding: '8px 10px',
                        color: r.daysDiff && r.daysDiff > 0 ? '#854F0B' : 'inherit',
                      }}
                    >
                      {r.daysDiff !== null ? `${r.daysDiff}d` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
