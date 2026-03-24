import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// IFRS Statement Generator - Complete 3-Step Wizard
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { Upload, CheckCircle, AlertTriangle, Download, ArrowLeft, ArrowRight, Zap, BarChart3, TrendingUp, FileSpreadsheet, X, Building2, ShoppingCart, Cpu, Factory, Briefcase, Sparkles, DollarSign, AlertCircle, RefreshCw } from 'lucide-react';
import { getAISuggestions, LIABILITY_MAPPING_OPTIONS } from '../services/mappingService';
import IFRSTabBar from '../components/IFRSTabBar';
import { NoteTemplate } from '../components/ifrs-notes';
import ManagementCommentary from '../components/ifrs-notes/ManagementCommentary';
// ==================== MAIN COMPONENT ====================
export const IFRSStatementGenerator = () => {
    const navigate = useNavigate();
    const [currentStep, setCurrentStep] = useState(1);
    // Step 1 state
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    // Step 2 state
    const [trialBalance, setTrialBalance] = useState([]);
    const [aiMappings, setAiMappings] = useState([]);
    const [userMappings, setUserMappings] = useState({});
    const [selectedAccount, setSelectedAccount] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [templates, setTemplates] = useState([]);
    const [showTemplateModal, setShowTemplateModal] = useState(false);
    const [showCustomUpload, setShowCustomUpload] = useState(false);
    const [customTemplateFile, setCustomTemplateFile] = useState(null);
    const [uploadingCustom, setUploadingCustom] = useState(false);
    // Step 3 state
    const [statements, setStatements] = useState(null);
    const [activeTab, setActiveTab] = useState('financial-position');
    const [activeSection, setActiveSection] = useState('financial-position');
    const [entityName, setEntityName] = useState('Your Company Ltd');
    const [periodEnd, setPeriodEnd] = useState('2024-12-31');
    const [currency, setCurrency] = useState('USD');
    const [generating, setGenerating] = useState(false);
    const [generatingNotes, setGeneratingNotes] = useState(false);
    const [completedSections, setCompletedSections] = useState([]);
    const [noteCustomizations, setNoteCustomizations] = useState({});
    const [generatedNotes, setGeneratedNotes] = useState({});
    const [commentaryContent, setCommentaryContent] = useState('');
    const [editedStatements, setEditedStatements] = useState(null);
    const ACCRUED_EXPENSES_PATH = 'financialPosition.liabilities.current.accruedExpenses';
    // Load templates on mount - use built-in templates from mapping service
    useEffect(() => {
        loadTemplates();
    }, []);
    // On mount: read trial balance from localStorage and show step 2 immediately (no re-upload needed)
    useEffect(() => {
        const raw = localStorage.getItem('ifrs_trial_balance');
        if (!raw)
            return;
        const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s_]+/g, '');
        const pick = (row, ...keys) => {
            for (const k of keys) {
                const nk = norm(k);
                for (const [header, val] of Object.entries(row || {})) {
                    if (val == null && val !== 0)
                        continue;
                    if (norm(String(header)) === nk || norm(String(header)).includes(nk) || nk.includes(norm(String(header))))
                        return val;
                }
                if (row[k] != null && row[k] !== '')
                    return row[k];
                if (row[nk] != null && row[nk] !== '')
                    return row[nk];
            }
            return '';
        };
        try {
            const data = JSON.parse(raw);
            const tb = Array.isArray(data) ? data : (data?.trialBalance ?? []);
            if (!Array.isArray(tb) || tb.length === 0)
                return;
            const entries = tb.map((row, i) => {
                const glCode = String(pick(row, 'gl code', 'glCode', 'account code', 'accountcode', 'code', 'entry id') || (i + 1)).trim();
                const accountName = String(pick(row, 'account name', 'accountName', 'accountname', 'name', 'description', 'account') || '').trim();
                const debit = parseFloat(String(pick(row, 'debit', 'debit balance', 'dr')).replace(/[₹,\s]/g, '')) || 0;
                const credit = parseFloat(String(pick(row, 'credit', 'credit balance', 'cr')).replace(/[₹,\s]/g, '')) || 0;
                let accountType = 'unknown';
                if (debit > 0)
                    accountType = 'asset/expense';
                if (credit > 0)
                    accountType = 'liability/equity/revenue';
                return { glCode, accountName, debit, credit, accountType, mappingStatus: 'unmapped' };
            }).filter((e) => e.accountName && (e.debit > 0 || e.credit > 0));
            if (entries.length === 0)
                return;
            setTrialBalance(entries);
            setCurrentStep(2);
            (async () => {
                try {
                    const aiResults = await getAISuggestions(entries);
                    const mappings = entries.map(entry => {
                        const r = aiResults[entry.glCode];
                        const confidence = r?.confidence ?? 0;
                        const suggested = r?.suggestedMapping ?? '';
                        const status = confidence >= 80 ? 'mapped' : confidence >= 50 ? 'uncertain' : 'unmapped';
                        return {
                            glCode: entry.glCode,
                            accountName: entry.accountName,
                            suggestedMapping: suggested || 'unmapped',
                            confidence,
                            status,
                            alternatives: (r?.alternatives ?? []).map((alt) => ({
                                path: alt.ifrsLine ?? '',
                                label: alt.label ?? ''
                            })),
                        };
                    });
                    setAiMappings(mappings);
                    const initialMappings = {};
                    mappings.forEach((m) => {
                        if (m.confidence >= 80 && m.suggestedMapping !== 'unmapped')
                            initialMappings[m.glCode] = m.suggestedMapping;
                    });
                    entries.forEach((entry) => {
                        const name = (entry.accountName || '').toLowerCase();
                        const glCodeStr = String(entry.glCode ?? '').trim();
                        if (glCodeStr === '2100' || /accrued\s*expenses?/.test(name) || (entry.credit > entry.debit && name.includes('accrued'))) {
                            const path = 'financialPosition.liabilities.current.accruedExpenses';
                            initialMappings[entry.glCode] = path;
                            if (glCodeStr !== String(entry.glCode))
                                initialMappings[glCodeStr] = path;
                        }
                    });
                    setUserMappings(initialMappings);
                }
                catch (e) {
                    console.error('IFRS AI mappings error', e);
                }
            })();
        }
        catch (e) {
            console.error('IFRS load error', e);
        }
    }, []);
    // Keep activeTab in sync with activeSection for statement tabs
    useEffect(() => {
        setActiveTab(activeSection);
    }, [activeSection]);
    // Mark section as completed when viewed
    useEffect(() => {
        if (!activeSection)
            return;
        setCompletedSections((prev) => prev.includes(activeSection) ? prev : [...prev, activeSection]);
    }, [activeSection]);
    // Correct Accrued Expenses: always map to Current Liabilities, never leave empty or as Revenue/other income
    useEffect(() => {
        if (trialBalance.length === 0)
            return;
        setUserMappings((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const entry of trialBalance) {
                const isLiability = entry.credit > entry.debit;
                const name = (entry.accountName || '').toLowerCase();
                const glCodeStr = String(entry.glCode ?? '').trim();
                const isAccruedExpenses = glCodeStr === '2100' || /accrued\s*expenses?/.test(name) || (name.includes('accrued') && isLiability);
                if (!isAccruedExpenses)
                    continue;
                const current = next[entry.glCode] ?? next[glCodeStr];
                const wrong = !current || current.startsWith('profitLoss.') || /revenue|income/i.test(current);
                if (wrong) {
                    next[entry.glCode] = ACCRUED_EXPENSES_PATH;
                    if (glCodeStr && glCodeStr !== String(entry.glCode))
                        next[glCodeStr] = ACCRUED_EXPENSES_PATH;
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [trialBalance]);
    const loadTemplates = async () => {
        try {
            // Import templates from mapping service
            const { INDUSTRY_TEMPLATES } = await import('../services/mappingService');
            setTemplates(INDUSTRY_TEMPLATES);
        }
        catch (error) {
            console.error('Failed to load templates:', error);
        }
    };
    // ==================== STEP 1: UPLOAD ====================
    const handleFileSelect = (e) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setUploadError(null);
        }
    };
    const handleDrop = (e) => {
        e.preventDefault();
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile) {
            setFile(droppedFile);
            setUploadError(null);
        }
    };
    const handleUpload = async () => {
        if (!file)
            return;
        setUploading(true);
        setUploadError(null);
        try {
            const parsedData = await parseUploadedFile(file);
            setTrialBalance(parsedData);
            try {
                localStorage.setItem('ifrs_trial_balance', JSON.stringify(parsedData));
            }
            catch (_) { }
            // Show trial balance / mapping step immediately so user always sees data
            setCurrentStep(2);
            setUploading(false);
            // Then load AI mapping suggestions in background (rule-based if backend unavailable)
            try {
                const aiResults = await getAISuggestions(parsedData);
                const mappings = parsedData.map(entry => {
                    const r = aiResults[entry.glCode];
                    const confidence = r?.confidence ?? 0;
                    const suggested = r?.suggestedMapping ?? '';
                    const status = confidence >= 80 ? 'mapped' : confidence >= 50 ? 'uncertain' : 'unmapped';
                    return {
                        glCode: entry.glCode,
                        accountName: entry.accountName,
                        suggestedMapping: suggested || 'unmapped',
                        confidence,
                        status,
                        alternatives: (r?.alternatives ?? []).map((alt) => ({
                            path: alt.ifrsLine ?? '',
                            label: alt.label ?? ''
                        }))
                    };
                });
                setAiMappings(mappings);
                const initialMappings = {};
                mappings.forEach((m) => {
                    if (m.confidence >= 80 && m.suggestedMapping !== 'unmapped') {
                        initialMappings[m.glCode] = m.suggestedMapping;
                    }
                });
                parsedData.forEach((entry) => {
                    const name = (entry.accountName || '').toLowerCase();
                    if (/accrued\s*expenses?/.test(name) || (entry.credit > entry.debit && name.includes('accrued'))) {
                        initialMappings[entry.glCode] = 'financialPosition.liabilities.current.accruedExpenses';
                    }
                });
                setUserMappings(initialMappings);
            }
            catch (e) {
                console.error('IFRS AI mappings', e);
                setAiMappings(parsedData.map(entry => ({
                    glCode: entry.glCode,
                    accountName: entry.accountName,
                    suggestedMapping: 'unmapped',
                    confidence: 0,
                    status: 'unmapped',
                    alternatives: []
                })));
            }
        }
        catch (error) {
            setUploadError(error?.message || 'Failed to parse file');
            setUploading(false);
        }
    };
    // Normalize header for column matching: strip, lowercase, remove (₹)/(Rs)
    const normalizeHeader = (col) => col.trim().toLowerCase()
        .replace(/\s*\(₹\)\s*/gi, '').replace(/\s*\(rs\)\s*/gi, '')
        .replace(/\s+/g, ' ').trim();
    // Parse Excel/CSV — try every sheet; detect header row (in case row 1 is a title)
    const parseUploadedFile = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target?.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetNames = workbook.SheetNames.includes('Trial_Balance_IFRS')
                        ? ['Trial_Balance_IFRS', ...workbook.SheetNames.filter((n) => n !== 'Trial_Balance_IFRS')]
                        : workbook.SheetNames;
                    let lastError = null;
                    for (const sheetName of sheetNames) {
                        const sheet = workbook.Sheets[sheetName];
                        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                        if (rawRows.length < 2)
                            continue;
                        const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s*\(₹\)\s*/gi, '').replace(/\s+/g, ' ');
                        let headerRowIndex = -1;
                        let nameColIdx = -1;
                        let debitColIdx = -1;
                        let creditColIdx = -1;
                        let glColIdx = -1;
                        let typeColIdx = -1;
                        for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
                            const row = rawRows[r];
                            if (!Array.isArray(row))
                                continue;
                            const cells = row.map((c) => norm(String(c ?? '')));
                            const hasDebit = cells.some((c) => c.includes('debit') || c === 'dr');
                            const hasCredit = cells.some((c) => c.includes('credit') || c === 'cr');
                            const hasName = cells.some((c) => c.includes('account') && c.includes('name') || c.includes('particulars') || c === 'name' || c.includes('description'));
                            if (hasDebit && hasCredit && (hasName || cells.some((c) => c.includes('account') || c.includes('code')))) {
                                headerRowIndex = r;
                                for (let j = 0; j < cells.length; j++) {
                                    const c = cells[j];
                                    if (c.includes('debit') || c === 'dr')
                                        debitColIdx = j;
                                    if (c.includes('credit') || c === 'cr')
                                        creditColIdx = j;
                                    if ((c.includes('account') && c.includes('name')) || c.includes('particulars') || c === 'name' || c.includes('description'))
                                        nameColIdx = j;
                                    if ((c.includes('gl') && c.includes('code')) || c === 'code' || c.includes('account no'))
                                        glColIdx = j;
                                    if (c.includes('account') && !c.includes('name') && nameColIdx < 0)
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
                        if (headerRowIndex < 0 || debitColIdx < 0 || creditColIdx < 0 || nameColIdx < 0) {
                            const firstRow = rawRows[0];
                            lastError = `Sheet "${sheetName}": no header row with Debit/Credit/Account. First row: ${Array.isArray(firstRow) ? firstRow.slice(0, 6).join(', ') : ''}`;
                            continue;
                        }
                        const entries = [];
                        for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
                            const row = rawRows[i];
                            if (!Array.isArray(row))
                                continue;
                            const accountName = String(row[nameColIdx] ?? '').trim();
                            const debitRaw = row[debitColIdx];
                            const creditRaw = row[creditColIdx];
                            const debit = parseFloat(String(debitRaw ?? 0).replace(/[₹,\s]/g, '')) || 0;
                            const credit = parseFloat(String(creditRaw ?? 0).replace(/[₹,\s]/g, '')) || 0;
                            if (!accountName && debit === 0 && credit === 0)
                                continue;
                            const glCode = glColIdx >= 0 ? String(row[glColIdx] ?? '').trim() : String(i - headerRowIndex);
                            let accountType = 'unknown';
                            if (typeColIdx >= 0 && row[typeColIdx])
                                accountType = String(row[typeColIdx]).trim().toLowerCase();
                            if (accountType === 'unknown') {
                                if (debit > 0)
                                    accountType = 'asset/expense';
                                if (credit > 0)
                                    accountType = 'liability/equity/revenue';
                            }
                            entries.push({
                                glCode: glCode || String(i - headerRowIndex),
                                accountName: accountName || `Line ${i - headerRowIndex}`,
                                debit,
                                credit,
                                accountType,
                                mappingStatus: 'unmapped'
                            });
                        }
                        const valid = entries.filter((e) => e.accountName && (e.debit > 0 || e.credit > 0));
                        if (valid.length > 0) {
                            resolve(valid);
                            return;
                        }
                        lastError = `Sheet "${sheetName}": no data rows with Debit/Credit values.`;
                    }
                    reject(new Error(lastError || 'No valid data found. Need a sheet with a header row containing Debit, Credit, and Account Name (or Particulars).'));
                }
                catch (error) {
                    reject(new Error(error.message || `Failed to parse file`));
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    };
    const loadSampleData = async () => {
        try {
            // Load sample CSV from public folder and parse it client-side
            const response = await fetch('/sample-trial-balance.csv');
            const text = await response.text();
            // Simple CSV parser (for more complex CSVs, you could use PapaParse)
            const lines = text.split('\n').filter(line => line.trim());
            const headers = lines[0].split(',').map(h => h.trim());
            const entries = lines.slice(1).map(line => {
                const values = line.split(',').map(v => v.trim());
                const row = {};
                headers.forEach((header, idx) => {
                    row[header] = values[idx];
                });
                const glCode = String(row['GL Code'] || row['GLCode'] || '').trim();
                const accountName = String(row['Account Name'] || row['AccountName'] || '').trim();
                const debit = parseFloat(row['Debit'] || 0);
                const credit = parseFloat(row['Credit'] || 0);
                let accountType = 'unknown';
                if (debit > 0)
                    accountType = 'asset/expense';
                if (credit > 0)
                    accountType = 'liability/equity/revenue';
                return {
                    glCode,
                    accountName,
                    debit,
                    credit,
                    accountType,
                    mappingStatus: 'unmapped'
                };
            }).filter(entry => entry.glCode && entry.accountName);
            setTrialBalance(entries);
            // Trigger AI mapping (backend or rule-based)
            const aiResults = await getAISuggestions(entries);
            const mappings = entries.map(entry => {
                const r = aiResults[entry.glCode];
                const confidence = r?.confidence ?? 0;
                const suggested = r?.suggestedMapping ?? '';
                const status = confidence >= 80 ? 'mapped' : confidence >= 50 ? 'uncertain' : 'unmapped';
                return {
                    glCode: entry.glCode,
                    accountName: entry.accountName,
                    suggestedMapping: suggested || 'unmapped',
                    confidence,
                    status,
                    alternatives: (r?.alternatives ?? []).map((alt) => ({
                        path: alt.ifrsLine ?? '',
                        label: alt.label ?? ''
                    }))
                };
            });
            setAiMappings(mappings);
            const initialMappings = {};
            mappings.forEach((m) => {
                if (m.confidence >= 80 && m.suggestedMapping !== 'unmapped') {
                    initialMappings[m.glCode] = m.suggestedMapping;
                }
            });
            entries.forEach((entry) => {
                const name = (entry.accountName || '').toLowerCase();
                const glCodeStr = String(entry.glCode ?? '').trim();
                if (glCodeStr === '2100' || /accrued\s*expenses?/.test(name) || (entry.credit > entry.debit && name.includes('accrued'))) {
                    const path = 'financialPosition.liabilities.current.accruedExpenses';
                    initialMappings[entry.glCode] = path;
                    if (glCodeStr !== String(entry.glCode))
                        initialMappings[glCodeStr] = path;
                }
            });
            setUserMappings(initialMappings);
            setCurrentStep(2);
        }
        catch (error) {
            console.error('Failed to load sample data:', error);
            alert('Failed to load sample data. Please upload your own file.');
        }
    };
    // ==================== STEP 2: MAPPING ====================
    const applyTemplate = (template) => {
        const newMappings = { ...userMappings };
        let addedCount = 0;
        // Only apply template mappings to UNMAPPED accounts
        Object.entries(template.mappings).forEach(([glCode, mapping]) => {
            const accountExists = trialBalance.find(acc => acc.glCode === glCode);
            const isUnmapped = !newMappings[glCode] || newMappings[glCode] === 'unmapped';
            if (accountExists && isUnmapped) {
                newMappings[glCode] = mapping;
                addedCount++;
            }
        });
        setUserMappings(newMappings);
        setShowTemplateModal(false);
        // Show success message
        if (addedCount > 0) {
            alert(`✅ ${template.name} template applied — ${addedCount} additional account${addedCount > 1 ? 's' : ''} mapped`);
        }
        else {
            alert(`ℹ️ ${template.name} template loaded, but all matching accounts were already mapped.`);
        }
    };
    const downloadBlankTemplate = () => {
        // Import required libraries and data
        Promise.all([
            import('../services/mappingService'),
            import('xlsx')
        ]).then(([{ IFRS_LINE_ITEMS }, XLSX]) => {
            // SHEET 1: "My Company Mapping" (user fills this)
            const sheet1Data = [
                // Header row
                ['GL Code', 'Account Name', 'IFRS Line Item', 'See Sheet 2 for valid IFRS Line Items →'],
                // Example row (will be highlighted yellow)
                ['1001', 'Cash & Bank', 'financialPosition.assets.current.cashAndEquivalents', ''],
                // Empty rows for user to fill
                ...Array(98).fill(['', '', '', ''])
            ];
            const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
            // Set column widths
            ws1['!cols'] = [
                { wch: 12 }, // GL Code
                { wch: 35 }, // Account Name
                { wch: 55 }, // IFRS Line Item
                { wch: 40 } // Note column
            ];
            // Freeze first row (headers)
            ws1['!freeze'] = { xSplit: 0, ySplit: 1 };
            // Style header row (row 1) - dark blue background, white text, bold
            const headerStyle = {
                fill: { fgColor: { rgb: "1F4E78" } },
                font: { bold: true, color: { rgb: "FFFFFF" } },
                alignment: { horizontal: "center", vertical: "center" }
            };
            // Style example row (row 2) - yellow background
            const exampleStyle = {
                fill: { fgColor: { rgb: "FFFF00" } },
                font: { italic: true }
            };
            // Apply header styles
            ['A1', 'B1', 'C1', 'D1'].forEach(cell => {
                if (!ws1[cell])
                    ws1[cell] = { t: 's', v: '' };
                ws1[cell].s = headerStyle;
            });
            // Apply example row styles
            ['A2', 'B2', 'C2'].forEach(cell => {
                if (!ws1[cell])
                    ws1[cell] = { t: 's', v: '' };
                ws1[cell].s = exampleStyle;
            });
            // Add data validation (dropdown) for column C (IFRS Line Item)
            // This creates a dropdown with all valid IFRS values
            const validValues = IFRS_LINE_ITEMS.map(item => item.value);
            ws1['!dataValidation'] = [{
                    sqref: 'C3:C100', // Apply to rows 3-100 in column C
                    type: 'list',
                    allowBlank: true,
                    formula1: `"${validValues.join(',')}"`,
                    showDropDown: true
                }];
            // SHEET 2: "IFRS Reference" (read-only reference)
            const sheet2Data = [
                // Title row
                ['Available IFRS Line Items - Copy exact value from Column A into Sheet 1 Column C'],
                [''], // Empty row
                // Headers
                ['IFRS Line Item Value', 'Label', 'Statement Type', 'Category'],
                // All IFRS line items
                ...IFRS_LINE_ITEMS.map(item => [
                    item.value,
                    item.label,
                    item.statement,
                    item.category || ''
                ])
            ];
            const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
            // Set column widths for Sheet 2
            ws2['!cols'] = [
                { wch: 60 }, // IFRS Line Item Value
                { wch: 35 }, // Label
                { wch: 18 }, // Statement Type
                { wch: 25 } // Category
            ];
            // Freeze first 3 rows (title, blank, headers)
            ws2['!freeze'] = { xSplit: 0, ySplit: 3 };
            // Style title row
            const titleStyle = {
                fill: { fgColor: { rgb: "FFC000" } },
                font: { bold: true, size: 14 },
                alignment: { horizontal: "left", vertical: "center" }
            };
            if (!ws2['A1'])
                ws2['A1'] = { t: 's', v: '' };
            ws2['A1'].s = titleStyle;
            // Style header row (row 3)
            ['A3', 'B3', 'C3', 'D3'].forEach(cell => {
                if (!ws2[cell])
                    ws2[cell] = { t: 's', v: '' };
                ws2[cell].s = {
                    fill: { fgColor: { rgb: "4472C4" } },
                    font: { bold: true, color: { rgb: "FFFFFF" } },
                    alignment: { horizontal: "center", vertical: "center" }
                };
            });
            // Create workbook with both sheets
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws1, 'My Company Mapping');
            XLSX.utils.book_append_sheet(wb, ws2, 'IFRS Reference');
            // Download the file
            XLSX.writeFile(wb, 'blank-mapping-template.xlsx');
        }).catch(err => {
            console.error('Failed to generate template:', err);
            alert('Failed to download template. Please try again.');
        });
    };
    const handleCustomTemplateUpload = async () => {
        if (!customTemplateFile)
            return;
        setUploadingCustom(true);
        try {
            const text = await customTemplateFile.text();
            const Papa = (await import('papaparse')).default;
            Papa.parse(text, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    const data = results.data;
                    const customMappings = {};
                    let addedCount = 0;
                    for (const row of data) {
                        const glCode = row["GL Code"] || row["glCode"] || row["Code"];
                        const ifrsLine = row["IFRS Line Item"] || row["ifrsLineItem"] || row["IFRS Mapping"];
                        if (glCode && ifrsLine && ifrsLine !== 'IFRS Line Item') {
                            const accountExists = trialBalance.find(acc => acc.glCode === glCode);
                            const isUnmapped = !userMappings[glCode] || userMappings[glCode] === 'unmapped';
                            if (accountExists && isUnmapped) {
                                customMappings[glCode] = ifrsLine;
                                addedCount++;
                            }
                        }
                    }
                    if (addedCount > 0) {
                        const newMappings = { ...userMappings, ...customMappings };
                        setUserMappings(newMappings);
                        // Save to company profile permanently (Map Once Use Forever)
                        import('../services/mappingService').then(({ saveCompanyMappings }) => {
                            const companyId = localStorage.getItem('currentCompanyId') || 'company-' + Date.now();
                            const companyName = entityName || 'Your Company';
                            saveCompanyMappings(companyId, companyName, newMappings);
                        });
                        alert(`✅ Your company template saved — ${addedCount} account${addedCount > 1 ? 's' : ''} mapped`);
                        setShowTemplateModal(false);
                        setShowCustomUpload(false);
                        setCustomTemplateFile(null);
                    }
                    else {
                        alert('ℹ️ No new mappings found in the uploaded file. All accounts may already be mapped.');
                    }
                    setUploadingCustom(false);
                },
                error: (error) => {
                    alert(`Failed to parse file: ${error.message}`);
                    setUploadingCustom(false);
                }
            });
        }
        catch (err) {
            alert(`Upload failed: ${err.message}`);
            setUploadingCustom(false);
        }
    };
    const autoAcceptAll = () => {
        const newMappings = { ...userMappings };
        aiMappings.forEach(mapping => {
            const code = String(mapping.glCode ?? '').trim();
            const name = (mapping.accountName ?? '').toLowerCase();
            const is2100OrAccrued = code === '2100' || /accrued\s*expenses?/.test(name);
            if (is2100OrAccrued) {
                newMappings[mapping.glCode] = ACCRUED_EXPENSES_PATH;
                newMappings['2100'] = ACCRUED_EXPENSES_PATH;
            }
            else if (mapping.confidence >= 80) {
                newMappings[mapping.glCode] = mapping.suggestedMapping;
            }
        });
        setUserMappings(newMappings);
    };
    const updateMapping = (glCode, mapping) => {
        const key = typeof glCode === 'string' ? glCode : String(glCode);
        setUserMappings(prev => {
            const next = { ...prev, [key]: mapping };
            if (key === '2100')
                next['2100'] = mapping;
            return next;
        });
    };
    const getMappingStats = () => {
        const total = aiMappings.length;
        const mapped = aiMappings.filter(m => userMappings[m.glCode] && userMappings[m.glCode] !== 'unmapped').length;
        const uncertain = aiMappings.filter(m => m.status === 'uncertain' && !userMappings[m.glCode]).length;
        const unmapped = total - mapped - uncertain;
        return { total, mapped, uncertain, unmapped };
    };
    const canProceedToGenerate = () => {
        const stats = getMappingStats();
        return stats.unmapped === 0;
    };
    // ==================== STEP 3: GENERATE ====================
    const generateStatements = async () => {
        setGenerating(true);
        try {
            // Import and use client-side statement generator
            const { generateIFRSStatements } = await import('../services/statementGenerator');
            const sanitizedMappings = { ...userMappings };
            trialBalance.forEach((entry) => {
                const code = String(entry?.glCode ?? '').trim();
                const name = (entry?.accountName ?? '').toLowerCase();
                if (code === '2100' || /accrued\s*expenses?/.test(name) || (entry.credit > entry.debit && name.includes('accrued'))) {
                    sanitizedMappings[entry.glCode] = ACCRUED_EXPENSES_PATH;
                    sanitizedMappings['2100'] = ACCRUED_EXPENSES_PATH;
                }
            });
            const result = generateIFRSStatements({
                trialBalance,
                mappings: sanitizedMappings,
                entityName,
                periodEnd,
                currency
            });
            setStatements(result);
            setEditedStatements(JSON.parse(JSON.stringify(result)));
            setCurrentStep(3);
            setCompletedSections(['financial-position', 'profit-loss', 'cash-flows', 'equity']);
            try {
                const keyPrefix = `ifrs_note_`;
                const stored = {};
                const noteIds = ['note-1-general', 'note-2-policies', 'note-3-revenue', 'note-4-ppe', 'note-5-leases', 'note-6-instruments', 'note-7-inventory', 'note-8-tax', 'note-9-related', 'note-10-events'];
                noteIds.forEach((id) => {
                    const val = localStorage.getItem(`${keyPrefix}${id}_${entityName}_${periodEnd}`);
                    if (val)
                        stored[id] = val;
                });
                setNoteCustomizations((prev) => ({ ...prev, ...stored }));
            }
            catch (_) { }
            await generateAllNotes(result);
        }
        catch (error) {
            alert('Failed to generate statements: ' + error.message);
        }
        finally {
            setGenerating(false);
        }
    };
    const handleNoteSave = (noteId, content) => {
        if (content) {
            setNoteCustomizations((prev) => ({ ...prev, [noteId]: content }));
        }
        else {
            setNoteCustomizations((prev) => {
                const updated = { ...prev };
                delete updated[noteId];
                return updated;
            });
        }
        try {
            const key = `ifrs_note_${noteId}_${entityName}_${periodEnd}`;
            if (content)
                localStorage.setItem(key, content);
            else
                localStorage.removeItem(key);
        }
        catch (_) { }
    };
    const generateAllNotes = async (stmt) => {
        setGeneratingNotes(true);
        try {
            const { generateNoteContent, getNoteTypeForGeneration } = await import('../services/notesGeneratorService');
            const companyInfo = {
                name: entityName,
                periodEnd,
                period: periodEnd,
                currency,
            };
            const financialData = {
                financialPosition: stmt.financialPosition,
                profitLoss: stmt.profitLoss,
                cashFlows: stmt.cashFlows,
                changesInEquity: stmt.changesInEquity,
            };
            const noteIds = [
                'note-1-general',
                'note-2-policies',
                'note-3-revenue',
                'note-4-ppe',
                'note-5-leases',
                'note-6-instruments',
                'note-7-inventory',
                'note-8-tax',
                'note-9-related',
                'note-10-events',
            ];
            const notes = {};
            for (const id of noteIds) {
                const noteType = getNoteTypeForGeneration(id);
                notes[id] = await generateNoteContent(noteType, financialData, companyInfo);
            }
            setGeneratedNotes(notes);
            const commentary = await generateNoteContent('Management commentary and analysis: summarise key financial results, trends, and highlights for the period', financialData, companyInfo);
            setCommentaryContent(commentary);
        }
        catch (e) {
            console.error('Notes generation failed:', e);
        }
        finally {
            setGeneratingNotes(false);
        }
    };
    const exportStatements = async (format) => {
        if (!statements)
            return;
        try {
            if (format === 'json') {
                const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: 'application/json' });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', `ifrs-statements-${periodEnd}.json`);
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.URL.revokeObjectURL(url);
            }
            else if (format === 'excel') {
                // Export as Excel using XLSX
                const workbook = XLSX.utils.book_new();
                // Balance Sheet
                const bsData = formatBalanceSheetForExport(toExport.financialPosition);
                const bsSheet = XLSX.utils.aoa_to_sheet(bsData);
                XLSX.utils.book_append_sheet(workbook, bsSheet, 'Balance Sheet');
                const plData = formatProfitLossForExport(toExport.profitLoss);
                const plSheet = XLSX.utils.aoa_to_sheet(plData);
                XLSX.utils.book_append_sheet(workbook, plSheet, 'Profit & Loss');
                XLSX.writeFile(workbook, `ifrs-statements-${periodEnd}.xlsx`);
            }
            else {
                alert(`${format.toUpperCase()} export coming soon!`);
            }
        }
        catch (error) {
            alert('Export failed');
        }
    };
    // Helper functions for Excel export
    const formatBalanceSheetForExport = (bs) => {
        return [
            [`${entityName} - Balance Sheet`, '', `As at ${periodEnd}`],
            [''],
            ['ASSETS', '', ''],
            ['Current Assets', '', ''],
            ['Cash & Cash Equivalents', '', bs.assets.current.cashAndEquivalents || 0],
            ['Trade Receivables', '', bs.assets.current.tradeReceivables || 0],
            ['Inventories', '', bs.assets.current.inventories || 0],
            ['Prepayments', '', bs.assets.current.prepayments || 0],
            ['Other Current Assets', '', bs.assets.current.otherCurrentAssets || 0],
            ['Total Current Assets', '', bs.assets.current.total || 0],
            [''],
            ['Non-Current Assets', '', ''],
            ['Property, Plant & Equipment', '', bs.assets.nonCurrent.propertyPlantEquipment || 0],
            ['Intangible Assets', '', bs.assets.nonCurrent.intangibleAssets || 0],
            ['Investments', '', bs.assets.nonCurrent.investments || 0],
            ['Other Non-Current Assets', '', bs.assets.nonCurrent.otherNonCurrentAssets || 0],
            ['Total Non-Current Assets', '', bs.assets.nonCurrent.total || 0],
            [''],
            ['TOTAL ASSETS', '', bs.assets.total || 0],
            [''],
            ['LIABILITIES', '', ''],
            ['Current Liabilities', '', ''],
            ['Trade Payables', '', bs.liabilities.current.tradePayables || 0],
            ['Short-term Borrowings', '', bs.liabilities.current.shortTermBorrowings || 0],
            ['Other Current Liabilities', '', bs.liabilities.current.otherCurrentLiabilities || 0],
            ['Total Current Liabilities', '', bs.liabilities.current.total || 0],
            [''],
            ['Non-Current Liabilities', '', ''],
            ['Long-term Borrowings', '', bs.liabilities.nonCurrent.longTermBorrowings || 0],
            ['Other Non-Current Liabilities', '', bs.liabilities.nonCurrent.otherNonCurrentLiabilities || 0],
            ['Total Non-Current Liabilities', '', bs.liabilities.nonCurrent.total || 0],
            [''],
            ['TOTAL LIABILITIES', '', bs.liabilities.total || 0],
            [''],
            ['EQUITY', '', ''],
            ['Share Capital', '', bs.equity.shareCapital || 0],
            ['Retained Earnings', '', bs.equity.retainedEarnings || 0],
            ['Reserves', '', bs.equity.reserves || 0],
            ['TOTAL EQUITY', '', bs.equity.total || 0],
            [''],
            ['TOTAL EQUITY & LIABILITIES', '', bs.totalEquityAndLiabilities || 0]
        ];
    };
    const formatProfitLossForExport = (pl) => {
        return [
            [`${entityName} - Profit & Loss`, '', `For the period ending ${periodEnd}`],
            [''],
            ['Revenue', '', pl.revenue || 0],
            ['Cost of Sales', '', -(pl.costOfSales || 0)],
            ['Gross Profit', '', pl.grossProfit || 0],
            [''],
            ['Operating Expenses', '', ''],
            ['Employee Benefits', '', -(pl.operatingExpenses.employeeBenefits || 0)],
            ['Depreciation', '', -(pl.operatingExpenses.depreciation || 0)],
            ['Administrative', '', -(pl.operatingExpenses.administrative || 0)],
            ['Distribution', '', -(pl.operatingExpenses.distribution || 0)],
            ['Other', '', -(pl.operatingExpenses.other || 0)],
            ['Total Operating Expenses', '', -(pl.operatingExpenses.total || 0)],
            [''],
            ['Operating Profit', '', pl.operatingProfit || 0],
            ['Finance Income', '', pl.financeIncome || 0],
            ['Finance Costs', '', -(pl.financeCosts || 0)],
            ['Profit Before Tax', '', pl.profitBeforeTax || 0],
            ['Income Tax', '', -(pl.incomeTax || 0)],
            ['Profit After Tax', '', pl.profitAfterTax || 0]
        ];
    };
    // ==================== RENDER ====================
    return (_jsxs("div", { className: "min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50", children: [_jsx("div", { className: "bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50", children: _jsx("div", { className: "max-w-7xl mx-auto px-6 py-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("button", { onClick: () => (currentStep > 1 ? setCurrentStep((currentStep - 1)) : navigate('/dashboard')), className: "p-2 hover:bg-gray-100 rounded-lg transition", children: _jsx(ArrowLeft, { className: "w-5 h-5" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "IFRS Statement Generator" }), _jsx("p", { className: "text-sm text-gray-500", children: "Convert Trial Balance to IFRS Financial Statements in 60 seconds" })] })] }), _jsx("div", { className: "flex items-center gap-2", children: [1, 2, 3, 4].map(step => (_jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: `w-10 h-10 rounded-full flex items-center justify-center font-semibold ${currentStep >= step
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-gray-200 text-gray-500'}`, children: step }), step < 4 && _jsx("div", { className: `w-12 h-0.5 ${currentStep > step ? 'bg-blue-600' : 'bg-gray-200'}` })] }, step))) }), _jsxs("button", { type: "button", onClick: () => setCurrentStep(1), className: "flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm", children: [_jsx(Upload, { className: "w-4 h-4" }), _jsx("span", { children: "Upload trial balance" })] })] }) }) }), _jsx("div", { className: "max-w-7xl mx-auto px-6 py-8", children: _jsxs(AnimatePresence, { mode: "wait", children: [currentStep === 1 && (_jsx(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -20 }, children: _jsx(Step1Upload, { file: file, uploading: uploading, uploadError: uploadError, onFileSelect: handleFileSelect, onDrop: handleDrop, onUpload: handleUpload, onLoadSample: loadSampleData, onClearFile: () => { setFile(null); setUploadError(null); } }) }, "step1")), currentStep === 2 && (_jsx(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -20 }, children: _jsx(Step2Mapping, { trialBalance: trialBalance, aiMappings: aiMappings, userMappings: (() => {
                                    const forced = { ...userMappings };
                                    trialBalance.forEach((e) => {
                                        const c = String(e?.glCode ?? '').trim();
                                        const n = (e?.accountName ?? '').toLowerCase();
                                        if (c === '2100' || /accrued\s*expenses?/.test(n) || (e.credit > e.debit && n.includes('accrued'))) {
                                            forced[e.glCode] = ACCRUED_EXPENSES_PATH;
                                            forced['2100'] = ACCRUED_EXPENSES_PATH;
                                        }
                                    });
                                    return forced;
                                })(), selectedAccount: selectedAccount, templates: templates, searchQuery: searchQuery, filterStatus: filterStatus, showTemplateModal: showTemplateModal, showCustomUpload: showCustomUpload, customTemplateFile: customTemplateFile, uploadingCustom: uploadingCustom, onUpdateMapping: updateMapping, onSelectAccount: setSelectedAccount, onAutoAcceptAll: autoAcceptAll, onApplyTemplate: applyTemplate, onSearchChange: setSearchQuery, onFilterChange: setFilterStatus, onToggleTemplateModal: () => setShowTemplateModal(!showTemplateModal), onGenerate: generateStatements, canProceed: canProceedToGenerate(), generating: generating, getMappingStats: getMappingStats, onShowCustomUpload: setShowCustomUpload, onCustomFileSelect: setCustomTemplateFile, onDownloadBlankTemplate: downloadBlankTemplate, onUploadCustomTemplate: handleCustomTemplateUpload }) }, "step2")), currentStep === 3 && editedStatements && (_jsx(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -20 }, children: _jsx(Step3EditableReview, { editedStatements: editedStatements, setEditedStatements: setEditedStatements, activeSection: activeSection, onSectionChange: setActiveSection, entityName: entityName, periodEnd: periodEnd, currency: currency, onProceedToPrint: () => setCurrentStep(4) }) }, "step3")), currentStep === 4 && editedStatements && (_jsx(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -20 }, children: _jsx(Step4PrintedFormat, { statements: editedStatements, activeSection: activeSection, onSectionChange: setActiveSection, completedSections: completedSections, noteCustomizations: noteCustomizations, generatedNotes: generatedNotes, commentaryContent: commentaryContent, onNoteSave: handleNoteSave, onExport: exportStatements, generatingNotes: generatingNotes }) }, "step4"))] }) })] }));
};
const FILE_INPUT_ID = 'trial-balance-file-input';
const Step1Upload = ({ file, uploading, uploadError, onFileSelect, onDrop, onUpload, onLoadSample, onClearFile }) => {
    const fileInputRef = useRef(null);
    return (_jsxs("div", { className: "max-w-4xl mx-auto space-y-8", children: [_jsxs(motion.div, { role: file ? undefined : 'button', tabIndex: file ? undefined : 0, onKeyDown: file ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                } }, className: "bg-white rounded-2xl shadow-lg p-12 border-2 border-dashed border-gray-300", onDragOver: (e) => e.preventDefault(), onDrop: onDrop, onClick: () => { if (!file)
                    fileInputRef.current?.click(); }, whileHover: { borderColor: '#3b82f6' }, children: [_jsx("input", { id: FILE_INPUT_ID, ref: fileInputRef, type: "file", className: "sr-only", accept: ".xlsx,.xls,.csv", onChange: onFileSelect, "aria-label": "Choose trial balance file" }), _jsxs("div", { className: "flex flex-col items-center text-center", onClick: (e) => file && e.stopPropagation(), children: [_jsx("div", { className: "w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center mb-6", children: _jsx(Upload, { className: "w-12 h-12 text-blue-600" }) }), _jsx("h2", { className: "text-2xl font-bold text-gray-900 mb-2", children: "Upload Trial Balance" }), _jsx("p", { className: "text-gray-600 mb-8", children: "Drag and drop your file here, or click to browse" }), file ? (_jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 w-full max-w-md", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(FileSpreadsheet, { className: "w-8 h-8 text-blue-600" }), _jsxs("div", { className: "text-left", children: [_jsx("p", { className: "font-medium text-gray-900", children: file.name }), _jsxs("p", { className: "text-sm text-gray-500", children: [(file.size / 1024).toFixed(2), " KB"] })] })] }), _jsx(CheckCircle, { className: "w-6 h-6 text-green-500 shrink-0" })] }), _jsx("button", { type: "button", onClick: (e) => { e.stopPropagation(); onClearFile(); setTimeout(() => fileInputRef.current?.click(), 0); }, className: "mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium", children: "Change file" })] })) : (_jsx("label", { htmlFor: FILE_INPUT_ID, className: "cursor-pointer inline-block", onClick: (e) => e.stopPropagation(), children: _jsx("span", { className: "px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium inline-block", children: "Browse Files" }) })), uploadError && (_jsx("div", { className: "mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 w-full max-w-md", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(AlertTriangle, { className: "w-5 h-5" }), _jsx("span", { children: uploadError })] }) })), _jsx("p", { className: "text-sm text-gray-500 mt-6", children: "Supported formats: .xlsx, .xls, .csv" }), file && !uploadError && (_jsx("button", { onClick: onUpload, disabled: uploading, className: "mt-6 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed", children: uploading ? (_jsxs("span", { className: "flex items-center gap-2", children: [_jsx(RefreshCw, { className: "w-5 h-5 animate-spin" }), "Processing..."] })) : ('Continue to Mapping') }))] })] }), _jsx("div", { className: "grid md:grid-cols-2 lg:grid-cols-4 gap-4", children: [
                    { icon: Building2, title: 'Financial Position', desc: 'Balance Sheet' },
                    { icon: TrendingUp, title: 'Profit & Loss', desc: 'Income Statement' },
                    { icon: DollarSign, title: 'Cash Flows', desc: 'Indirect Method' },
                    { icon: BarChart3, title: 'Equity Changes', desc: 'Statement of Changes' }
                ].map((item, idx) => (_jsxs(motion.div, { className: "bg-white rounded-xl p-6 shadow-md border border-gray-100", whileHover: { y: -4, shadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }, children: [_jsx(item.icon, { className: "w-10 h-10 text-blue-600 mb-3" }), _jsx("h3", { className: "font-semibold text-gray-900 mb-1", children: item.title }), _jsx("p", { className: "text-sm text-gray-500", children: item.desc })] }, idx))) }), _jsx("div", { className: "text-center", children: _jsxs("button", { onClick: onLoadSample, className: "inline-flex items-center gap-2 px-6 py-3 text-blue-600 hover:bg-blue-50 rounded-lg transition font-medium border-2 border-blue-200", children: [_jsx(Sparkles, { className: "w-5 h-5" }), "Try with Sample Data"] }) })] }));
};
const Step2Mapping = (props) => {
    const stats = props.getMappingStats();
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "bg-white rounded-xl shadow-lg p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Review Account Mapping" }), _jsxs("div", { className: "flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg", children: [_jsx(Sparkles, { className: "w-5 h-5" }), _jsxs("span", { className: "font-semibold", children: [Math.round((stats.mapped / stats.total) * 100), "% Auto-Mapped"] })] })] }), _jsxs("div", { className: "grid grid-cols-4 gap-4", children: [_jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-gray-500", children: "Total Accounts" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: stats.total })] }), _jsxs("div", { className: "bg-green-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-green-700", children: "Mapped" }), _jsx("p", { className: "text-2xl font-bold text-green-700", children: stats.mapped })] }), _jsxs("div", { className: "bg-yellow-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-yellow-700", children: "Needs Review" }), _jsx("p", { className: "text-2xl font-bold text-yellow-700", children: stats.uncertain })] }), _jsxs("div", { className: "bg-red-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-red-700", children: "Unmapped" }), _jsx("p", { className: "text-2xl font-bold text-red-700", children: stats.unmapped })] })] }), _jsxs("div", { className: "mt-4 flex gap-3", children: [_jsx("button", { onClick: props.onAutoAcceptAll, className: "px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition", children: "Auto-Accept All (>80% confidence)" }), _jsx("button", { onClick: props.onToggleTemplateModal, className: "px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition", children: "Load Industry Template" })] })] }), _jsx("div", { className: "bg-white rounded-xl shadow-lg overflow-hidden", children: _jsxs("div", { className: "p-6", children: [_jsx("h3", { className: "text-lg font-semibold mb-4", children: "Trial Balance Accounts" }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full", children: [_jsx("thead", { className: "bg-gray-50", children: _jsxs("tr", { children: [_jsx("th", { className: "px-4 py-3 text-left text-sm font-semibold text-gray-700", children: "GL Code" }), _jsx("th", { className: "px-4 py-3 text-left text-sm font-semibold text-gray-700", children: "Account Name" }), _jsx("th", { className: "px-4 py-3 text-right text-sm font-semibold text-gray-700", children: "Debit" }), _jsx("th", { className: "px-4 py-3 text-right text-sm font-semibold text-gray-700", children: "Credit" }), _jsx("th", { className: "px-4 py-3 text-left text-sm font-semibold text-gray-700", children: "IFRS Mapping" }), _jsx("th", { className: "px-4 py-3 text-center text-sm font-semibold text-gray-700", children: "Status" })] }) }), _jsx("tbody", { className: "divide-y divide-gray-200", children: props.aiMappings.map((mapping) => {
                                            const glCodeStr = String(mapping.glCode ?? '').trim();
                                            const userMapping = props.userMappings[mapping.glCode] ?? props.userMappings[glCodeStr] ?? props.userMappings['2100'];
                                            const entry = props.trialBalance.find((a) => String(a?.glCode) === String(mapping.glCode));
                                            const isLiability = entry && (entry.credit > entry.debit || /liability|liabilities|equity|capital/.test((entry.accountType || '').toLowerCase()));
                                            const name = (mapping.accountName || '').toLowerCase();
                                            const isAccruedExpenses = glCodeStr === '2100' || /accrued\s*expenses?/.test(name) || (name.includes('accrued') && isLiability);
                                            const accruedPath = 'financialPosition.liabilities.current.accruedExpenses';
                                            const isIncomeMapping = !userMapping || userMapping.startsWith('profitLoss.') || /revenue|income/i.test(userMapping);
                                            const effectiveMapping = (isAccruedExpenses && (isIncomeMapping || userMapping !== accruedPath))
                                                ? accruedPath
                                                : (userMapping || '');
                                            const displayValue = isAccruedExpenses ? accruedPath : effectiveMapping;
                                            const isMapped = displayValue && displayValue !== 'unmapped';
                                            const useLiabilityDropdown = isLiability || isAccruedExpenses;
                                            const dropdownOptions = useLiabilityDropdown
                                                ? LIABILITY_MAPPING_OPTIONS
                                                : [
                                                    ...(mapping.suggestedMapping && mapping.suggestedMapping !== 'unmapped'
                                                        ? [{ value: mapping.suggestedMapping, label: `${mapping.suggestedMapping} (AI: ${mapping.confidence}%)` }]
                                                        : []),
                                                    ...(mapping.alternatives || []).map((alt) => ({ value: alt.path || '', label: alt.label || alt.path }))
                                                ].filter((o) => o.value);
                                            return (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: "px-4 py-3 text-sm font-mono", children: mapping.glCode }), _jsxs("td", { className: "px-4 py-3 text-sm", children: [mapping.accountName, isAccruedExpenses && (_jsx("span", { className: "ml-1 text-xs text-blue-600 font-medium", children: "(Current Liabilities)" }))] }), _jsx("td", { className: "px-4 py-3 text-sm text-right", children: entry?.debit.toLocaleString() }), _jsx("td", { className: "px-4 py-3 text-sm text-right", children: entry?.credit.toLocaleString() }), _jsx("td", { className: "px-4 py-3 text-sm", children: _jsxs("select", { value: displayValue, onChange: (e) => props.onUpdateMapping(mapping.glCode, e.target.value), className: "w-full px-2 py-1 border border-gray-300 rounded text-sm", children: [_jsx("option", { value: "", children: "Select mapping..." }), useLiabilityDropdown
                                                                    ? LIABILITY_MAPPING_OPTIONS.map((opt) => (_jsx("option", { value: opt.value, children: opt.label }, opt.value)))
                                                                    : dropdownOptions.map((opt, idx) => (_jsx("option", { value: opt.value, children: opt.label }, opt.value || idx)))] }) }), _jsx("td", { className: "px-4 py-3 text-center", children: isMapped ? (_jsx(CheckCircle, { className: "w-5 h-5 text-green-500 mx-auto" })) : mapping.confidence >= 50 ? (_jsx(AlertTriangle, { className: "w-5 h-5 text-yellow-500 mx-auto" })) : (_jsx(AlertCircle, { className: "w-5 h-5 text-red-500 mx-auto" })) })] }, mapping.glCode));
                                        }) })] }) })] }) }), _jsx("div", { className: "flex justify-end", children: _jsx("button", { onClick: props.onGenerate, disabled: !props.canProceed || props.generating, className: "px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2", children: props.generating ? (_jsxs(_Fragment, { children: [_jsx(RefreshCw, { className: "w-5 h-5 animate-spin" }), "Generating Statements..."] })) : (_jsxs(_Fragment, { children: [_jsx(Zap, { className: "w-5 h-5" }), "Generate IFRS Statements"] })) }) }), props.showTemplateModal && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50", children: _jsxs("div", { className: "bg-white rounded-2xl p-8 max-w-2xl w-full max-h-[80vh] overflow-y-auto", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsx("h3", { className: "text-2xl font-bold", children: "Select Industry Template" }), _jsx("button", { onClick: props.onToggleTemplateModal, className: "p-2 hover:bg-gray-100 rounded-lg", children: _jsx(X, { className: "w-6 h-6" }) })] }), _jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "border-2 border-blue-500 bg-blue-50 rounded-xl p-6", children: _jsxs("div", { className: "flex items-start gap-4", children: [_jsx("div", { className: "w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center", children: _jsx(Upload, { className: "w-6 h-6 text-white" }) }), _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-2 mb-1", children: [_jsx("h4", { className: "font-semibold text-lg text-gray-900", children: "Upload Your Company Template" }), _jsx("span", { className: "px-2 py-1 bg-green-600 text-white text-xs font-bold rounded", children: "RECOMMENDED" })] }), _jsx("p", { className: "text-sm text-gray-600 mb-3", children: "Use your own Chart of Accounts mapping file" }), !props.showCustomUpload ? (_jsx("button", { onClick: () => props.onShowCustomUpload(true), className: "px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium", children: "Upload Custom Template" })) : (_jsxs("div", { className: "space-y-3", children: [_jsx("div", { onDragOver: (e) => e.preventDefault(), onDrop: (e) => {
                                                                    e.preventDefault();
                                                                    const file = e.dataTransfer.files[0];
                                                                    if (file)
                                                                        props.onCustomFileSelect(file);
                                                                }, className: "border-2 border-dashed border-blue-300 rounded-lg p-4 text-center bg-white", children: !props.customTemplateFile ? (_jsxs(_Fragment, { children: [_jsx(FileSpreadsheet, { className: "w-8 h-8 text-blue-400 mx-auto mb-2" }), _jsx("p", { className: "text-sm text-gray-600 mb-2", children: "Drag & drop or" }), _jsxs("label", { className: "cursor-pointer", children: [_jsx("input", { type: "file", className: "hidden", accept: ".csv,.xlsx,.xls", onChange: (e) => {
                                                                                        const file = e.target.files?.[0];
                                                                                        if (file)
                                                                                            props.onCustomFileSelect(file);
                                                                                    } }), _jsx("span", { className: "px-4 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition text-sm inline-block", children: "Browse Files" })] })] })) : (_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2 text-green-600", children: [_jsx(FileSpreadsheet, { className: "w-5 h-5" }), _jsx("span", { className: "text-sm font-medium", children: props.customTemplateFile.name })] }), _jsx("button", { onClick: () => props.onCustomFileSelect(null), className: "text-red-600 hover:text-red-700", children: _jsx(X, { className: "w-4 h-4" }) })] })) }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { onClick: props.onDownloadBlankTemplate, className: "flex-1 px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition text-sm font-medium flex items-center justify-center gap-2", children: [_jsx(Download, { className: "w-4 h-4" }), "Download Blank Template"] }), props.customTemplateFile && (_jsx("button", { onClick: props.onUploadCustomTemplate, disabled: props.uploadingCustom, className: "flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed", children: props.uploadingCustom ? 'Uploading...' : 'Apply Template' }))] }), _jsx("button", { onClick: () => props.onShowCustomUpload(false), className: "text-sm text-gray-500 hover:text-gray-700", children: "Cancel" })] }))] })] }) }), _jsxs("div", { className: "flex items-center gap-4 py-2", children: [_jsx("div", { className: "flex-1 border-t border-gray-300" }), _jsx("span", { className: "text-sm text-gray-500 font-medium", children: "OR SELECT PRE-BUILT TEMPLATE" }), _jsx("div", { className: "flex-1 border-t border-gray-300" })] }), props.templates.map((template) => {
                                    const IconComponent = template.icon === 'ShoppingCart' ? ShoppingCart :
                                        template.icon === 'Cpu' ? Cpu :
                                            template.icon === 'Factory' ? Factory :
                                                template.icon === 'Briefcase' ? Briefcase : Building2;
                                    return (_jsx("button", { onClick: () => props.onApplyTemplate(template), className: "w-full p-6 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition text-left", children: _jsxs("div", { className: "flex items-start gap-4", children: [_jsx("div", { className: "w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center", children: _jsx(IconComponent, { className: "w-6 h-6 text-blue-600" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("h4", { className: "font-semibold text-lg text-gray-900 mb-1", children: template.name }), _jsx("p", { className: "text-sm text-gray-600", children: template.description })] }), _jsx(ArrowRight, { className: "w-6 h-6 text-gray-400" })] }) }, template.id));
                                })] })] }) }))] }));
};
const EDITABLE_TABS = [
    { id: 'financial-position', label: 'Financial Position' },
    { id: 'profit-loss', label: 'Profit & Loss' },
    { id: 'cash-flows', label: 'Cash Flows' },
    { id: 'equity', label: 'Changes in Equity' },
];
const Step3EditableReview = ({ editedStatements, setEditedStatements, activeSection, onSectionChange, entityName, periodEnd, currency, onProceedToPrint, }) => (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "bg-white rounded-xl shadow-lg p-6", children: [_jsxs("div", { className: "mb-4", children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: entityName }), _jsx("p", { className: "text-gray-600", children: "Step 3: Review & Edit \u2014 Change any numbers as needed, then proceed to print." })] }), _jsx("div", { className: "flex gap-2 border-b border-gray-200", children: EDITABLE_TABS.map((tab) => (_jsx("button", { type: "button", onClick: () => onSectionChange(tab.id), className: `px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeSection === tab.id
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'}`, children: tab.label }, tab.id))) })] }), _jsxs("div", { className: "bg-white rounded-xl shadow-lg p-8", children: [activeSection === 'financial-position' && (_jsx(EditableFinancialPositionView, { data: editedStatements.financialPosition, onChange: (fp) => setEditedStatements((p) => (p ? { ...p, financialPosition: fp } : p)), entityName: entityName, periodEnd: periodEnd, currency: currency })), activeSection === 'profit-loss' && (_jsx(EditableProfitLossView, { data: editedStatements.profitLoss, onChange: (pl) => setEditedStatements((p) => (p ? { ...p, profitLoss: pl } : p)), entityName: entityName, periodEnd: periodEnd, currency: currency })), activeSection === 'cash-flows' && (_jsx(EditableCashFlowView, { data: editedStatements.cashFlows, onChange: (cf) => setEditedStatements((p) => (p ? { ...p, cashFlows: cf } : p)), entityName: entityName, periodEnd: periodEnd, currency: currency })), activeSection === 'equity' && (_jsx(EditableEquityView, { data: editedStatements.changesInEquity, onChange: (eq) => setEditedStatements((p) => (p ? { ...p, changesInEquity: eq } : p)), entityName: entityName, periodEnd: periodEnd, currency: currency })), _jsx("div", { className: "mt-8 flex justify-end", children: _jsx("button", { type: "button", onClick: onProceedToPrint, className: "px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition", children: "Proceed to Print" }) })] })] }));
const NOTE_CONFIG = {
    'note-1-general': { number: 1, title: 'General Information' },
    'note-2-policies': { number: 2, title: 'Significant Accounting Policies' },
    'note-3-revenue': { number: 3, title: 'Revenue (IFRS 15)' },
    'note-4-ppe': { number: 4, title: 'Property, Plant & Equipment' },
    'note-5-leases': { number: 5, title: 'Leases (IFRS 16)' },
    'note-6-instruments': { number: 6, title: 'Financial Instruments' },
    'note-7-inventory': { number: 7, title: 'Inventories' },
    'note-8-tax': { number: 8, title: 'Income Tax' },
    'note-9-related': { number: 9, title: 'Related Party Transactions' },
    'note-10-events': { number: 10, title: 'Subsequent Events' },
};
const Step4PrintedFormat = ({ statements, activeSection, onSectionChange, completedSections, noteCustomizations, generatedNotes, commentaryContent, onNoteSave, onExport, generatingNotes, }) => {
    const renderContent = () => {
        if (activeSection === 'financial-position') {
            return (_jsx(FinancialPositionView, { data: statements.financialPosition, entityName: statements.entityName, periodEnd: statements.periodEnd, currency: statements.currency }));
        }
        if (activeSection === 'profit-loss') {
            return (_jsx(ProfitLossView, { data: statements.profitLoss, entityName: statements.entityName, periodEnd: statements.periodEnd, currency: statements.currency }));
        }
        if (activeSection === 'cash-flows') {
            return (_jsx(CashFlowView, { data: statements.cashFlows, entityName: statements.entityName, periodEnd: statements.periodEnd, currency: statements.currency }));
        }
        if (activeSection === 'equity') {
            return (_jsx(EquityView, { data: statements.changesInEquity, entityName: statements.entityName, periodEnd: statements.periodEnd, currency: statements.currency }));
        }
        const note = NOTE_CONFIG[activeSection];
        if (note) {
            return (_jsx(NoteTemplate, { noteId: activeSection, noteNumber: note.number, noteTitle: note.title, autoContent: generatedNotes[activeSection] ?? '', customContent: noteCustomizations[activeSection], onSave: (content) => onNoteSave(activeSection, content) }));
        }
        if (activeSection === 'md-and-a') {
            return (_jsx(ManagementCommentary, { data: commentaryContent, entityName: statements.entityName, periodEnd: statements.periodEnd }));
        }
        return (_jsx(FinancialPositionView, { data: statements.financialPosition, entityName: statements.entityName, periodEnd: statements.periodEnd, currency: statements.currency }));
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "bg-white rounded-xl shadow-lg p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: statements?.entityName ?? 'Statements' }), _jsxs("p", { className: "text-gray-600", children: ["IFRS Financial Statements - Period ending ", statements?.periodEnd ?? '—'] })] }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { type: "button", onClick: () => onExport('excel'), className: "px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center gap-2", children: [_jsx(Download, { className: "w-4 h-4" }), "Excel"] }), _jsxs("button", { type: "button", onClick: () => onExport('pdf'), className: "px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex items-center gap-2", children: [_jsx(Download, { className: "w-4 h-4" }), "PDF"] }), _jsxs("button", { type: "button", onClick: () => onExport('json'), className: "px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition flex items-center gap-2", children: [_jsx(Download, { className: "w-4 h-4" }), "JSON"] })] })] }), _jsx(IFRSTabBar, { activeSection: activeSection, onSectionChange: onSectionChange, completedSections: completedSections })] }), _jsxs("div", { className: "bg-white rounded-xl shadow-lg p-8", children: [generatingNotes && (_jsxs("div", { className: "flex items-center gap-2 text-sm text-gray-600 mb-4 print:hidden", children: [_jsx(RefreshCw, { className: "w-4 h-4 animate-spin" }), "Generating notes\u2026"] })), renderContent()] })] }));
};
// ==================== EDITABLE STATEMENT VIEWS ====================
const inp = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);
const EditableCell = ({ value, onChange, className = '' }) => (_jsx("input", { type: "number", value: value, onChange: (e) => onChange(parseFloat(e.target.value) || 0), className: `w-28 text-right px-2 py-1 border border-gray-300 rounded text-sm ${className}` }));
const EditableFinancialPositionView = ({ data, onChange, entityName, periodEnd, currency }) => {
    if (!data?.assets)
        return _jsx("div", { className: "text-gray-500", children: "No data." });
    const d = data;
    const up = (path, val) => {
        const next = JSON.parse(JSON.stringify(d));
        const parts = path.split('.');
        let o = next;
        for (let i = 0; i < parts.length - 1; i++)
            o = o[parts[i]];
        o[parts[parts.length - 1]] = val;
        onChange(next);
    };
    const nc = d.assets?.nonCurrent ?? {};
    const c = d.assets?.current ?? {};
    const eq = d.equity ?? {};
    const lnc = d.liabilities?.nonCurrent ?? {};
    const lc = d.liabilities?.current ?? {};
    return (_jsxs("div", { className: "font-serif", children: [_jsxs("div", { className: "text-center mb-6", children: [_jsx("h3", { className: "text-xl font-bold uppercase", children: entityName }), _jsx("h4", { className: "text-lg font-semibold", children: "STATEMENT OF FINANCIAL POSITION (Editable)" }), _jsxs("p", { className: "text-gray-600", children: ["As at ", periodEnd] })] }), _jsx("table", { className: "w-full text-sm", children: _jsxs("tbody", { children: [_jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-4 pb-2 font-bold", children: "ASSETS" }) }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-2 pb-1 font-semibold", children: "Non-current assets" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Property, plant and equipment" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(nc.propertyPlantEquipment ?? nc.ppe), onChange: (v) => up('assets.nonCurrent.propertyPlantEquipment', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Intangible assets" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(nc.intangibleAssets ?? nc.intangibles), onChange: (v) => up('assets.nonCurrent.intangibleAssets', v) }) })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-2 pb-1 font-semibold", children: "Current assets" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Inventories" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(c.inventories), onChange: (v) => up('assets.current.inventories', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Trade and other receivables" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(c.tradeReceivables), onChange: (v) => up('assets.current.tradeReceivables', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Cash and cash equivalents" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(c.cashAndEquivalents), onChange: (v) => up('assets.current.cashAndEquivalents', v) }) })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-6 font-bold", children: "EQUITY AND LIABILITIES" }) }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-2 font-semibold", children: "Equity" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Share capital" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(eq.shareCapital), onChange: (v) => up('equity.shareCapital', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Retained earnings" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(eq.retainedEarnings), onChange: (v) => up('equity.retainedEarnings', v) }) })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-2 font-semibold", children: "Non-current liabilities" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Long-term borrowings" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(lnc.longTermBorrowings ?? lnc.borrowings), onChange: (v) => up('liabilities.nonCurrent.longTermBorrowings', v) }) })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-2 font-semibold", children: "Current liabilities" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Trade and other payables" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(lc.tradePayables), onChange: (v) => up('liabilities.current.tradePayables', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Short-term borrowings" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(lc.shortTermBorrowings ?? lc.borrowings), onChange: (v) => up('liabilities.current.shortTermBorrowings', v) }) })] })] }) })] }));
};
const EditableProfitLossView = ({ data, onChange, entityName, periodEnd }) => {
    if (!data)
        return _jsx("div", { className: "text-gray-500", children: "No data." });
    const up = (path, val) => {
        const next = JSON.parse(JSON.stringify(data));
        const parts = path.split('.');
        let o = next;
        for (let i = 0; i < parts.length - 1; i++)
            o = o[parts[i]];
        o[parts[parts.length - 1]] = val;
        onChange(next);
    };
    const op = data.operatingExpenses ?? {};
    return (_jsxs("div", { className: "font-serif", children: [_jsxs("div", { className: "text-center mb-6", children: [_jsx("h3", { className: "text-xl font-bold uppercase", children: entityName }), _jsx("h4", { className: "text-lg font-semibold", children: "STATEMENT OF PROFIT OR LOSS (Editable)" }), _jsxs("p", { className: "text-gray-600", children: ["For the year ended ", periodEnd] })] }), _jsx("table", { className: "w-full text-sm", children: _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsx("td", { className: "py-2 font-semibold", children: "Revenue" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(data.revenue), onChange: (v) => up('revenue', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "py-1", children: "Cost of sales" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(data.costOfSales), onChange: (v) => up('costOfSales', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "py-2 font-semibold", children: "Gross profit" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(data.grossProfit), onChange: (v) => up('grossProfit', v) }) })] }), _jsx("tr", { children: _jsx("td", { className: "pt-4", children: "Operating expenses" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Employee benefits" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(op.employeeBenefits), onChange: (v) => up('operatingExpenses.employeeBenefits', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Depreciation" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(op.depreciation), onChange: (v) => up('operatingExpenses.depreciation', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Administrative" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(op.administrative), onChange: (v) => up('operatingExpenses.administrative', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Distribution" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(op.distribution), onChange: (v) => up('operatingExpenses.distribution', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "py-2 font-semibold", children: "Operating profit" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(data.operatingProfit), onChange: (v) => up('operatingProfit', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "py-1", children: "Finance costs" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(data.financeCosts), onChange: (v) => up('financeCosts', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "py-2 font-semibold", children: "Profit before tax" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(data.profitBeforeTax), onChange: (v) => up('profitBeforeTax', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "py-1", children: "Income tax" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(data.incomeTax), onChange: (v) => up('incomeTax', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "py-2 font-bold", children: "Profit after tax" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(data.profitAfterTax), onChange: (v) => up('profitAfterTax', v) }) })] })] }) })] }));
};
const EditableCashFlowView = ({ data, onChange, entityName, periodEnd }) => {
    if (!data?.operating)
        return _jsx("div", { className: "text-gray-500", children: "No data." });
    const op = data.operating;
    const adj = op.adjustments ?? {};
    const inv = data.investing ?? {};
    const fin = data.financing ?? {};
    const up = (path, val) => {
        const next = JSON.parse(JSON.stringify(data));
        const parts = path.split('.');
        let o = next;
        for (let i = 0; i < parts.length - 1; i++)
            o = o[parts[i]];
        o[parts[parts.length - 1]] = val;
        onChange(next);
    };
    return (_jsxs("div", { className: "font-serif", children: [_jsxs("div", { className: "text-center mb-6", children: [_jsx("h3", { className: "text-xl font-bold uppercase", children: entityName }), _jsx("h4", { className: "text-lg font-semibold", children: "STATEMENT OF CASH FLOWS (Editable)" }), _jsxs("p", { className: "text-gray-600", children: ["For the year ended ", periodEnd] })] }), _jsx("table", { className: "w-full text-sm", children: _jsxs("tbody", { children: [_jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-2 font-bold", children: "Operating activities" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Profit before tax" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(op.profitBeforeTax), onChange: (v) => up('operating.profitBeforeTax', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Depreciation" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(adj.depreciation), onChange: (v) => up('operating.adjustments.depreciation', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Net cash from operating" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(op.netOperating), onChange: (v) => up('operating.netOperating', v) }) })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-4 font-bold", children: "Investing activities" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Purchase of PPE" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(inv.propertyPlantEquipment), onChange: (v) => up('investing.propertyPlantEquipment', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Net cash from investing" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(inv.netInvesting), onChange: (v) => up('investing.netInvesting', v) }) })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-4 font-bold", children: "Financing activities" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Borrowings drawdown" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(fin.borrowingsDrawdown), onChange: (v) => up('financing.borrowingsDrawdown', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Dividends paid" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(fin.dividendsPaid), onChange: (v) => up('financing.dividendsPaid', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pt-4 font-semibold", children: "Net increase in cash" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(data.netIncrease), onChange: (v) => up('netIncrease', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Cash at beginning" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(data.cashBeginning), onChange: (v) => up('cashBeginning', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "py-2 font-bold", children: "Cash at end" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(data.cashEnding), onChange: (v) => up('cashEnding', v) }) })] })] }) })] }));
};
const EditableEquityView = ({ data, onChange, entityName, periodEnd }) => {
    if (!data?.shareCapital)
        return _jsx("div", { className: "text-gray-500", children: "No data." });
    const sc = data.shareCapital ?? {};
    const re = data.retainedEarnings ?? {};
    const res = data.reserves ?? {};
    const up = (path, val) => {
        const next = JSON.parse(JSON.stringify(data));
        const parts = path.split('.');
        let o = next;
        for (let i = 0; i < parts.length - 1; i++)
            o = o[parts[i]];
        o[parts[parts.length - 1]] = val;
        onChange(next);
    };
    return (_jsxs("div", { className: "font-serif", children: [_jsxs("div", { className: "text-center mb-6", children: [_jsx("h3", { className: "text-xl font-bold uppercase", children: entityName }), _jsx("h4", { className: "text-lg font-semibold", children: "STATEMENT OF CHANGES IN EQUITY (Editable)" }), _jsxs("p", { className: "text-gray-600", children: ["For the year ended ", periodEnd] })] }), _jsx("table", { className: "w-full text-sm", children: _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsx("td", { className: "py-2 font-semibold", children: "Share capital \u2013 beginning" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(sc.beginning), onChange: (v) => up('shareCapital.beginning', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Share capital \u2013 ending" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(sc.ending), onChange: (v) => up('shareCapital.ending', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pt-4 font-semibold", children: "Retained earnings \u2013 beginning" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(re.beginning), onChange: (v) => up('retainedEarnings.beginning', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Profit for the year" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(re.profitForYear), onChange: (v) => up('retainedEarnings.profitForYear', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Dividends" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(re.dividends), onChange: (v) => up('retainedEarnings.dividends', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Retained earnings \u2013 ending" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(re.ending), onChange: (v) => up('retainedEarnings.ending', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pt-4 font-semibold", children: "Reserves \u2013 beginning" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(res.beginning), onChange: (v) => up('reserves.beginning', v) }) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Reserves \u2013 ending" }), _jsx("td", { className: "text-right", children: _jsx(EditableCell, { value: inp(res.ending), onChange: (v) => up('reserves.ending', v) }) })] })] }) })] }));
};
// ==================== STATEMENT VIEWS (READ-ONLY) ====================
const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0).toLocaleString();
const FinancialPositionView = ({ data, entityName, periodEnd, currency }) => {
    if (!data?.assets) {
        return (_jsx("div", { className: "text-center py-12 text-gray-500", children: _jsx("p", { children: "No financial position data yet. Complete Steps 1\u20132 and generate statements." }) }));
    }
    return (_jsxs("div", { className: "font-serif", children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("h3", { className: "text-xl font-bold uppercase", children: entityName ?? '' }), _jsx("h4", { className: "text-lg font-semibold", children: "STATEMENT OF FINANCIAL POSITION" }), _jsxs("p", { className: "text-gray-600", children: ["As at ", periodEnd ?? ''] })] }), _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b-2 border-gray-900", children: [_jsx("th", { className: "text-left py-2" }), _jsx("th", { className: "text-right py-2 px-4", children: currency ?? '' })] }) }), _jsxs("tbody", { children: [_jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-6 pb-2 font-bold text-lg", children: "ASSETS" }) }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-4 pb-2 font-semibold", children: "Non-current assets" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Property, plant and equipment" }), _jsx("td", { className: "text-right px-4", children: num(data.assets?.nonCurrent?.propertyPlantEquipment ?? data.assets?.nonCurrent?.ppe) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Intangible assets" }), _jsx("td", { className: "text-right px-4", children: num(data.assets?.nonCurrent?.intangibleAssets ?? data.assets?.nonCurrent?.intangibles) })] }), _jsxs("tr", { className: "border-t border-gray-300", children: [_jsx("td", { className: "pl-4 py-1 font-semibold", children: "Total non-current assets" }), _jsx("td", { className: "text-right px-4 font-semibold", children: num(data.assets?.totalNonCurrent) })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-4 pb-2 font-semibold", children: "Current assets" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Inventories" }), _jsx("td", { className: "text-right px-4", children: num(data.assets?.current?.inventories) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Trade and other receivables" }), _jsx("td", { className: "text-right px-4", children: num(data.assets?.current?.tradeReceivables) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Cash and cash equivalents" }), _jsx("td", { className: "text-right px-4", children: num(data.assets?.current?.cashAndEquivalents) })] }), _jsxs("tr", { className: "border-t border-gray-300", children: [_jsx("td", { className: "pl-4 py-1 font-semibold", children: "Total current assets" }), _jsx("td", { className: "text-right px-4 font-semibold", children: num(data.assets?.current?.total ?? data.assets?.totalCurrent) })] }), _jsxs("tr", { className: "border-t-2 border-gray-900", children: [_jsx("td", { className: "py-2 font-bold", children: "TOTAL ASSETS" }), _jsx("td", { className: "text-right px-4 font-bold", children: num(data.assets?.total) })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-8 pb-2 font-bold text-lg", children: "EQUITY AND LIABILITIES" }) }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-4 pb-2 font-semibold", children: "Equity" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Share capital" }), _jsx("td", { className: "text-right px-4", children: num(data.equity?.shareCapital) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Retained earnings" }), _jsx("td", { className: "text-right px-4", children: num(data.equity?.retainedEarnings) })] }), _jsxs("tr", { className: "border-t border-gray-300", children: [_jsx("td", { className: "pl-4 py-1 font-semibold", children: "Total equity" }), _jsx("td", { className: "text-right px-4 font-semibold", children: num(data.equity?.total) })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-4 pb-2 font-semibold", children: "Non-current liabilities" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Long-term borrowings" }), _jsx("td", { className: "text-right px-4", children: num(data.liabilities?.nonCurrent?.longTermBorrowings ?? data.liabilities?.nonCurrent?.borrowings) })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-4 pb-2 font-semibold", children: "Current liabilities" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Trade and other payables" }), _jsx("td", { className: "text-right px-4", children: num(data.liabilities?.current?.tradePayables) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Short-term borrowings" }), _jsx("td", { className: "text-right px-4", children: num(data.liabilities?.current?.shortTermBorrowings ?? data.liabilities?.current?.borrowings) })] }), _jsxs("tr", { className: "border-t border-gray-300", children: [_jsx("td", { className: "pl-4 py-1 font-semibold", children: "Total current liabilities" }), _jsx("td", { className: "text-right px-4 font-semibold", children: num(data.liabilities?.current?.total ?? data.liabilities?.totalCurrent) })] }), _jsxs("tr", { className: "border-t-2 border-gray-900", children: [_jsx("td", { className: "py-2 font-bold", children: "TOTAL EQUITY AND LIABILITIES" }), _jsx("td", { className: "text-right px-4 font-bold", children: num(data.totalEquityAndLiabilities) })] })] })] }), data?.isBalanced && (_jsxs("div", { className: "mt-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2", children: [_jsx(CheckCircle, { className: "w-5 h-5 text-green-600" }), _jsx("span", { className: "text-green-700 font-medium", children: "Statement is balanced \u2713" })] }))] }));
};
const ProfitLossView = ({ data, entityName, periodEnd, currency }) => {
    if (!data) {
        return (_jsx("div", { className: "text-center py-12 text-gray-500", children: _jsx("p", { children: "No profit or loss data yet. Complete Steps 1\u20132 and generate statements." }) }));
    }
    return (_jsxs("div", { className: "font-serif", children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("h3", { className: "text-xl font-bold uppercase", children: entityName ?? '' }), _jsx("h4", { className: "text-lg font-semibold", children: "STATEMENT OF PROFIT OR LOSS" }), _jsxs("p", { className: "text-gray-600", children: ["For the year ended ", periodEnd ?? ''] })] }), _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b-2 border-gray-900", children: [_jsx("th", { className: "text-left py-2" }), _jsx("th", { className: "text-right py-2 px-4", children: currency ?? '' })] }) }), _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsx("td", { className: "py-2 font-semibold", children: "Revenue" }), _jsx("td", { className: "text-right px-4", children: num(data.revenue) })] }), _jsxs("tr", { children: [_jsx("td", { className: "py-2", children: "Cost of sales" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(data.costOfSales), ")"] })] }), _jsxs("tr", { className: "border-t border-gray-300", children: [_jsx("td", { className: "py-2 font-semibold", children: "Gross profit" }), _jsx("td", { className: "text-right px-4 font-semibold", children: num(data.grossProfit) })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-4 pb-2", children: "Operating expenses:" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Employee benefits" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(data.operatingExpenses?.employeeBenefits), ")"] })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Depreciation and amortization" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(data.operatingExpenses?.depreciation), ")"] })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Distribution costs" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(data.operatingExpenses?.distribution), ")"] })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Administrative expenses" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(data.operatingExpenses?.administrative), ")"] })] }), _jsxs("tr", { className: "border-t border-gray-300", children: [_jsx("td", { className: "py-2 font-semibold", children: "Operating profit" }), _jsx("td", { className: "text-right px-4 font-semibold", children: num(data.operatingProfit) })] }), _jsxs("tr", { children: [_jsx("td", { className: "py-2", children: "Finance costs" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(data.financeCosts), ")"] })] }), _jsxs("tr", { className: "border-t border-gray-300", children: [_jsx("td", { className: "py-2 font-semibold", children: "Profit before tax" }), _jsx("td", { className: "text-right px-4 font-semibold", children: num(data.profitBeforeTax) })] }), _jsxs("tr", { children: [_jsx("td", { className: "py-2", children: "Income tax expense" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(data.incomeTax), ")"] })] }), _jsxs("tr", { className: "border-t-2 border-gray-900", children: [_jsx("td", { className: "py-3 font-bold text-lg", children: "PROFIT FOR THE YEAR" }), _jsx("td", { className: "text-right px-4 font-bold text-lg", children: num(data.profitAfterTax) })] })] })] })] }));
};
const CashFlowView = ({ data, entityName, periodEnd, currency }) => {
    if (!data?.operating) {
        return (_jsx("div", { className: "text-center py-12 text-gray-500", children: _jsx("p", { children: "No cash flow data yet. Complete Steps 1\u20132 and generate statements." }) }));
    }
    const op = data.operating;
    const adj = op?.adjustments ?? {};
    const wc = op?.workingCapitalChanges ?? {};
    const inv = data.investing ?? {};
    const fin = data.financing ?? {};
    return (_jsxs("div", { className: "font-serif", children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("h3", { className: "text-xl font-bold uppercase", children: entityName ?? '' }), _jsx("h4", { className: "text-lg font-semibold", children: "STATEMENT OF CASH FLOWS (Indirect Method)" }), _jsxs("p", { className: "text-gray-600", children: ["For the year ended ", periodEnd ?? ''] })] }), _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b-2 border-gray-900", children: [_jsx("th", { className: "text-left py-2" }), _jsx("th", { className: "text-right py-2 px-4", children: currency ?? '' })] }) }), _jsxs("tbody", { children: [_jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-4 pb-2 font-bold", children: "Cash flows from operating activities" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Profit before tax" }), _jsx("td", { className: "text-right px-4", children: num(op.profitBeforeTax) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Adjustments for:" }), _jsx("td", { className: "text-right px-4" })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-6 py-1", children: "Depreciation and amortisation" }), _jsx("td", { className: "text-right px-4", children: num(adj.depreciation) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-6 py-1", children: "Interest expense" }), _jsx("td", { className: "text-right px-4", children: num(adj.interestExpense) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Change in inventories" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(wc.inventories), ")"] })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Change in trade receivables" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(wc.tradeReceivables), ")"] })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Change in trade payables" }), _jsx("td", { className: "text-right px-4", children: num(wc.tradePayables) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Interest paid" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(op.interestPaid), ")"] })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Tax paid" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(op.taxesPaid), ")"] })] }), _jsxs("tr", { className: "border-t border-gray-300", children: [_jsx("td", { className: "pl-4 py-2 font-semibold", children: "Net cash from operating activities" }), _jsx("td", { className: "text-right px-4 font-semibold", children: num(op.netOperating) })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-4 pb-2 font-bold", children: "Cash flows from investing activities" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Purchase of property, plant and equipment" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(inv.propertyPlantEquipment), ")"] })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Purchase of intangibles" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(inv.intangibles), ")"] })] }), _jsxs("tr", { className: "border-t border-gray-300", children: [_jsx("td", { className: "pl-4 py-2 font-semibold", children: "Net cash used in investing activities" }), _jsxs("td", { className: "text-right px-4 font-semibold", children: ["(", num(inv.netInvesting), ")"] })] }), _jsx("tr", { children: _jsx("td", { colSpan: 2, className: "pt-4 pb-2 font-bold", children: "Cash flows from financing activities" }) }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Proceeds from borrowings" }), _jsx("td", { className: "text-right px-4", children: num(fin.borrowingsDrawdown) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Repayment of borrowings" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(fin.borrowingsRepayment), ")"] })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Dividends paid" }), _jsxs("td", { className: "text-right px-4", children: ["(", num(fin.dividendsPaid), ")"] })] }), _jsxs("tr", { className: "border-t border-gray-300", children: [_jsx("td", { className: "pl-4 py-2 font-semibold", children: "Net cash from / (used in) financing activities" }), _jsx("td", { className: "text-right px-4 font-semibold", children: num(fin.netFinancing) })] }), _jsxs("tr", { className: "border-t-2 border-gray-900", children: [_jsx("td", { className: "py-2 font-semibold", children: "Net increase in cash and cash equivalents" }), _jsx("td", { className: "text-right px-4 font-semibold", children: num(data.netIncrease) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Cash and cash equivalents at beginning of period" }), _jsx("td", { className: "text-right px-4", children: num(data.cashBeginning) })] }), _jsxs("tr", { className: "border-t-2 border-gray-900", children: [_jsx("td", { className: "py-2 font-bold", children: "Cash and cash equivalents at end of period" }), _jsx("td", { className: "text-right px-4 font-bold", children: num(data.cashEnding) })] })] })] })] }));
};
const EquityView = ({ data, entityName, periodEnd, currency }) => {
    if (!data?.shareCapital) {
        return (_jsx("div", { className: "text-center py-12 text-gray-500", children: _jsx("p", { children: "No changes in equity data yet. Complete Steps 1\u20132 and generate statements." }) }));
    }
    const sc = data.shareCapital ?? {};
    const re = data.retainedEarnings ?? {};
    const res = data.reserves ?? {};
    const tot = data.total ?? {};
    return (_jsxs("div", { className: "font-serif", children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("h3", { className: "text-xl font-bold uppercase", children: entityName ?? '' }), _jsx("h4", { className: "text-lg font-semibold", children: "STATEMENT OF CHANGES IN EQUITY" }), _jsxs("p", { className: "text-gray-600", children: ["For the year ended ", periodEnd ?? ''] })] }), _jsxs("table", { className: "w-full text-sm border-collapse", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b-2 border-gray-900", children: [_jsx("th", { className: "text-left py-2" }), _jsx("th", { className: "text-right py-2 px-4", children: "Share capital" }), _jsx("th", { className: "text-right py-2 px-4", children: "Retained earnings" }), _jsx("th", { className: "text-right py-2 px-4", children: "Reserves" }), _jsx("th", { className: "text-right py-2 px-4", children: currency ?? '' })] }) }), _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsx("td", { className: "py-2 font-semibold", children: "Balance at beginning of period" }), _jsx("td", { className: "text-right px-4", children: num(sc.beginning) }), _jsx("td", { className: "text-right px-4", children: num(re.beginning) }), _jsx("td", { className: "text-right px-4", children: num(res.beginning) }), _jsx("td", { className: "text-right px-4 font-semibold", children: num(tot.beginning) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Profit for the year" }), _jsx("td", {}), _jsx("td", { className: "text-right px-4", children: num(re.profitForYear) }), _jsx("td", {}), _jsx("td", { className: "text-right px-4", children: num(re.profitForYear) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Dividends" }), _jsx("td", {}), _jsxs("td", { className: "text-right px-4", children: ["(", num(re.dividends), ")"] }), _jsx("td", {}), _jsxs("td", { className: "text-right px-4", children: ["(", num(re.dividends), ")"] })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Share capital issued" }), _jsx("td", { className: "text-right px-4", children: num(sc.issued) }), _jsx("td", {}), _jsx("td", {}), _jsx("td", { className: "text-right px-4", children: num(sc.issued) })] }), _jsxs("tr", { children: [_jsx("td", { className: "pl-4 py-1", children: "Other reserves movement" }), _jsx("td", {}), _jsx("td", {}), _jsx("td", { className: "text-right px-4", children: num(res.movements) }), _jsx("td", { className: "text-right px-4", children: num(res.movements) })] }), _jsxs("tr", { className: "border-t-2 border-gray-900", children: [_jsx("td", { className: "py-2 font-bold", children: "Balance at end of period" }), _jsx("td", { className: "text-right px-4 font-bold", children: num(sc.ending) }), _jsx("td", { className: "text-right px-4 font-bold", children: num(re.ending) }), _jsx("td", { className: "text-right px-4 font-bold", children: num(res.ending) }), _jsx("td", { className: "text-right px-4 font-bold", children: num(tot.ending) })] })] })] })] }));
};
