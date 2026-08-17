import { useState } from 'react';
import * as api from '../../services/reraApi';
import type { RERAQPRRecord, RERAProject } from '../../services/reraApi';
import { useReraData, DemoBadge, PageHeader, GoldButton, OutlineButton, Table, EmptyRow, StatusBadge, BORDER, MUTED } from './shared';

async function fetchAllQpr(): Promise<{ record: RERAQPRRecord; project: RERAProject }[]> {
  const { projects } = await api.listProjects();
  const perProject = await Promise.all(
    projects.map(async (project) => {
      const { records } = await api.listQpr(project.id);
      return records.map((record) => ({ record, project }));
    }),
  );
  return perProject.flat();
}

export default function RERAQPR() {
  const rows = useReraData(fetchAllQpr, [], () => false);
  const projects = useReraData(async () => (await api.listProjects()).projects, [], () => false);
  const [selectedProject, setSelectedProject] = useState('');
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    if (!selectedProject) return;
    setGenerating(true);
    try {
      await api.generateQpr(selectedProject);
      rows.reload();
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <PageHeader title="QPR Reports" subtitle="Quarterly Project Reports" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="px-3 py-2 rounded-lg border bg-transparent text-sm text-white"
          style={{ borderColor: BORDER }}
        >
          <option value="" style={{ background: '#0F2035' }}>Select project…</option>
          {projects.data.map((p) => (
            <option key={p.id} value={p.id} style={{ background: '#0F2035' }}>{p.name}</option>
          ))}
        </select>
        <GoldButton onClick={() => void generate()} disabled={!selectedProject || generating}>
          {generating ? 'Generating…' : 'Generate QPR'}
        </GoldButton>
      </div>

      <Table headers={['Project', 'Quarter', 'Status', 'Generated', 'Actions']}>
        {rows.data.length === 0 ? (
          <EmptyRow colSpan={5} text="No QPR records yet." />
        ) : (
          rows.data.map(({ record, project }) => (
            <tr key={record.id} className="border-b" style={{ borderColor: BORDER }}>
              <td className="px-4 py-3">{project.name}</td>
              <td className="px-4 py-3">{record.quarter}</td>
              <td className="px-4 py-3"><StatusBadge status={record.status} /></td>
              <td className="px-4 py-3" style={{ color: MUTED }}>
                {record.generated_at ? new Date(record.generated_at).toLocaleDateString() : '—'}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  <OutlineButton onClick={() => void api.downloadQprExport(project.id, 'pdf', `QPR-${project.name}-${record.quarter}.pdf`)}>
                    PDF
                  </OutlineButton>
                  <OutlineButton onClick={() => void api.downloadQprExport(project.id, 'csv', `QPR-${project.name}-${record.quarter}.csv`)}>
                    CSV
                  </OutlineButton>
                </div>
              </td>
            </tr>
          ))
        )}
      </Table>

      <DemoBadge show={rows.isDemo} />
    </div>
  );
}
