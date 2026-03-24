import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useClient } from '../context/ClientContext';
import { saveClientData, getClientData } from '../services/clientManager';

interface CloseTask {
  id: string;
  task: string;
  owner: string;
  dueDate: string;
  status: 'Not Started' | 'In Progress' | 'Complete' | 'Overdue';
  category: string;
}

const DEFAULT_TASKS: Omit<CloseTask, 'id'>[] = [
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
  const [tasks, setTasks] = useState<CloseTask[]>([]);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const companyId = activeClient?.companyId || 'default';

  useEffect(() => {
    const saved = getClientData<CloseTask[]>(companyId, `close_${period}`);
    if (saved && saved.length > 0) {
      setTasks(saved);
    } else {
      setTasks(DEFAULT_TASKS.map((t, i) => ({ ...t, id: `task_${i}` })));
    }
  }, [companyId, period]);

  const save = (updated: CloseTask[]) => {
    setTasks(updated);
    saveClientData(companyId, `close_${period}`, updated);
  };

  const updateTask = (id: string, field: keyof CloseTask, value: string) => {
    save(tasks.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  };

  const today = new Date().toISOString().slice(0, 10);
  const displayTasks = tasks.map((t) => ({
    ...t,
    status:
      t.dueDate && t.dueDate < today && t.status !== 'Complete'
        ? ('Overdue' as const)
        : t.status,
  }));

  const complete = displayTasks.filter((t) => t.status === 'Complete').length;
  const overdue = displayTasks.filter((t) => t.status === 'Overdue').length;
  const pct = tasks.length > 0 ? Math.round((complete / tasks.length) * 100) : 0;

  const statusColor = (s: string) =>
    s === 'Complete'
      ? '#3B6D11'
      : s === 'Overdue'
        ? '#A32D2D'
        : s === 'In Progress'
          ? '#185FA5'
          : '#5F5E5A';

  const statusBg = (s: string) =>
    s === 'Complete'
      ? '#EAF3DE'
      : s === 'Overdue'
        ? '#FCEBEB'
        : s === 'In Progress'
          ? '#E6F1FB'
          : 'var(--color-background-tertiary, #F1F5F9)';

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto', minHeight: '100vh', background: '#F8FAFC' }}>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => navigate('/r2r')}
          className="p-2 hover:bg-white rounded-lg transition flex items-center gap-2 text-gray-700"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Month-End Close Tracker</h1>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748B)', margin: '4px 0 0' }}>
                {activeClient?.name}
              </p>
            </div>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #E2E8F0',
                fontSize: 13,
              }}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          padding: 16,
          borderRadius: 10,
          background: 'var(--color-background-secondary, #F1F5F9)',
          marginBottom: 16,
          border: '0.5px solid #E2E8F0',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>Close Progress — {pct}%</span>
          <span style={{ fontSize: 13, color: overdue > 0 ? '#A32D2D' : '#3B6D11' }}>
            {overdue > 0 ? `${overdue} overdue` : 'On track ✓'}
          </span>
        </div>
        <div
          style={{
            height: 8,
            borderRadius: 4,
            background: 'var(--color-border-tertiary, #E2E8F0)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              borderRadius: 4,
              background: overdue > 0 ? '#E24B4A' : '#639922',
              transition: 'width 0.3s',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 8,
            fontSize: 12,
            color: 'var(--color-text-secondary, #64748B)',
          }}
        >
          <span style={{ color: '#3B6D11' }}>{complete} complete</span>
          <span style={{ color: '#A32D2D' }}>{overdue} overdue</span>
          <span>{tasks.length - complete - overdue} remaining</span>
        </div>
      </div>

      <div style={{ overflowX: 'auto', background: 'white', borderRadius: 10, border: '1px solid #E2E8F0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--color-background-secondary, #F1F5F9)' }}>
              {['Task', 'Category', 'Owner', 'Due Date', 'Status'].map((h) => (
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
            {displayTasks.map((task) => (
              <tr
                key={task.id}
                style={{
                  borderBottom: '1px solid #E2E8F0',
                  background: task.status === 'Overdue' ? '#FCEBEB' : 'transparent',
                }}
              >
                <td
                  style={{
                    padding: '8px 10px',
                    fontWeight: task.status === 'Overdue' ? 500 : 400,
                  }}
                >
                  {task.task}
                </td>
                <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--color-text-secondary, #64748B)' }}>
                  {task.category}
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <input
                    value={task.owner}
                    onChange={(e) => updateTask(task.id, 'owner', e.target.value)}
                    placeholder="Assign..."
                    style={{
                      padding: '4px 6px',
                      borderRadius: 4,
                      border: '1px solid #E2E8F0',
                      fontSize: 11,
                      width: 100,
                    }}
                  />
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <input
                    type="date"
                    value={task.dueDate}
                    onChange={(e) => updateTask(task.id, 'dueDate', e.target.value)}
                    style={{
                      padding: '4px 6px',
                      borderRadius: 4,
                      border: '1px solid #E2E8F0',
                      fontSize: 11,
                    }}
                  />
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <select
                    value={task.status}
                    onChange={(e) => updateTask(task.id, 'status', e.target.value as CloseTask['status'])}
                    style={{
                      padding: '4px 6px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: 'pointer',
                      background: statusBg(task.status),
                      color: statusColor(task.status),
                      border: `1px solid ${statusColor(task.status)}40`,
                    }}
                  >
                    {['Not Started', 'In Progress', 'Complete', 'Overdue'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
