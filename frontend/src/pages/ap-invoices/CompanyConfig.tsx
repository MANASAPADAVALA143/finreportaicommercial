import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useToast } from '../../hooks/use-toast';
import {
  getCompanyConfig,
  getMyCompany,
  updateCompanyConfigJson,
  parseApprovalFlow,
  type VendorRuleAction,
} from '../../lib/ap-invoice/companyService';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { Plus, Trash2 } from 'lucide-react';

type VendorRuleRow = { name: string; rule: VendorRuleAction };
type GlRow = { category: string; code: string };

export function CompanyConfig() {
  const { toast } = useToast();
  const { baseCurrency } = useCompanySettings();
  const currencyLabel = (baseCurrency || 'AED').toUpperCase() === 'INR' ? '₹' : (baseCurrency || 'AED');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyName, setCompanyName] = useState('');

  const [approvalChain, setApprovalChain] = useState<string[]>([]);
  const [autoUnder] = useState('10000');
  const [fmBand] = useState('100000');

  const [vendorRules, setVendorRules] = useState<VendorRuleRow[]>([]);
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorRule, setNewVendorRule] = useState<VendorRuleAction>('manual_review');

  const [gstOn, setGstOn] = useState(true);
  const [dupOn, setDupOn] = useState(true);
  const [dupDays, setDupDays] = useState('365');
  const [requirePoAbove, setRequirePoAbove] = useState('100000');
  const [maxWithoutPo, setMaxWithoutPo] = useState('50000');
  const [blockedList, setBlockedList] = useState<string[]>([]);
  const [blockedInput, setBlockedInput] = useState('');

  const [matchPricePct, setMatchPricePct] = useState('3');
  const [matchQtyPct, setMatchQtyPct] = useState('2');
  const [matchTaxInr, setMatchTaxInr] = useState('250');
  const [matchAutoApprove, setMatchAutoApprove] = useState(true);
  const [matchOnUpload, setMatchOnUpload] = useState(true);
  const [matchRequireGrn, setMatchRequireGrn] = useState(false);

  const [glRows, setGlRows] = useState<GlRow[]>([]);
  const [newCat, setNewCat] = useState('');
  const [newGl, setNewGl] = useState('');

  const [primaryErp, setPrimaryErp] = useState('none');
  const [exportFmt, setExportFmt] = useState('csv');
  const [tallyOn, setTallyOn] = useState(false);
  const [zohoOn, setZohoOn] = useState(false);
  const [sapOn, setSapOn] = useState(false);
  const [qbOn, setQbOn] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const co = await getMyCompany();
        setCompanyName(co?.name ?? '');
        const cfg = await getCompanyConfig();
        if (cfg) {
          setApprovalChain(parseApprovalFlow(cfg.approval_flow));
          const vr = cfg.vendor_rules ?? {};
          setVendorRules(Object.entries(vr).map(([name, rule]) => ({ name, rule: rule as VendorRuleAction })));
          const gl = cfg.gl_mapping ?? {};
          setGlRows(Object.entries(gl).map(([category, code]) => ({ category, code })));
          const cr = (cfg.compliance_rules ?? {}) as Record<string, unknown>;
          setGstOn(Boolean(cr.gst_check_enabled ?? true));
          setDupOn(Boolean(cr.duplicate_check_enabled ?? true));
          setDupDays(String(cr.duplicate_lookback_days ?? 365));
          setRequirePoAbove(String(cr.require_po_above ?? 100000));
          setMaxWithoutPo(String(cr.max_amount_without_po ?? 50000));
          setBlockedList(Array.isArray(cr.blocked_vendors) ? (cr.blocked_vendors as string[]) : []);
          const erp = (cfg.erp_config ?? {}) as Record<string, unknown>;
          setPrimaryErp(String(erp.primary_erp ?? 'none'));
          setExportFmt(String(erp.export_format ?? 'csv'));
          setTallyOn(Boolean(erp.tally_enabled));
          setZohoOn(Boolean(erp.zoho_enabled));
          setSapOn(Boolean(erp.sap_enabled));
          setQbOn(Boolean(erp.quickbooks_enabled));
          const mt = cfg.match_tolerance as Record<string, unknown> | undefined;
          if (mt && typeof mt === 'object') {
            setMatchPricePct(String(mt.price_variance_pct ?? 3));
            setMatchQtyPct(String(mt.qty_variance_pct ?? 2));
            setMatchTaxInr(String(mt.tax_variance_inr ?? 250));
            setMatchAutoApprove(Boolean(mt.auto_approve_on_full_match ?? true));
            setMatchOnUpload(Boolean(mt.auto_match_on_upload ?? true));
            setMatchRequireGrn(Boolean(mt.require_grn_for_match ?? false));
          }
        }
      } catch (e) {
        console.error(e);
        toast({ title: 'Failed to load config', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  async function handleSave() {
    setSaving(true);
    try {
      const vendor_rules: Record<string, VendorRuleAction> = {};
      for (const r of vendorRules) {
        if (r.name.trim()) vendor_rules[r.name.trim()] = r.rule;
      }
      const gl_mapping: Record<string, string> = {};
      for (const r of glRows) {
        if (r.category.trim() && r.code.trim()) gl_mapping[r.category.trim()] = r.code.trim();
      }
      await updateCompanyConfigJson({
        // approval_flow is legacy display-only — do not present this page as the routing source of truth.
        // Real routing: Settings → Approval Rules (approval_rules table).
        vendor_rules,
        gl_mapping,
        compliance_rules: {
          gst_check_enabled: gstOn,
          duplicate_check_enabled: dupOn,
          duplicate_lookback_days: Number(dupDays) || 365,
          max_amount_without_po: Number(maxWithoutPo) || 0,
          require_po_above: Number(requirePoAbove) || 0,
          blocked_vendors: blockedList,
        },
        erp_config: {
          primary_erp: primaryErp,
          tally_enabled: tallyOn,
          zoho_enabled: zohoOn,
          sap_enabled: sapOn,
          quickbooks_enabled: qbOn,
          export_format: exportFmt,
        },
        match_tolerance: {
          price_variance_pct: Number(matchPricePct) || 3,
          qty_variance_pct: Number(matchQtyPct) || 2,
          tax_variance_inr: Number(matchTaxInr) || 250,
          auto_approve_on_full_match: matchAutoApprove,
          auto_match_on_upload: matchOnUpload,
          require_grn_for_match: matchRequireGrn,
        },
      });
      toast({ title: 'Saved', description: 'Company configuration updated.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">Loading company configâ€¦</div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Company configuration</h1>
          <p className="text-sm text-gray-600">
            Customise approval flow, vendor rules, compliance, GL hints, and ERP for {companyName || 'your company'}.
          </p>
        </div>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Savingâ€¦' : 'Save all'}
        </Button>
      </div>

      <Card className="border-amber-200 bg-amber-50/40">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Approval flow
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
              Not active
            </span>
          </CardTitle>
          <CardDescription>
            These controls are not connected to My Approvals. Real routing uses amount bands and approver emails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-medium">These settings are not yet active</p>
            <p className="mt-1 text-amber-900/90">
              Role names (e.g. Finance Manager, CFO) and the auto-approve / mid-band fields on this page are{' '}
              <strong>not read</strong> when invoices are submitted for approval. Configure real approval routing in{' '}
              <a href="/ap-invoices/settings" className="font-semibold underline underline-offset-2">
                Settings → Approval Rules
              </a>{' '}
              (emails + amount bands). Wiring this page into <code className="text-xs">approval_rules</code> is on the
              backlog so there is one source of truth later.
            </p>
          </div>

          {approvalChain.length > 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white/70 p-3 opacity-70">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Legacy labels (display only — not used for routing)
              </p>
              <ul className="space-y-1 text-sm text-gray-700">
                {approvalChain.map((label, i) => (
                  <li key={`${label}-${i}`}>
                    {i + 1}. {label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-3 rounded-lg border border-dashed border-gray-300 bg-white/70 p-4 text-sm opacity-70 md:grid-cols-2">
            <div>
              <Label className="text-gray-500">Auto-approve under ({currencyLabel}) — inactive</Label>
              <Input value={autoUnder} disabled readOnly className="mt-1 bg-gray-50" />
            </div>
            <div>
              <Label className="text-gray-500">Mid band ceiling ({currencyLabel}) — inactive</Label>
              <Input value={fmBand} disabled readOnly className="mt-1 bg-gray-50" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vendor rules</CardTitle>
          <CardDescription>Match behaviour by vendor name (partial match supported in code).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4">Vendor</th>
                  <th className="py-2 pr-4">Rule</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {vendorRules.map((row, idx) => (
                  <tr key={idx} className="border-b border-gray-100">
                    <td className="py-2 pr-4">
                      <Input
                        value={row.name}
                        onChange={(e) => {
                          const v = e.target.value;
                          setVendorRules((r) => r.map((x, i) => (i === idx ? { ...x, name: v } : x)));
                        }}
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <Select
                        value={row.rule}
                        onValueChange={(v) => {
                          setVendorRules((r) =>
                            r.map((x, i) => (i === idx ? { ...x, rule: v as VendorRuleAction } : x))
                          );
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto_approve">Auto-approve</SelectItem>
                          <SelectItem value="manual_review">Manual review</SelectItem>
                          <SelectItem value="reject">Reject</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setVendorRules((r) => r.filter((_, i) => i !== idx))}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Vendor name" value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} className="max-w-xs" />
            <Select value={newVendorRule} onValueChange={(v) => setNewVendorRule(v as VendorRuleAction)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto_approve">Auto-approve</SelectItem>
                <SelectItem value="manual_review">Manual review</SelectItem>
                <SelectItem value="reject">Reject</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                const n = newVendorName.trim();
                if (!n) return;
                setVendorRules((r) => [...r, { name: n, rule: newVendorRule }]);
                setNewVendorName('');
              }}
            >
              Add rule
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compliance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>GST validation</Label>
            <Switch checked={gstOn} onCheckedChange={setGstOn} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={dupOn} onCheckedChange={setDupOn} />
              <Label>Duplicate detection</Label>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Lookback (days)</Label>
              <Input className="mt-1 w-24" value={dupDays} onChange={(e) => setDupDays(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Require PO above (â‚¹)</Label>
              <Input className="mt-1" value={requirePoAbove} onChange={(e) => setRequirePoAbove(e.target.value)} />
            </div>
            <div>
              <Label>Block without PO above (â‚¹)</Label>
              <Input className="mt-1" value={maxWithoutPo} onChange={(e) => setMaxWithoutPo(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Blocked vendors</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {blockedList.map((b) => (
                <span key={b} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs">
                  {b}
                  <button type="button" className="text-red-600" onClick={() => setBlockedList((l) => l.filter((x) => x !== b))}>
                    Ã—
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Input value={blockedInput} onChange={(e) => setBlockedInput(e.target.value)} placeholder="Vendor name" className="max-w-xs" />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  const t = blockedInput.trim();
                  if (!t) return;
                  setBlockedList((l) => [...l, t]);
                  setBlockedInput('');
                }}
              >
                Add
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3-Way match</CardTitle>
          <CardDescription>
            Tolerance and automation for PO / GRN / invoice matching (saved with &quot;Save all&quot;).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Price tolerance (%)</Label>
              <Input
                className="mt-1"
                type="number"
                min={0}
                step={0.1}
                value={matchPricePct}
                onChange={(e) => setMatchPricePct(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">Invoice vs PO within this %</p>
            </div>
            <div>
              <Label>Qty / value tolerance (%)</Label>
              <Input
                className="mt-1"
                type="number"
                min={0}
                step={0.1}
                value={matchQtyPct}
                onChange={(e) => setMatchQtyPct(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">Invoice vs GRN received value</p>
            </div>
            <div>
              <Label>Tax tolerance (â‚¹)</Label>
              <Input
                className="mt-1"
                type="number"
                min={0}
                step={1}
                value={matchTaxInr}
                onChange={(e) => setMatchTaxInr(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">Reserved for future tax rounding rules</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={matchAutoApprove} onCheckedChange={setMatchAutoApprove} />
              Auto-approve on full match
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={matchOnUpload} onCheckedChange={setMatchOnUpload} />
              Auto-match on every upload
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={matchRequireGrn} onCheckedChange={setMatchRequireGrn} />
              Require GRN before payment
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GL mapping hints</CardTitle>
          <CardDescription>Optional shortcuts layered on top of your chart of accounts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {glRows.map((row, idx) => (
            <div key={idx} className="flex flex-wrap gap-2">
              <Input
                placeholder="Category / IFRS label"
                value={row.category}
                onChange={(e) => setGlRows((r) => r.map((x, i) => (i === idx ? { ...x, category: e.target.value } : x)))}
                className="max-w-xs"
              />
              <Input
                placeholder="GL code"
                value={row.code}
                onChange={(e) => setGlRows((r) => r.map((x, i) => (i === idx ? { ...x, code: e.target.value } : x)))}
                className="max-w-xs"
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => setGlRows((r) => r.filter((_, i) => i !== idx))}>
                Remove
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Category" value={newCat} onChange={(e) => setNewCat(e.target.value)} className="max-w-xs" />
            <Input placeholder="GL code" value={newGl} onChange={(e) => setNewGl(e.target.value)} className="max-w-xs" />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                if (!newCat.trim() || !newGl.trim()) return;
                setGlRows((r) => [...r, { category: newCat.trim(), code: newGl.trim() }]);
                setNewCat('');
                setNewGl('');
              }}
            >
              Add mapping
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ERP integration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Primary ERP</Label>
              <Select value={primaryErp} onValueChange={setPrimaryErp}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="tally">Tally</SelectItem>
                  <SelectItem value="zoho">Zoho Books</SelectItem>
                  <SelectItem value="sap">SAP</SelectItem>
                  <SelectItem value="quickbooks">QuickBooks</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Export format</Label>
              <Select value={exportFmt} onValueChange={setExportFmt}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="xml">XML</SelectItem>
                  <SelectItem value="iif">IIF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={tallyOn} onChange={(e) => setTallyOn(e.target.checked)} />
              Tally
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={zohoOn} onChange={(e) => setZohoOn(e.target.checked)} />
              Zoho Books
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sapOn} onChange={(e) => setSapOn(e.target.checked)} />
              SAP
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={qbOn} onChange={(e) => setQbOn(e.target.checked)} />
              QuickBooks
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end pb-8">
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Savingâ€¦' : 'Save all'}
        </Button>
      </div>
    </div>
  );
}

