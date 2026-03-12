// ═══════════════════════════════════════════════════════════
// FinReportAI — Pattern Intelligence Engine
// 7-Model Anomaly Detection (Client-Specific Baselines)
// ═══════════════════════════════════════════════════════════
// ── DATE PARSER — defined at module level, available everywhere ──
function parseDateSafe(val) {
    if (val == null || val === '')
        return null;
    if (typeof val === 'number') {
        const d = new Date(Math.round((val - 25569) * 86400 * 1000));
        return isNaN(d.getTime()) ? null : d;
    }
    const str = String(val).trim();
    if (!str)
        return null;
    const d = new Date(str);
    if (!isNaN(d.getTime()))
        return d;
    const parts = str.split(/[\/\-\.]/);
    if (parts.length === 3) {
        const nums = parts.map(Number);
        if (nums[0] <= 31 && nums[1] <= 12) {
            const d2 = new Date(nums[2], nums[1] - 1, nums[0]);
            if (!isNaN(d2.getTime()))
                return d2;
        }
    }
    return null;
}
const WEIGHTS = {
    amount: 25, duplicate: 25, user: 20, timing: 15, account: 10, vendor: 5,
};
// ─── MAIN FUNCTION ──────────────────────────────────────────────────────────
export function analysePatterns(journalEntries) {
    if (!journalEntries || journalEntries.length === 0)
        return getEmptyResult();
    // Normalise all entries first (Excel "Amount (₹)", "Posted By", "Entry ID" etc.)
    const normalisedEntries = journalEntries.map(normaliseEntry);
    const baseline = buildClientBaseline(normalisedEntries);
    const vendorPatterns = buildVendorPatterns(normalisedEntries, baseline);
    const userPatterns = buildUserPatterns(normalisedEntries, baseline);
    const accountPatterns = buildAccountPatterns(normalisedEntries, baseline);
    const timingPatterns = buildTimingPatterns(normalisedEntries);
    const benfordResult = runBenfordsLaw(normalisedEntries);
    const patternEntries = scoreAllEntries(normalisedEntries, baseline, vendorPatterns, userPatterns, benfordResult);
    const highRisk = patternEntries.filter(e => e.riskLevel === 'HIGH').length;
    const mediumRisk = patternEntries.filter(e => e.riskLevel === 'MEDIUM').length;
    const lowRisk = patternEntries.filter(e => e.riskLevel === 'LOW').length;
    const modelTotals = patternEntries.reduce((acc, e) => {
        Object.entries(e.modelScores).forEach(([model, score]) => {
            if (model !== 'benford')
                acc[model] = (acc[model] || 0) + score;
        });
        return acc;
    }, {});
    const dominantRiskModel = Object.entries(modelTotals)
        .sort(([, a], [, b]) => b - a)[0]?.[0] || 'amount';
    const sorted = [...patternEntries].sort((a, b) => b.patternRiskScore - a.patternRiskScore);
    return {
        baseline,
        vendorPatterns: [...vendorPatterns].sort((a, b) => b.riskScore - a.riskScore),
        userPatterns: [...userPatterns].sort((a, b) => b.riskScore - a.riskScore),
        accountPatterns: [...accountPatterns].sort((a, b) => b.riskScore - a.riskScore),
        timingPatterns,
        patternEntries: sorted,
        benfordResult,
        modelWeights: WEIGHTS,
        summary: {
            totalEntries: normalisedEntries.length,
            highRisk, mediumRisk, lowRisk,
            topRiskyVendor: vendorPatterns.sort((a, b) => b.riskScore - a.riskScore)[0]?.vendorName || 'N/A',
            topRiskyUser: userPatterns.sort((a, b) => b.riskScore - a.riskScore)[0]?.userId || 'N/A',
            topRiskyAccount: accountPatterns.sort((a, b) => b.riskScore - a.riskScore)[0]?.accountCode || 'N/A',
            topRiskEntry: sorted[0]?.entryId || 'N/A',
            overallRiskScore: patternEntries.length > 0
                ? Math.round(patternEntries.reduce((s, e) => s + e.patternRiskScore, 0) / patternEntries.length)
                : 0,
            dominantRiskModel,
        }
    };
}
// ─── HELPERS: Duplicate detection ───────────────────────────────────────────
function isDuplicateEntry(e) {
    if (typeof e.isDuplicate === 'boolean')
        return e.isDuplicate;
    const raw = e.Duplicate ?? e.duplicate ?? e.duplicate_entry ?? e.IsDuplicate ?? e.is_duplicate ?? e['Is Duplicate'] ?? '';
    if (typeof raw === 'boolean')
        return raw;
    const str = String(raw).trim().toLowerCase();
    return str === 'true' || str === '1' || str === 'yes';
}
// ─── NORMALISE ROW (Excel "Amount (₹)", "Posted By", "Entry ID" etc.) ────────
function normaliseEntry(e) {
    const amount = Number(e['Amount (₹)'] ??
        e['Amount(₹)'] ??
        e['Amount'] ??
        e['amount'] ??
        e['AMOUNT'] ??
        e['amount_inr'] ??
        e.Amount ??
        e.amount ??
        e.AMOUNT ??
        0);
    const entryId = String(e['Entry ID'] ?? e.entry_id ?? e.EntryID ?? e.id ?? e.JE_ID ?? e.je_id ?? '');
    const date = String(e['Date'] ?? e.date ?? e.DATE ?? e.PostingDate ?? e.posting_date ?? '');
    const vendor = String(e['Vendor'] ?? e.vendor ?? e.VENDOR ?? e.VendorName ?? e.vendor_name ?? 'Unknown').trim();
    const account = String(e['Account'] ?? e.account ?? e.AccountCode ?? e.account_code ?? e['Debit Account'] ?? e.account_debit ?? e.DebitAccount ?? '').trim();
    const debitAcct = String(e['Debit Account'] ?? e.debit_account ?? e.DebitAccount ?? e.account_debit ?? account ?? '').trim();
    const creditAcct = String(e['Credit Account'] ?? e.credit_account ?? e.CreditAccount ?? e.account_credit ?? '').trim();
    const postedBy = String(e['Posted By'] ?? e.posted_by ?? e.PostedBy ?? e.User ?? e.user ?? e.user_id ?? e.Employee ?? e.CreatedBy ?? e.preparer ?? '').trim();
    const description = String(e['Description'] ?? e.description ?? e.narration ?? '').trim();
    const rawDup = e['Duplicate'] ?? e.duplicate ?? e.is_duplicate ?? e['Is Duplicate'] ?? '';
    const isDuplicate = typeof rawDup === 'boolean'
        ? rawDup
        : String(rawDup).trim().toLowerCase() === 'true' || String(rawDup).trim().toLowerCase() === '1' || String(rawDup).trim().toLowerCase() === 'yes';
    const amountResolved = amount > 0
        ? amount
        : Math.max(Number(e.debit ?? e.Debit ?? 0), Number(e.credit ?? e.Credit ?? 0));
    return {
        ...e,
        entryId,
        date,
        vendor,
        account,
        debitAcct,
        creditAcct,
        amount: amountResolved,
        postedBy: postedBy || 'Unknown',
        description,
        isDuplicate,
        'Entry ID': entryId,
        'Date': date,
        'Vendor': vendor,
        'Account': account,
        'Debit Account': debitAcct,
        'Credit Account': creditAcct,
        'Amount (₹)': amountResolved,
        'Amount': amountResolved,
        'Posted By': postedBy || 'Unknown',
        'Description': description,
    };
}
// ─── NORMALIZE ROW (handle backend vs Excel column names) ────────────────────
function getAmount(e) {
    const a = Number(e.amount ?? e['Amount (₹)'] ?? e['Amount(₹)'] ?? e.Amount ?? e.amount ?? e.AMOUNT ?? 0);
    if (a > 0)
        return a;
    const debit = Number(e.debit ?? e.Debit ?? 0);
    const credit = Number(e.credit ?? e.Credit ?? 0);
    return Math.max(debit, credit);
}
function getVendor(e) {
    return String(e.vendor ?? e.Vendor ?? e.VENDOR ?? e.VendorName ?? e.vendor_name ?? e['Vendor/Customer'] ?? e.preparer ?? e.PostedBy ?? e.posted_by ?? 'Unknown').trim();
}
function getAccount(e) {
    return String(e.account ?? e.Account ?? e.AccountCode ?? e.account_code ?? e.account_debit ?? e['Debit Account'] ?? e.DebitAccount ?? '').trim();
}
function getUserId(e) {
    return String(e.postedBy ?? e.PostedBy ?? e.posted_by ?? e['Posted By'] ?? e.User ?? e.user ?? e.user_id ?? e.UserId ?? e.Employee ?? e.employee ?? e.CreatedBy ?? e.created_by ?? e.preparer ?? 'Unknown').trim();
}
function getDateStr(e) {
    return String(e.date ?? e.Date ?? e.DATE ?? e.PostingDate ?? e.posting_date ?? '');
}
function getEntryId(e) {
    return String(e.entryId ?? e['Entry ID'] ?? e.entry_id ?? e.id ?? e.JE_ID ?? e.je_id ?? '');
}
// ─── SCORE ALL ENTRIES (ALL 7 MODELS) ───────────────────────────────────────
function scoreAllEntries(entries, baseline, vendorPatterns, userPatterns, benfordResult) {
    const amounts = entries.map(getAmount);
    const globalMean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const globalVariance = amounts.reduce((s, a) => s + Math.pow(a - globalMean, 2), 0) / amounts.length;
    const globalStdDev = Math.sqrt(globalVariance);
    return entries.map(e => {
        const amount = Number(e.Amount ?? e['Amount (₹)'] ?? e.amount ?? e.AMOUNT ?? 0);
        const vendor = String(e.Vendor ?? e.vendor ?? e.VENDOR ?? e.VendorName ?? e.vendor_name ?? 'Unknown').trim();
        const account = String(e.Account ?? e.account ?? e.AccountCode ?? e.account_code ??
            e.account_debit ?? e.AccountDebit ?? e['Debit Account'] ?? '').trim();
        const debitAccount = String(e.DebitAccount ?? e.debit_account ?? e['Debit Account'] ??
            e.account_debit ?? e.AccountDebit ?? account ?? '').trim();
        const creditAccount = String(e.CreditAccount ?? e.credit_account ?? e['Credit Account'] ??
            e.account_credit ?? e.AccountCredit ?? '').trim();
        const userId = String(e.PostedBy ?? e.posted_by ?? e['Posted By'] ??
            e.User ?? e.user ?? e.user_id ?? e.UserId ??
            e.Employee ?? e.employee ?? e.CreatedBy ?? e.created_by ?? 'Unknown').trim();
        const dateStr = String(e.Date ?? e.date ?? e.DATE ?? e.PostingDate ?? e.posting_date ?? '');
        const date = parseDateSafe(e.Date ?? e.date ?? e.DATE ?? e.PostingDate ?? e.posting_date);
        const dayOfWeek = date ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()] : '';
        const isWeekend = date ? (date.getDay() === 0 || date.getDay() === 6) : false;
        const isMonthEnd = date ? date.getDate() >= 28 : false;
        const hour = date ? date.getHours() : 12;
        const isLateNight = hour >= 20 || hour < 6;
        const postingType = String(e.PostingType ?? e.posting_type ?? e['Posting Type'] ?? e.Type ?? e.type ?? '').toLowerCase();
        const isManualEntry = postingType === 'manual' || postingType === 'man';
        const isDuplicate = isDuplicateEntry(e);
        const vendorProfile = vendorPatterns.find(v => v.vendorName === vendor);
        const userProfile = userPatterns.find(u => u.userId === userId);
        const flags = [];
        const scores = {
            amount: 0, duplicate: 0, user: 0,
            timing: 0, account: 0, vendor: 0, benford: 0
        };
        // ── MODEL 1: AMOUNT OUTLIER ─────────────
        const zScoreAmount = globalStdDev > 0 ? (amount - globalMean) / globalStdDev : 0;
        if (amount > baseline.p99Amount) {
            scores.amount = 100;
            flags.push(`Amount ₹${fmt(amount)} exceeds 99th percentile (₹${fmt(baseline.p99Amount)})`);
        }
        else if (amount > baseline.p95Amount) {
            scores.amount = 70;
            flags.push(`Amount ₹${fmt(amount)} above 95th percentile (₹${fmt(baseline.p95Amount)})`);
        }
        else if (amount > baseline.p90Amount) {
            scores.amount = 40;
            flags.push(`Amount in top 10% (>₹${fmt(baseline.p90Amount)})`);
        }
        else if (Math.abs(zScoreAmount) > 3) {
            scores.amount = 80;
            flags.push(`Amount ${zScoreAmount.toFixed(1)}σ from mean (₹${fmt(globalMean)})`);
        }
        // ── MODEL 2: DUPLICATE DETECTION ────────────────────────────────────────
        if (isDuplicate) {
            scores.duplicate = 100;
            flags.push(`Duplicate — ${vendor} ₹${fmt(amount)} posted multiple times`);
        }
        else {
            const nearDups = entries.filter(e2 => {
                if (e2 === e)
                    return false;
                const a2 = getAmount(e2);
                const v2 = getVendor(e2);
                return v2 === vendor && amount > 0 && Math.abs(a2 - amount) / amount < 0.01;
            });
            if (nearDups.length > 0) {
                scores.duplicate = 60;
                flags.push(`Near-duplicate: ${nearDups.length} similar from ${vendor}`);
            }
        }
        // ── MODEL 3: USER BEHAVIOR ──────────────────────────────────────────────
        if (userProfile) {
            if (isWeekend && userProfile.weekendRate < 0.05) {
                scores.user = Math.max(scores.user, 65);
                flags.push(`${userId} rarely posts weekends (${(userProfile.weekendRate * 100).toFixed(1)}%) — posted ${dayOfWeek}`);
            }
            if (userProfile.meanAmount > 0 && amount > userProfile.meanAmount * 4) {
                scores.user = Math.max(scores.user, 70);
                flags.push(`₹${fmt(amount)} is ${(amount / userProfile.meanAmount).toFixed(1)}x above ${userId}'s avg (₹${fmt(userProfile.meanAmount)})`);
            }
            if (isMonthEnd && userProfile.monthEndRate > 0.6) {
                scores.user = Math.max(scores.user, 40);
                flags.push(`${userId} posts ${(userProfile.monthEndRate * 100).toFixed(0)}% at month-end`);
            }
        }
        // ── MODEL 4: TIMING ANOMALY ──────────────────────────────────────────────
        if (isWeekend) {
            if (baseline.weekendRate < 0.02) {
                scores.timing = Math.max(scores.timing, 85);
                flags.push(`Weekend posting — client posts only ${(baseline.weekendRate * 100).toFixed(1)}% on weekends`);
            }
            else if (baseline.weekendRate < 0.05) {
                scores.timing = Math.max(scores.timing, 50);
                flags.push(`Weekend posting (${dayOfWeek}) — above client norm`);
            }
        }
        if (isLateNight && baseline.lateNightRate < 0.03) {
            scores.timing = Math.max(scores.timing, 75);
            flags.push(`Late night (${hour}:00h) — client rarely posts outside hours`);
        }
        if (isMonthEnd && amount > baseline.p95Amount && date) {
            scores.timing = Math.max(scores.timing, 55);
            flags.push(`Large month-end entry (day ${date.getDate()})`);
        }
        // Manual journal entries — always higher risk than auto-posted
        if (isManualEntry) {
            scores.timing = Math.max(scores.timing, 35);
            flags.push(`Manual journal entry — manual postings carry higher fraud risk than auto-posted`);
            if (amount > baseline.p95Amount) {
                scores.timing = Math.max(scores.timing, 60);
                flags.push(`Manual entry + large amount (₹${fmt(amount)}) — high-risk combination`);
            }
            if (isWeekend) {
                scores.timing = Math.max(scores.timing, 75);
                flags.push(`Manual entry posted on ${dayOfWeek} — manual weekend entries need approver review`);
            }
        }
        // ── MODEL 5: ACCOUNT COMBINATION ────────────────────────────────────────
        if (debitAccount && creditAccount) {
            const normalCredits = baseline.normalAccountPairs[debitAccount] || [];
            if (normalCredits.length > 2 && !normalCredits.includes(creditAccount)) {
                scores.account = 70;
                flags.push(`Unusual pair: Dr ${debitAccount} / Cr ${creditAccount}`);
            }
        }
        const highRiskKeywords = ['suspense', 'clearing', 'misc', 'other expense', 'personal', 'director', 'shareholder loan', 'write off', 'write-off'];
        if (highRiskKeywords.some(k => account.toLowerCase().includes(k))) {
            scores.account = Math.max(scores.account, 55);
            flags.push(`High-risk account: "${account}"`);
        }
        // ── MODEL 6: VENDOR PATTERN ──────────────────────────────────────────────
        let zScoreVendor = 0;
        if (vendorProfile) {
            if (vendorProfile.stdDevAmount > 0) {
                zScoreVendor = (amount - vendorProfile.meanAmount) / vendorProfile.stdDevAmount;
                if (Math.abs(zScoreVendor) > 3) {
                    scores.vendor = 90;
                    flags.push(`${vendor} normally ₹${fmt(vendorProfile.meanAmount)} ±₹${fmt(vendorProfile.stdDevAmount)} — ${Math.abs(zScoreVendor).toFixed(1)}σ outside`);
                }
                else if (Math.abs(zScoreVendor) > 2) {
                    scores.vendor = 55;
                    flags.push(`Amount ${Math.abs(zScoreVendor).toFixed(1)}σ outside ${vendor}'s range`);
                }
            }
            if (account && vendorProfile.normalAccounts.length > 1 && !vendorProfile.normalAccounts.includes(account)) {
                scores.vendor = Math.max(scores.vendor, 50);
                flags.push(`${vendor} has never used "${account}"`);
            }
            if (vendorProfile.totalEntries === 1) {
                scores.vendor = Math.max(scores.vendor, 40);
                flags.push(`New vendor: ${vendor} has only 1 entry`);
            }
        }
        // ── MODEL 7: BENFORD ─────────────────────────────────────────────────────
        if (benfordResult.isSuspicious && amount > 0) {
            const firstDigit = parseInt(String(Math.abs(amount)).replace(/^0+/, '').replace('.', '')[0]);
            if (benfordResult.suspiciousDigits.includes(firstDigit)) {
                scores.benford = 30;
                flags.push(`Benford: digit ${firstDigit} over-represented (χ²=${benfordResult.chiSquare})`);
            }
        }
        // ── ADDITIVE RISK SCORE ─────────────────────────────────────────
        // Each triggered model contributes directly to final score.
        let patternRiskScore = 0;
        if (scores.amount >= 100)
            patternRiskScore += 40;
        else if (scores.amount >= 70)
            patternRiskScore += 30;
        else if (scores.amount >= 40)
            patternRiskScore += 15;
        if (scores.duplicate >= 100)
            patternRiskScore += 40;
        else if (scores.duplicate >= 60)
            patternRiskScore += 25;
        if (scores.user >= 70)
            patternRiskScore += 25;
        else if (scores.user >= 40)
            patternRiskScore += 15;
        if (scores.timing >= 80)
            patternRiskScore += 25;
        else if (scores.timing >= 50)
            patternRiskScore += 15;
        else if (scores.timing >= 40)
            patternRiskScore += 10;
        if (scores.account >= 70)
            patternRiskScore += 20;
        else if (scores.account >= 50)
            patternRiskScore += 12;
        if (scores.vendor >= 90)
            patternRiskScore += 15;
        else if (scores.vendor >= 55)
            patternRiskScore += 10;
        else if (scores.vendor >= 40)
            patternRiskScore += 5;
        if (scores.benford >= 30)
            patternRiskScore += 8;
        patternRiskScore = Math.min(patternRiskScore, 100);
        // Count how many models actually fired (score > 0)
        const signalCount = [
            scores.amount, scores.duplicate, scores.user,
            scores.timing, scores.account, scores.vendor
        ].filter(s => s >= 40).length;
        // Boost when multiple signals fire together (collective anomaly detection)
        if (signalCount >= 3)
            patternRiskScore += 20;
        else if (signalCount >= 2)
            patternRiskScore += 10;
        patternRiskScore = Math.min(patternRiskScore, 100);
        const riskLevel = patternRiskScore >= 55 ? 'HIGH' :
            patternRiskScore >= 35 ? 'MEDIUM' :
                'LOW';
        if (isWeekend || isMonthEnd) {
            console.log(`${getEntryId(e)} | weekend:${isWeekend} monthEnd:${isMonthEnd} | timing:${scores.timing} | clientWkRate:${baseline.weekendRate.toFixed(3)}`);
        }
        return {
            entryId: getEntryId(e),
            amount, vendor, account, userId,
            date: dateStr, dayOfWeek, isWeekend, isMonthEnd, isDuplicate,
            modelScores: scores,
            patternRiskScore, riskLevel,
            patternFlags: flags,
            zScoreAmount: +zScoreAmount.toFixed(2),
            zScoreVendor: +zScoreVendor.toFixed(2),
        };
    });
    console.table(results.slice(0, 20).map(e => ({
        id: e.entryId,
        amt: e.modelScores.amount,
        dup: e.modelScores.duplicate,
        user: e.modelScores.user,
        time: e.modelScores.timing,
        acct: e.modelScores.account,
        total: e.patternRiskScore,
        risk: e.riskLevel
    })));
    return results;
}
// ─── CLIENT BASELINE ────────────────────────────────────────────────────────
function buildClientBaseline(entries) {
    const amounts = entries.map(e => Number(e.Amount ?? e['Amount (₹)'] ?? e.amount ?? e.AMOUNT ?? 0)).filter(a => a > 0).sort((a, b) => a - b);
    const n = amounts.length || 1;
    const mean = amounts.reduce((s, a) => s + a, 0) / n;
    const variance = amounts.reduce((s, a) => s + Math.pow(a - mean, 2), 0) / n;
    const pct = (p) => amounts[Math.floor(n * p)] || 0;
    const weekendEntries = entries.filter(e => {
        const dow = String(e.day_of_week ?? e.DayOfWeek ?? e['Day of Week'] ?? '').toLowerCase();
        if (dow)
            return dow === 'saturday' || dow === 'sunday';
        const date = parseDateSafe(e.Date ?? e.date ?? e.DATE ?? getDateStr(e));
        return date ? (date.getDay() === 0 || date.getDay() === 6) : false;
    });
    const monthEndEntries = entries.filter(e => {
        const date = parseDateSafe(e.Date ?? e.date ?? e.DATE ?? getDateStr(e));
        return date ? date.getDate() >= 28 : false;
    });
    const lateNightEntries = entries.filter(e => {
        const date = parseDateSafe(e.Date ?? e.date ?? e.DATE ?? getDateStr(e));
        if (!date)
            return false;
        const h = date.getHours();
        return h >= 20 || h < 6;
    });
    const duplicates = entries.filter(e => isDuplicateEntry(e));
    const normalAccountPairs = {};
    entries.forEach(e => {
        const debit = String(e.DebitAccount ?? e.debit_account ?? getAccount(e) ?? '').trim();
        const credit = String(e.CreditAccount ?? e.credit_account ?? '').trim();
        if (debit && credit) {
            if (!normalAccountPairs[debit])
                normalAccountPairs[debit] = [];
            if (!normalAccountPairs[debit].includes(credit))
                normalAccountPairs[debit].push(credit);
        }
    });
    return {
        meanAmount: Math.round(mean),
        medianAmount: Math.round(pct(0.5)),
        stdDevAmount: Math.round(Math.sqrt(variance)),
        p75Amount: Math.round(pct(0.75)),
        p90Amount: Math.round(pct(0.90)),
        p95Amount: Math.round(pct(0.95)),
        p99Amount: Math.round(pct(0.99)),
        weekendRate: weekendEntries.length / entries.length,
        monthEndRate: monthEndEntries.length / entries.length,
        lateNightRate: lateNightEntries.length / entries.length,
        avgEntriesPerDay: entries.length / 30,
        duplicateRate: duplicates.length / entries.length,
        uniqueVendors: new Set(entries.map(getVendor)).size,
        uniqueAccounts: new Set(entries.map(getAccount)).size,
        uniqueUsers: new Set(entries.map(getUserId)).size,
        normalAccountPairs,
    };
}
// ─── VENDOR PATTERNS ────────────────────────────────────────────────────────
function buildVendorPatterns(entries, baseline) {
    const groups = {};
    entries.forEach(e => {
        const v = getVendor(e);
        if (!groups[v])
            groups[v] = [];
        groups[v].push(e);
    });
    return Object.entries(groups).map(([vendorName, ve]) => {
        const amounts = ve.map(e => getAmount(e)).sort((a, b) => a - b);
        const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
        const variance = amounts.reduce((s, a) => s + Math.pow(a - mean, 2), 0) / amounts.length;
        const stdDev = Math.sqrt(variance);
        const p95 = amounts[Math.floor(amounts.length * 0.95)] || 0;
        const weekendCount = ve.filter(e => {
            const date = parseDateSafe(e.Date ?? e.date ?? e.DATE ?? getDateStr(e));
            return date ? (date.getDay() === 0 || date.getDay() === 6) : false;
        }).length;
        const accounts = [...new Set(ve.map(e => getAccount(e)))].filter(Boolean);
        const anomalies = ve.filter(e => {
            const a = getAmount(e);
            const z = stdDev > 0 ? Math.abs((a - mean) / stdDev) : 0;
            return z > 2 || isDuplicateEntry(e);
        }).length;
        let riskScore = 0;
        if (anomalies > 0)
            riskScore += Math.min((anomalies / ve.length) * 60, 40);
        if (weekendCount / ve.length > baseline.weekendRate * 2)
            riskScore += 20;
        if (p95 > baseline.p95Amount * 1.5)
            riskScore += 25;
        if (ve.length === 1)
            riskScore += 15;
        return {
            vendorName,
            totalEntries: ve.length,
            meanAmount: Math.round(mean),
            medianAmount: Math.round(amounts[Math.floor(amounts.length * 0.5)] || 0),
            stdDevAmount: Math.round(stdDev),
            p95Amount: Math.round(p95),
            normalAccounts: accounts,
            weekendRate: weekendCount / ve.length,
            riskScore: Math.min(Math.round(riskScore), 100),
            anomalyCount: anomalies,
            largestEntry: Math.max(...amounts),
        };
    });
}
// ─── USER PATTERNS ──────────────────────────────────────────────────────────
function buildUserPatterns(entries, baseline) {
    const groups = {};
    entries.forEach(e => {
        const u = getUserId(e);
        if (!groups[u])
            groups[u] = [];
        groups[u].push(e);
    });
    return Object.entries(groups).map(([userId, ue]) => {
        const amounts = ue.map(e => getAmount(e));
        const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
        const weekendCount = ue.filter(e => {
            const date = parseDateSafe(e.Date ?? e.date ?? e.DATE ?? getDateStr(e));
            return date ? (date.getDay() === 0 || date.getDay() === 6) : false;
        }).length;
        const monthEndCount = ue.filter(e => {
            const date = parseDateSafe(e.Date ?? e.date ?? e.DATE ?? getDateStr(e));
            return date ? date.getDate() >= 28 : false;
        }).length;
        const dupCount = ue.filter(e => isDuplicateEntry(e)).length;
        const weekendRate = weekendCount / ue.length;
        let riskScore = 0;
        if (weekendRate > baseline.weekendRate * 2)
            riskScore += 30;
        if (dupCount > 0)
            riskScore += Math.min((dupCount / ue.length) * 50, 40);
        if (mean > baseline.p95Amount)
            riskScore += 20;
        return {
            userId,
            totalEntries: ue.length,
            meanAmount: Math.round(mean),
            weekendRate,
            monthEndRate: monthEndCount / ue.length,
            duplicateCount: dupCount,
            riskScore: Math.min(Math.round(riskScore), 100),
            vsClientWeekendRate: weekendRate > baseline.weekendRate * 2 ? 'higher' : weekendRate < baseline.weekendRate * 0.5 ? 'lower' : 'similar',
        };
    });
}
// ─── ACCOUNT PATTERNS ───────────────────────────────────────────────────────
function buildAccountPatterns(entries, baseline) {
    const groups = {};
    entries.forEach(e => {
        const a = getAccount(e) || 'Unknown';
        if (!groups[a])
            groups[a] = [];
        groups[a].push(e);
    });
    return Object.entries(groups).map(([accountCode, ae]) => {
        const amounts = ae.map(e => getAmount(e)).sort((a, b) => a - b);
        const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
        const p95 = amounts[Math.floor(amounts.length * 0.95)] || 0;
        const monthEndCount = ae.filter(e => {
            const date = parseDateSafe(e.Date ?? e.date ?? e.DATE ?? getDateStr(e));
            return date ? date.getDate() >= 28 : false;
        }).length;
        const dupCount = ae.filter(e => isDuplicateEntry(e)).length;
        const creditAccounts = [...new Set(ae.map(e => String(e.CreditAccount ?? e.credit_account ?? e['Credit Account'] ?? e.account_credit ?? '').trim()))].filter(Boolean);
        const isHighRisk = ['suspense', 'clearing', 'misc', 'other', 'personal', 'director', 'loan', 'write'].some(k => accountCode.toLowerCase().includes(k));
        let riskScore = 0;
        if (isHighRisk)
            riskScore += 40;
        if (dupCount > 0)
            riskScore += 30;
        if (p95 > baseline.p95Amount * 2)
            riskScore += 20;
        if (monthEndCount / ae.length > 0.7)
            riskScore += 10;
        return {
            accountCode,
            totalEntries: ae.length,
            meanAmount: Math.round(mean),
            p95Amount: Math.round(p95),
            monthEndRate: monthEndCount / ae.length,
            normalCreditAccounts: creditAccounts,
            anomalyCount: dupCount,
            riskScore: Math.min(Math.round(riskScore), 100),
        };
    });
}
// ─── TIMING PATTERNS ────────────────────────────────────────────────────────
function buildTimingPatterns(entries) {
    const monthGroups = {};
    entries.forEach(e => {
        const date = parseDateSafe(e.Date ?? e.date ?? e.DATE ?? getDateStr(e));
        if (!date)
            return;
        const key = date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
        monthGroups[key] = (monthGroups[key] || 0) + 1;
    });
    const counts = Object.values(monthGroups);
    const avg = counts.length ? counts.reduce((s, c) => s + c, 0) / counts.length : 1;
    return Object.entries(monthGroups).map(([month, entryCount]) => ({
        month, entryCount,
        isSpike: entryCount > avg * 1.5,
        spikeRatio: +(entryCount / avg).toFixed(2),
    }));
}
// ─── BENFORD'S LAW ──────────────────────────────────────────────────────────
function runBenfordsLaw(entries) {
    const EXPECTED = [30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6];
    const firstDigits = entries.map(e => {
        const s = String(Math.abs(getAmount(e))).replace(/^0+/, '').replace('.', '');
        return parseInt(s[0]);
    }).filter(d => d >= 1 && d <= 9);
    const n = firstDigits.length || 1;
    const actualPct = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => +(firstDigits.filter(fd => fd === d).length / n * 100).toFixed(1));
    const deviations = EXPECTED.map((exp, i) => +(actualPct[i] - exp).toFixed(1));
    const chiSquare = +EXPECTED.reduce((sum, exp, i) => sum + Math.pow(actualPct[i] - exp, 2) / exp, 0).toFixed(2);
    const suspiciousDigits = deviations
        .map((dev, i) => ({ digit: i + 1, dev: Math.abs(dev) }))
        .filter(d => d.dev > 5)
        .map(d => d.digit);
    const isSuspicious = chiSquare > 15.51;
    return {
        digits: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        expectedPct: EXPECTED,
        actualPct,
        deviations,
        chiSquare,
        pValue: chiSquare > 26.12 ? 'p < 0.001 (highly suspicious)' :
            chiSquare > 20.09 ? 'p < 0.01 (suspicious)' :
                chiSquare > 15.51 ? 'p < 0.05 (borderline)' : 'p > 0.05 (normal)',
        isSuspicious,
        suspiciousDigits,
        interpretation: isSuspicious
            ? `Dataset deviates from Benford's Law (χ²=${chiSquare}). Digits ${suspiciousDigits.join(', ')} over/under-represented.`
            : `Dataset follows Benford's Law (χ²=${chiSquare}). No digit manipulation detected.`,
    };
}
function fmt(n) {
    return Math.round(n).toLocaleString('en-IN');
}
function getEmptyResult() {
    return {
        baseline: {
            meanAmount: 0, medianAmount: 0, stdDevAmount: 0,
            p75Amount: 0, p90Amount: 0, p95Amount: 0, p99Amount: 0,
            weekendRate: 0, monthEndRate: 0, lateNightRate: 0,
            avgEntriesPerDay: 0, duplicateRate: 0,
            uniqueVendors: 0, uniqueAccounts: 0, uniqueUsers: 0,
            normalAccountPairs: {},
        },
        vendorPatterns: [], userPatterns: [], accountPatterns: [],
        timingPatterns: [], patternEntries: [],
        benfordResult: {
            digits: [], expectedPct: [], actualPct: [], deviations: [],
            chiSquare: 0, pValue: '', isSuspicious: false,
            suspiciousDigits: [], interpretation: ''
        },
        modelWeights: WEIGHTS,
        summary: {
            totalEntries: 0, highRisk: 0, mediumRisk: 0, lowRisk: 0,
            topRiskyVendor: 'N/A', topRiskyUser: 'N/A', topRiskyAccount: 'N/A', topRiskEntry: 'N/A',
            overallRiskScore: 0, dominantRiskModel: 'N/A'
        }
    };
}
export function detectFraudPatterns(patternEntries, baseline, journalEntries) {
    const alerts = [];
    const fmtAmt = (n) => Math.round(n).toLocaleString('en-IN');
    // ── PATTERN 1: USER WEEKEND CONCENTRATION ───────────────────────────────
    const userWeekendMap = {};
    patternEntries.forEach(e => {
        if (e.isWeekend) {
            if (!userWeekendMap[e.userId])
                userWeekendMap[e.userId] = [];
            userWeekendMap[e.userId].push(e);
        }
    });
    Object.entries(userWeekendMap).forEach(([userId, wkEntries]) => {
        if (wkEntries.length < 2)
            return;
        const totalAmount = wkEntries.reduce((s, e) => s + e.amount, 0);
        const userTotal = patternEntries.filter(e => e.userId === userId).length;
        const userWkRate = wkEntries.length / userTotal;
        alerts.push({
            id: `user-weekend-${userId}`,
            category: 'user',
            severity: wkEntries.length >= 4 ? 'CRITICAL' : wkEntries.length >= 3 ? 'HIGH' : 'MEDIUM',
            title: `${userId} — Weekend Posting Pattern`,
            detail: `${userId} posted ${wkEntries.length} weekend entries worth ₹${fmtAmt(totalAmount)}`,
            insight: `${(userWkRate * 100).toFixed(0)}% of ${userId}'s entries are on weekends vs client average ${(baseline.weekendRate * 100).toFixed(1)}%`,
            recommendation: `Review all ${wkEntries.length} weekend entries by ${userId} — obtain approver confirmation for each`,
            entryIds: wkEntries.map(e => e.entryId),
            totalAmount,
            entryCount: wkEntries.length,
        });
    });
    // ── PATTERN 2: USER HIGH-VALUE CONCENTRATION ─────────────────────────────
    const userAllMap = {};
    patternEntries.forEach(e => {
        if (!userAllMap[e.userId])
            userAllMap[e.userId] = [];
        userAllMap[e.userId].push(e);
    });
    Object.entries(userAllMap).forEach(([userId, allEntries]) => {
        const bigEntries = allEntries.filter(e => e.amount > baseline.p95Amount);
        if (bigEntries.length < 2)
            return;
        const totalAmount = bigEntries.reduce((s, e) => s + e.amount, 0);
        alerts.push({
            id: `user-highval-${userId}`,
            category: 'user',
            severity: bigEntries.length >= 4 ? 'CRITICAL' : 'HIGH',
            title: `${userId} — High-Value Entry Concentration`,
            detail: `${userId} posted ${bigEntries.length} entries above P95 threshold (₹${fmtAmt(baseline.p95Amount)}), totalling ₹${fmtAmt(totalAmount)}`,
            insight: `${((bigEntries.length / allEntries.length) * 100).toFixed(0)}% of ${userId}'s entries exceed the 95th percentile — significantly above expected rate`,
            recommendation: `Verify authorization chain for all high-value entries by ${userId}. Confirm each has supporting invoice`,
            entryIds: bigEntries.map(e => e.entryId),
            totalAmount,
            entryCount: bigEntries.length,
        });
    });
    // ── PATTERN 3: VENDOR NEAR-DUPLICATE PAYMENTS ────────────────────────────
    const vendorJEMap = {};
    journalEntries.forEach(e => {
        const v = getVendor(e);
        if (!vendorJEMap[v])
            vendorJEMap[v] = [];
        vendorJEMap[v].push(e);
    });
    Object.entries(vendorJEMap).forEach(([vendor, vEntries]) => {
        const dupPairs = [];
        for (let i = 0; i < vEntries.length; i++) {
            for (let j = i + 1; j < vEntries.length; j++) {
                const a1 = getAmount(vEntries[i]);
                const a2 = getAmount(vEntries[j]);
                if (a1 > 0 && Math.abs(a1 - a2) / a1 < 0.01) {
                    dupPairs.push({ e1: vEntries[i], e2: vEntries[j] });
                }
            }
        }
        if (dupPairs.length < 1)
            return;
        const uniqueIds = new Set();
        dupPairs.forEach(p => {
            uniqueIds.add(getEntryId(p.e1));
            uniqueIds.add(getEntryId(p.e2));
        });
        const totalAmount = [...uniqueIds].reduce((s, id) => {
            const je = journalEntries.find(e => getEntryId(e) === id);
            return s + getAmount(je || {});
        }, 0);
        alerts.push({
            id: `vendor-neardup-${vendor}`,
            category: 'vendor',
            severity: dupPairs.length >= 3 ? 'CRITICAL' : dupPairs.length >= 2 ? 'HIGH' : 'MEDIUM',
            title: `${vendor} — Near-Duplicate Payments`,
            detail: `${vendor} has ${uniqueIds.size} near-duplicate payments worth ₹${fmtAmt(totalAmount)}`,
            insight: `${dupPairs.length} payment pair(s) with amounts within 1% of each other — possible duplicate processing in ERP`,
            recommendation: `Cross-check ${vendor} invoices against payment records. Contact vendor to confirm no double payment has been made`,
            entryIds: [...uniqueIds],
            totalAmount,
            entryCount: uniqueIds.size,
        });
    });
    // ── PATTERN 4: VENDOR AMOUNT SPIKE ──────────────────────────────────────
    Object.entries(vendorJEMap).forEach(([vendor, vEntries]) => {
        if (vEntries.length < 4)
            return;
        const amounts = vEntries.map(e => getAmount(e));
        const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
        const variance = amounts.reduce((s, a) => s + Math.pow(a - mean, 2), 0) / amounts.length;
        const stdDev = Math.sqrt(variance);
        if (stdDev < 1)
            return;
        const spikeEntries = vEntries.filter(e => {
            const a = getAmount(e);
            return (a - mean) / stdDev > 2.5;
        });
        if (spikeEntries.length < 1)
            return;
        const totalAmount = spikeEntries.reduce((s, e) => s + getAmount(e), 0);
        alerts.push({
            id: `vendor-spike-${vendor}`,
            category: 'vendor',
            severity: spikeEntries.length >= 2 ? 'HIGH' : 'MEDIUM',
            title: `${vendor} — Unusual Payment Amount`,
            detail: `${vendor} has ${spikeEntries.length} payment(s) significantly above their normal range, worth ₹${fmtAmt(totalAmount)}`,
            insight: `Normal range for ${vendor}: ₹${fmtAmt(mean - stdDev)}–₹${fmtAmt(mean + stdDev)}. These entries are >2.5σ above average`,
            recommendation: `Verify invoice authenticity for large ${vendor} payments. Confirm approvals were obtained`,
            entryIds: spikeEntries.map(e => getEntryId(e)),
            totalAmount,
            entryCount: spikeEntries.length,
        });
    });
    // ── PATTERN 5: HIGH-RISK ACCOUNT CONCENTRATION ──────────────────────────
    const HIGH_RISK_ACCOUNTS = [
        { kw: 'suspense', insight: 'Suspense accounts must be cleared within the period — uncleared items indicate control failure' },
        { kw: 'clearing', insight: 'Clearing accounts with multiple entries need immediate reconciliation' },
        { kw: 'director', insight: 'Director/related-party transactions require board approval and disclosure under IFRS' },
        { kw: 'misc', insight: 'Repeated use of miscellaneous accounts suggests deliberate avoidance of proper coding' },
        { kw: 'personal', insight: 'Personal expenses through company accounts need receipts, approval and tax treatment' },
        { kw: 'write', insight: 'Write-off entries need CFO/auditor sign-off and board disclosure above materiality threshold' },
    ];
    const acctJEMap = {};
    journalEntries.forEach(e => {
        const a = getAccount(e) || 'Unknown';
        if (!acctJEMap[a])
            acctJEMap[a] = [];
        acctJEMap[a].push(e);
    });
    Object.entries(acctJEMap).forEach(([account, aEntries]) => {
        const matched = HIGH_RISK_ACCOUNTS.find(k => account.toLowerCase().includes(k.kw));
        if (!matched)
            return;
        const totalAmount = aEntries.reduce((s, e) => s + getAmount(e), 0);
        alerts.push({
            id: `account-highrisk-${account}`,
            category: 'account',
            severity: aEntries.length >= 3 ? 'CRITICAL' : aEntries.length >= 2 ? 'HIGH' : 'MEDIUM',
            title: `${account} — ${aEntries.length} Entr${aEntries.length > 1 ? 'ies' : 'y'} Flagged`,
            detail: `${account} has ${aEntries.length} entr${aEntries.length > 1 ? 'ies' : 'y'} worth ₹${fmtAmt(totalAmount)} this period`,
            insight: matched.insight,
            recommendation: aEntries.length >= 3
                ? `ESCALATE: Multiple high-risk account entries — review with senior auditor before period close`
                : `Obtain supporting documentation and approval evidence for all ${account} entries`,
            entryIds: aEntries.map(e => getEntryId(e)),
            totalAmount,
            entryCount: aEntries.length,
        });
    });
    // ── PATTERN 6: MONTH-END LARGE ENTRY SPIKE ──────────────────────────────
    const monthEndBig = patternEntries.filter(e => e.isMonthEnd && e.amount > baseline.p90Amount);
    if (monthEndBig.length >= 3) {
        const totalAmount = monthEndBig.reduce((s, e) => s + e.amount, 0);
        const uniqueUsers = [...new Set(monthEndBig.map(e => e.userId))];
        alerts.push({
            id: 'timing-monthend-spike',
            category: 'timing',
            severity: monthEndBig.length >= 5 ? 'CRITICAL' : 'HIGH',
            title: `Month-End Large Entry Concentration`,
            detail: `${monthEndBig.length} high-value entries (>₹${fmtAmt(baseline.p90Amount)}) posted on days 28–31, totalling ₹${fmtAmt(totalAmount)}`,
            insight: `Posted by: ${uniqueUsers.slice(0, 3).join(', ')}. Month-end concentration of large entries is a key indicator of earnings management under IFRS`,
            recommendation: `Review all month-end accruals — verify each has proper business justification, supporting document, and senior approval`,
            entryIds: monthEndBig.map(e => e.entryId),
            totalAmount,
            entryCount: monthEndBig.length,
        });
    }
    // ── PATTERN 7: THRESHOLD AVOIDANCE (Benford) ────────────────────────────
    const THRESHOLDS = [100000, 50000, 200000, 500000];
    THRESHOLDS.forEach(threshold => {
        const below = journalEntries.filter(e => {
            const a = getAmount(e);
            return a >= threshold * 0.95 && a < threshold;
        });
        if (below.length < 2)
            return;
        const totalAmount = below.reduce((s, e) => s + getAmount(e), 0);
        const vendors = [...new Set(below.map(e => getVendor(e)))];
        alerts.push({
            id: `benford-threshold-${threshold}`,
            category: 'benford',
            severity: below.length >= 4 ? 'CRITICAL' : below.length >= 3 ? 'HIGH' : 'MEDIUM',
            title: `Threshold Avoidance — Below ₹${fmtAmt(threshold)}`,
            detail: `${below.length} entries just below ₹${fmtAmt(threshold)} approval limit, worth ₹${fmtAmt(totalAmount)}`,
            insight: `Vendors: ${vendors.slice(0, 3).join(', ')}. Payments consistently just below approval limits suggest deliberate splitting — classic Benford's Law fraud indicator`,
            recommendation: `Investigate whether these payments required higher-level approval. Determine if a single transaction was split to avoid controls`,
            entryIds: below.map(e => getEntryId(e)),
            totalAmount,
            entryCount: below.length,
        });
    });
    const ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
    return alerts.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
