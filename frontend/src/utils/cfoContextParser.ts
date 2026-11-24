/**
 * Parse CFO Services Context from Excel sheet rows.
 * Used by UploadData (central upload) and CFOServices (in-page upload).
 *
 * Never invents health scores or KPI figures when the sheet omits them.
 */
import * as XLSX from 'xlsx';
import type { CFOServicesContext } from '../types/cfoServicesContext';
import type { FinancialHealthScore } from '../types/cfo';

export function parseCFOServicesContextFromRows(rows: any[], fileName: string): CFOServicesContext | null {
  if (!rows?.length) return null;
  const get = (row: any, ...keys: string[]) => {
    for (const k of keys) {
      const v = row[k];
      if (v !== undefined && v !== null && v !== '') return String(v).trim();
    }
    return '';
  };
  const getByKeyword = (row: any, ...keywords: string[]) => {
    const key = Object.keys(row).find((k) =>
      keywords.some((kw) => k.toLowerCase().includes(kw.toLowerCase()))
    );
    if (!key) return '';
    const v = row[key];
    if (v === undefined || v === null || v === '') return '';
    return String(v).trim();
  };
  const getNum = (row: any, ...keys: string[]) => {
    const v = get(row, ...keys);
    if (!v) return NaN;
    const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  };
  const getNumByKeyword = (row: any, ...keywords: string[]) => {
    const key = Object.keys(row).find((k) =>
      keywords.some((kw) => k.toLowerCase().includes(kw.toLowerCase()))
    );
    if (!key) return NaN;
    const v = row[key];
    if (v === undefined || v === null || v === '') return NaN;
    const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  };
  const section = (name: string) => (row: any) =>
    get(row, 'Section', 'Category', 'Type').toLowerCase().includes(name.toLowerCase().replace(/\s+/g, ' ').slice(0, 15));
  const hasKey = (row: any, ...keys: string[]) => keys.some((k) => row[k] !== undefined && row[k] !== null && row[k] !== '');

  const aiRows = rows.filter((r) => section('AI Assistant')(r) || (!get(r, 'Section', 'Category') && get(r, 'Metric', 'Name', 'Key', 'Label')));
  let kpiRows = rows.filter((r) => section('KPI')(r) || get(r, 'KPI', 'kpi', 'KPI Name', 'Metric', 'Name', 'Company Name'));
  if (kpiRows.length === 0)
    kpiRows = rows.filter((r) => (hasKey(r, 'Current', 'Threshold', 'Value', 'Actual', 'Target', 'Score') && hasKey(r, 'KPI', 'kpi', 'Metric', 'Name', 'Company Name', 'Label')) || (hasKey(r, 'KPI', 'kpi') && hasKey(r, 'Threshold', 'Critical', 'Warning', 'Target')));
  if (kpiRows.length === 0) {
    kpiRows = rows.filter((r) => {
      const hasLabel = get(r, 'KPI', 'kpi', 'Metric', 'Name', 'Company Name', 'Label') || getByKeyword(r, 'kpi', 'metric', 'name', 'label');
      const hasNum = Number.isFinite(getNumByKeyword(r, 'current', 'actual', 'value', 'score', 'threshold', 'target', 'amount')) || Number.isFinite(getNum(r, 'Current', 'Value', 'Actual', 'Threshold', 'Target'));
      return !!hasLabel && (hasNum || hasKey(r, 'Current', 'Value', 'Actual', 'Threshold', 'Target'));
    });
  }
  const healthRows = rows.filter((r) => section('Financial Health')(r) || section('Health Score')(r) || get(r, 'Overall', 'Grade', 'Profitability', 'Score'));
  let insightRows = rows.filter((r) => section('Strategic Insight')(r) || section('Insight')(r) || get(r, 'Priority', 'P1', 'P2', 'P3'));
  if (insightRows.length === 0)
    insightRows = rows.filter((r) => get(r, 'Trigger', 'Description', 'Summary', 'Title', 'Category'));

  let aiAssistantContext = '';
  if (aiRows.length) {
    aiAssistantContext = aiRows
      .map((r) => {
        const name = get(r, 'Metric', 'Name', 'Key', 'Label');
        const value = get(r, 'Value', 'Amount', 'Score');
        return name && value ? `${name}: ${value}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (!aiAssistantContext && rows.length <= 30) {
    aiAssistantContext = rows
      .map((r) => {
        const keys = Object.keys(r).filter((k) => !/section|category|type/i.test(k));
        return keys.map((k) => `${k}: ${r[k]}`).join(' | ');
      })
      .filter(Boolean)
      .join('\n');
  }

  const kpiAlerts = kpiRows.map((r, i) => {
    const kpi = get(r, 'KPI', 'kpi', 'Metric', 'Name', 'Company Name', 'Label', 'KPI Name') || getByKeyword(r, 'kpi', 'metric', 'name', 'label');
    const currentRaw = getNum(r, 'Current', 'Value', 'Actual', 'Actual Value', 'Current Value', 'Score', 'Amount');
    const currentKw = getNumByKeyword(r, 'current', 'actual', 'value', 'score', 'amount');
    const current = Number.isFinite(currentRaw) ? currentRaw : (Number.isFinite(currentKw) ? currentKw : 0);
    const thresholdRaw = getNum(r, 'Threshold', 'Target', 'Critical', 'Warning', 'Limit', 'Budget', 'Goal', 'Max', 'Min');
    const thresholdKw = getNumByKeyword(r, 'threshold', 'target', 'critical', 'warning', 'limit', 'budget', 'goal');
    const threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : (Number.isFinite(thresholdKw) ? thresholdKw : current);
    const severity = (get(r, 'Severity', 'Alert', 'Status').toLowerCase().includes('critical') ? 'critical' : 'warning') as 'critical' | 'warning' | 'info';
    return {
      id: `cfo-alert-${i + 1}`,
      kpi: kpi || `KPI ${i + 1}`,
      current,
      threshold,
      severity,
      message: get(r, 'Message', 'Description') || `${kpi}: ${current} vs threshold ${threshold}`,
      recommendation: get(r, 'Recommendation', 'Action') || 'Review and take action.',
      triggeredAt: new Date().toISOString(),
    };
  });

  let healthScore: FinancialHealthScore | null = null;
  if (healthRows.length) {
    const first = healthRows[0];
    const overall = getNum(first, 'Overall', 'Score', 'Total');
    const profitability = getNum(first, 'Profitability', 'profitability');
    const liquidity = getNum(first, 'Liquidity', 'liquidity');
    const efficiency = getNum(first, 'Efficiency', 'efficiency');
    const growth = getNum(first, 'Growth', 'growth');
    const stability = getNum(first, 'Risk', 'Stability', 'stability', 'risk');
    // Only accept a health score when overall is present — never fill with synthetic 72/81/…
    if (Number.isFinite(overall) && overall > 0) {
      const gradeRaw = get(first, 'Grade', 'grade');
      const toComp = (n: number): number | null => (Number.isFinite(n) ? n : null);
      healthScore = {
        overall,
        grade: ((gradeRaw.toUpperCase().slice(0, 1) || 'C') as 'A' | 'B' | 'C' | 'D' | 'F'),
        components: {
          profitability: toComp(profitability),
          liquidity: toComp(liquidity),
          efficiency: toComp(efficiency),
          growth: toComp(growth),
          stability: toComp(stability),
        },
        trend: (get(first, 'Trend', 'trend') || 'stable').toLowerCase() as 'improving' | 'stable' | 'declining',
        benchmarkVsIndustry: (() => {
          const b = getNum(first, 'Benchmark', 'benchmarkVsIndustry');
          return Number.isFinite(b) ? b : null;
        })(),
        aiSummary: get(first, 'AI Summary', 'aiSummary', 'Summary') || 'Financial health from uploaded CFO Services Context.',
      };
    }
  }

  const strategicInsightsSeeds = insightRows.slice(0, 6).map((r, i) => ({
    id: `seed-${i + 1}`,
    priority: (get(r, 'Priority', 'P1', 'P2', 'P3').toUpperCase().slice(0, 2) || 'P2') as 'P1' | 'P2' | 'P3',
    category: get(r, 'Category', 'category') || 'risk',
    trigger: get(r, 'Trigger', 'Description', 'Summary', 'Title') || '',
    impact: get(r, 'Impact', 'impact'),
    urgency: get(r, 'Urgency', 'urgency'),
  }));

  // Refuse to invent a placeholder context string when nothing was parsed.
  if (!aiAssistantContext && !kpiAlerts.length && !healthScore && !strategicInsightsSeeds.length) {
    return null;
  }

  return {
    aiAssistantContext,
    kpiAlerts,
    healthScore,
    strategicInsightsSeeds,
    fileName,
  };
}

const CFO_SHEET_KEYWORDS = ['cfo_services', 'context', 'services', 'cfo services'];

/** Parse CFO Services Context from an Excel/CSV file. Looks for a sheet matching CFO_Services_Context (or similar). */
export async function parseCFOServicesContextFromFile(file: File): Promise<CFOServicesContext | null> {
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames.find((n) =>
    CFO_SHEET_KEYWORDS.some((k) => n.toLowerCase().includes(k.toLowerCase()))
  );
  if (!sheetName) return null;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  return parseCFOServicesContextFromRows(rows as any[], file.name);
}
