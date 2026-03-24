import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useClient } from '../context/ClientContext';
import { saveClientData, getClientData } from '../services/clientManager';
const DEFAULT_TASKS = [
    { task: 'Post all sub-ledger journals', owner: '', dueDate: '', status: 'Not Started', category: 'Journals' },
    { task: 'Complete bank reconciliation', owner: '', dueDate: '', status: 'Not Started', category: 'Reconciliation' },
    { task: 'Clear suspense accounts', owner: '', dueDate: '', status: 'Not Started', category: 'Reconciliation' },
    { task: 'Post accruals and prepayments', owner: '', dueDate: '', status: 'Not Started', category: 'Journals' },
    { task: 'Post depreciation', owner: '', dueDate: '', status: 'Not Started', category: 'Journals' },
    { task: 'Intercompany reconciliation', owner: '', dueDate: '', status: 'Not Started', category: 'Reconciliation' },
    { task: 'Review trial balance', owner: '', dueDate: '', status: 'Not Started', category: 'Review' },
    { task: 'Variance analysis vs budget', owner: '', dueDate: '', status: 'Not Started', category: 'Review' },
    { task: 'Management accounts preparation', owner: '', dueDate: '', status: 'Not Started', category: 'Reporting' },
    { task: 'CFO sign-off', owner: '', dueDate: '', status: 'Not Started', category: 'Sign-off' },
];
export function CloseTrackerPage() {
    const navigate = useNavigate();
    const { activeClient } = useClient();
    const [tasks, setTasks] = useState([]);
    const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
    const companyId = activeClient?.companyId || 'default';
    useEffect(() => {
        const saved = getClientData(companyId, `close_${period}`);
        if (saved && saved.length > 0) {
            setTasks(saved);
        }
        else {
            setTasks(DEFAULT_TASKS.map((t, i) => ({ ...t, id: `task_${i}` })));
        }
    }, [companyId, period]);
    const save = (updated) => {
        setTasks(updated);
        saveClientData(companyId, `close_${period}`, updated);
    };
    const updateTask = (id, field, value) => {
        save(tasks.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
    };
    const today = new Date().toISOString().slice(0, 10);
    const displayTasks = tasks.map((t) => ({
        ...t,
        status: t.dueDate && t.dueDate < today && t.status !== 'Complete'
            ? 'Overdue'
            : t.status,
    }));
    const complete = displayTasks.filter((t) => t.status === 'Complete').length;
    const overdue = displayTasks.filter((t) => t.status === 'Overdue').length;
    const pct = tasks.length > 0 ? Math.round((complete / tasks.length) * 100) : 0;
    const statusColor = (s) => s === 'Complete'
        ? '#3B6D11'
        : s === 'Overdue'
            ? '#A32D2D'
            : s === 'In Progress'
                ? '#185FA5'
                : '#5F5E5A';
    const statusBg = (s) => s === 'Complete'
        ? '#EAF3DE'
        : s === 'Overdue'
            ? '#FCEBEB'
            : s === 'In Progress'
                ? '#E6F1FB'
                : 'var(--color-background-tertiary, #F1F5F9)';
    return (_jsxs("div", { style: { padding: 24, maxWidth: 900, margin: '0 auto', minHeight: '100vh', background: '#F8FAFC' }, children: [_jsxs("div", { style: { marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }, children: [_jsx("button", { onClick: () => navigate('/r2r'), className: "p-2 hover:bg-white rounded-lg transition flex items-center gap-2 text-gray-700", children: _jsx(ArrowLeft, { className: "w-5 h-5" }) }), _jsx("div", { style: { flex: 1 }, children: _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }, children: [_jsxs("div", { children: [_jsx("h1", { style: { fontSize: 20, fontWeight: 500, margin: 0 }, children: "Month-End Close Tracker" }), _jsx("p", { style: { fontSize: 13, color: 'var(--color-text-secondary, #64748B)', margin: '4px 0 0' }, children: activeClient?.name })] }), _jsx("input", { type: "month", value: period, onChange: (e) => setPeriod(e.target.value), style: {
                                        padding: '6px 10px',
                                        borderRadius: 6,
                                        border: '1px solid #E2E8F0',
                                        fontSize: 13,
                                    } })] }) })] }), _jsxs("div", { style: {
                    padding: 16,
                    borderRadius: 10,
                    background: 'var(--color-background-secondary, #F1F5F9)',
                    marginBottom: 16,
                    border: '0.5px solid #E2E8F0',
                }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 }, children: [_jsxs("span", { style: { fontSize: 14, fontWeight: 500 }, children: ["Close Progress \u2014 ", pct, "%"] }), _jsx("span", { style: { fontSize: 13, color: overdue > 0 ? '#A32D2D' : '#3B6D11' }, children: overdue > 0 ? `${overdue} overdue` : 'On track ✓' })] }), _jsx("div", { style: {
                            height: 8,
                            borderRadius: 4,
                            background: 'var(--color-border-tertiary, #E2E8F0)',
                            overflow: 'hidden',
                        }, children: _jsx("div", { style: {
                                height: '100%',
                                width: `${pct}%`,
                                borderRadius: 4,
                                background: overdue > 0 ? '#E24B4A' : '#639922',
                                transition: 'width 0.3s',
                            } }) }), _jsxs("div", { style: {
                            display: 'flex',
                            gap: 16,
                            marginTop: 8,
                            fontSize: 12,
                            color: 'var(--color-text-secondary, #64748B)',
                        }, children: [_jsxs("span", { style: { color: '#3B6D11' }, children: [complete, " complete"] }), _jsxs("span", { style: { color: '#A32D2D' }, children: [overdue, " overdue"] }), _jsxs("span", { children: [tasks.length - complete - overdue, " remaining"] })] })] }), _jsx("div", { style: { overflowX: 'auto', background: 'white', borderRadius: 10, border: '1px solid #E2E8F0' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 }, children: [_jsx("thead", { children: _jsx("tr", { style: { background: 'var(--color-background-secondary, #F1F5F9)' }, children: ['Task', 'Category', 'Owner', 'Due Date', 'Status'].map((h) => (_jsx("th", { style: {
                                        padding: '8px 10px',
                                        textAlign: 'left',
                                        fontWeight: 500,
                                        fontSize: 11,
                                        borderBottom: '1px solid #E2E8F0',
                                    }, children: h }, h))) }) }), _jsx("tbody", { children: displayTasks.map((task) => (_jsxs("tr", { style: {
                                    borderBottom: '1px solid #E2E8F0',
                                    background: task.status === 'Overdue' ? '#FCEBEB' : 'transparent',
                                }, children: [_jsx("td", { style: {
                                            padding: '8px 10px',
                                            fontWeight: task.status === 'Overdue' ? 500 : 400,
                                        }, children: task.task }), _jsx("td", { style: { padding: '8px 10px', fontSize: 11, color: 'var(--color-text-secondary, #64748B)' }, children: task.category }), _jsx("td", { style: { padding: '6px 8px' }, children: _jsx("input", { value: task.owner, onChange: (e) => updateTask(task.id, 'owner', e.target.value), placeholder: "Assign...", style: {
                                                padding: '4px 6px',
                                                borderRadius: 4,
                                                border: '1px solid #E2E8F0',
                                                fontSize: 11,
                                                width: 100,
                                            } }) }), _jsx("td", { style: { padding: '6px 8px' }, children: _jsx("input", { type: "date", value: task.dueDate, onChange: (e) => updateTask(task.id, 'dueDate', e.target.value), style: {
                                                padding: '4px 6px',
                                                borderRadius: 4,
                                                border: '1px solid #E2E8F0',
                                                fontSize: 11,
                                            } }) }), _jsx("td", { style: { padding: '6px 8px' }, children: _jsx("select", { value: task.status, onChange: (e) => updateTask(task.id, 'status', e.target.value), style: {
                                                padding: '4px 6px',
                                                borderRadius: 4,
                                                fontSize: 11,
                                                fontWeight: 500,
                                                cursor: 'pointer',
                                                background: statusBg(task.status),
                                                color: statusColor(task.status),
                                                border: `1px solid ${statusColor(task.status)}40`,
                                            }, children: ['Not Started', 'In Progress', 'Complete', 'Overdue'].map((s) => (_jsx("option", { value: s, children: s }, s))) }) })] }, task.id))) })] }) })] }));
}
