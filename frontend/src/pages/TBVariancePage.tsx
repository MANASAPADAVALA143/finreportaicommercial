import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useClient } from '../context/ClientContext';
import { callGemini } from '../services/geminiService';

interface TBRow {
  account: string;
  currentPeriod: number;
  priorPeriod: number;
  variance: number;
  variancePct: number;
  isMaterial: boolean;
  aiCommentary?: string;
}

export function TBVariancePage() {
  const navigate = useNavigate();
  const { activeClient } = useClient();
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [priorFile, setPriorFile] = useState<File | null>(null);
  const [materiality, setMateriality] = useState(10000);
  const [materialityPct, setMaterialityPct] = useState(10);
  const [results, setResults] = useState<TBRow[]>([]);
  const [loading, setLoading] = useState(false);
  const currency = activeClient?.currency || 'INR';

  const readTB = (file: File): Promise<Record<string, number>> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const wb = XLSX.read(e.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<any>(ws);
        const map: Record<string, number> = {};
        data.forEach((row: Record<string, unknown>) => {
          const accountCol =
            Object.keys(row).find((k) =>
              k.toLowerCase().includes('account') || k.toLowerCase().includes('gl')
            ) || Object.keys(row)[0];
          const amountCol =
            Object.keys(row).find((k) =>
              k.toLowerCase().includes('amount') ||
              k.toLowerCase().includes('balance') ||
              k.toLowerCase().includes('value')
            ) || Object.keys(row)[1];
          if (row[accountCol] && row[amountCol] !== undefined) {
            map[String(row[accountCol])] = Number(row[amountCol]) || 0;
          }
        });
        resolve(map);
      };
      reader.readAsBinaryString(file);
    });
  };

  const analyse = async () => {
    if (!currentFile || !priorFile) return;
    setLoading(true);
    try {
      const [current, prior] = await Promise.all([readTB(currentFile), readTB(priorFile)]);
      const allAccounts = new Set([...Object.keys(current), ...Object.keys(prior)]);
      const rows: TBRow[] = [];

      allAccounts.forEach((account) => {
        const curr = current[account] || 0;
        const prev = prior[account] || 0;
        const variance = curr - prev;
        const variancePct = prev !== 0 ? (variance / Math.abs(prev)) * 100 : 100;
        const isMaterial =
          Math.abs(variance) >= materiality || Math.abs(variancePct) >= materialityPct;
        rows.push({ account, currentPeriod: curr, priorPeriod: prev, variance, variancePct, isMaterial });
      });

      rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

      const material = rows.filter((r) => r.isMaterial).slice(0, 10);
      for (const row of material) {
        try {
          const prompt = `You are a CFO analyst. Write a 1-sentence commentary for this variance.
Account: ${row.account}
Current: ${row.currentPeriod.toLocaleString()} ${currency}
Prior: ${row.priorPeriod.toLocaleString()} ${currency}
Variance: ${row.variance > 0 ? '+' : ''}${row.variance.toLocaleString()} (${row.variancePct.toFixed(1)}%)
Return ONLY JSON: {"commentary": "one sentence explanation"}`;
          const raw = await callGemini(prompt);
          const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
          row.aiCommentary = json.commentary;
        } catch {
          /* skip */
        }
      }

      setResults(rows);
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = () => {
    const data = results.map((r) => ({
      Account: r.account,
      'Current Period': r.currentPeriod,
      'Prior Period': r.priorPeriod,
      Variance: r.variance,
      'Variance %': r.variancePct.toFixed(1) + '%',
      Material: r.isMaterial ? 'YES' : 'NO',
      'AI Commentary': r.aiCommentary || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(data.filter((d) => d.Material === 'YES')),
      'Flagged Accounts'
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Full TB');
    XLSX.writeFile(wb, `TB_Variance_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
          <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Trial Balance Variance Analysis</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748B)', margin: 0 }}>
            {activeClient?.name} · Upload current and prior period TB to identify material movements
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Current Period TB', state: currentFile, setState: setCurrentFile },
          { label: 'Prior Period TB', state: priorFile, setState: setPriorFile },
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

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label
            style={{
              fontSize: 12,
              fontWeight: 500,
              display: 'block',
              marginBottom: 4,
            }}
          >
            Materiality ({currency})
          </label>
          <input
            type="number"
            value={materiality}
            onChange={(e) => setMateriality(Number(e.target.value))}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #E2E8F0',
              fontSize: 13,
              width: 120,
            }}
          />
        </div>
        <div>
          <label
            style={{
              fontSize: 12,
              fontWeight: 500,
              display: 'block',
              marginBottom: 4,
            }}
          >
            Materiality (%)
          </label>
          <input
            type="number"
            value={materialityPct}
            onChange={(e) => setMaterialityPct(Number(e.target.value))}
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
          onClick={analyse}
          disabled={!currentFile || !priorFile || loading}
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
          {loading ? 'Analysing...' : 'Analyse Variances'}
        </button>
        {results.length > 0 && (
          <button
            onClick={exportExcel}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              background: '#3B6D11',
              color: 'white',
              border: 'none',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Export Excel
          </button>
        )}
      </div>

      {results.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              {
                label: 'Material accounts',
                value: results.filter((r) => r.isMaterial).length,
                color: '#A32D2D',
              },
              {
                label: 'Largest increase',
                value: fmt(Math.max(...results.map((r) => r.variance))),
                color: '#3B6D11',
              },
              {
                label: 'Largest decrease',
                value: fmt(Math.min(...results.map((r) => r.variance))),
                color: '#A32D2D',
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  flex: 1,
                  minWidth: 140,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'var(--color-background-secondary, #F1F5F9)',
                  border: '0.5px solid var(--color-border-tertiary, #E2E8F0)',
                }}
              >
                <div style={{ fontSize: 20, fontWeight: 500, color: s.color }}>{s.value}</div>
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
                  {['Account', 'Current', 'Prior', 'Variance', 'Var %', 'Material', 'AI Commentary'].map(
                    (h) => (
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
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {results.map((row, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: '1px solid #E2E8F0',
                      background: row.isMaterial ? '#FCEBEB' : 'transparent',
                    }}
                  >
                    <td
                      style={{
                        padding: '8px 10px',
                        fontWeight: row.isMaterial ? 500 : 400,
                      }}
                    >
                      {row.account}
                    </td>
                    <td style={{ padding: '8px 10px' }}>{fmt(row.currentPeriod)}</td>
                    <td style={{ padding: '8px 10px' }}>{fmt(row.priorPeriod)}</td>
                    <td
                      style={{
                        padding: '8px 10px',
                        color: row.variance > 0 ? '#3B6D11' : '#A32D2D',
                        fontWeight: 500,
                      }}
                    >
                      {row.variance > 0 ? '+' : ''}
                      {fmt(row.variance)}
                    </td>
                    <td
                      style={{
                        padding: '8px 10px',
                        color: Math.abs(row.variancePct) > materialityPct ? '#A32D2D' : 'inherit',
                      }}
                    >
                      {row.variancePct > 0 ? '+' : ''}
                      {row.variancePct.toFixed(1)}%
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {row.isMaterial && (
                        <span style={{ color: '#A32D2D', fontWeight: 500 }}>YES</span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: '8px 10px',
                        fontSize: 11,
                        color: 'var(--color-text-secondary, #64748B)',
                        maxWidth: 300,
                      }}
                    >
                      {row.aiCommentary}
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
