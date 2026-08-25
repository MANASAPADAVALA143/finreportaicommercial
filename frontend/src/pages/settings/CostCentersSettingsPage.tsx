import { useEffect, useMemo, useState } from 'react';
import { Building2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { useToast } from '../../hooks/use-toast';
import { useIndustryConfig } from '../../context/IndustryConfigContext';
import {
  costCentersPageTitle,
  createCostCenter,
  deleteCostCenter,
  listCostCenters,
  type CostCenter,
} from '../../services/industryConfig.service';

export default function CostCentersSettingsPage() {
  const { toast } = useToast();
  const cfg = useIndustryConfig();
  const title = costCentersPageTitle(cfg.industry, cfg.costCenterLabel);

  const [items, setItems] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [importText, setImportText] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setItems(await listCostCenters(false));
    } catch (e) {
      toast({
        title: `Could not load ${title.toLowerCase()}`,
        description: e instanceof Error ? e.message : 'Request failed',
        variant: 'destructive',
      });
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.industry]);

  const activeCount = useMemo(() => items.filter((i) => i.is_active).length, [items]);

  const onCreate = async () => {
    if (!name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createCostCenter({
        name: name.trim(),
        code: code.trim() || undefined,
        description: description.trim() || undefined,
      });
      setName('');
      setCode('');
      setDescription('');
      toast({ title: `${cfg.costCenterLabel} created` });
      await load();
    } catch (e) {
      toast({
        title: 'Create failed',
        description: e instanceof Error ? e.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      await deleteCostCenter(id);
      toast({ title: 'Deactivated' });
      await load();
    } catch (e) {
      toast({
        title: 'Delete failed',
        description: e instanceof Error ? e.message : 'Request failed',
        variant: 'destructive',
      });
    }
  };

  const onImport = async () => {
    // Excel/CSV-ish: code,name,description per line
    const lines = importText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;
    setSaving(true);
    let ok = 0;
    let fail = 0;
    for (const line of lines) {
      if (/^code\s*[,;\t]/i.test(line)) continue;
      const parts = line.split(/[,;\t]/).map((p) => p.trim());
      const [c, n, d] = parts;
      if (!c || !n) {
        fail += 1;
        continue;
      }
      try {
        await createCostCenter({ code: c, name: n, description: d });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setSaving(false);
    toast({ title: `Imported ${ok}${fail ? ` · ${fail} failed` : ''}` });
    setImportText('');
    await load();
  };

  return (
    <div className="space-y-6 p-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="h-6 w-6 text-blue-700" />
            {title}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage {cfg.costCenterLabel.toLowerCase()} master data for {cfg.industryLabel}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add {cfg.costCenterLabel}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="text-xs text-slate-500">Code</label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PR-001" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={cfg.costCenterPlaceholder}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={() => void onCreate()} disabled={saving}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Import from Excel / CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-500">
            Paste rows as <code>code,name,description</code> (one per line). Header row optional.
          </p>
          <textarea
            className="w-full min-h-[100px] rounded-md border border-slate-200 p-3 text-sm"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'code,name,description\nPR-01,Marina Tower,\nPR-02,Business Bay'}
          />
          <Button variant="outline" onClick={() => void onImport()} disabled={saving || !importText.trim()}>
            Import
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            All {title} ({activeCount} active)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                    No {cfg.costCenterLabel}s added yet. Add your first one to start tagging invoices
                    by {cfg.costCenterLabel}.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                items.map((row) => (
                  <TableRow key={row.id} className={!row.is_active ? 'opacity-50' : ''}>
                    <TableCell className="font-mono text-sm">{row.code}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.description || '—'}</TableCell>
                    <TableCell>{row.is_active ? 'Active' : 'Inactive'}</TableCell>
                    <TableCell>
                      {row.is_active && (
                        <Button variant="ghost" size="sm" onClick={() => void onDelete(row.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
