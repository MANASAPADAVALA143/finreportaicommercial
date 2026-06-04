import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useToast } from '../../hooks/use-toast';
import {
  createCompanyForClient,
  fetchAllCompaniesAdmin,
  isSuperAdmin,
  switchActiveCompany,
  TIER_PRESETS,
  type Company,
  type SubscriptionTier,
} from '../../lib/ap-invoice/companyService';
export function AdminClients() {
  const { toast } = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('finance');
  const [standard, setStandard] = useState('IFRS');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [tier, setTier] = useState<SubscriptionTier>('starter');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const ok = await isSuperAdmin();
      setAllowed(ok);
      if (ok) {
        const rows = await fetchAllCompaniesAdmin();
        setCompanies(rows);
      }
    } catch (e) {
      console.error(e);
      toast({ title: 'Failed to load', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [toast]);

  const stats = useMemo(() => {
    const active = companies.filter((c) => c.subscription_status === 'active').length;
    const trial = companies.filter((c) => c.subscription_status === 'trial').length;
    const paused = companies.filter((c) => c.subscription_status === 'paused').length;
    const mrr = companies.reduce((s, c) => s + (c.price_inr_monthly ?? 0), 0);
    return { active, trial, paused, mrr, total: companies.length };
  }, [companies]);

  if (allowed === false) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <h1 className="text-lg font-semibold">Access restricted</h1>
        <p className="mt-2 text-sm">
          This page is for platform administrators only. Ask your database admin to set your{' '}
          <code className="rounded bg-white px-1">company_members.role</code> to{' '}
          <code className="rounded bg-white px-1">super_admin</code> (see MULTI-TENANT-MIGRATION.sql).
        </p>
      </div>
    );
  }

  if (loading || allowed === null) {
    return <div className="py-12 text-center text-gray-500">Loadingâ€¦</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-600">Onboard tenants, review plans, and estimated MRR.</p>
        </div>
        <Button onClick={() => setOpen(true)}>Onboard new client</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Companies</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{stats.total}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Active / Trial / Paused</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold">
            {stats.active} / {stats.trial} / {stats.paused}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">MRR estimate (â‚¹)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{stats.mrr.toLocaleString('en-IN')}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Tiers</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-gray-600">
            Starter â‚¹{TIER_PRESETS.starter.price_inr_monthly.toLocaleString('en-IN')} Â· Growth â‚¹
            {TIER_PRESETS.growth.price_inr_monthly.toLocaleString('en-IN')} Â· Enterprise â‚¹
            {TIER_PRESETS.enterprise.price_inr_monthly.toLocaleString('en-IN')}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All clients</CardTitle>
          <CardDescription>Invoice usage per company requires a follow-up SQL view or Edge function for exact counts.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoices / mo cap</TableHead>
                <TableHead>Users cap</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.industry}</TableCell>
                  <TableCell className="capitalize">{c.subscription_tier}</TableCell>
                  <TableCell className="capitalize">{c.subscription_status}</TableCell>
                  <TableCell>
                    {c.subscription_tier === 'enterprise' || c.max_invoices_per_month < 0
                      ? 'Unlimited'
                      : `â‰¤ ${c.max_invoices_per_month}`}
                  </TableCell>
                  <TableCell>
                    {c.max_users < 0 ? 'Unlimited' : c.max_users}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void (async () => {
                          try {
                            await switchActiveCompany(c.id);
                            window.location.reload();
                          } catch (e) {
                            toast({
                              title: 'Switch requires sign-in',
                              description: e instanceof Error ? e.message : String(e),
                              variant: 'destructive',
                            });
                          }
                        })();
                      }}
                    >
                      View as
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Onboard client</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Company name</Label>
              <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Industry</Label>
              <Input className="mt-1" value={industry} onChange={(e) => setIndustry(e.target.value)} />
            </div>
            <div>
              <Label>Accounting standard</Label>
              <Select value={standard} onValueChange={setStandard}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IFRS">IFRS</SelectItem>
                  <SelectItem value="US GAAP">US GAAP</SelectItem>
                  <SelectItem value="Ind AS">Ind AS</SelectItem>
                  <SelectItem value="IGAAP">IGAAP</SelectItem>
                  <SelectItem value="Cash Basis">Cash Basis</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Plan</Label>
              <Select value={tier} onValueChange={(v) => setTier(v as SubscriptionTier)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="growth">Growth</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Owner email (invite)</Label>
              <Input
                className="mt-1"
                type="email"
                placeholder="optional"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={submitting || !name.trim()}
              onClick={() => {
                void (async () => {
                  setSubmitting(true);
                  try {
                    await createCompanyForClient({
                      name: name.trim(),
                      industry,
                      accounting_standard: standard,
                      tier,
                      ownerEmail: ownerEmail.trim() || undefined,
                    });
                    toast({ title: 'Client created', description: `${name.trim()} is ready.` });
                    setOpen(false);
                    setName('');
                    setOwnerEmail('');
                    await load();
                  } catch (e) {
                    toast({
                      title: 'Failed',
                      description: e instanceof Error ? e.message : String(e),
                      variant: 'destructive',
                    });
                  } finally {
                    setSubmitting(false);
                  }
                })();
              }}
            >
              {submitting ? 'Creatingâ€¦' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

