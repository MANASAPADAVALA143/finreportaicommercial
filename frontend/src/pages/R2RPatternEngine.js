import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { PatternIntelligenceTab } from '../components/r2r/PatternIntelligenceTab';
import toast from 'react-hot-toast';
export const R2RPatternEngine = () => {
    const navigate = useNavigate();
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [uploadedEntries, setUploadedEntries] = useState([]);
    const handleFileChange = (e) => {
        if (e.target.files?.[0])
            setFile(e.target.files[0]);
    };
    const handleUpload = async () => {
        if (!file) {
            toast.error('Please select a file');
            return;
        }
        setLoading(true);
        try {
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet);
            setUploadedEntries(rows);
            toast.success(`Loaded ${rows.length} entries for pattern analysis`);
        }
        catch (err) {
            toast.error(err.message || 'Failed to parse file');
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { className: "min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-8", children: _jsxs("div", { className: "container mx-auto max-w-7xl", children: [_jsxs("div", { className: "mb-8", children: [_jsxs("button", { onClick: () => navigate('/dashboard'), className: "flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4", children: [_jsx(ArrowLeft, { className: "w-4 h-4" }), " Back to Dashboard"] }), _jsxs("h1", { className: "text-4xl font-bold text-gray-900 flex items-center gap-3 mb-2", children: [_jsx(FileText, { className: "w-10 h-10 text-indigo-600" }), "R2R Pattern Engine"] }), _jsx("p", { className: "text-lg text-gray-600", children: "7-model client-specific anomaly detection \u2014 Amount, Duplicate, User, Timing, Account, Vendor, Benford" })] }), _jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-200 p-8 mb-8", children: [_jsxs("div", { className: "flex items-center gap-4 mb-4", children: [_jsx(Upload, { className: "w-6 h-6 text-indigo-600" }), _jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Upload Journal Entries (CSV or Excel)" })] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsx("input", { type: "file", accept: ".csv,.xlsx,.xls", onChange: handleFileChange, className: "flex-1 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-indigo-500 transition" }), _jsx("button", { onClick: handleUpload, disabled: loading || !file, className: "px-8 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition", children: loading ? 'Loading...' : 'Analyze Patterns' })] }), file && (_jsxs("p", { className: "mt-3 text-sm text-gray-600", children: ["Selected: ", _jsx("span", { className: "font-semibold", children: file.name })] }))] }), _jsx(PatternIntelligenceTab, { uploadedEntries: uploadedEntries })] }) }));
};
