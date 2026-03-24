import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { parseCFODecisionFromWorkbook } from '../services/cfoDecisionDataService';
import { parseTrialBalanceFromRows } from '../services/fpaDataService';
import { saveCFOServicesContext } from '../types/cfoServicesContext';
import { parseCFOServicesContextFromRows } from '../utils/cfoContextParser';
import { useAgentActivity } from '../context/AgentActivityContext';
function normalizeSheetName(name) {
    return name.toLowerCase().trim().replace(/[\s-]+/g, '_');
}
export const UploadData = () => {
    const navigate = useNavigate();
    const { pushAction } = useAgentActivity();
    const [uploading, setUploading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const handleFileUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file)
            return;
        setUploading(true);
        setError(null);
        setResult(null);
        try {
            const data = new Uint8Array(await file.arrayBuffer());
            const wb = XLSX.read(data, { type: 'array' });
            const sheetNames = wb.SheetNames.slice();
            const getSheet = (workbook, keywords) => {
                const name = workbook.SheetNames.find((n) => keywords.some((k) => n.toLowerCase().includes(k.toLowerCase())));
                return name ? XLSX.utils.sheet_to_json(workbook.Sheets[name]) : null;
            };
            const r2rData = getSheet(wb, ['r2r', 'journal']);
            const trialBalanceSheetName = wb.SheetNames.find((n) => ['trial', 'balance', 'ifrs'].some((k) => n.toLowerCase().includes(k)));
            let ifrsData = trialBalanceSheetName ? XLSX.utils.sheet_to_json(wb.Sheets[trialBalanceSheetName]) : null;
            const fpaData = getSheet(wb, ['fpa', 'budget', 'variance']);
            const cfoContextRows = getSheet(wb, ['cfo_services', 'context', 'services']);
            const kpiData = getSheet(wb, ['kpi']);
            const cfoData = getSheet(wb, ['cfo_decision', 'cfo decision', 'decision_input', 'CFO_Decision']);
            let cfoDecisionData = null;
            try {
                cfoDecisionData = parseCFODecisionFromWorkbook(wb);
            }
            catch {
                if (cfoData?.length) {
                    cfoDecisionData = { rawRows: cfoData, uploadDate: new Date().toISOString(), investment: [], buildVsBuy: [], internalVsExternal: [], hireVsAutomate: [], costCutVsInvest: [], capitalAllocation: [], risks: [], auditTrail: [] };
                }
            }
            let ifrsTb = [];
            if (ifrsData?.length)
                ifrsTb = parseTrialBalanceFromSheet(ifrsData);
            if (ifrsTb.length === 0 && trialBalanceSheetName) {
                ifrsTb = parseTrialBalanceFromSheetWithHeaderDetection(wb.Sheets[trialBalanceSheetName]);
            }
            if (ifrsTb.length === 0 && wb.SheetNames.length > 0) {
                for (const sheetName of wb.SheetNames) {
                    const sheet = wb.Sheets[sheetName];
                    ifrsTb = parseTrialBalanceFromSheetWithHeaderDetection(sheet);
                    if (ifrsTb.length === 0) {
                        const rows = XLSX.utils.sheet_to_json(sheet);
                        ifrsTb = parseTrialBalanceFromSheet(rows);
                    }
                    if (ifrsTb.length > 0)
                        break;
                }
            }
            if (ifrsTb.length > 0) {
                ifrsData = ifrsTb.map((r) => ({ glCode: r.accountCode, accountName: r.accountName, accountType: r.accountType, debit: r.debit, credit: r.credit }));
            }
            const parsedData = {
                r2r: r2rData,
                trialBalance: ifrsData,
                fpa: fpaData,
                cfo: cfoDecisionData,
                kpi: kpiData,
                cfoContext: cfoContextRows,
            };
            console.log('=== UPLOAD DEBUG ===');
            console.log('All sheet names found:', sheetNames);
            console.log('Parsed data keys:', Object.keys(parsedData));
            console.log('R2R rows:', parsedData.r2r?.length);
            console.log('Trial balance rows:', parsedData.trialBalance?.length);
            console.log('FPA rows:', parsedData.fpa?.length);
            console.log('CFO rows:', parsedData.cfo ? (Array.isArray(parsedData.cfo) ? parsedData.cfo.length : Object.keys(parsedData.cfo).length) : 0);
            if (r2rData?.length)
                localStorage.setItem('finreport_r2r_entries', JSON.stringify(r2rData));
            if (ifrsData?.length)
                localStorage.setItem('finreport_trial_balance', JSON.stringify(ifrsData));
            if (fpaData?.length) {
                const fpaParsed = await parseTrialBalanceFromRows(fpaData, file.name).catch(() => null);
                if (fpaParsed) {
                    localStorage.setItem('finreport_fpa_budget', JSON.stringify(fpaParsed));
                    localStorage.setItem('finreport_fpa_actuals', JSON.stringify(fpaParsed));
                }
                else {
                    localStorage.setItem('finreport_fpa_budget', JSON.stringify(fpaData));
                    localStorage.setItem('finreport_fpa_actuals', JSON.stringify(fpaData));
                }
            }
            if (cfoDecisionData)
                localStorage.setItem('finreport_cfo_decisions', JSON.stringify(cfoDecisionData));
            if (kpiData?.length)
                localStorage.setItem('finreport_kpi_data', JSON.stringify(kpiData));
            if (cfoContextRows?.length) {
                const ctx = parseCFOServicesContextFromRows(cfoContextRows || [], file.name);
                if (ctx) {
                    localStorage.setItem('finreport_cfo_context', JSON.stringify(ctx));
                    saveCFOServicesContext(ctx);
                }
            }
            localStorage.setItem('finreport_upload_timestamp', String(Date.now()));
            console.log('=== LOCALSTORAGE AFTER UPLOAD ===');
            console.log(Object.keys(localStorage));
            const loaded = [];
            if (r2rData?.length)
                loaded.push('R2R Journal Entries');
            if (ifrsData?.length)
                loaded.push('IFRS Trial Balance');
            if (fpaData?.length)
                loaded.push('FP&A Budget vs Actuals');
            if (cfoDecisionData)
                loaded.push('CFO Decision');
            if (kpiData?.length)
                loaded.push('KPI Actuals');
            if (cfoContextRows?.length)
                loaded.push('CFO Services Context');
            setResult({
                success: true,
                message: loaded.length
                    ? `Data loaded for ${loaded.length} module(s): ${loaded.join(', ')}`
                    : 'File processed. Some sheets may not match expected names (r2r/journal, trial/balance/ifrs, fpa/budget, cfo, kpi).',
                loaded,
            });
            if (loaded.includes('R2R Journal Entries'))
                pushAction('r2r', `Processed ${r2rData.length} journal entries — open R2R Pattern Engine`);
            if (loaded.includes('IFRS Trial Balance'))
                pushAction('ifrs', 'Trial balance loaded — open IFRS Generator for statements');
            if (loaded.includes('FP&A Budget vs Actuals') || loaded.includes('KPI Actuals'))
                pushAction('fpa', 'Budget/actuals loaded — open FP&A Suite');
            if (loaded.includes('CFO Decision'))
                pushAction('decision', 'Decision data loaded — open CFO Decision Intelligence');
            if (loaded.includes('CFO Services Context'))
                pushAction('voice', 'CFO context updated');
            setTimeout(() => navigate('/dashboard'), 2000);
        }
        catch (err) {
            setError(err.message || 'Upload failed. Please check your file format.');
        }
        finally {
            setUploading(false);
        }
    };
    function normalizeTbHeader(col) {
        return col.trim().toLowerCase()
            .replace(/\s*\(₹\)\s*/gi, '').replace(/\s*\(rs\)\s*/gi, '')
            .replace(/\s+/g, ' ').trim();
    }
    function parseTrialBalanceFromSheet(rows) {
        if (!rows.length)
            return [];
        const headers = Object.keys(rows[0]);
        const normToOrig = {};
        headers.forEach((h) => {
            const n = normalizeTbHeader(h);
            if (n && !normToOrig[n])
                normToOrig[n] = h;
        });
        const pick = (...keys) => {
            for (const k of keys) {
                if (normToOrig[k])
                    return normToOrig[k];
            }
            return undefined;
        };
        const glCol = pick('gl code', 'account code', 'code', 'entry id');
        const nameCol = pick('account name', 'accountname', 'name', 'description', 'account');
        const typeCol = pick('account type', 'accounttype', 'type');
        const debitCol = pick('debit', 'debit balance', 'dr');
        const creditCol = pick('credit', 'credit balance', 'cr');
        if (!nameCol)
            return [];
        const debitColKey = debitCol || '';
        const creditColKey = creditCol || '';
        return rows.map((row, i) => {
            const accountCode = String(glCol ? row[glCol] : (row[nameCol] ?? i + 1)).trim();
            const accountName = String(row[nameCol] ?? '').trim();
            const accountType = typeCol ? String(row[typeCol] ?? 'Unknown').trim() : 'Unknown';
            const debit = debitColKey ? parseFloat(String(row[debitColKey] ?? 0).replace(/[₹,\s]/g, '')) || 0 : 0;
            const credit = creditColKey ? parseFloat(String(row[creditColKey] ?? 0).replace(/[₹,\s]/g, '')) || 0 : 0;
            return { accountCode, accountName, accountType, debit, credit };
        }).filter((e) => e.accountName && (e.debit > 0 || e.credit > 0));
    }
    /** Try to parse trial balance from a sheet when the first row might be a title (find real header row). */
    function parseTrialBalanceFromSheetWithHeaderDetection(sheet) {
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (rawRows.length < 2)
            return [];
        const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s*\(₹\)\s*/gi, '').replace(/\s+/g, ' ');
        let headerRowIndex = -1;
        let nameColIdx = -1, debitColIdx = -1, creditColIdx = -1, glColIdx = -1, typeColIdx = -1;
        for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
            const row = rawRows[r];
            if (!Array.isArray(row))
                continue;
            const cells = row.map((c) => norm(String(c ?? '')));
            const hasDebit = cells.some((c) => c.includes('debit') || c === 'dr');
            const hasCredit = cells.some((c) => c.includes('credit') || c === 'cr');
            const hasName = cells.some((c) => (c.includes('account') && c.includes('name')) || c.includes('particulars') || c === 'name');
            if (hasDebit && hasCredit && (hasName || cells.some((c) => c.includes('account') || c.includes('code')))) {
                headerRowIndex = r;
                for (let j = 0; j < cells.length; j++) {
                    const c = cells[j];
                    if (c.includes('debit') || c === 'dr')
                        debitColIdx = j;
                    if (c.includes('credit') || c === 'cr')
                        creditColIdx = j;
                    if ((c.includes('account') && c.includes('name')) || c.includes('particulars') || c === 'name')
                        nameColIdx = j;
                    if ((c.includes('gl') && c.includes('code')) || c === 'code')
                        glColIdx = j;
                    if (c.includes('account') && nameColIdx < 0)
                        nameColIdx = j;
                    if (c.includes('type'))
                        typeColIdx = j;
                }
                if (nameColIdx < 0)
                    for (let j = 0; j < cells.length; j++) {
                        if (cells[j].includes('account') || cells[j] === 'name') {
                            nameColIdx = j;
                            break;
                        }
                    }
                break;
            }
        }
        if (headerRowIndex < 0 || debitColIdx < 0 || creditColIdx < 0 || nameColIdx < 0)
            return [];
        const headerRow = rawRows[headerRowIndex];
        const rowsAsObjects = [];
        for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
            const row = rawRows[i];
            if (!Array.isArray(row))
                continue;
            const obj = {};
            for (let j = 0; j < Math.max(headerRow?.length ?? 0, row.length); j++) {
                const key = headerRow?.[j] != null ? String(headerRow[j]) : `Col${j}`;
                obj[key] = row[j];
            }
            rowsAsObjects.push(obj);
        }
        return parseTrialBalanceFromSheet(rowsAsObjects);
    }
    const parseFinancialFile = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target?.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames.includes('Trial_Balance_IFRS')
                        ? 'Trial_Balance_IFRS'
                        : workbook.SheetNames[0];
                    const sheet = workbook.Sheets[sheetName];
                    const rows = XLSX.utils.sheet_to_json(sheet);
                    if (rows.length === 0) {
                        throw new Error('File is empty or has no valid data');
                    }
                    const headers = Object.keys(rows[0]);
                    const normToOrig = {};
                    headers.forEach((h) => {
                        const n = normalizeTbHeader(h);
                        if (n && !normToOrig[n])
                            normToOrig[n] = h;
                    });
                    const pick = (...keys) => {
                        for (const k of keys) {
                            if (normToOrig[k])
                                return normToOrig[k];
                        }
                        return undefined;
                    };
                    const glCol = pick('gl code', 'account code', 'code', 'entry id');
                    const nameCol = pick('account name', 'accountname', 'name', 'description', 'account');
                    const typeCol = pick('account type', 'accounttype', 'type');
                    const debitCol = pick('debit', 'debit balance', 'dr');
                    const creditCol = pick('credit', 'credit balance', 'cr');
                    if (!nameCol || !debitCol || !creditCol) {
                        throw new Error(`Missing required columns. Need at least: Account/Name, Debit, Credit. Found: ${headers.join(', ')}`);
                    }
                    const trialBalance = rows.map((row, index) => {
                        const accountCode = String(glCol ? row[glCol] : (row[nameCol] ?? index + 1)).trim();
                        const accountName = String(row[nameCol] ?? '').trim();
                        const accountType = typeCol ? String(row[typeCol] ?? 'Unknown').trim() : 'Unknown';
                        const debit = parseFloat(String(row[debitCol] ?? 0).replace(/[₹,\s]/g, '')) || 0;
                        const credit = parseFloat(String(row[creditCol] ?? 0).replace(/[₹,\s]/g, '')) || 0;
                        return { accountCode, accountName, accountType, debit, credit };
                    }).filter((entry) => entry.accountName && entry.accountName !== 'Unknown' && (entry.debit > 0 || entry.credit > 0));
                    if (trialBalance.length === 0) {
                        throw new Error('No valid accounts found. Check that Account Code, Account Name, Debit and Credit have values. Found columns: ' + headers.join(', '));
                    }
                    // Calculate summary metrics
                    let totalAssets = 0;
                    let totalLiabilities = 0;
                    let totalEquity = 0;
                    let totalRevenue = 0;
                    let totalExpenses = 0;
                    let cash = 0;
                    trialBalance.forEach(entry => {
                        const type = entry.accountType.toLowerCase();
                        const netAmount = entry.debit - entry.credit;
                        if (type.includes('asset')) {
                            totalAssets += entry.debit;
                            if (entry.accountName.toLowerCase().includes('cash')) {
                                cash += entry.debit;
                            }
                        }
                        else if (type.includes('liability')) {
                            totalLiabilities += entry.credit;
                        }
                        else if (type.includes('equity')) {
                            totalEquity += entry.credit;
                        }
                        else if (type.includes('revenue') || type.includes('income')) {
                            totalRevenue += entry.credit;
                        }
                        else if (type.includes('expense') || type.includes('cost')) {
                            totalExpenses += entry.debit;
                        }
                    });
                    const netProfit = totalRevenue - totalExpenses;
                    resolve({
                        trialBalance,
                        summary: {
                            totalAssets,
                            totalLiabilities,
                            totalEquity,
                            totalRevenue,
                            totalExpenses,
                            netProfit,
                            cash
                        },
                        uploadDate: new Date().toISOString(),
                        fileName: file.name
                    });
                }
                catch (error) {
                    reject(new Error(`Failed to parse file: ${error.message}`));
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    };
    return (_jsx("div", { className: "min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8", children: _jsxs("div", { className: "max-w-4xl mx-auto", children: [_jsxs("div", { className: "text-center mb-12", children: [_jsx("h1", { className: "text-4xl font-bold text-white mb-4", children: "Upload Financial Data" }), _jsx("p", { className: "text-slate-300 text-lg", children: "Upload your Trial Balance (Excel or CSV) to power your CFO Dashboard" }), _jsx("p", { className: "text-slate-400 text-sm mt-2", children: "One upload updates all sections: R2R, IFRS, FP&A, CFO Decision, and more." })] }), _jsx("div", { className: "bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20", children: _jsxs("div", { className: "flex flex-col items-center", children: [_jsx("div", { className: "w-24 h-24 bg-purple-500/20 rounded-full flex items-center justify-center mb-6", children: _jsx(FileSpreadsheet, { className: "w-12 h-12 text-purple-400" }) }), _jsx("h2", { className: "text-2xl font-semibold text-white mb-4", children: "Upload Trial Balance" }), _jsxs("p", { className: "text-slate-300 text-center mb-8 max-w-2xl", children: ["Single sheet: Account Code, Account Name, Account Type, Debit, Credit.", _jsx("br", {}), _jsx("span", { className: "text-purple-200", children: "Demo (one file, 7 sheets):" }), " R2R_Journal_Entries, Trial_Balance_IFRS, FPA_Budget_vs_Actuals, CFO_Decision_Inputs (or Investment / Build vs Buy / \u2026), KPI_Actuals, CFO_Services_Context (AI context, KPI thresholds, Health Score, Insight seeds), README \u2192 all modules use this file."] }), _jsxs("label", { htmlFor: "file-upload", className: "w-full max-w-md border-2 border-dashed border-purple-400 rounded-xl p-12 cursor-pointer hover:border-purple-300 transition-all hover:bg-white/5", children: [_jsxs("div", { className: "flex flex-col items-center", children: [_jsx(Upload, { className: "w-16 h-16 text-purple-400 mb-4" }), _jsx("p", { className: "text-white font-semibold mb-2", children: "Click to upload or drag and drop" }), _jsx("p", { className: "text-slate-400 text-sm", children: "Excel (.xlsx, .xls) or CSV files" })] }), _jsx("input", { id: "file-upload", type: "file", className: "hidden", accept: ".csv,.xlsx,.xls", onChange: handleFileUpload, disabled: uploading })] }), uploading && (_jsxs("div", { className: "mt-8 flex items-center space-x-3", children: [_jsx("div", { className: "animate-spin rounded-full h-6 w-6 border-b-2 border-purple-400" }), _jsx("p", { className: "text-white", children: "Processing your file..." })] })), result && (_jsx("div", { className: "mt-8 w-full max-w-md bg-green-500/20 border border-green-500/50 rounded-xl p-6", children: _jsxs("div", { className: "flex items-start space-x-3", children: [_jsx(CheckCircle, { className: "w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" }), _jsxs("div", { className: "flex-1", children: [_jsx("h3", { className: "text-white font-semibold mb-2", children: "Upload Successful!" }), _jsx("p", { className: "text-green-200 text-sm mb-4", children: result.message }), result.multiSheet && result.loaded?.length > 0 && (_jsxs("p", { className: "text-green-100 text-xs mb-2", children: ["Loaded for: ", result.loaded.join(' · ')] })), result.data && (_jsxs("div", { className: "space-y-2 text-sm", children: [_jsxs("div", { className: "flex justify-between text-green-100", children: [_jsx("span", { children: "Cash:" }), _jsxs("span", { className: "font-semibold", children: ["\u20B9", (result.data.cash / 10000000).toFixed(2), "Cr"] })] }), _jsxs("div", { className: "flex justify-between text-green-100", children: [_jsx("span", { children: "Revenue:" }), _jsxs("span", { className: "font-semibold", children: ["\u20B9", (result.data.totalRevenue / 10000000).toFixed(2), "Cr"] })] }), _jsxs("div", { className: "flex justify-between text-green-100", children: [_jsx("span", { children: "Expenses:" }), _jsxs("span", { className: "font-semibold", children: ["\u20B9", (result.data.totalExpenses / 10000000).toFixed(2), "Cr"] })] }), _jsxs("div", { className: "flex justify-between text-green-100", children: [_jsx("span", { children: "Net Profit:" }), _jsxs("span", { className: "font-semibold", children: ["\u20B9", (result.data.netProfit / 10000000).toFixed(2), "Cr"] })] }), _jsxs("div", { className: "flex justify-between text-green-100", children: [_jsx("span", { children: "Total Assets:" }), _jsxs("span", { className: "font-semibold", children: ["\u20B9", (result.data.totalAssets / 10000000).toFixed(2), "Cr"] })] })] })), _jsx("p", { className: "text-green-200 text-sm mt-4", children: "Redirecting to dashboard..." })] })] }) })), error && (_jsx("div", { className: "mt-8 w-full max-w-md bg-red-500/20 border border-red-500/50 rounded-xl p-6", children: _jsxs("div", { className: "flex items-start space-x-3", children: [_jsx(AlertCircle, { className: "w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" }), _jsxs("div", { children: [_jsx("h3", { className: "text-white font-semibold mb-2", children: "Upload Failed" }), _jsx("p", { className: "text-red-200 text-sm", children: error })] })] }) }))] }) }), _jsxs("div", { className: "mt-8 bg-white/5 backdrop-blur-lg rounded-xl p-6 border border-white/10", children: [_jsxs("h3", { className: "text-white font-semibold mb-4 flex items-center", children: [_jsx(FileSpreadsheet, { className: "w-5 h-5 mr-2" }), "File Format Requirements"] }), _jsxs("div", { className: "grid md:grid-cols-2 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("h4", { className: "text-purple-300 font-medium mb-2", children: "Required Columns:" }), _jsxs("ul", { className: "text-slate-300 space-y-1", children: [_jsx("li", { children: "\u2022 Account Code" }), _jsx("li", { children: "\u2022 Account Name" }), _jsx("li", { children: "\u2022 Account Type (Asset, Liability, Equity, Revenue, Expense)" }), _jsx("li", { children: "\u2022 Debit" }), _jsx("li", { children: "\u2022 Credit" })] })] }), _jsxs("div", { children: [_jsx("h4", { className: "text-purple-300 font-medium mb-2", children: "Example:" }), _jsxs("div", { className: "bg-black/30 rounded p-3 text-xs text-slate-300 font-mono", children: ["1000, Cash, Asset, 812450, 0", _jsx("br", {}), "4000, Revenue, Revenue, 0, 362000", _jsx("br", {}), "5100, Operations, Expense, 118000, 0"] })] })] })] })] }) }));
};
