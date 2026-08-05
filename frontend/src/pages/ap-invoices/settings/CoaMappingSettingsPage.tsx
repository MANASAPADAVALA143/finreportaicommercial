import { useEffect, useState } from 'react';
import { BookOpen, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  loadEffectiveCoaMappings,
  resetCompanyCoaOverride,
  saveCompanyCoaOverride,
  type CoaMappingRow,
} from '@/services/coaVatMapping.service';

type Draft = Record<string, { gl_code: string; gl_name: string }>;

export default function CoaMappingSettingsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<CoaMappingRow[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await loadEffectiveCoaMappings();
      setRows(data);
      const d: Draft = {};
      for (const r of data) {
        d[r.category_key] = { gl_code: r.gl_code, gl_name: r.gl_name };
      }
      setDraft(d);
    } catch (e) {
      toast({
        title: 'Could not load COA mappings',
        description: e instanceof Error ? e.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = async (key: string) => {
    const d = draft[key];
    if (!d?.gl_code?.trim() || !d?.gl_name?.trim()) {
      toast({ title: 'GL code and name are required', variant: 'destructive' });
      return;
    }
    setSavingKey(key);
    try {
      await saveCompanyCoaOverride({
        category_key: key,
        gl_code: d.gl_code,
        gl_name: d.gl_name,
      });
      toast({ title: 'Override saved', description: `${key} → ${d.gl_code}` });
      await load();
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      setSavingKey(null);
    }
  };

  const onReset = async (key: string) => {
    setSavingKey(key);
    try {
      await resetCompanyCoaOverride(key);
      toast({ title: 'Reset to default', description: key });
      await load();
    } catch (e) {
      toast({
        title: 'Reset failed',
        description: e instanceof Error ? e.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-[#0A4B8F]" />
            Company COA Mapping
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Default UAE IFRS/VAT treatment → GL codes. Override per workspace when you use your own chart of
            accounts.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Treatment → GL account</CardTitle>
          <CardDescription>
            Used to show the GL Account column on approved invoices. Approve-and-post still uses the GL codes
            stored on each invoice when posting journal entries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>GL code</TableHead>
                    <TableHead>Account name</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.category_key}>
                      <TableCell>
                        <div className="font-medium text-sm">{r.category_label}</div>
                        <code className="text-xs text-muted-foreground">{r.category_key}</code>
                      </TableCell>
                      <TableCell>
                        {r.source === 'company' ? (
                          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Your COA</Badge>
                        ) : (
                          <Badge variant="secondary">Default</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Label className="sr-only" htmlFor={`code-${r.category_key}`}>
                          GL code
                        </Label>
                        <Input
                          id={`code-${r.category_key}`}
                          className="font-mono w-28"
                          value={draft[r.category_key]?.gl_code ?? ''}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              [r.category_key]: {
                                gl_code: e.target.value,
                                gl_name: prev[r.category_key]?.gl_name ?? r.gl_name,
                              },
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={draft[r.category_key]?.gl_name ?? ''}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              [r.category_key]: {
                                gl_code: prev[r.category_key]?.gl_code ?? r.gl_code,
                                gl_name: e.target.value,
                              },
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void onSave(r.category_key)}
                          disabled={savingKey === r.category_key}
                        >
                          <Save className="h-3.5 w-3.5" />
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void onReset(r.category_key)}
                          disabled={savingKey === r.category_key || r.source !== 'company'}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Default
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
