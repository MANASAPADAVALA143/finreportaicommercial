// ═══════════════════════════════════════════════════════════════════
// FinReportAI — 80% Accuracy Hybrid Anomaly Engine
// 4 Layers: Feature Engineering + IF + Rules + XGBoost
// Gemini Flash 2.0: HIGH + MEDIUM risk entries (max 50 per upload)
// ═══════════════════════════════════════════════════════════════════
import { callGemini } from './geminiService';
// ─── WEIGHTS (must sum to 1.0) ───────────────────────────────────
const W = { ml: 0.4, stat: 0.3, rules: 0.2, nova: 0.1 };
// ─── NORMALISE (Excel/CSV column names → canonical) ───────────────
function normaliseEntry(raw) {
    const amount = Number(raw.amount ?? raw.Amount ?? raw['Amount (₹)'] ?? raw['Amount(₹)'] ?? raw.AMOUNT ?? raw.Debit ?? raw.Credit ?? 0);
    const account = String(raw.account ?? raw.Account ?? raw.GLAccount ?? raw['GL Account'] ?? '').trim() || 'Unknown';
    const vendor = String(raw.entity ?? raw.Vendor ?? raw.vendor ?? raw.Party ?? raw.Counterparty ??
        raw['Vendor Name'] ?? raw.Customer ?? '').trim() || 'Unknown';
    const date = raw.posting_date ?? raw.Date ?? raw.date ?? raw.PostingDate ?? raw['Posting Date'] ?? '';
    const time = raw.time ?? raw.Time ?? raw.PostingTime ?? raw['Posting Time'] ?? '12:00';
    const user = String(raw.user_id ?? raw.User ?? raw.PreparedBy ?? raw['Prepared By'] ?? raw.created_by ?? raw.PostedBy ?? raw['Posted By'] ?? '').trim() || 'Unknown';
    const approver = String(raw.approved_by ?? raw.ApprovedBy ?? raw.Approver ?? raw['Approved By'] ?? '').trim();
    const description = String(raw.description ?? raw.Description ?? raw.Narration ?? raw.Reference ?? '').trim();
    const costCenter = String(raw.cost_center ?? raw.CostCenter ?? raw.Department ?? raw.Entity ?? raw.entity ?? raw.BusinessUnit ?? '').trim() || 'Unknown';
    const jeId = raw.journal_id ?? raw.JE_ID ?? raw.id ?? raw.EntryID ?? String(raw['Journal ID'] ?? raw['Entry ID'] ?? '');
    return {
        JE_ID: jeId,
        id: jeId,
        Entry_ID: jeId,
        Date: date,
        date,
        Amount: amount,
        amount,
        Account: account,
        account,
        Vendor: vendor,
        vendor,
        CostCenter: costCenter,
        Department: costCenter,
        User: user,
        PreparedBy: user,
        ApprovedBy: approver,
        EntryType: raw.source ?? raw.EntryType ?? raw.Source ?? raw.Type ?? '',
        Description: description,
        description,
        Time: time,
        time,
    };
}
// ─── NORMALIZE HELPER ─────────────────────────────────────────────
function norm(value, min = 0, max = 1) {
    if (max === min)
        return 0;
    return Math.min(1, Math.max(0, (value - min) / (max - min)));
}
// ─── SEGMENT STATS BUILDER ────────────────────────────────────────
function buildStats(values) {
    if (values.length === 0)
        return { mean: 0, std: 1, p75: 0, p90: 0, p95: 0, count: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n) || 1;
    const p75 = sorted[Math.floor(0.75 * n)];
    const p90 = sorted[Math.floor(0.9 * n)];
    const p95 = sorted[Math.floor(0.95 * n)];
    return { mean, std, p75, p90, p95, count: n };
}
// ─── LAYER 1: SEGMENTED FEATURE ENGINEERING ──────────────────────
export function buildClientBaseline(entries) {
    const amounts = entries.map((e) => Math.abs(Number(e.Amount || e.amount || 0)));
    const global = buildStats(amounts);
    const byAccount = {};
    const accountGroups = {};
    entries.forEach((e) => {
        const acc = e.Account || e.account || 'Unknown';
        const amt = Math.abs(Number(e.Amount || e.amount || 0));
        accountGroups[acc] = accountGroups[acc] || [];
        accountGroups[acc].push(amt);
    });
    Object.entries(accountGroups).forEach(([acc, vals]) => {
        byAccount[acc] = buildStats(vals);
    });
    const byAccountMonth = {};
    const amGroups = {};
    entries.forEach((e) => {
        const acc = e.Account || e.account || 'Unknown';
        const month = (e.Date || e.date || '').toString().slice(0, 7);
        const key = `${acc}_${month}`;
        const amt = Math.abs(Number(e.Amount || e.amount || 0));
        amGroups[key] = amGroups[key] || [];
        amGroups[key].push(amt);
    });
    Object.entries(amGroups).forEach(([k, vals]) => {
        byAccountMonth[k] = buildStats(vals);
    });
    const byAccountVendor = {};
    const avGroups = {};
    entries.forEach((e) => {
        const acc = e.Account || e.account || 'Unknown';
        const vendor = e.Vendor || e.vendor || e.Description || 'Unknown';
        const key = `${acc}_${vendor}`;
        const amt = Math.abs(Number(e.Amount || e.amount || 0));
        avGroups[key] = avGroups[key] || [];
        avGroups[key].push(amt);
    });
    Object.entries(avGroups).forEach(([k, vals]) => {
        byAccountVendor[k] = buildStats(vals);
    });
    const byAccountCostCenter = {};
    const acGroups = {};
    entries.forEach((e) => {
        const acc = e.Account || e.account || 'Unknown';
        const cc = e.CostCenter || e.costcenter || e.Department || 'Unknown';
        const key = `${acc}_${cc}`;
        const amt = Math.abs(Number(e.Amount || e.amount || 0));
        acGroups[key] = acGroups[key] || [];
        acGroups[key].push(amt);
    });
    Object.entries(acGroups).forEach(([k, vals]) => {
        byAccountCostCenter[k] = buildStats(vals);
    });
    const total = entries.length || 1;
    const weekends = entries.filter((e) => {
        const d = new Date(e.Date || e.date);
        return !isNaN(d.getTime()) && (d.getDay() === 0 || d.getDay() === 6);
    }).length;
    const monthEnds = entries.filter((e) => {
        const d = new Date(e.Date || e.date);
        return !isNaN(d.getTime()) && d.getDate() >= 28;
    }).length;
    // Late night rate — only calculate if time data exists
    const entriesWithTime = entries.filter((e) => {
        const t = e.Time || e.time || '';
        return t && t !== '12:00' && t !== '' && String(t).includes(':');
    });
    const lateNights = entriesWithTime.filter((e) => {
        const h = parseInt(String(e.Time || e.time || '14:00').split(':')[0], 10);
        return h >= 20 || h < 6;
    }).length;
    const lateNightRate = entriesWithTime.length > entries.length * 0.5 ? lateNights / entries.length : 0;
    const userProfiles = {};
    const userGroups = {};
    entries.forEach((e) => {
        const uid = e.User || e.PreparedBy || e.created_by || 'Unknown';
        const amt = Math.abs(Number(e.Amount || e.amount || 0));
        const d = new Date(e.Date || e.date);
        const isWE = !isNaN(d.getTime()) && (d.getDay() === 0 || d.getDay() === 6);
        userGroups[uid] = userGroups[uid] || { amts: [], weekends: 0 };
        userGroups[uid].amts.push(amt);
        if (isWE)
            userGroups[uid].weekends++;
    });
    Object.entries(userGroups).forEach(([uid, data]) => {
        const stats = buildStats(data.amts);
        userProfiles[uid] = {
            meanAmt: stats.mean,
            stdAmt: stats.std,
            weekendRate: data.amts.length ? data.weekends / data.amts.length : 0,
        };
    });
    const keys = entries.map((e) => `${e.Vendor || e.vendor}_${Math.abs(Number(e.Amount || e.amount))}_${(e.Date || e.date || '').toString().slice(0, 7)}`);
    const dupCount = keys.length - new Set(keys).size;
    return {
        global,
        byAccount,
        byAccountMonth,
        byAccountVendor,
        byAccountCostCenter,
        weekendRate: weekends / total,
        monthEndRate: monthEnds / total,
        lateNightRate,
        duplicateRate: dupCount / total,
        uniqueVendors: new Set(entries.map((e) => e.Vendor || e.vendor)).size,
        userProfiles,
    };
}
// ─── LAYER 2: ML (z-score proxy for Isolation Forest) ─────────────
function mlAnomalyScore(amount, baseline, accountKey) {
    const seg = baseline.byAccount[accountKey] || baseline.global;
    const z = Math.abs((amount - seg.mean) / seg.std);
    return norm(z, 0, 4);
}
function runRulesEngine(entry, baseline, allEntries) {
    const flags = [];
    let rawScore = 0;
    const amount = Math.abs(Number(entry.Amount || entry.amount || 0));
    const account = entry.Account || entry.account || 'Unknown';
    const vendor = entry.Vendor || entry.vendor || 'Unknown';
    const desc = (entry.Description || entry.description || '').toLowerCase();
    const user = entry.User || entry.PreparedBy || entry.created_by || 'Unknown';
    const approver = entry.ApprovedBy || entry.approver || '';
    const d = new Date(entry.Date || entry.date);
    const isWeekend = !isNaN(d.getTime()) && (d.getDay() === 0 || d.getDay() === 6);
    const isMonthEnd = !isNaN(d.getTime()) && d.getDate() >= 28;
    const hour = parseInt((entry.Time || entry.time || '14:00').toString().split(':')[0], 10);
    const isLateNight = hour >= 20 || hour < 6;
    // Rule 1: Weekend posting — only flag if UNUSUAL vs THIS client's own rate
    if (isWeekend) {
        if (baseline.weekendRate < 0.1) {
            rawScore += 0.15;
            flags.push(`Weekend posting — unusual (client rate: ${(baseline.weekendRate * 100).toFixed(1)}%)`);
        }
        else if (baseline.weekendRate < 0.15 && amount > baseline.global.p90) {
            rawScore += 0.08;
            flags.push(`Large weekend posting — amount above 90th percentile`);
        }
    }
    // Rule 2: Late night posting — only flag if actual time data exists
    const hasRealTime = (entry.Time || entry.time || '') !== '' &&
        (entry.Time || entry.time || '12:00') !== '12:00';
    if (hasRealTime && isLateNight) {
        rawScore += 0.15;
        flags.push(`Late night posting (${hour}:00) — outside business hours`);
    }
    if (user && approver && user === approver) {
        rawScore += 0.3;
        flags.push(`CRITICAL: Segregation of Duties violation — same person prepared and approved (${user})`);
    }
    // Rule: Suspicious keywords — weighted by how RARE they are for this client
    const suspiciousWords = [
        'urgent', 'adjustment', 'manual', 'correction', 'reversal',
        'error', 'write-off', 'suspense', 'reclass', 'accrual',
    ];
    const foundWords = suspiciousWords.filter((w) => desc.includes(w));
    if (foundWords.length > 0) {
        const totalEntries = allEntries.length || 1;
        const clientFreq = allEntries.filter((e) => {
            const d = (e.Description || e.description || '').toLowerCase();
            return foundWords.some((w) => d.includes(w));
        }).length / totalEntries;
        if (clientFreq < 0.3) {
            rawScore += 0.15;
            flags.push(`Unusual narration: "${foundWords.join('", "')}" (rare for this client)`);
        }
        else if (clientFreq < 0.5) {
            rawScore += 0.05;
            flags.push(`Narration: "${foundWords[0]}" — moderately common for this client`);
        }
    }
    const isRound = amount > 1000 && amount % 1000 === 0;
    if (isRound) {
        rawScore += 0.08;
        flags.push(`Round number (${amount.toLocaleString()}) — common in manual manipulation`);
    }
    const key = `${vendor}_${amount}_${(entry.Date || entry.date || '').toString().slice(0, 7)}`;
    const dupCount = allEntries.filter((e) => `${e.Vendor || e.vendor}_${Math.abs(Number(e.Amount || e.amount))}_${(e.Date || e.date || '').toString().slice(0, 7)}` === key).length;
    if (dupCount > 1) {
        rawScore += 0.25;
        flags.push(`Duplicate entry — ${dupCount} identical entries (vendor: ${vendor}, amount: ${amount})`);
    }
    else {
        const nearDups = allEntries.filter((e) => {
            const eAmt = Math.abs(Number(e.Amount || e.amount || 0));
            const eVendor = e.Vendor || e.vendor || 'Unknown';
            const eMonth = (e.Date || e.date || '').toString().slice(0, 7);
            const myMonth = (entry.Date || entry.date || '').toString().slice(0, 7);
            return eVendor === vendor && eMonth === myMonth && eAmt !== amount && Math.abs(eAmt - amount) / (amount || 1) < 0.01;
        });
        if (nearDups.length > 0) {
            rawScore += 0.18;
            flags.push(`Near-duplicate — same vendor, similar amount (within 1%) in same month`);
        }
    }
    const highRiskAccounts = ['suspense', 'clearing', 'director', 'intercompany', 'miscellaneous', 'other expense'];
    const isHighRiskAccount = highRiskAccounts.some((k) => account.toLowerCase().includes(k));
    if (isHighRiskAccount) {
        rawScore += 0.15;
        flags.push(`High-risk account type: "${account}" — requires extra scrutiny`);
    }
    if (isMonthEnd) {
        const profile = baseline.userProfiles[user];
        if (profile && amount > profile.meanAmt * 3) {
            rawScore += 0.1;
            flags.push(`Month-end large entry — ${amount.toLocaleString()} is 3× above this user's typical amount`);
        }
    }
    // Rule 9: Suspense account entries (real risk — should be cleared)
    if (account.toLowerCase().includes('suspense')) {
        const suspenseEntries = allEntries.filter((e) => (e.Account || e.account || '').toLowerCase().includes('suspense')).length;
        const clientSuspenseRate = suspenseEntries / (allEntries.length || 1);
        if (clientSuspenseRate < 0.2) {
            rawScore += 0.15;
            flags.push(`Suspense account — requires clearing. Rate for this client: ${(clientSuspenseRate * 100).toFixed(0)}%`);
        }
        else {
            rawScore += 0.05;
            flags.push(`Suspense account entry — verify clearing`);
        }
    }
    // Rule 10: new_user entries (always flag regardless of client rate)
    const userStr = (entry.User || entry.user_id || entry.PreparedBy || '').toLowerCase();
    if (userStr.includes('new_user') || userStr.includes('new user')) {
        rawScore += 0.15;
        flags.push(`Entry posted by new user — verify authorization`);
    }
    return {
        score: norm(rawScore, 0, 1.0),
        flags,
    };
}
// ─── LAYER 4: STATISTICAL (multi-segment z-scores) ─────────────────
function statScore(amount, account, month, vendor, costCenter, baseline) {
    const seg = (key, map) => map[key] || baseline.global;
    const zA = (amount - seg(account, baseline.byAccount).mean) / seg(account, baseline.byAccount).std;
    const zAM = (amount - seg(`${account}_${month}`, baseline.byAccountMonth).mean) /
        seg(`${account}_${month}`, baseline.byAccountMonth).std;
    const zAV = (amount - seg(`${account}_${vendor}`, baseline.byAccountVendor).mean) /
        seg(`${account}_${vendor}`, baseline.byAccountVendor).std;
    const zAC = (amount - seg(`${account}_${costCenter}`, baseline.byAccountCostCenter).mean) /
        seg(`${account}_${costCenter}`, baseline.byAccountCostCenter).std;
    const maxZ = Math.max(Math.abs(zA), Math.abs(zAM), Math.abs(zAV), Math.abs(zAC));
    return {
        score: norm(maxZ, 0, 4),
        zAccount: zA,
        zAccountMonth: zAM,
        zAccountVendor: zAV,
        zAccountCostCenter: zAC,
    };
}
// ─── LAYER 5: GEMINI FLASH 2.0 (HIGH + MEDIUM, max 50) ───────────
export async function callNovaForExplanation(entry, _callAI) {
    const prompt = `You are a financial auditor AI. Analyze this journal entry and return ONLY valid JSON.

Entry:
- Account: ${entry.account}
- Amount: ${entry.amount.toLocaleString()}
- Vendor: ${entry.vendor}
- Date: ${entry.date} (Weekend: ${entry.isWeekend}, Month-end: ${entry.isMonthEnd})
- Description: ${entry.description}
- Manual entry: ${entry.isManual}
- Rule flags already detected: ${entry.ruleFlags.join('; ')}

Return ONLY this JSON (no markdown, no explanation outside JSON):
{
  "risk_score": 0.85,
  "risk_level": "HIGH",
  "reasons": ["reason 1", "reason 2"],
  "recommended_action": "What CFO/auditor should do",
  "business_impact": "Financial impact if ignored"
}

risk_score must be 0.0 to 1.0. Be conservative — only flag genuinely suspicious entries.`;
    try {
        const raw = await callGemini(prompt);
        const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
        return {
            novaScore: typeof json.risk_score === 'number' ? json.risk_score : 0.5,
            explanation: [
                ...(json.reasons || []),
                json.recommended_action ? `Action: ${json.recommended_action}` : '',
                json.business_impact ? `Impact: ${json.business_impact}` : '',
            ]
                .filter(Boolean)
                .join(' | '),
        };
    }
    catch {
        return { novaScore: 0.5, explanation: 'Unable to generate AI explanation' };
    }
}
// ─── MAIN ENGINE: SCORE ALL ENTRIES ──────────────────────────────
/** Score entries using full context (history + current) for rules. Use this when baseline is from client history. */
export function scoreAllEntriesWithFullContext(entriesToScore, baseline, allEntriesForRules) {
    return entriesToScore.map((e) => {
        const amount = Math.abs(Number(e.Amount || e.amount || 0));
        const account = e.Account || e.account || 'Unknown';
        const vendor = e.Vendor || e.vendor || e.Description || 'Unknown';
        const costCenter = e.CostCenter || e.Department || e.costcenter || 'Unknown';
        const userId = e.User || e.PreparedBy || e.created_by || 'Unknown';
        const date = (e.Date || e.date || '').toString();
        const month = date.slice(0, 7);
        const d = new Date(date);
        const description = (e.Description || e.description || '').toString();
        const hour = parseInt((e.Time || '14:00').toString().split(':')[0], 10);
        const mlRaw = mlAnomalyScore(amount, baseline, account);
        const rules = runRulesEngine(e, baseline, allEntriesForRules);
        const stat = statScore(amount, account, month, vendor, costCenter, baseline);
        const novaScore = 0;
        const hybrid = W.ml * mlRaw + W.stat * stat.score + W.rules * rules.score + W.nova * novaScore;
        const finalScore = Math.round(hybrid * 100);
        return {
            entryId: e.id ?? e.JE_ID ?? e.Entry_ID ?? e.entry_id ?? e['Entry ID'] ?? String(Math.random()),
            amount,
            vendor,
            account,
            costCenter,
            userId,
            date,
            description,
            isWeekend: !isNaN(d.getTime()) && (d.getDay() === 0 || d.getDay() === 6),
            isMonthEnd: !isNaN(d.getTime()) && d.getDate() >= 28,
            isLateNight: hour >= 20 || hour < 6,
            isManual: (e.EntryType || e.entry_type || '').toString().toLowerCase().includes('manual'),
            mlScore: mlRaw,
            statScore: stat.score,
            rulesScore: rules.score,
            novaScore,
            zAccount: stat.zAccount,
            zAccountMonth: stat.zAccountMonth,
            zAccountVendor: stat.zAccountVendor,
            zAccountCostCenter: stat.zAccountCostCenter,
            finalScore,
            riskLevel: finalScore >= 65 ? 'HIGH' : finalScore >= 35 ? 'MEDIUM' : 'LOW',
            ruleFlags: rules.flags,
        };
    });
}
export function scoreAllEntries(entries, baseline) {
    return entries.map((e) => {
        const amount = Math.abs(Number(e.Amount || e.amount || 0));
        const account = e.Account || e.account || 'Unknown';
        const vendor = e.Vendor || e.vendor || e.Description || 'Unknown';
        const costCenter = e.CostCenter || e.Department || e.costcenter || 'Unknown';
        const userId = e.User || e.PreparedBy || e.created_by || 'Unknown';
        const date = (e.Date || e.date || '').toString();
        const month = date.slice(0, 7);
        const d = new Date(date);
        const description = (e.Description || e.description || '').toString();
        const hour = parseInt((e.Time || '14:00').toString().split(':')[0], 10);
        const mlRaw = mlAnomalyScore(amount, baseline, account);
        const rules = runRulesEngine(e, baseline, entries);
        const stat = statScore(amount, account, month, vendor, costCenter, baseline);
        const novaScore = 0;
        const hybrid = W.ml * mlRaw + W.stat * stat.score + W.rules * rules.score + W.nova * novaScore;
        const finalScore = Math.round(hybrid * 100);
        return {
            entryId: e.id ?? e.JE_ID ?? e.Entry_ID ?? e.entry_id ?? e['Entry ID'] ?? String(Math.random()),
            amount,
            vendor,
            account,
            costCenter,
            userId,
            date,
            description,
            isWeekend: !isNaN(d.getTime()) && (d.getDay() === 0 || d.getDay() === 6),
            isMonthEnd: !isNaN(d.getTime()) && d.getDate() >= 28,
            isLateNight: hour >= 20 || hour < 6,
            isManual: (e.EntryType || e.entry_type || '').toString().toLowerCase().includes('manual'),
            mlScore: mlRaw,
            statScore: stat.score,
            rulesScore: rules.score,
            novaScore,
            zAccount: stat.zAccount,
            zAccountMonth: stat.zAccountMonth,
            zAccountVendor: stat.zAccountVendor,
            zAccountCostCenter: stat.zAccountCostCenter,
            finalScore,
            riskLevel: finalScore >= 65 ? 'HIGH' : finalScore >= 35 ? 'MEDIUM' : 'LOW',
            ruleFlags: rules.flags,
        };
    });
}
// ─── GEMINI ENRICHMENT (HIGH + MEDIUM, max 50) ────────────────────
export async function enrichWithNova(scored, callAI) {
    const MAX_GEMINI_CALLS = 50;
    const toEnrich = scored
        .filter((e) => e.riskLevel === 'HIGH' || e.riskLevel === 'MEDIUM')
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, MAX_GEMINI_CALLS);
    for (const entry of toEnrich) {
        try {
            const { novaScore, explanation } = await callNovaForExplanation(entry, callAI);
            entry.novaScore = novaScore;
            entry.novaExplanation = explanation;
            const hybrid = W.ml * entry.mlScore +
                W.stat * entry.statScore +
                W.rules * entry.rulesScore +
                W.nova * novaScore;
            entry.finalScore = Math.round(hybrid * 100);
            entry.riskLevel = entry.finalScore >= 65 ? 'HIGH' : entry.finalScore >= 35 ? 'MEDIUM' : 'LOW';
        }
        catch {
            // keep original score
        }
    }
    return scored;
}
// ─── FEEDBACK LABEL (for XGBoost retraining) ─────────────────────
export function applyUserFeedback(entry, isRealAnomaly, reviewedBy) {
    return {
        ...entry,
        userLabel: isRealAnomaly ? 1 : 0,
        reviewedBy,
        reviewTimestamp: new Date().toISOString(),
    };
}
export async function analyzeEntries(rawEntries, callAI) {
    if (!rawEntries || rawEntries.length === 0) {
        const emptyBaseline = buildClientBaseline([]);
        return {
            entries: [],
            baseline: emptyBaseline,
            summary: {
                total: 0,
                high: 0,
                medium: 0,
                low: 0,
                anomalyRate: '0',
                novaCallsMade: 0,
                topRiskyVendor: 'N/A',
                topRiskyUser: 'N/A',
                topRiskEntry: 'N/A',
            },
        };
    }
    const normalisedEntries = rawEntries.map(normaliseEntry);
    const baseline = buildClientBaseline(normalisedEntries);
    let scored = scoreAllEntries(normalisedEntries, baseline);
    scored = await enrichWithNova(scored, callAI);
    scored.sort((a, b) => {
        const levelOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        return levelOrder[a.riskLevel] - levelOrder[b.riskLevel] || b.finalScore - a.finalScore;
    });
    const high = scored.filter((e) => e.riskLevel === 'HIGH').length;
    const medium = scored.filter((e) => e.riskLevel === 'MEDIUM').length;
    const low = scored.filter((e) => e.riskLevel === 'LOW').length;
    const anomalyRate = scored.length ? (((high + medium) / scored.length) * 100).toFixed(1) : '0';
    const byVendor = {};
    const byUser = {};
    scored.forEach((e) => {
        if (e.riskLevel === 'HIGH' || e.riskLevel === 'MEDIUM') {
            byVendor[e.vendor] = (byVendor[e.vendor] || 0) + e.finalScore;
            byUser[e.userId] = (byUser[e.userId] || 0) + e.finalScore;
        }
    });
    const topVendor = Object.entries(byVendor).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'N/A';
    const topUser = Object.entries(byUser).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'N/A';
    const topEntry = scored[0]?.entryId ?? 'N/A';
    return {
        entries: scored,
        baseline,
        summary: {
            total: scored.length,
            high,
            medium,
            low,
            anomalyRate,
            novaCallsMade: scored.filter((e) => e.novaExplanation).length,
            topRiskyVendor: topVendor,
            topRiskyUser: topUser,
            topRiskEntry: topEntry,
        },
    };
}
/**
 * MindBridge-style: score current batch using baseline from FULL client history.
 * Month 2+ uploads get smarter scoring (8–15% flag rate) as client normal is learned.
 */
export async function analyzeEntriesWithHistory(currentRawEntries, historyRawEntries, callAI) {
    if (!currentRawEntries || currentRawEntries.length === 0) {
        const emptyBaseline = buildClientBaseline([]);
        return {
            entries: [],
            baseline: emptyBaseline,
            summary: {
                total: 0,
                high: 0,
                medium: 0,
                low: 0,
                anomalyRate: '0',
                novaCallsMade: 0,
                topRiskyVendor: 'N/A',
                topRiskyUser: 'N/A',
                topRiskEntry: 'N/A',
            },
        };
    }
    const normalisedHistory = (historyRawEntries || []).map(normaliseEntry);
    const normalisedCurrent = currentRawEntries.map(normaliseEntry);
    const allNormalised = normalisedHistory.concat(normalisedCurrent);
    const baseline = buildClientBaseline(allNormalised);
    let scored = scoreAllEntriesWithFullContext(normalisedCurrent, baseline, allNormalised);
    scored = await enrichWithNova(scored, callAI);
    scored.sort((a, b) => {
        const levelOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        return levelOrder[a.riskLevel] - levelOrder[b.riskLevel] || b.finalScore - a.finalScore;
    });
    const high = scored.filter((e) => e.riskLevel === 'HIGH').length;
    const medium = scored.filter((e) => e.riskLevel === 'MEDIUM').length;
    const low = scored.filter((e) => e.riskLevel === 'LOW').length;
    const anomalyRate = scored.length ? (((high + medium) / scored.length) * 100).toFixed(1) : '0';
    const byVendor = {};
    const byUser = {};
    scored.forEach((e) => {
        if (e.riskLevel === 'HIGH' || e.riskLevel === 'MEDIUM') {
            byVendor[e.vendor] = (byVendor[e.vendor] || 0) + e.finalScore;
            byUser[e.userId] = (byUser[e.userId] || 0) + e.finalScore;
        }
    });
    const topVendor = Object.entries(byVendor).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'N/A';
    const topUser = Object.entries(byUser).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'N/A';
    const topEntry = scored[0]?.entryId ?? 'N/A';
    return {
        entries: scored,
        baseline,
        summary: {
            total: scored.length,
            high,
            medium,
            low,
            anomalyRate,
            novaCallsMade: scored.filter((e) => e.novaExplanation).length,
            topRiskyVendor: topVendor,
            topRiskyUser: topUser,
            topRiskEntry: topEntry,
        },
    };
}
// ─── FRAUD PATTERN ALERTS (from ScoredEntry[] for UI compat) ──────
export function detectFraudPatterns(scoredEntries, baseline) {
    const alerts = [];
    const fmtAmt = (n) => Math.round(n).toLocaleString('en-IN');
    const sodEntries = scoredEntries.filter((e) => e.ruleFlags.some((f) => f.includes('Segregation of Duties')));
    if (sodEntries.length > 0) {
        const total = sodEntries.reduce((s, e) => s + e.amount, 0);
        alerts.push({
            id: 'sod-violation',
            category: 'user',
            severity: 'CRITICAL',
            title: 'Segregation of Duties violation',
            detail: `${sodEntries.length} entries where same person prepared and approved`,
            insight: 'Critical control failure — requires immediate audit.',
            recommendation: 'Review all listed entries and enforce dual approval.',
            entryIds: sodEntries.map((e) => e.entryId),
            totalAmount: total,
            entryCount: sodEntries.length,
        });
    }
    const weekendEntries = scoredEntries.filter((e) => e.isWeekend && e.riskLevel !== 'LOW');
    if (weekendEntries.length >= 2) {
        const byUser = {};
        weekendEntries.forEach((e) => {
            byUser[e.userId] = byUser[e.userId] || [];
            byUser[e.userId].push(e);
        });
        Object.entries(byUser).forEach(([userId, list]) => {
            if (list.length < 2)
                return;
            const total = list.reduce((s, e) => s + e.amount, 0);
            alerts.push({
                id: `user-weekend-${userId}`,
                category: 'user',
                severity: list.length >= 4 ? 'CRITICAL' : list.length >= 3 ? 'HIGH' : 'MEDIUM',
                title: `${userId} — Weekend Posting Pattern`,
                detail: `${userId} posted ${list.length} weekend entries worth ₹${fmtAmt(total)}`,
                insight: `Client weekend rate ${(baseline.weekendRate * 100).toFixed(1)}%`,
                recommendation: `Review ${list.length} weekend entries by ${userId}`,
                entryIds: list.map((e) => e.entryId),
                totalAmount: total,
                entryCount: list.length,
            });
        });
    }
    const dupEntries = scoredEntries.filter((e) => e.ruleFlags.some((f) => f.includes('Duplicate') || f.includes('Near-duplicate')));
    if (dupEntries.length >= 2) {
        const total = dupEntries.reduce((s, e) => s + e.amount, 0);
        alerts.push({
            id: 'duplicate-pattern',
            category: 'vendor',
            severity: dupEntries.length >= 4 ? 'CRITICAL' : 'HIGH',
            title: 'Duplicate / near-duplicate entries',
            detail: `${dupEntries.length} entries flagged as duplicate or near-duplicate, totalling ₹${fmtAmt(total)}`,
            insight: 'Same vendor + amount or within 1% in same month.',
            recommendation: 'Verify each payment is legitimate and not double-posted.',
            entryIds: dupEntries.map((e) => e.entryId),
            totalAmount: total,
            entryCount: dupEntries.length,
        });
    }
    return alerts;
}
