import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Trash2, Upload } from 'lucide-react';
import {
  EVIDENCE_ACCEPT,
  EVIDENCE_MAX_BYTES,
  workpapersApi,
  type WorkpaperEvidence,
} from '../../services/internalAudit.service';
import { errorText } from './shared';

function size(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = { companyId: string; procedureId: number; onCountChange: (n: number) => void };

export function EvidencePanel({ companyId, procedureId, onCountChange }: Props) {
  const [files, setFiles] = useState<WorkpaperEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const onCount = useRef(onCountChange);
  onCount.current = onCountChange;

  const show = (rows: WorkpaperEvidence[]) => {
    setFiles(rows);
    onCount.current(rows.length);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await workpapersApi.evidence(companyId, procedureId);
      setFiles(rows);
      onCount.current(rows.length);
    } catch (e) {
      setError(errorText(e, 'Failed to load evidence'));
    } finally {
      setLoading(false);
    }
  }, [companyId, procedureId]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > EVIDENCE_MAX_BYTES) {
      setError(`${file.name} is larger than 20 MB`);
      return;
    }
    setUploading(true);
    setError('');
    try {
      const created = await workpapersApi.upload(companyId, procedureId, file, note.trim() || undefined);
      show([...files, created]);
      setNote('');
    } catch (e) {
      setError(errorText(e, 'Upload failed'));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  const download = async (ev: WorkpaperEvidence) => {
    setError('');
    try {
      const { url } = await workpapersApi.downloadUrl(companyId, ev.id);
      window.location.assign(url);
    } catch (e) {
      setError(errorText(e, 'Download failed'));
    }
  };

  const remove = async (ev: WorkpaperEvidence) => {
    if (!window.confirm(`Delete evidence "${ev.file_name}"? This cannot be undone.`)) return;
    setError('');
    try {
      await workpapersApi.removeEvidence(companyId, ev.id);
      show(files.filter((f) => f.id !== ev.id));
    } catch (e) {
      setError(errorText(e, 'Delete failed'));
    }
  };

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading evidence…</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No evidence attached.</p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-xs">
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate" title={f.file_name}>{f.file_name}</p>
                <p className="text-muted-foreground">
                  {[size(f.file_size), f.uploaded_by, f.created_at?.slice(0, 10)].filter(Boolean).join(' · ')}
                </p>
                {f.notes && <p className="text-muted-foreground">{f.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => void download(f)} aria-label={`Download ${f.file_name}`} className="p-1 text-muted-foreground hover:text-blue-600 rounded">
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => void remove(f)} aria-label={`Delete ${f.file_name}`} className="p-1 text-muted-foreground hover:text-red-600 rounded">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          placeholder="Note for the next file (optional), e.g. sample item 14 invoice"
          className="flex-1 min-w-48 rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <label className={`flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground ${uploading ? 'opacity-50' : 'cursor-pointer hover:bg-muted'}`}>
          <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Attach file'}
          <input
            ref={input}
            type="file"
            className="sr-only"
            accept={EVIDENCE_ACCEPT}
            disabled={uploading}
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">PDF, Excel, CSV, Word, TXT, PNG or JPG · up to 20 MB</p>
    </div>
  );
}
