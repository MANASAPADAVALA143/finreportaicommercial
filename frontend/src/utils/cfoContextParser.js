/**
 * Parse CFO Services Context from Excel sheet rows.
 * Used by UploadData (central upload) and CFOServices (in-page upload).
 */
import * as XLSX from 'xlsx';
export function parseCFOServicesContextFromRows(rows, fileName) {
    if (!rows?.length)
        return null;
    const get = (row, ...keys) => {
        for (const k of keys) {
            const v = row[k];
            if (v !== undefined && v !== null && v !== '')
                return String(v).trim();
        }
        return '';
    };
    const getByKeyword = (row, ...keywords) => {
        const key = Object.keys(row).find((k) => keywords.some((kw) => k.toLowerCase().includes(kw.toLowerCase())));
        if (!key)
            return '';
        const v = row[key];
        if (v === undefined || v === null || v === '')
            return '';
        return String(v).trim();
    };
    const getNum = (row, ...keys) => {
        const v = get(row, ...keys);
        const n = parseFloat(String(v).replace(/[₹,%\s]/g, ''));
        return Number.isFinite(n) ? n : 0;
    };
    const getNumByKeyword = (row, ...keywords) => {
        const key = Object.keys(row).find((k) => keywords.some((kw) => k.toLowerCase().includes(kw.toLowerCase())));
        if (!key)
            return 0;
        const v = row[key];
        if (v === undefined || v === null || v === '')
            return 0;
        const n = parseFloat(String(v).replace(/[₹,%\s]/g, ''));
        return Number.isFinite(n) ? n : 0;
    };
    const section = (name) => (row) => get(row, 'Section', 'Category', 'Type').toLowerCase().includes(name.toLowerCase().replace(/\s+/g, ' ').slice(0, 15));
    const hasKey = (row, ...keys) => keys.some((k) => row[k] !== undefined && row[k] !== null && row[k] !== '');
    const aiRows = rows.filter((r) => section('AI Assistant')(r) || (!get(r, 'Section', 'Category') && get(r, 'Metric', 'Name', 'Key', 'Label')));
    let kpiRows = rows.filter((r) => section('KPI')(r) || get(r, 'KPI', 'kpi', 'KPI Name', 'Metric', 'Name', 'Company Name'));
    if (kpiRows.length === 0)
        kpiRows = rows.filter((r) => (hasKey(r, 'Current', 'Threshold', 'Value', 'Actual', 'Target', 'Score') && hasKey(r, 'KPI', 'kpi', 'Metric', 'Name', 'Company Name', 'Label')) || (hasKey(r, 'KPI', 'kpi') && hasKey(r, 'Threshold', 'Critical', 'Warning', 'Target')));
    if (kpiRows.length === 0) {
        kpiRows = rows.filter((r) => {
            const hasLabel = get(r, 'KPI', 'kpi', 'Metric', 'Name', 'Company Name', 'Label') || getByKeyword(r, 'kpi', 'metric', 'name', 'label');
            const hasNum = getNumByKeyword(r, 'current', 'actual', 'value', 'score', 'threshold', 'target', 'amount') !== 0 || getNum(r, 'Current', 'Value', 'Actual', 'Threshold', 'Target') !== 0;
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
        const current = getNum(r, 'Current', 'Value', 'Actual', 'Actual Value', 'Current Value', 'Score', 'Amount')
            || getNumByKeyword(r, 'current', 'actual', 'value', 'score', 'amount');
        const threshold = getNum(r, 'Threshold', 'Target', 'Critical', 'Warning', 'Limit', 'Budget', 'Goal', 'Max', 'Min')
            || getNumByKeyword(r, 'threshold', 'target', 'critical', 'warning', 'limit', 'budget', 'goal');
        const severity = (get(r, 'Severity', 'Alert', 'Status').toLowerCase().includes('critical') ? 'critical' : 'warning');
        return {
            id: `cfo-alert-${i + 1}`,
            kpi: kpi || `KPI ${i + 1}`,
            current,
            threshold: threshold || current || 0,
            severity,
            message: get(r, 'Message', 'Description') || `${kpi}: ${current} vs threshold ${threshold}`,
            recommendation: get(r, 'Recommendation', 'Action') || 'Review and take action.',
            triggeredAt: new Date().toISOString(),
        };
    });
    let healthScore = {
        overall: 72,
        grade: 'B',
        components: { profitability: 72, liquidity: 81, efficiency: 68, growth: 74, stability: 55 },
        trend: 'stable',
        benchmarkVsIndustry: 70,
        aiSummary: 'Financial health from CFO Services Context upload.',
    };
    if (healthRows.length) {
        const first = healthRows[0];
        const overall = getNum(first, 'Overall', 'Score', 'Total');
        const grade = get(first, 'Grade', 'grade') || 'B';
        healthScore = {
            overall: overall || 72,
            grade: grade.toUpperCase().slice(0, 1) || 'B',
            components: {
                profitability: getNum(first, 'Profitability', 'profitability') || 72,
                liquidity: getNum(first, 'Liquidity', 'liquidity') || 81,
                efficiency: getNum(first, 'Efficiency', 'efficiency') || 68,
                growth: getNum(first, 'Growth', 'growth') || 74,
                stability: getNum(first, 'Risk', 'Stability', 'stability', 'risk') || 55,
            },
            trend: (get(first, 'Trend', 'trend') || 'stable').toLowerCase(),
            benchmarkVsIndustry: getNum(first, 'Benchmark', 'benchmarkVsIndustry') || 70,
            aiSummary: get(first, 'AI Summary', 'aiSummary', 'Summary') || healthScore.aiSummary,
        };
    }
    const strategicInsightsSeeds = insightRows.slice(0, 6).map((r, i) => ({
        id: `seed-${i + 1}`,
        priority: (get(r, 'Priority', 'P1', 'P2', 'P3').toUpperCase().slice(0, 2) || 'P2'),
        category: get(r, 'Category', 'category') || 'risk',
        trigger: get(r, 'Trigger', 'Description', 'Summary', 'Title') || '',
        impact: get(r, 'Impact', 'impact'),
        urgency: get(r, 'Urgency', 'urgency'),
    }));
    return {
        aiAssistantContext: aiAssistantContext || 'Company financial context from upload.',
        kpiAlerts: kpiAlerts.length ? kpiAlerts : [],
        healthScore,
        strategicInsightsSeeds,
        fileName,
    };
}
const CFO_SHEET_KEYWORDS = ['cfo_services', 'context', 'services', 'cfo services'];
/** Parse CFO Services Context from an Excel/CSV file. Looks for a sheet matching CFO_Services_Context (or similar). */
export async function parseCFOServicesContextFromFile(file) {
    const data = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(data, { type: 'array' });
    const sheetName = wb.SheetNames.find((n) => CFO_SHEET_KEYWORDS.some((k) => n.toLowerCase().includes(k.toLowerCase())));
    if (!sheetName)
        return null;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
    return parseCFOServicesContextFromRows(rows, file.name);
}
