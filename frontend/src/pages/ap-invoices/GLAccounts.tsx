import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, type GLAccount } from '../../lib/ap-invoice/supabase';
import { requireCompanyId } from '../../lib/ap-invoice/companyService';
import {
  deleteGlAccount,
  insertGlAccount,
  listGlAccounts,
  resolveGlStoreTable,
  updateGlAccount,
} from '../../lib/ap-invoice/glAccountsStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Plus, Search, Edit2, Trash2, FileText, Upload, Download, AlertCircle } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import {
  type AccountingStandard,
  STANDARD_TEMPLATES,
  getAccountingStandard,
  setAccountingStandard,
  loadStandardTemplateGLAccounts,
  importGLFromCSV,
  exportForZoho,
  exportForTally,
  countUnconfirmedAiGlInvoices,
} from '../../lib/ap-invoice/accountingStandardService';

const accountTypeColors = {
  Asset: 'bg-blue-100 text-blue-800 border-blue-200',
  Liability: 'bg-red-100 text-red-800 border-red-200',
  Equity: 'bg-green-100 text-green-800 border-green-200',
  Revenue: 'bg-purple-100 text-purple-800 border-purple-200',
  Expense: 'bg-orange-100 text-orange-800 border-orange-200',
  COGS: 'bg-yellow-100 text-yellow-800 border-yellow-200',
};

const STANDARD_ORDER: AccountingStandard[] = [
  'IFRS',
  'US_GAAP',
  'IND_AS',
  'IGAAP',
  'CASH_BASIS',
  'CUSTOM',
];

export function GLAccounts() {
  const { toast } = useToast();
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [filteredAccounts, setFilteredAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [templateConfirmOpen, setTemplateConfirmOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<GLAccount | null>(null);
  const [selectedStandard, setSelectedStandard] = useState<AccountingStandard>('IFRS');
  const [unconfirmedAiCount, setUnconfirmedAiCount] = useState(0);
  const [importCsvText, setImportCsvText] = useState('');
  const [importSource, setImportSource] = useState<'tally' | 'zoho' | 'manual'>('tally');
  const [exportMonth, setExportMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [formData, setFormData] = useState({
    gl_code: '',
    gl_name: '',
    account_type: 'Expense' as 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense' | 'COGS',
    department: '',
    cost_center: '',
  });

  const [dialogOpenState, setDialogOpenState] = useState(false);

  useEffect(() => {
    fetchGLAccounts();
    void refreshStandardAndBanner();
  }, []);

  useEffect(() => {
    filterAccounts();
  }, [glAccounts, searchTerm]);

  async function refreshStandardAndBanner() {
    try {
      const std = await getAccountingStandard(supabase);
      setSelectedStandard(std);
    } catch {
      setSelectedStandard('IFRS');
    }
    try {
      const n = await countUnconfirmedAiGlInvoices(supabase);
      setUnconfirmedAiCount(n);
    } catch {
      setUnconfirmedAiCount(0);
    }
  }

  async function fetchGLAccounts() {
    try {
      const companyId = await requireCompanyId().catch(() => null);
      const rows = await listGlAccounts(supabase, companyId);
      // If tenant filter returned nothing, show company-unscoped rows (legacy / seed data)
      if (rows.length === 0 && companyId) {
        const all = await listGlAccounts(supabase, null);
        setGlAccounts(all);
      } else {
        setGlAccounts(rows);
      }
      const store = await resolveGlStoreTable(supabase);
      if (store === 'uae_chart_of_accounts' && rows.length === 0) {
        // Soft hint — template seed still works against the fallback table
        console.info('[GLAccounts] using uae_chart_of_accounts fallback (gl_accounts missing)');
      }
    } catch (error: unknown) {
      console.error('Error fetching GL accounts:', error);
      setGlAccounts([]);
      toast({
        title: 'Error',
        description: 'Failed to fetch GL accounts. Use “Load standard template” to seed IFRS codes.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  function filterAccounts() {
    let filtered = glAccounts;

    if (searchTerm) {
      filtered = filtered.filter(
        (account) =>
          account.gl_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
          account.gl_name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredAccounts(filtered);
  }

  function openDialog(account?: GLAccount) {
    if (account) {
      setEditingAccount(account);
      setFormData({
        gl_code: account.gl_code,
        gl_name: account.gl_name,
        account_type: account.account_type,
        department: account.department || '',
        cost_center: account.cost_center || '',
      });
    } else {
      setEditingAccount(null);
      setFormData({
        gl_code: '',
        gl_name: '',
        account_type: 'Expense',
        department: '',
        cost_center: '',
      });
    }
    setDialogOpenState(true);
  }

  async function handleSelectStandard(std: AccountingStandard) {
    setSelectedStandard(std);
    try {
      await setAccountingStandard(std, supabase);
      toast({ title: 'Accounting standard', description: `${STANDARD_TEMPLATES[std].label} selected.` });
    } catch (e) {
      console.error(e);
      toast({ title: 'Could not save standard', variant: 'destructive' });
    }
  }

  async function confirmLoadTemplate() {
    setTemplateConfirmOpen(false);
    const { inserted, skipped, error } = await loadStandardTemplateGLAccounts(supabase, selectedStandard);
    if (error) {
      toast({ title: 'Template load failed', description: error, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Standard template',
      description: `Added ${inserted} GL code(s). Skipped ${skipped} existing.`,
    });
    void fetchGLAccounts();
  }

  async function handleImportCsv() {
    const { imported, error } = await importGLFromCSV(supabase, importCsvText, importSource);
    if (error) {
      toast({ title: 'Import failed', description: error, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Import complete',
      description: `${imported} GL account${imported === 1 ? '' : 's'} imported from ${importSource === 'zoho' ? 'Zoho' : importSource === 'tally' ? 'Tally' : 'CSV'}.`,
    });
    setImportOpen(false);
    setImportCsvText('');
    void fetchGLAccounts();
  }

  function downloadText(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportZoho() {
    try {
      const csv = await exportForZoho(supabase, exportMonth);
      downloadText(`zoho-export-${exportMonth}.csv`, csv, 'text/csv;charset=utf-8');
      toast({ title: 'Download started', description: 'Approved invoices with confirmed GL only.' });
    } catch (e) {
      console.error(e);
      toast({ title: 'Export failed', variant: 'destructive' });
    }
  }

  async function handleExportTally() {
    try {
      const xml = await exportForTally(supabase, exportMonth);
      downloadText(`tally-export-${exportMonth}.xml`, xml, 'application/xml;charset=utf-8');
      toast({ title: 'Download started', description: 'Approved invoices with confirmed GL only.' });
    } catch (e) {
      console.error(e);
      toast({ title: 'Export failed', variant: 'destructive' });
    }
  }

  const importPreviewRows = importCsvText
    .split('\n')
    .filter((l) => l.trim())
    .slice(0, 6);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.gl_code || !formData.gl_name) {
      toast({
        title: 'Error',
        description: 'Please fill in GL Code and GL Name',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (editingAccount) {
        const { error } = await updateGlAccount(supabase, editingAccount.id, {
          gl_name: formData.gl_name,
          account_type: formData.account_type,
          department: formData.department || null,
          cost_center: formData.cost_center || null,
        });

        if (error) throw new Error(error);

        toast({
          title: 'Success',
          description: 'GL account updated successfully',
        });
      } else {
        const company_id = await requireCompanyId();
        const { error } = await insertGlAccount(supabase, {
          company_id,
          gl_code: formData.gl_code,
          gl_name: formData.gl_name,
          account_type: formData.account_type,
          department: formData.department || null,
          cost_center: formData.cost_center || null,
        });

        if (error) throw new Error(error);

        toast({
          title: 'Success',
          description: 'GL account created successfully',
        });
      }

      setDialogOpenState(false);
      setEditingAccount(null);
      setFormData({
        gl_code: '',
        gl_name: '',
        account_type: 'Expense',
        department: '',
        cost_center: '',
      });
      fetchGLAccounts();
    } catch (error: unknown) {
      console.error('Error saving GL account:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save GL account',
        variant: 'destructive',
      });
    }
  }

  async function handleDelete(account: GLAccount) {
    if (!confirm(`Are you sure you want to delete GL account ${account.gl_code}?`)) {
      return;
    }

    try {
      const { error } = await updateGlAccount(supabase, account.id, { is_active: false });
      if (error) {
        // Soft deactivate not supported on fallback table — hard delete
        const del = await deleteGlAccount(supabase, account.id);
        if (del.error) throw new Error(del.error);
      }

      toast({
        title: 'Success',
        description: 'GL account deactivated successfully',
      });
      fetchGLAccounts();
    } catch (error: unknown) {
      console.error('Error deleting GL account:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete GL account',
        variant: 'destructive',
      });
    }
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading GL accounts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {unconfirmedAiCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>
              {unconfirmedAiCount} invoice{unconfirmedAiCount === 1 ? '' : 's'} have unconfirmed GL codes â€” AI suggested codes need your review
            </span>
          </div>
          <Button asChild variant="outline" size="sm" className="border-amber-600 text-amber-950">
            <Link to="/invoices">Review now</Link>
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">GL Accounts</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage General Ledger accounts for invoice coding
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Dialog open={dialogOpenState} onOpenChange={setDialogOpenState}>
            <DialogTrigger asChild>
              <Button className="bg-[#0A4B8F]" onClick={() => openDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                Add GL Account
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editingAccount ? 'Edit GL Account' : 'Create GL Account'}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="gl_code">GL Code *</Label>
                    <Input
                      id="gl_code"
                      required
                      value={formData.gl_code}
                      onChange={(e) =>
                        setFormData({ ...formData, gl_code: e.target.value })
                      }
                      placeholder="6100"
                      disabled={!!editingAccount}
                    />
                    {editingAccount && (
                      <p className="text-xs text-gray-500">GL Code cannot be changed</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="account_type">Account Type *</Label>
                    <Select
                      value={formData.account_type}
                      onValueChange={(value: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense' | 'COGS') =>
                        setFormData({ ...formData, account_type: value })
                      }
                    >
                      <SelectTrigger id="account_type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Asset">Asset</SelectItem>
                        <SelectItem value="Liability">Liability</SelectItem>
                        <SelectItem value="Equity">Equity</SelectItem>
                        <SelectItem value="Revenue">Revenue</SelectItem>
                        <SelectItem value="Expense">Expense</SelectItem>
                        <SelectItem value="COGS">COGS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gl_name">GL Name *</Label>
                  <Input
                    id="gl_name"
                    required
                    value={formData.gl_name}
                    onChange={(e) =>
                      setFormData({ ...formData, gl_name: e.target.value })
                    }
                    placeholder="Office Supplies"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="department">Department</Label>
                    <Input
                      id="department"
                      value={formData.department}
                      onChange={(e) =>
                        setFormData({ ...formData, department: e.target.value })
                      }
                      placeholder="Administration"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cost_center">Cost Center</Label>
                    <Input
                      id="cost_center"
                      value={formData.cost_center}
                      onChange={(e) =>
                        setFormData({ ...formData, cost_center: e.target.value })
                      }
                      placeholder="ADM-001"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpenState(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="bg-[#0A4B8F]">
                    {editingAccount ? 'Update' : 'Create'} GL Account
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Accounting standard</CardTitle>
          <CardDescription>
            Drives default GL suggestions when a code is not in your chart. Matches the accounting standard under Settings (Accounting and Compliance).
            Selecting IFRS or loading template codes here does not fill the IFRS category on invoices you already uploaded; that value comes from OCR/upload or from editing each invoice. After a category is set, GL codes resolve using your chart of accounts (Settings) and this standard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STANDARD_ORDER.map((key) => {
              const cfg = STANDARD_TEMPLATES[key];
              const active = selectedStandard === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => void handleSelectStandard(key)}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    active ? 'border-[#0A4B8F] bg-blue-50 ring-2 ring-[#0A4B8F]/30' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <p className="font-semibold text-gray-900">{cfg.label}</p>
                  <p className="mt-1 text-xs text-gray-600">{cfg.whoUsesIt}</p>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => setTemplateConfirmOpen(true)} disabled={selectedStandard === 'CUSTOM'}>
              Load standard template
            </Button>
            <p className="text-xs text-gray-500">
              Adds missing codes from the selected standard only â€” does not remove or overwrite existing GL accounts.
            </p>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={templateConfirmOpen} onOpenChange={setTemplateConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load standard template?</AlertDialogTitle>
            <AlertDialogDescription>
              This will add {STANDARD_TEMPLATES[selectedStandard].categories.length} standard GL codes for{' '}
              {STANDARD_TEMPLATES[selectedStandard].label}. Your existing codes will not be removed or changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmLoadTemplate()}>Add missing codes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import chart of accounts</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Source</Label>
              <Select value={importSource} onValueChange={(v) => setImportSource(v as typeof importSource)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tally">Tally</SelectItem>
                  <SelectItem value="zoho">Zoho Books</SelectItem>
                  <SelectItem value="manual">Manual CSV</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gl-csv-file">Upload CSV file</Label>
              <Input
                id="gl-csv-file"
                type="file"
                accept=".csv,text/csv"
                className="cursor-pointer"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => setImportCsvText(String(reader.result ?? ''));
                  reader.readAsText(f);
                  e.target.value = '';
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Paste CSV (optional)</Label>
              <textarea
                className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={importCsvText}
                onChange={(e) => setImportCsvText(e.target.value)}
                placeholder="Header row with code + name columns..."
              />
            </div>
            {importPreviewRows.length > 0 && (
              <div className="rounded border bg-muted/40 p-2 text-xs font-mono overflow-x-auto">
                {importPreviewRows.slice(0, 5).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
            <Button type="button" className="w-full bg-[#0A4B8F]" onClick={() => void handleImportCsv()}>
              Import accounts
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search by GL code or name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* GL Accounts Table */}
      <Card>
        <CardHeader>
          <CardTitle>All GL Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredAccounts.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-4 text-gray-600">No GL accounts found</p>
              <p className="mt-2 text-sm text-gray-500">
                Create your first GL account to get started
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>GL Code</TableHead>
                    <TableHead>GL Name</TableHead>
                    <TableHead>Account Type</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Cost Center</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts
                    .filter((account) => account.is_active)
                    .map((account) => (
                      <TableRow key={account.id}>
                        <TableCell className="font-medium">{account.gl_code}</TableCell>
                        <TableCell>{account.gl_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={accountTypeColors[account.account_type]}>
                            {account.account_type}
                          </Badge>
                        </TableCell>
                        <TableCell>{account.department || 'â€”'}</TableCell>
                        <TableCell>{account.cost_center || 'â€”'}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              account.is_active
                                ? 'bg-green-100 text-green-800 border-green-200'
                                : 'bg-gray-100 text-gray-800 border-gray-200'
                            }
                          >
                            {account.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDialog(account)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(account)}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Export</CardTitle>
          <CardDescription>
            Exports only approved invoices with confirmed GL codes (status Approved or approval chain approved, and GL confirmed).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="space-y-2">
            <Label>Month</Label>
            <Input type="month" value={exportMonth} onChange={(e) => setExportMonth(e.target.value)} />
          </div>
          <Button type="button" variant="outline" onClick={() => void handleExportZoho()}>
            <Download className="mr-2 h-4 w-4" />
            Export for Zoho Books
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleExportTally()}>
            <Download className="mr-2 h-4 w-4" />
            Export for Tally
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

