import { useEffect, useState, useCallback } from 'react';
import { useMarket } from '@/contexts/MarketContext';
import { useNavigate } from 'react-router-dom';
import { supabase, type Invoice } from '@/lib/ap-invoice/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Building2, Search, Eye, Pencil, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/utils/currency';
import {
  applyVendorGstinToInvoicesForName,
  listVendorsFromTable,
  upsertVendorGstin,
} from '@/lib/ap-invoice/gstService';
import { VendorDetailDialog } from '@/components/vendors/VendorDetailDialog';
import type { Vendor } from '@/lib/ap-invoice/supabase';
import { logAction, getInvoiceflowWorkEmail } from '@/lib/ap-invoice/auditService';

import { getVendorById, ensureVendorRowByName } from '@/lib/ap-invoice/vendorMasterService';

type VendorStats = {
  name: string;
  totalInvoices: number;
  totalSpend: number;
  averageInvoice: number;
  lastInvoiceDate: string | null;
  status: 'active' | 'inactive';
  gstin: string | null;
  vendorRowId?: string;
  risk_level?: string | null;
  risk_score?: number | null;
  bank_verification_status?: string | null;
};

export function Vendors() {
  const navigate = useNavigate();
  const { config, isUAE } = useMarket();
  const [vendorStats, setVendorStats] = useState<VendorStats[]>([]);
  const [filteredVendors, setFilteredVendors] = useState<VendorStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editGstin, setEditGstin] = useState('');
  const [editingVendorRowId, setEditingVendorRowId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailVendor, setDetailVendor] = useState<Vendor | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [isAddingVendor, setIsAddingVendor] = useState(false);

  const loadDbGstinMap = useCallback(async (): Promise<Map<string, { gstin: string | null; id?: string; risk_level?: string | null; risk_score?: number | null; bank_verification_status?: string | null }>> => {
    const map = new Map<string, { gstin: string | null; id?: string; risk_level?: string | null; risk_score?: number | null; bank_verification_status?: string | null }>();
    try {
      const rows = await listVendorsFromTable();
      for (const r of rows) {
        map.set(r.name.trim().toLowerCase(), {
          gstin: r.gstin,
          id: r.id,
          risk_level: r.risk_level,
          risk_score: r.risk_score,
          bank_verification_status: r.bank_verification_status,
        });
      }
    } catch {
      /* vendors table may not exist until migration */
    }
    return map;
  }, []);

  const calculateVendorStats = useCallback(
    async (invoiceData: Invoice[]) => {
      const gstMap = await loadDbGstinMap();
      const vendorMap = new Map<string, VendorStats>();

      invoiceData.forEach((inv) => {
        const vendorName = inv.vendor_name;
        const key = vendorName.trim().toLowerCase();
        const fromDb = gstMap.get(key);

        if (!vendorMap.has(vendorName)) {
          vendorMap.set(vendorName, {
            name: vendorName,
            totalInvoices: 0,
            totalSpend: 0,
            averageInvoice: 0,
            lastInvoiceDate: null,
            status: 'active',
            gstin: fromDb?.gstin ?? null,
            vendorRowId: fromDb?.id,
            risk_level: fromDb?.risk_level,
            risk_score: fromDb?.risk_score,
            bank_verification_status: fromDb?.bank_verification_status,
          });
        }

        const vendor = vendorMap.get(vendorName)!;
        if (fromDb?.gstin && !vendor.gstin) vendor.gstin = fromDb.gstin;
        if (fromDb?.risk_level) vendor.risk_level = fromDb.risk_level;
        if (fromDb?.risk_score != null) vendor.risk_score = fromDb.risk_score;
        if (fromDb?.bank_verification_status) vendor.bank_verification_status = fromDb.bank_verification_status;
        vendor.totalInvoices += 1;
        vendor.totalSpend += Number(inv.total_amount);

        const invDate = new Date(inv.created_at);
        if (!vendor.lastInvoiceDate || invDate > new Date(vendor.lastInvoiceDate)) {
          vendor.lastInvoiceDate = inv.created_at;
        }
      });

      const stats = Array.from(vendorMap.values()).map((vendor) => {
        vendor.averageInvoice = vendor.totalSpend / vendor.totalInvoices;
        const lastDate = vendor.lastInvoiceDate ? new Date(vendor.lastInvoiceDate) : null;
        const daysSinceLastInvoice = lastDate
          ? Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
          : Infinity;
        vendor.status = daysSinceLastInvoice > 90 ? 'inactive' : 'active';
        return vendor;
      });

      stats.sort((a, b) => b.totalSpend - a.totalSpend);

      try {
        const dbRows = await listVendorsFromTable();
        const seen = new Set(stats.map((s) => s.name.trim().toLowerCase()));
        for (const r of dbRows) {
          const k = r.name.trim().toLowerCase();
          if (seen.has(k)) continue;
          stats.push({
            name: r.name,
            totalInvoices: 0,
            totalSpend: 0,
            averageInvoice: 0,
            lastInvoiceDate: null,
            status: 'inactive',
            gstin: r.gstin,
            vendorRowId: r.id,
            risk_level: r.risk_level,
            risk_score: r.risk_score,
            bank_verification_status: r.bank_verification_status,
          });
        }
      } catch {
        /* ignore */
      }

      setVendorStats(stats);
    },
    [loadDbGstinMap]
  );

  async function fetchInvoices() {
    try {
      const { data, error } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      await calculateVendorStats(data || []);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchInvoices();
  }, []);

  useEffect(() => {
    let filtered = vendorStats;
    if (searchTerm) {
      filtered = filtered.filter((vendor) =>
        vendor.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    setFilteredVendors(filtered);
  }, [vendorStats, searchTerm]);

  function openEdit(v: VendorStats) {
    setIsAddingVendor(false);
    setEditName(v.name);
    setEditGstin(v.gstin ?? '');
    setEditingVendorRowId(v.vendorRowId ?? null);
    setEditOpen(true);
  }

  function openAddVendor() {
    setIsAddingVendor(true);
    setEditName('');
    setEditGstin('');
    setEditingVendorRowId(null);
    setEditOpen(true);
  }

  async function saveVendorGstin() {
    setSaving(true);
    try {
      const hadRow = !!editingVendorRowId;
      await upsertVendorGstin(editName, editGstin);
      const rows = await listVendorsFromTable();
      const row = rows.find((r) => r.name.trim().toLowerCase() === editName.trim().toLowerCase());
      const vid = row?.id ?? editingVendorRowId;
      logAction(hadRow ? 'vendor.updated' : 'vendor.created', 'vendor', vid ?? null, getInvoiceflowWorkEmail(), {
        name: editName.trim(),
      });
      await applyVendorGstinToInvoicesForName(editName);
      setEditOpen(false);
      await fetchInvoices();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : 'Save failed — run GST-RECONCILIATION-MIGRATION.sql');
    } finally {
      setSaving(false);
    }
  }

  async function openVendorDetail(v: VendorStats) {
    try {
      const row = v.vendorRowId
        ? (await getVendorById(v.vendorRowId)) ?? (await ensureVendorRowByName(v.name, v.gstin))
        : await ensureVendorRowByName(v.name, v.gstin);
      setDetailVendor(row);
      setDetailOpen(true);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : 'Could not open vendor — check vendors table in Supabase.');
    }
  }

  function handleViewVendorInvoices(vendorName: string) {
    navigate(`/invoices?vendor=${encodeURIComponent(vendorName)}`);
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading vendors...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Vendors</h1>
        <p className="mt-1 text-sm text-gray-500">
          Vendor master {config.taxIdLabel} syncs to invoices with the same name (empty {config.taxIdLabel} on invoice only)
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search vendors by name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {filteredVendors.length} Vendor{filteredVendors.length !== 1 ? 's' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {vendorStats.length === 0 ? (
            <div className="py-16 text-center">
              <Building2 className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-4 text-gray-600">No vendors yet — add your first vendor</p>
              <Button className="mt-6 bg-[#0A4B8F]" onClick={openAddVendor}>
                <Plus className="mr-2 h-4 w-4" />
                Add Vendor
              </Button>
            </div>
          ) : (
          <div className="overflow-x-auto w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor Name</TableHead>
                  <TableHead>{config.taxIdLabel}</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead>Total Invoices</TableHead>
                  <TableHead>Total Spend</TableHead>
                  <TableHead>Average Invoice</TableHead>
                  <TableHead>Last Invoice Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVendors.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-gray-500">
                      No vendors match your search
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredVendors.map((vendor) => (
                    <TableRow key={vendor.name} className="hover:bg-gray-50">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-gray-400" />
                          {vendor.name}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[140px] truncate" title={vendor.gstin ?? ''}>
                        {vendor.gstin || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {vendor.risk_level ?? 'low'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs capitalize">
                        {(vendor.bank_verification_status ?? 'verified').replace(/_/g, ' ')}
                      </TableCell>
                      <TableCell>{vendor.totalInvoices}</TableCell>
                      <TableCell className="font-semibold">
                        {formatCurrency(vendor.totalSpend, config.currency)}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(vendor.averageInvoice, config.currency)}
                      </TableCell>
                      <TableCell>
                        {vendor.lastInvoiceDate ? format(new Date(vendor.lastInvoiceDate), 'MMM dd, yyyy') : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            vendor.status === 'active'
                              ? 'bg-green-100 text-green-800 border-green-200'
                              : 'bg-gray-100 text-gray-800 border-gray-200'
                          }
                        >
                          {vendor.status === 'active' ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => void openVendorDetail(vendor)}>
                          <Building2 className="h-4 w-4 mr-1" />
                          Detail
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(vendor)}>
                          <Pencil className="h-4 w-4 mr-1" />
                          {config.taxIdLabel}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleViewVendorInvoices(vendor.name)}>
                          <Eye className="mr-2 h-4 w-4" />
                          Invoices
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isAddingVendor ? 'Add Vendor' : `Vendor ${config.taxIdLabel}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Vendor name</Label>
              <Input
                value={editName}
                readOnly={!isAddingVendor}
                className={isAddingVendor ? '' : 'bg-gray-50'}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Vendor legal name"
              />
            </div>
            <div className="space-y-2">
              <Label>{config.taxIdLabel}</Label>
              <Input
                className="font-mono text-sm"
                value={editGstin}
                onChange={(e) => setEditGstin(e.target.value)}
                placeholder={isUAE ? '15-digit TRN (e.g. 100-1234567-8)' : '15-character GSTIN'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button className="bg-[#0A4B8F]" disabled={saving} onClick={() => void saveVendorGstin()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VendorDetailDialog
        vendor={detailVendor}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSaved={() => void fetchInvoices()}
      />
    </div>
  );
}
