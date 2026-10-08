import { useCallback, useEffect, useState } from 'react';
import { fetchActiveTaxPeriod } from '../services/gulfTaxApi';
import { getStoredWorkspaceId } from '../services/workspaceService';

/**
 * Single selected VAT period ("YYYY-Qn") shared by Classifier, VAT Return, Recon,
 * Dashboard and Invoice Flow. Defaults to the backend's data-driven period
 * (quarter of the latest invoice/transaction), never to today's quarter alone.
 */

const CHANGE_EVENT = 'gulftax:period_changed';
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const QUARTER_MONTHS = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'];

function storageKey(): string {
  const ws = localStorage.getItem('active_workspace_id') || getStoredWorkspaceId() || 'default';
  return `gulftax_tax_period:${ws}`;
}

export function getSelectedTaxPeriod(): string | null {
  const v = localStorage.getItem(storageKey());
  return v && QUARTER_RE.test(v) ? v : null;
}

export function quarterBounds(period: string): { start: string; end: string } | null {
  const m = QUARTER_RE.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  const pad = (n: number) => String(n).padStart(2, '0');
  const startMonth = 3 * (q - 1) + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(year, endMonth, 0).getDate();
  return { start: `${year}-${pad(startMonth)}-01`, end: `${year}-${pad(endMonth)}-${pad(lastDay)}` };
}

export function quarterLabel(period: string): string {
  const m = QUARTER_RE.exec(period);
  if (!m) return period;
  return `${m[1]} Q${m[2]} ${QUARTER_MONTHS[Number(m[2]) - 1]}`;
}

/** Last two calendar years plus the selected period if it falls outside them, newest first. */
export function quarterOptions(selected?: string | null): { value: string; label: string }[] {
  const currentYear = new Date().getFullYear();
  const values = new Set<string>();
  for (let year = currentYear - 1; year <= currentYear; year++) {
    for (let q = 1; q <= 4; q++) values.add(`${year}-Q${q}`);
  }
  if (selected && QUARTER_RE.test(selected)) values.add(selected);
  return Array.from(values)
    .sort()
    .reverse()
    .map((value) => ({ value, label: quarterLabel(value) }));
}

export function useGulfTaxPeriod() {
  const [period, setPeriodState] = useState<string | null>(() => getSelectedTaxPeriod());

  useEffect(() => {
    if (period) return;
    let cancelled = false;
    fetchActiveTaxPeriod()
      .then((res) => {
        if (cancelled || getSelectedTaxPeriod()) return;
        localStorage.setItem(storageKey(), res.tax_period);
        setPeriodState(res.tax_period);
      })
      .catch(() => {
        if (cancelled) return;
        const d = new Date();
        setPeriodState(`${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  useEffect(() => {
    const sync = () => {
      const next = getSelectedTaxPeriod();
      if (next) setPeriodState(next);
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setPeriod = useCallback((next: string) => {
    if (!QUARTER_RE.test(next)) return;
    localStorage.setItem(storageKey(), next);
    setPeriodState(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const bounds = period ? quarterBounds(period) : null;
  return {
    period,
    setPeriod,
    periodStart: bounds?.start,
    periodEnd: bounds?.end,
    label: period ? quarterLabel(period) : null,
    ready: Boolean(period),
  };
}
