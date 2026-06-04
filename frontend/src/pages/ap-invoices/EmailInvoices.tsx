import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase, type EmailInboxConfig, type EmailIntakeLog } from '../../lib/ap-invoice/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { useToast } from '../../hooks/use-toast';
import { resolveGLAccount, invoiceGlFieldsFromResult } from '../../utils/coaMapping';
import { requireCompanyId } from '../../lib/ap-invoice/companyService';
import { runAutoMatch } from '../../lib/ap-invoice/threeWayMatchService';
import {
  Mail,
  Download,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  Inbox,
} from 'lucide-react';

type EmailStatus = 'pending' | 'processing' | 'imported' | 'skipped';

type FetchedEmail = {
  id: string;
  from: string;
  subject: string;
  date: string;
  attachmentName: string;
  attachmentSize: number;
  status: EmailStatus;
  invoiceId: string | null;
  selected: boolean;
};

export function EmailInvoices() {
  const { toast } = useToast();
  const [emailConfig, setEmailConfig] = useState({
    imapServer: '',
    imapPort: '993',
    email: '',
    password: '',
  });
  const [emailWebhookUrl, setEmailWebhookUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [fetchedEmails, setFetchedEmails] = useState<FetchedEmail[]>([]);
  const [testConnectionStatus, setTestConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  const [inboxConfig, setInboxConfig] = useState<EmailInboxConfig | null>(null);
  const [intakeLog, setIntakeLog] = useState<EmailIntakeLog[]>([]);
  const [intakeStats, setIntakeStats] = useState({
    totalEmails: 0,
    totalInvoicesFromEmail: 0,
    successPct: 0,
    lastReceived: null as string | null,
  });
  const [forwardingInput, setForwardingInput] = useState('');
  const [providerInput, setProviderInput] = useState('n8n');
  const [savingInbox, setSavingInbox] = useState(false);

  const emailIntakeWebhookUrl = import.meta.env.VITE_EMAIL_INTAKE_WEBHOOK_URL ?? '';

  const loadInboxMonitoring = useCallback(async () => {
    try {
      const { data: cfg } = await supabase
        .from('email_inbox_config')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cfg) {
        setInboxConfig(cfg as EmailInboxConfig);
        setForwardingInput((cfg as EmailInboxConfig).forwarding_address);
        setProviderInput((cfg as EmailInboxConfig).provider || 'n8n');
      } else {
        setInboxConfig(null);
      }

      const [{ data: logs }, { data: statRows }] = await Promise.all([
        supabase
          .from('email_intake_log')
          .select('*')
          .order('received_at', { ascending: false })
          .limit(50),
        supabase.from('email_intake_log').select('invoices_created, status, received_at'),
      ]);

      const rows = (logs ?? []) as EmailIntakeLog[];
      setIntakeLog(rows);

      const stats = statRows ?? [];
      const totalEmails = stats.length;
      const totalInvoicesFromEmail = stats.reduce((s, r) => s + (Number(r.invoices_created) || 0), 0);
      const processed = stats.filter((r) => r.status === 'processed').length;
      const successPct = totalEmails > 0 ? Math.round((processed / totalEmails) * 100) : 0;
      const lastReceived =
        stats.length > 0
          ? [...stats].sort(
              (a, b) =>
                new Date(b.received_at as string).getTime() -
                new Date(a.received_at as string).getTime()
            )[0].received_at
          : null;
      setIntakeStats({ totalEmails, totalInvoicesFromEmail, successPct, lastReceived });
    } catch (e) {
      console.warn('Email inbox monitoring tables may not exist yet. Run EMAIL-INBOX-MIGRATION.sql.', e);
      setIntakeLog([]);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    void loadInboxMonitoring();
  }, [loadInboxMonitoring]);

  async function loadSettings() {
    try {
      // Load email webhook URL
      const { data: webhookData } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('setting_key', 'email_webhook_url')
        .maybeSingle();

      if (webhookData) {
        setEmailWebhookUrl(webhookData.setting_value);
      }

      // Load email config (if stored)
      const { data: configData } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('setting_key', 'email_config')
        .maybeSingle();

      if (configData && configData.setting_value) {
        try {
          const config = JSON.parse(configData.setting_value);
          setEmailConfig({
            imapServer: config.imapServer || '',
            imapPort: config.imapPort || '993',
            email: config.email || '',
            password: '', // Don't load password for security
          });
        } catch (e) {
          console.error('Error parsing email config:', e);
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function saveEmailConfig() {
    try {
      // Note: In production, passwords should be encrypted
      const configToSave = {
        ...emailConfig,
        password: emailConfig.password || '', // In production, encrypt this
      };

      const { data: existing } = await supabase
        .from('app_settings')
        .select('id')
        .eq('setting_key', 'email_config')
        .maybeSingle();

      if (existing) {
        await supabase
          .from('app_settings')
          .update({
            setting_value: JSON.stringify(configToSave),
            updated_at: new Date().toISOString(),
          })
          .eq('setting_key', 'email_config');
      } else {
        await supabase.from('app_settings').insert({
          setting_key: 'email_config',
          setting_value: JSON.stringify(configToSave),
        });
      }

      toast({
        title: 'Email Configuration Saved',
        description: 'Your email settings have been saved.',
      });
    } catch (error: any) {
      console.error('Error saving email config:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save email configuration',
        variant: 'destructive',
      });
    }
  }

  async function testConnection() {
    if (!emailWebhookUrl) {
      toast({
        title: 'Webhook URL Required',
        description: 'Please configure the email webhook URL in Settings first.',
        variant: 'destructive',
      });
      return;
    }

    setTestConnectionStatus('testing');
    try {
      // Call n8n webhook to test connection
      const response = await fetch(`${emailWebhookUrl}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          config: emailConfig,
        }),
      });

      if (response.ok) {
        setTestConnectionStatus('success');
        toast({
          title: 'Connection Successful',
          description: 'Email connection test passed.',
        });
      } else {
        throw new Error('Connection test failed');
      }
    } catch (error: any) {
      setTestConnectionStatus('error');
      toast({
        title: 'Connection Failed',
        description: error.message || 'Could not connect to email server. Check your settings.',
        variant: 'destructive',
      });
    } finally {
      setTimeout(() => setTestConnectionStatus('idle'), 3000);
    }
  }

  async function fetchInvoices() {
    if (!emailWebhookUrl) {
      toast({
        title: 'Webhook URL Required',
        description: 'Please configure the email webhook URL in Settings first.',
        variant: 'destructive',
      });
      return;
    }

    setFetching(true);
    try {
      // Call n8n webhook to fetch emails
      const response = await fetch(emailWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fetch',
          config: emailConfig,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch emails: ${response.status}`);
      }

      const data = await response.json();
      
      // Expected response format from n8n:
      // {
      //   emails: [
      //     {
      //       id: "email-id",
      //       from: "vendor@example.com",
      //       subject: "Invoice #12345",
      //       date: "2025-01-15T10:30:00Z",
      //       attachments: [
      //         { name: "invoice.pdf", size: 245678 }
      //       ]
      //     }
      //   ]
      // }

      const emails: FetchedEmail[] = (data.emails || []).flatMap((email: any) => {
        // If email has multiple attachments, create one row per attachment
        if (email.attachments && email.attachments.length > 0) {
          return email.attachments.map((attachment: any) => ({
            id: `${email.id}-${attachment.name}`,
            from: email.from,
            subject: email.subject,
            date: email.date,
            attachmentName: attachment.name,
            attachmentSize: attachment.size || 0,
            status: 'pending' as EmailStatus,
            invoiceId: null,
            selected: false,
          }));
        } else {
          // Email with no attachments
          return [{
            id: email.id,
            from: email.from,
            subject: email.subject,
            date: email.date,
            attachmentName: 'No attachment',
            attachmentSize: 0,
            status: 'pending' as EmailStatus,
            invoiceId: null,
            selected: false,
          }];
        }
      });

      setFetchedEmails(emails);
      toast({
        title: 'Emails Fetched',
        description: `Found ${emails.length} email attachment(s) to process.`,
      });
    } catch (error: any) {
      console.error('Error fetching emails:', error);
      toast({
        title: 'Fetch Failed',
        description: error.message || 'Failed to fetch emails from server.',
        variant: 'destructive',
      });
    } finally {
      setFetching(false);
    }
  }

  async function processSelected() {
    const selectedEmails = fetchedEmails.filter(email => email.selected && email.status === 'pending');
    
    if (selectedEmails.length === 0) {
      toast({
        title: 'No Selection',
        description: 'Please select at least one email to process.',
        variant: 'destructive',
      });
      return;
    }

    setProcessing(true);
    let successCount = 0;
    let failedCount = 0;

    try {
      const companyId = await requireCompanyId();
      for (const email of selectedEmails) {
        // Update status to processing
        setFetchedEmails(prev => prev.map(e => 
          e.id === email.id ? { ...e, status: 'processing' } : e
        ));

        try {
          // Call n8n webhook to extract invoice from email attachment
          const response = await fetch(emailWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'extract',
              emailId: email.id,
              attachmentName: email.attachmentName,
            }),
          });

          if (!response.ok) {
            throw new Error(`Extraction failed: ${response.status}`);
          }

          const extractedData = await response.json();
          const ifrsCategory = extractedData.ifrs_category ?? extractedData.category;
          const ifrsConfidence = extractedData.ifrs_confidence ?? extractedData.confidence;
          const ifrsExplanation = extractedData.ifrs_explanation ?? extractedData.explanation;

          // Save invoice to database
          const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .insert({
              company_id: companyId,
              invoice_number: extractedData.invoice_number || `EMAIL-${Date.now()}`,
              invoice_date: extractedData.invoice_date || new Date().toISOString().split('T')[0],
              due_date: extractedData.due_date || null,
              vendor_name: extractedData.vendor_name || email.from.split('@')[0],
              vendor_email: email.from,
              vendor_phone: extractedData.vendor_phone || null,
              vendor_address: extractedData.vendor_address || null,
              total_amount: extractedData.total_amount || 0,
              subtotal_amount: extractedData.total_amount || 0,
              tax_type: extractedData.tax_type || 'None',
              tax_rate: extractedData.tax_rate || 0,
              tax_amount: extractedData.tax_amount || 0,
              currency: extractedData.currency || 'USD',
              status: 'Processing',
              file_url: `email-${email.id}`,
              file_type: 'application/pdf',
              ifrs_category: ifrsCategory || '',
              ifrs_confidence: ifrsConfidence != null ? Number(ifrsConfidence) : 0,
              ifrs_explanation: ifrsExplanation || '',
            })
            .select()
            .single();

          if (invoiceError) {
            throw invoiceError;
          }

          if (ifrsCategory) {
            const glEmail = await resolveGLAccount(supabase, ifrsCategory, null, {
              description: extractedData.description ?? '',
              vendorName: extractedData.vendor_name ?? '',
            });
            await supabase
              .from('invoices')
              .update({
                ...invoiceGlFieldsFromResult(glEmail),
                updated_at: new Date().toISOString(),
              })
              .eq('id', invoice.id);
          }

          try {
            await runAutoMatch(invoice.id);
          } catch (matchErr) {
            console.warn('Email import auto match:', matchErr);
          }

          // Update email status to imported
          setFetchedEmails(prev => prev.map(e => 
            e.id === email.id ? { 
              ...e, 
              status: 'imported' as EmailStatus, 
              invoiceId: invoice.id 
            } : e
          ));

          successCount++;
        } catch (error: any) {
          console.error(`Error processing email ${email.id}:`, error);
          setFetchedEmails(prev => prev.map(e => 
            e.id === email.id ? { 
              ...e, 
              status: 'skipped' as EmailStatus 
            } : e
          ));
          failedCount++;
        }
      }

      toast({
        title: 'Processing Complete',
        description: `Successfully imported ${successCount} invoice(s). ${failedCount > 0 ? `${failedCount} failed.` : ''}`,
        variant: failedCount > 0 ? 'destructive' : 'default',
      });
    } catch (error: any) {
      console.error('Error processing emails:', error);
      toast({
        title: 'Processing Error',
        description: error.message || 'Failed to process selected emails',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  }

  function toggleEmailSelection(emailId: string) {
    setFetchedEmails(prev => prev.map(email => 
      email.id === emailId ? { ...email, selected: !email.selected } : email
    ));
  }

  function toggleAllSelection() {
    const allSelected = fetchedEmails.every(email => email.selected);
    setFetchedEmails(prev => prev.map(email => ({
      ...email,
      selected: !allSelected && email.status === 'pending',
    })));
  }

  function getStatusBadge(status: EmailStatus) {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-gray-100 text-gray-700">Pending</Badge>;
      case 'processing':
        return <Badge variant="secondary" className="bg-blue-100 text-blue-700">Processing</Badge>;
      case 'imported':
        return <Badge variant="default" className="bg-green-100 text-green-700">Imported</Badge>;
      case 'skipped':
        return <Badge variant="destructive">Skipped</Badge>;
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  async function saveInboxForwarding() {
    if (!forwardingInput.trim()) {
      toast({ title: 'Forwarding address required', variant: 'destructive' });
      return;
    }
    setSavingInbox(true);
    try {
      const companyId = await requireCompanyId();
      const { data, error } = await supabase
        .from('email_inbox_config')
        .insert({
          company_id: companyId,
          forwarding_address: forwardingInput.trim(),
          provider: providerInput,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      setInboxConfig(data as EmailInboxConfig);
      toast({ title: 'Forwarding address saved' });
      await loadInboxMonitoring();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setSavingInbox(false);
    }
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `Copied ${label}` });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  }

  function intakeStatusBadge(status: EmailIntakeLog['status']) {
    if (status === 'processed')
      return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Processed</Badge>;
    if (status === 'failed')
      return <Badge variant="destructive">Failed</Badge>;
    return <Badge variant="secondary" className="bg-gray-100 text-gray-700">Skipped</Badge>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Email Invoices</h1>
        <p className="mt-1 text-sm text-gray-500">
          Fetch and process invoices from email attachments
        </p>
      </div>

      {/* Email inbox monitoring â€” stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Emails logged</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{intakeStats.totalEmails}</div>
            <p className="text-xs text-muted-foreground mt-1">Rows in intake log</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Invoices from email</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{intakeStats.totalInvoicesFromEmail}</div>
            <p className="text-xs text-muted-foreground mt-1">Sum of invoices_created</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Success rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{intakeStats.successPct}%</div>
            <p className="text-xs text-muted-foreground mt-1">Processed / total</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Last email</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-semibold">
              {intakeStats.lastReceived
                ? new Date(intakeStats.lastReceived).toLocaleString()
                : 'â€”'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Forwarding setup + webhook URL */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5" />
            Inbox forwarding (automatic intake)
          </CardTitle>
          <CardDescription>
            n8n receives mail, runs OCR, then POSTs JSON to your Edge Function. Run{' '}
            <code className="text-xs bg-muted px-1 rounded">EMAIL-INBOX-MIGRATION.sql</code> first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {inboxConfig ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border bg-muted/30 p-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Forwarding address</p>
                <p className="text-lg font-semibold">{inboxConfig.forwarding_address}</p>
                <p className="text-xs text-muted-foreground mt-1">Provider: {inboxConfig.provider}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyText(inboxConfig.forwarding_address, 'address')}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy address
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fwd_addr">Forwarding address</Label>
                <Input
                  id="fwd_addr"
                  value={forwardingInput}
                  onChange={(e) => setForwardingInput(e.target.value)}
                  placeholder="invoices@yourdomain.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Provider</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={providerInput}
                  onChange={(e) => setProviderInput(e.target.value)}
                >
                  <option value="n8n">n8n</option>
                  <option value="gmail">Gmail</option>
                  <option value="outlook">Outlook</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <Button
                  type="button"
                  onClick={saveInboxForwarding}
                  disabled={savingInbox}
                  className="bg-[#0A4B8F] hover:bg-[#0D6EFD]"
                >
                  {savingInbox ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save forwarding setup'}
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-dashed p-4 space-y-2 text-sm text-gray-700">
            <p className="font-medium">Setup steps</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Configure forwarding in your mail provider to the forwarding address above.</li>
              <li>In n8n, add an Email Trigger (IMAP) or Gmail Trigger for that mailbox.</li>
              <li>
                After OCR (same webhook as manual upload), POST the payload to your intake URL:
              </li>
            </ol>
            {emailIntakeWebhookUrl ? (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <code className="text-xs break-all bg-muted px-2 py-1 rounded flex-1 min-w-0">
                  {emailIntakeWebhookUrl}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyText(emailIntakeWebhookUrl, 'webhook URL')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <p className="text-amber-800 text-xs mt-2">
                Set <code className="bg-amber-100 px-1 rounded">VITE_EMAIL_INTAKE_WEBHOOK_URL</code> in
                .env (Supabase function URL after deploy).
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Intake log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Recent email intake</CardTitle>
              <CardDescription>Last 50 events from email_intake_log</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadInboxMonitoring()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {intakeLog.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No intake events yet. After migration and n8n, new emails appear here.
            </p>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Attachments</TableHead>
                    <TableHead>Invoices</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {intakeLog.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(row.received_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-sm">{row.from_address ?? 'â€”'}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">{row.subject ?? 'â€”'}</TableCell>
                      <TableCell>{row.attachment_count}</TableCell>
                      <TableCell>{row.invoices_created}</TableCell>
                      <TableCell>{intakeStatusBadge(row.status)}</TableCell>
                      <TableCell className="text-right">
                        {row.status === 'processed' && row.invoices_created > 0 ? (
                          <Link
                            to={`/invoices?receivedAt=${encodeURIComponent(row.received_at)}`}
                            className="text-sm text-[#0A4B8F] hover:underline"
                          >
                            View invoices
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">â€”</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Configuration
          </CardTitle>
          <CardDescription>
            Configure IMAP settings for email fetching. The actual email reading happens in n8n.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="imap_server">IMAP Server</Label>
              <Input
                id="imap_server"
                value={emailConfig.imapServer}
                onChange={(e) => setEmailConfig({ ...emailConfig, imapServer: e.target.value })}
                placeholder="imap.gmail.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="imap_port">IMAP Port</Label>
              <Input
                id="imap_port"
                type="number"
                value={emailConfig.imapPort}
                onChange={(e) => setEmailConfig({ ...emailConfig, imapPort: e.target.value })}
                placeholder="993"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={emailConfig.email}
                onChange={(e) => setEmailConfig({ ...emailConfig, email: e.target.value })}
                placeholder="your-email@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password / App Password</Label>
              <Input
                id="password"
                type="password"
                value={emailConfig.password}
                onChange={(e) => setEmailConfig({ ...emailConfig, password: e.target.value })}
                placeholder="Enter password"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={saveEmailConfig}
            >
              Save Configuration
            </Button>
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={testConnectionStatus === 'testing'}
            >
              {testConnectionStatus === 'testing' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : testConnectionStatus === 'success' ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" />
                  Connected
                </>
              ) : testConnectionStatus === 'error' ? (
                <>
                  <XCircle className="mr-2 h-4 w-4 text-red-600" />
                  Failed
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Test Connection
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Fetch Invoices */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Fetched Emails</CardTitle>
              <CardDescription>
                Fetch invoices from your email inbox using the configured n8n webhook.
              </CardDescription>
            </div>
            <Button
              onClick={fetchInvoices}
              disabled={fetching || !emailWebhookUrl}
              className="bg-[#0A4B8F] hover:bg-[#0D6EFD]"
            >
              {fetching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Fetching...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Fetch Invoices
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!emailWebhookUrl && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
              <p className="text-sm text-yellow-800">
                âš ï¸ Email webhook URL not configured. Please configure it in{' '}
                <a href="/settings" className="underline font-medium">Settings</a>.
              </p>
            </div>
          )}

          {fetchedEmails.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={fetchedEmails.every(email => email.selected || email.status !== 'pending')}
                    onCheckedChange={toggleAllSelection}
                  />
                  <Label>Select All Pending</Label>
                </div>
                <Button
                  onClick={processSelected}
                  disabled={processing || fetchedEmails.filter(e => e.selected && e.status === 'pending').length === 0}
                  className="bg-[#0A4B8F] hover:bg-[#0D6EFD]"
                >
                  {processing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Process Selected ({fetchedEmails.filter(e => e.selected && e.status === 'pending').length})
                    </>
                  )}
                </Button>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={fetchedEmails.every(email => email.selected || email.status !== 'pending')}
                          onCheckedChange={toggleAllSelection}
                        />
                      </TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Attachment</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fetchedEmails.map((email) => (
                      <TableRow key={email.id}>
                        <TableCell>
                          <Checkbox
                            checked={email.selected}
                            onCheckedChange={() => toggleEmailSelection(email.id)}
                            disabled={email.status !== 'pending'}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{email.from}</TableCell>
                        <TableCell>{email.subject}</TableCell>
                        <TableCell>
                          {new Date(email.date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>{email.attachmentName}</TableCell>
                        <TableCell>{formatFileSize(email.attachmentSize)}</TableCell>
                        <TableCell>{getStatusBadge(email.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {fetchedEmails.length === 0 && emailWebhookUrl && (
            <div className="text-center py-12 text-gray-500">
              <Mail className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p>No emails fetched yet. Click "Fetch Invoices" to retrieve emails from your inbox.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

