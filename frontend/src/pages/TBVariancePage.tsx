import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useClient } from '../context/ClientContext';

type VarianceImpact = 'favorable' | 'unfavorable' | 'neutral';

interface TBRow {
  account: string;
  accountCode: string;
  currentPeriod: number;
  priorPeriod: number;
  variance: number;
  /** null when both zero or prior is zero (new account — % not meaningful) */
  variancePct: number | null;
  isMaterial: boolean;
  impact: VarianceImpact;
  aiCommentary?: string;
}

const INDUSTRY_OPTIONS: { value: string; label: string }[] = [
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'services', label: 'Services / IT' },
  { value: 'trading', label: 'Trading / Distribution' },
  { value: 'real_estate', label: 'Real Estate / Construction' },
  { value: 'financial_services', label: 'Financial Services / NBFC' },
  { value: 'healthcare', label: 'Healthcare / Pharma' },
  { value: 'technology', label: 'Technology / SaaS' },
  { value: 'general', label: 'General / Other' },
];

/** P&L-style favourable / unfavourable from account wording + variance sign (TB net balances). */
function varianceImpact(account: string, variance: number): VarianceImpact {
  if (Math.abs(variance) < 1e-9) return 'neutral';
  const a = account.toLowerCase();

  const costLike =
    /\b(cost of sales|cost of goods|cogs|expense|salary|wage|payroll|depreciation|amorti[sz]ation|rent|overhead|marketing|administrative|finance cost|interest expense|tax expense|employee benefit|utilities)\b/.test(
      a
    ) || (/\bcost\b/.test(a) && /\b(revenue|sales|goods|service)\b/.test(a));

  const revenueLike =
    /\b(revenue|sales|turnover|subscription|mrr|arr|fee income|service income|interest income|other income)\b/.test(
      a
    ) && !costLike;

  const liabilityLike =
    /\b(payable|payables|creditor|borrow|borrowing|lease liability|deferred revenue|contract liabilit|tax liability|accrual)\b/.test(
      a
    ) && !/\breceivable\b/.test(a);

  const assetLike =
    /\b(receivable|receivables|inventory|stock|prepayment|ppe|plant|property|goodwill|intangible|cash at bank|bank balance|deposit|investment in)\b/.test(
      a
    );

  if (revenueLike) return variance > 0 ? 'favorable' : 'unfavorable';
  if (costLike) return variance < 0 ? 'favorable' : 'unfavorable';
  if (liabilityLike) return variance < 0 ? 'favorable' : 'unfavorable';
  if (assetLike) return 'neutral';
  return 'neutral';
}

function impactDisplay(impact: VarianceImpact): { label: string; bg: string; color: string; icon: string } {
  if (impact === 'favorable')
    return { label: 'Favorable', bg: '#DCFCE7', color: '#166534', icon: '✅' };
  if (impact === 'unfavorable')
    return { label: 'Unfavorable', bg: '#FEE2E2', color: '#991B1B', icon: '❌' };
  return { label: 'Neutral', bg: '#F1F5F9', color: '#64748B', icon: '—' };
}

function parseNumeric(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = String(val)
    .replace(/[,₹$\s£€\u00a0\u2009\u202f\u2212]/g, '')
    .replace(/[()[\]]/g, '')
    .trim()
    .replace(/^−/, '-');
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

type ColumnKeys = {
  codeKey: string;
  nameKey: string | null;
  debitKey: string | null;
  creditKey: string | null;
  balanceKey: string | null;
};

/** Lowercase letters only — "Debit (₹)" → "debit", "Credit (₹)" → "credit" */
function alphaNorm(header: string): string {
  return header.toLowerCase().replace(/[^a-z]/g, '');
}

/** First column whose normalized header contains any keyword (keywords also letter-stripped). */
function findCol(keys: string[], keywords: string[]): string | null {
  const kws = keywords.map((kw) => kw.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean);
  for (const k of keys) {
    const norm = alphaNorm(k);
    if (!norm) continue;
    for (const kw of kws) {
      if (kw && norm.includes(kw)) return k;
    }
  }
  return null;
}

function detectColumnsFromKeys(keys: string[]): ColumnKeys {
  const debitKey =
    keys.find((k) => {
      const a = alphaNorm(k);
      return (a.includes('debit') || a === 'dr' || a.endsWith('dr')) && !a.includes('credit');
    }) ?? findCol(keys, ['debit', 'dr']);

  const creditKey =
    keys.find((k) => {
      const a = alphaNorm(k);
      return a.includes('credit') || a === 'cr' || a.endsWith('cr');
    }) ?? findCol(keys, ['credit', 'cr']);

  const codeKey =
    findCol(keys, ['accountcode', 'acctcode', 'glcode']) ||
    keys.find((k) => {
      const a = alphaNorm(k);
      return a.includes('code') && !a.includes('posting');
    }) ||
    keys[0];

  const balanceKey =
    keys.find((k) => {
      const a = alphaNorm(k);
      return (
        (a.includes('balance') || a === 'amount' || (a.includes('amount') && !a.includes('debit'))) &&
        !a.includes('debit') &&
        !a.includes('credit')
      );
    }) ?? null;

  const nameKey =
    (findCol(keys, ['accountname', 'ledgername', 'particulars']) ||
      keys.find((k) => {
        const a = alphaNorm(k);
        return (
          (a.includes('description') || (a.includes('name') && !a.includes('code'))) &&
          !a.includes('accountcode')
        );
      })) ??
    null;

  return {
    codeKey,
    nameKey,
    debitKey: debitKey ?? null,
    creditKey: creditKey ?? null,
    balanceKey,
  };
}

function detectColumns(sampleRow: Record<string, unknown>): ColumnKeys {
  return detectColumnsFromKeys(Object.keys(sampleRow));
}

/** When row 1 is a title (not headers), find the header row and build objects with real column names. */
function sheetToJsonWithHeaderRow(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  const direct = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  if (direct.length) {
    const cols0 = detectColumnsFromKeys(Object.keys(direct[0]));
    if (cols0.debitKey && cols0.creditKey) return direct;
  }

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
  if (!aoa?.length) return direct;

  let bestI = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(30, aoa.length); i++) {
    const cells = (aoa[i] || []).map((c) => String(c ?? '').trim());
    const joined = cells.join(' ').toLowerCase();
    let score = 0;
    if (joined.includes('debit')) score += 2;
    if (joined.includes('credit')) score += 2;
    if (joined.includes('account') && joined.includes('code')) score += 3;
    score += cells.filter(Boolean).length * 0.001;
    if (score > bestScore) {
      bestScore = score;
      bestI = i;
    }
  }

  const hdr = (aoa[bestI] || []).map((c, j) => {
    const s = String(c ?? '').trim();
    return s || `__COL_${j}`;
  });
  const out: Record<string, unknown>[] = [];
  for (let r = bestI + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const obj: Record<string, unknown> = {};
    hdr.forEach((h, j) => {
      obj[h] = row[j] ?? '';
    });
    out.push(obj);
  }
  return out.length ? out : direct;
}

/** Real TB line: code present and contains a digit (skips section headers like "NON-CURRENT ASSETS"). */
function isDataRow(row: Record<string, unknown>, codeKey: string): boolean {
  const code = row[codeKey];
  if (code === null || code === undefined) return false;
  const s = String(code).trim();
  if (!s) return false;
  if (!/\d/.test(s)) return false;
  return true;
}

function netAmountForRow(row: Record<string, unknown>, cols: ColumnKeys): number {
  const d = cols.debitKey ? parseNumeric(row[cols.debitKey]) : 0;
  const c = cols.creditKey ? parseNumeric(row[cols.creditKey]) : 0;
  if (cols.debitKey && cols.creditKey) return d - c;
  if (cols.balanceKey) return parseNumeric(row[cols.balanceKey]);
  const keys = Object.keys(row);
  const amtKey =
    keys.find((k) => {
      const a = alphaNorm(k);
      return (
        a.includes('amount') ||
        a.includes('balance') ||
        a.includes('value') ||
        a.includes('closing')
      );
    }) || keys[1];
  return parseNumeric(row[amtKey]);
}

function variancePct(current: number, prior: number): number | null {
  if (prior === 0 && current === 0) return null;
  if (prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function pickTrialBalanceSheet(wb: { SheetNames: string[]; Sheets: XLSX.WorkSheets }, periodHint: 'current' | 'prior'): string {
  const names = wb.SheetNames;
  const lower = names.map((n) => n.toLowerCase());
  if (periodHint === 'current') {
    const idx = lower.findIndex(
      (n) =>
        n.includes('current') ||
        n.includes('fy2026') ||
        n.includes('2026') ||
        n.includes('tb_fy2026')
    );
    if (idx >= 0) return names[idx];
  } else {
    const idx = lower.findIndex(
      (n) =>
        n.includes('prior') ||
        n.includes('fy2025') ||
        n.includes('2025') ||
        n.includes('tb_fy2025')
    );
    if (idx >= 0) return names[idx];
  }
  let best = names[0];
  let bestScore = -1;
  for (const sn of names) {
    const ws = wb.Sheets[sn];
    const rows = sheetToJsonWithHeaderRow(ws);
    if (rows.length === 0) continue;
    const cols = detectColumns(rows[0]);
    const hdr = Object.keys(rows[0] || {})
      .join('|')
      .toLowerCase();
    let score = rows.length;
    if (hdr.includes('debit') && hdr.includes('credit')) score += 200;
    if (hdr.includes('account') && hdr.includes('code')) score += 100;
    if (cols.debitKey && cols.creditKey) score += 150;
    if (score > bestScore) {
      bestScore = score;
      best = sn;
    }
  }
  return best;
}

function displayAccountLabel(
  row: Record<string, unknown>,
  cols: ColumnKeys
): { code: string; label: string } {
  const code = String(row[cols.codeKey] ?? '').trim();
  const name = cols.nameKey ? String(row[cols.nameKey] ?? '').trim() : '';
  const label = name ? `${code} ${name}`.replace(/\s+/g, ' ').trim() : code;
  return { code, label };
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
  const [parseWarning, setParseWarning] = useState<string | null>(null);
  /** When false, table lists only material rows (matches “12–15 accounts” review list). */
  const [showAllNonZero, setShowAllNonZero] = useState(false);
  const [industryKey, setIndustryKey] = useState('manufacturing');
  const [companyName, setCompanyName] = useState('');
  const currency = activeClient?.currency || 'INR';

  useEffect(() => {
    setCompanyName(activeClient?.name ?? '');
  }, [activeClient?.id]);

  const tableRows = useMemo(() => {
    if (showAllNonZero) return results;
    return results.filter((r) => r.isMaterial);
  }, [results, showAllNonZero]);

  const readTB = (
    file: File,
    periodHint: 'current' | 'prior'
  ): Promise<Record<string, { net: number; label: string }>> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const buf = e.target?.result;
          if (!buf) {
            resolve({});
            return;
          }
          const wb = XLSX.read(buf, { type: 'array' });
          const sheetName = pickTrialBalanceSheet(wb, periodHint);
          const ws = wb.Sheets[sheetName];
          if (!ws) {
            resolve({});
            return;
          }
          const data = sheetToJsonWithHeaderRow(ws);
          if (!data.length) {
            resolve({});
            return;
          }
          const cols = detectColumns(data[0]);
          const map: Record<string, { net: number; label: string }> = {};
          for (const row of data) {
            if (!isDataRow(row, cols.codeKey)) continue;
            const { code, label } = displayAccountLabel(row, cols);
            const normCode = code.trim();
            if (!normCode) continue;
            const net = netAmountForRow(row, cols);
            const prevEntry = map[normCode];
            if (!prevEntry) {
              map[normCode] = { net, label: label || normCode };
            } else {
              prevEntry.net += net;
              if (label.length > prevEntry.label.length) prevEntry.label = label;
            }
          }
          resolve(map);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  };

  const analyse = async () => {
    if (!currentFile || !priorFile) return;
    setLoading(true);
    setParseWarning(null);
    try {
      const [currentMap, priorMap] = await Promise.all([
        readTB(currentFile, 'current'),
        readTB(priorFile, 'prior'),
      ]);
      const allCodes = new Set([...Object.keys(currentMap), ...Object.keys(priorMap)]);
      const rows: TBRow[] = [];

      allCodes.forEach((accountCode) => {
        const curr = currentMap[accountCode]?.net ?? 0;
        const prev = priorMap[accountCode]?.net ?? 0;
        if (curr === 0 && prev === 0) return;

        const variance = curr - prev;
        const vp = variancePct(curr, prev);
        const isMaterial =
          Math.abs(variance) >= materiality ||
          (vp !== null && Math.abs(vp) >= materialityPct);

        const label =
          currentMap[accountCode]?.label ||
          priorMap[accountCode]?.label ||
          accountCode;

        rows.push({
          accountCode,
          account: label,
          currentPeriod: curr,
          priorPeriod: prev,
          variance,
          variancePct: vp,
          isMaterial,
          impact: varianceImpact(label, variance),
        });
      });

      rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

      if (rows.length === 0) {
        const c = Object.keys(currentMap).length;
        const p = Object.keys(priorMap).length;
        setResults([]);
        setParseWarning(
          c === 0 && p === 0
            ? 'No data rows found. Use sheets with headers: Account Code, Debit, Credit (or a balance column). Section-only rows (no numeric code) are skipped. Try exporting the TB sheet to CSV and uploading that.'
            : `Found ${c} account code(s) in current file and ${p} in prior, but all net to zero after Debit−Credit. Check column names (Debit/Credit) and that amounts are numeric.`
        );
        return;
      }

      // Show the table immediately — do not block on Gemini (was causing a blank screen with no API key or slow network).
      setResults(rows);

      const material = rows.filter((r) => r.isMaterial).slice(0, 12);
      const apiBase = String(import.meta.env.VITE_API_URL || '')
        .trim()
        .replace(/\/$/, '');
      if (!apiBase || material.length === 0) return;

      const industry = industryKey;
      const company = companyName.trim();

      void (async () => {
        for (const target of material) {
          try {
            const res = await fetch(`${apiBase}/api/fpa/variance/tb-line-commentary`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                account_name: target.account,
                current: target.currentPeriod,
                prior: target.priorPeriod,
                variance: target.variance,
                variance_pct: target.variancePct,
                currency,
                industry,
                company_name: company,
              }),
            });
            if (!res.ok) continue;
            const data = (await res.json()) as { commentary?: string };
            const commentary = typeof data.commentary === 'string' ? data.commentary.trim() : '';
            if (!commentary) continue;
            setResults((prev) =>
              prev.map((r) =>
                r.accountCode === target.accountCode ? { ...r, aiCommentary: commentary } : r
              )
            );
          } catch {
            /* skip */
          }
        }
      })();
    } catch (err) {
      console.error(err);
      setResults([]);
      setParseWarning(null);
      alert(err instanceof Error ? err.message : 'Could not read trial balance files.');
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = () => {
    const data = results.map((r) => ({
      'Account Code': r.accountCode,
      Account: r.account,
      'Current Period': r.currentPeriod,
      'Prior Period': r.priorPeriod,
      Variance: r.variance,
      'Variance %': r.variancePct === null ? '—' : `${r.variancePct.toFixed(1)}%`,
      Material: r.isMaterial ? 'YES' : 'NO',
      Impact: impactDisplay(r.impact).label,
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
    const body = Math.abs(n).toLocaleString();
    if (n < 0) return `-${s}${body}`;
    return `${s}${body}`;
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
            {activeClient?.name} · Upload current and prior TB (Excel or CSV). Multi-sheet Excel: chooses sheets
            named like Current/FY2026 and Prior/FY2025 when present; nets Debit − Credit; skips section header rows
            without numeric account codes.
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

      <div
        style={{
          marginBottom: 16,
          padding: 16,
          borderRadius: 10,
          background: 'white',
          border: '1px solid #E2E8F0',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#0F172A' }}>
          Company context (improves AI commentary)
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(200px, 1fr) minmax(220px, 1fr)',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>
              Industry
            </label>
            <select
              value={industryKey}
              onChange={(e) => setIndustryKey(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid #E2E8F0',
                fontSize: 13,
                background: 'white',
              }}
            >
              {INDUSTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>
              Company
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Prism Manufacturing"
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid #E2E8F0',
                fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
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
            {loading ? 'Analysing...' : '🔍 Analyse variances'}
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
      </div>

      {parseWarning && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            borderRadius: 10,
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            fontSize: 13,
            color: '#991B1B',
            lineHeight: 1.5,
          }}
        >
          {parseWarning}
        </div>
      )}

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
                value:
                  results.length > 0
                    ? fmt(Math.max(...results.map((r) => r.variance)))
                    : '—',
                color: '#3B6D11',
              },
              {
                label: 'Largest decrease',
                value:
                  results.length > 0
                    ? fmt(Math.min(...results.map((r) => r.variance)))
                    : '—',
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

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
              fontSize: 13,
              cursor: 'pointer',
              color: 'var(--color-text-secondary, #64748B)',
            }}
          >
            <input
              type="checkbox"
              checked={showAllNonZero}
              onChange={(e) => setShowAllNonZero(e.target.checked)}
            />
            Show all non-zero accounts (not only material)
          </label>
          {results.length > 0 && tableRows.length === 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 8,
                background: '#FFFBEB',
                border: '1px solid #FDE68A',
                fontSize: 13,
                color: '#92400E',
              }}
            >
              No accounts meet your materiality (INR / %). Lower thresholds or tick “Show all non-zero
              accounts”.
            </div>
          )}
          {results.length > 0 && (
            <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8 }}>
              Showing {tableRows.length} of {results.length} account{results.length === 1 ? '' : 's'} with at
              least one non-zero period
              {!showAllNonZero ? ' (material only)' : ''}.
            </div>
          )}

          <div style={{ overflowX: 'auto', background: 'white', borderRadius: 10, border: '1px solid #E2E8F0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--color-background-secondary, #F1F5F9)' }}>
                  {[
                    'Account',
                    'Current',
                    'Prior',
                    'Variance',
                    'Var %',
                    'Material',
                    'Impact',
                    'AI Commentary',
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
                {tableRows.map((row, i) => (
                  <tr
                    key={`${row.accountCode}-${i}`}
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
                        color:
                          row.variancePct !== null &&
                          Math.abs(row.variancePct) > materialityPct
                            ? '#A32D2D'
                            : 'inherit',
                      }}
                    >
                      {row.variancePct === null
                        ? '—'
                        : `${row.variancePct > 0 ? '+' : ''}${row.variancePct.toFixed(1)}%`}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {row.isMaterial && (
                        <span style={{ color: '#A32D2D', fontWeight: 500 }}>YES</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {(() => {
                        const im = impactDisplay(row.impact);
                        return (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 8px',
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 500,
                              background: im.bg,
                              color: im.color,
                            }}
                          >
                            <span aria-hidden>{im.icon}</span>
                            {im.label}
                          </span>
                        );
                      })()}
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
