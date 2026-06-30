import { useEffect, useState } from 'react';

import { CheckCircle, XCircle, Download, Loader2, Send, RotateCcw } from 'lucide-react';

import {

  Dialog,

  DialogContent,

  DialogHeader,

  DialogTitle,

} from '@/components/ui/dialog';

import { Button } from '@/components/ui/button';

import type { Invoice } from '@/lib/ap-invoice/supabase';

import {

  validatePintAeInvoice,

  type PintAeValidateResult,

} from '@/lib/ap-invoice/uaeVatService';

import {

  fetchAspSubmissions,

  generateEInvoiceXml,

  redriveAspSubmission,

  submitToAsp,

  type AspSubmission,

} from '@/services/gulfTaxApi';



type Props = {

  invoice: Invoice | null;

  open: boolean;

  onOpenChange: (open: boolean) => void;

};



function statusBadgeClass(status: AspSubmission['status']): string {

  if (status === 'accepted') return 'bg-green-100 text-green-800 border-green-200';

  if (status === 'rejected') return 'bg-red-100 text-red-800 border-red-200';

  return 'bg-amber-100 text-amber-900 border-amber-200';

}



export function PintAeValidateModal({ invoice, open, onOpenChange }: Props) {

  const [loading, setLoading] = useState(false);

  const [result, setResult] = useState<PintAeValidateResult | null>(null);

  const [xmlLoading, setXmlLoading] = useState(false);

  const [submitLoading, setSubmitLoading] = useState(false);

  const [submission, setSubmission] = useState<AspSubmission | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);



  useEffect(() => {

    if (!open || !invoice) {

      setResult(null);

      setSubmission(null);

      setSubmitError(null);

      return;

    }

    let cancelled = false;

    setLoading(true);

    Promise.all([

      validatePintAeInvoice(invoice),

      fetchAspSubmissions(50).catch(() => ({ items: [] as AspSubmission[] })),

    ])

      .then(([r, subs]) => {

        if (cancelled) return;

        setResult(r);

        const existing = subs.items.find((s) => s.invoice_number === invoice.invoice_number);

        setSubmission(existing ?? null);

      })

      .catch(() => {

        if (!cancelled) setResult(null);

      })

      .finally(() => {

        if (!cancelled) setLoading(false);

      });

    return () => {

      cancelled = true;

    };

  }, [open, invoice?.id, invoice?.invoice_number]);



  const buildAmounts = () => {

    const net = Number(invoice?.subtotal_amount ?? invoice?.total_amount ?? 0);

    const vat = Number(invoice?.vat_amount ?? invoice?.gst_amount ?? net * 0.05);

    const gross = Number(invoice?.total_amount ?? net + vat);

    return { net, vat, gross };

  };



  const downloadXml = async () => {

    if (!invoice || !result?.compliant) return;

    setXmlLoading(true);

    try {

      const { net, vat } = buildAmounts();

      const res = await generateEInvoiceXml({

        invoice_number: invoice.invoice_number,

        supplier_name: invoice.vendor_name,

        supplier_trn: invoice.vendor_trn ?? '',

        net_amount: net,

        vat_amount: vat,

        invoice_date: invoice.invoice_date?.slice(0, 10) ?? '',

      });

      const blob = new Blob([res.xml_content], { type: 'application/xml' });

      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');

      a.href = url;

      a.download = `${invoice.invoice_number}-pint-ae.xml`;

      a.click();

      URL.revokeObjectURL(url);

    } finally {

      setXmlLoading(false);

    }

  };



  const submitAsp = async () => {

    if (!invoice || !result?.compliant) return;

    setSubmitLoading(true);

    setSubmitError(null);

    try {

      const { net, vat, gross } = buildAmounts();

      const xmlRes = await generateEInvoiceXml({

        invoice_number: invoice.invoice_number,

        supplier_name: invoice.vendor_name,

        supplier_trn: invoice.vendor_trn ?? '',

        net_amount: net,

        vat_amount: vat,

        invoice_date: invoice.invoice_date?.slice(0, 10) ?? '',

      });

      const res = await submitToAsp({

        invoice_number: invoice.invoice_number,

        invoice_date: invoice.invoice_date?.slice(0, 10) ?? '',

        seller_trn: invoice.vendor_trn ?? '',

        buyer_trn: '',

        net_amount: net,

        vat_amount: vat,

        gross_amount: gross,

        xml_content: xmlRes.xml_content,

      });

      setSubmission({

        id: res.submission_id,

        invoice_number: invoice.invoice_number,

        invoice_date: invoice.invoice_date?.slice(0, 10) ?? '',

        net_amount: net,

        vat_amount: vat,

        gross_amount: gross,

        status: res.status,

        rejection_reason: null,

        submitted_at: new Date().toISOString(),

        updated_at: new Date().toISOString(),

      });

    } catch (e) {

      setSubmitError(e instanceof Error ? e.message : 'ASP submission failed');

    } finally {

      setSubmitLoading(false);

    }

  };



  const redrive = async () => {

    if (!submission) return;

    setSubmitLoading(true);

    setSubmitError(null);

    try {

      await redriveAspSubmission(submission.id);

      setSubmission({ ...submission, status: 'pending', rejection_reason: null });

    } catch (e) {

      setSubmitError(e instanceof Error ? e.message : 'Redrive failed');

    } finally {

      setSubmitLoading(false);

    }

  };



  return (

    <Dialog open={open} onOpenChange={onOpenChange}>

      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">

        <DialogHeader>

          <DialogTitle>PINT AE Validation — {invoice?.invoice_number}</DialogTitle>

        </DialogHeader>

        {loading && (

          <div className="flex items-center justify-center py-8 text-muted-foreground">

            <Loader2 className="h-6 w-6 animate-spin mr-2" />

            Running 15-rule check…

          </div>

        )}

        {!loading && result && (

          <div className="space-y-4">

            <div

              className={`rounded-lg border p-4 text-center ${

                result.compliant

                  ? 'border-green-200 bg-green-50 text-green-900'

                  : 'border-red-200 bg-red-50 text-red-900'

              }`}

            >

              <div className="text-lg font-semibold">

                {result.compliant ? '✅ PINT AE Compliant' : `❌ ${result.issues_found} issue(s) found`}

              </div>

              <div className="text-sm mt-1">

                {result.rules_passed}/{result.rules_total} rules passed

              </div>

            </div>



            {submission && (

              <div className={`rounded-lg border px-3 py-2 text-sm ${statusBadgeClass(submission.status)}`}>

                ASP status: <strong className="capitalize">{submission.status}</strong>

                {submission.status === 'rejected' && submission.rejection_reason && (

                  <p className="text-xs mt-1">{submission.rejection_reason}</p>

                )}

              </div>

            )}



            <ul className="space-y-2">

              {result.rules.map((rule) => (

                <li key={rule.id} className="flex gap-2 text-sm">

                  {rule.passed ? (

                    <CheckCircle className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />

                  ) : (

                    <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />

                  )}

                  <div>

                    <div className={rule.passed ? 'text-gray-800' : 'text-red-800 font-medium'}>

                      {rule.label}

                    </div>

                    {!rule.passed && rule.fix && (

                      <div className="text-xs text-gray-600 mt-0.5">{rule.fix}</div>

                    )}

                  </div>

                </li>

              ))}

            </ul>



            {submitError && (

              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{submitError}</p>

            )}



            {result.compliant && (

              <div className="flex flex-col gap-2">

                <Button

                  type="button"

                  className="w-full bg-[#1E3A5F] hover:bg-[#152a45]"

                  disabled={xmlLoading}

                  onClick={() => void downloadXml()}

                >

                  {xmlLoading ? (

                    <Loader2 className="h-4 w-4 animate-spin mr-2" />

                  ) : (

                    <Download className="h-4 w-4 mr-2" />

                  )}

                  Download XML

                </Button>

                {(!submission || submission.status === 'rejected') && (

                  <Button

                    type="button"

                    variant="outline"

                    className="w-full"

                    disabled={submitLoading}

                    onClick={() => void submitAsp()}

                  >

                    {submitLoading ? (

                      <Loader2 className="h-4 w-4 animate-spin mr-2" />

                    ) : (

                      <Send className="h-4 w-4 mr-2" />

                    )}

                    {submission?.status === 'rejected' ? 'Resubmit to ASP' : 'Submit to ASP'}

                  </Button>

                )}

                {submission?.status === 'rejected' && (

                  <Button

                    type="button"

                    variant="secondary"

                    className="w-full"

                    disabled={submitLoading}

                    onClick={() => void redrive()}

                  >

                    <RotateCcw className="h-4 w-4 mr-2" />

                    Redrive

                  </Button>

                )}

              </div>

            )}

          </div>

        )}

      </DialogContent>

    </Dialog>

  );

}


