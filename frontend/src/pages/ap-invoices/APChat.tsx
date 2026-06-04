import { useState, useRef, useEffect } from 'react';
import { supabase, type Invoice } from '../../lib/ap-invoice/supabase';
import { anthropicMessagesUrl } from '../../lib/ap-invoice/anthropicApiUrl';
import { normalizedOpenPaymentStatus } from '../../lib/ap-invoice/paymentService';
import { APChatMarkdown } from '@/components/chat/APChatMarkdown';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Bot, Send, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

type Message = { role: 'user' | 'assistant'; content: string };

const SUGGESTED_QUESTIONS = [
  'Why is INV-2025-00842 high risk?',
  'Which invoices need IFRS reclassification?',
  'Show CFO approval queue with amounts',
  'Vendors with abnormal invoice patterns',
  'What is the 3-way match failure rate?',
  "Summarize this month's AP activity",
];

const AGENT_NAMES = [
  'Extraction',
  'Classification',
  'Matching',
  'Risk',
  'Approval',
  'GL Coder',
];

export function APChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [agentLastRun, setAgentLastRun] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAgentLastRun();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function fetchAgentLastRun() {
    try {
      const { data } = await supabase
        .from('audit_logs')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.created_at) setAgentLastRun(data.created_at);
    } catch {
      // ignore
    }
  }

  async function fetchInvoiceContext(userMessage: string): Promise<unknown[]> {
    const msg = userMessage.toLowerCase();
    let query = supabase.from('invoices').select('*').order('created_at', { ascending: false });

    // Invoice number mentioned (e.g. INV-2025-00842)
    const invoiceNumMatch = userMessage.match(/\bINV-[^\s]+\b/i) || userMessage.match(/\binvoice\s*#?\s*(\d+[-]?\w*)/i);
    if (invoiceNumMatch) {
      const num = invoiceNumMatch[0].replace(/invoice\s*#?\s*/i, '').trim();
      const { data } = await supabase.from('invoices').select('*').ilike('invoice_number', `%${num}%`).limit(5);
      if (data?.length) return data;
    }

    if (msg.includes('risk') || msg.includes('high risk') || msg.includes('abnormal')) {
      const { data } = await query.in('risk_score', ['high', 'medium']).limit(15);
      return data || [];
    }
    if (msg.includes('ifrs') || msg.includes('reclassif') || msg.includes('unclassified')) {
      const { data } = await supabase.from('invoices').select('*').is('ifrs_category', null).order('created_at', { ascending: false }).limit(15);
      return data || [];
    }
    if (msg.includes('approval') || msg.includes('cfo') || msg.includes('queue') || msg.includes('pending')) {
      const { data } = await query.eq('status', 'Processing').limit(15);
      return data || [];
    }
    if (msg.includes('match') || msg.includes('3-way')) {
      const { data } = await query.in('match_status', ['mismatch', 'partial', 'no_po']).limit(15);
      return data || [];
    }

    if (
      msg.includes('overdue') ||
      msg.includes('over due') ||
      msg.includes('past due') ||
      msg.includes('late payment') ||
      msg.includes('aged')
    ) {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('invoices')
        .select('*')
        .lt('due_date', today)
        .neq('status', 'Paid')
        .order('due_date', { ascending: true })
        .limit(50);
      const rows = (data || []) as Invoice[];
      return rows.filter((r) => normalizedOpenPaymentStatus(r) !== 'paid');
    }

    // Default: last 10 invoices
    const { data } = await query.limit(10);
    return data || [];
  }

  async function sendMessage(userContent?: string) {
    const text = (userContent ?? input).trim();
    if (!text) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const invoiceContext = await fetchInvoiceContext(text);
      const todayIso = new Date().toISOString().slice(0, 10);

      const system = `You are an AP Finance Assistant for InvoiceFlow.

Output rules (always follow):
- Use GitHub-Flavored Markdown: short paragraphs, bullet lists where helpful, and a **markdown table** when listing 2+ invoices (e.g. columns: Invoice # | Vendor | Amount | Currency | Due date | Workflow status | Payment status).
- After any table, add 1â€“3 sentences of plain English: totals, who is most overdue, and what to do next.
- Do not emit one long run-on paragraph for lists.
- Overdue logic: compare each row's due_date to today's date (${todayIso}) in UTC date form. Treat as paid only if status is "Paid" OR payment_status is paid (case-insensitive). Ignore misleading placeholder fields like overdue_days if they disagree with due_date vs today.
- Use invoice_number, vendor_name, total_amount, currency, due_date, status, payment_status from the JSON.`;

      const conversationHistory = messages.map((m) => ({ role: m.role, content: m.content }));
      const response = await fetch(anthropicMessagesUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 2800,
          system,
          messages: [
            ...conversationHistory,
            {
              role: 'user' as const,
              content: `Invoice records (JSON array, may be empty):\n${JSON.stringify(invoiceContext)}\n\n---\n\nUser question:\n${text}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(err || response.statusText);
      }

      const result = await response.json();
      const assistantText = result.content?.[0]?.text ?? 'No response.';
      setMessages((prev) => [...prev, { role: 'assistant', content: assistantText }]);
    } catch (e) {
      const err = e instanceof Error ? e.message : 'Failed to get response';
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${err}. For local dev, set ANTHROPIC_API_KEY (or VITE_ANTHROPIC_API_KEY) in .env and restart the Vite server.`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSuggested(question: string) {
    setInput(question);
    sendMessage(question);
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-6">
      {/* Left: Chat */}
      <Card className="flex-1 flex flex-col border border-gray-200 bg-white shadow-sm min-w-0">
        <CardHeader className="border-b border-gray-200 bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1a56db]">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold text-gray-900">AP Finance Assistant</CardTitle>
              <p className="text-xs text-gray-500">Powered by Claude Â· Connected to Supabase</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col flex-1 p-0 min-h-0">
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {messages.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-8">Ask about invoices, risk, IFRS, approvals, or 3-way match.</p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[min(92%,48rem)] rounded-lg px-4 py-2 text-sm ${
                      m.role === 'user'
                        ? 'bg-[#1a56db] text-white'
                        : 'bg-gray-100 text-gray-900 border border-gray-200'
                    }`}
                  >
                    {m.role === 'user' ? (
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    ) : (
                      <APChatMarkdown content={m.content} />
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-lg bg-gray-100 border border-gray-200 px-4 py-2 flex items-center gap-2 text-sm text-gray-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Thinking...
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>
          <div className="p-4 border-t border-gray-200 bg-white">
            <div className="flex gap-2">
              <Input
                placeholder="Ask about invoices, risk, IFRS..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                className="flex-1 border-gray-200"
              />
              <Button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="bg-[#1a56db] hover:bg-[#1a56db]/90"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Right: Suggested + Agent status */}
      <div className="w-72 shrink-0 space-y-4">
        <Card className="border border-gray-200 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900">Suggested questions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <Button
                key={q}
                variant="outline"
                size="sm"
                className="w-full justify-start text-left h-auto py-2 px-3 text-xs border-gray-200 text-gray-700 hover:bg-gray-50"
                onClick={() => handleSuggested(q)}
              >
                {q}
              </Button>
            ))}
          </CardContent>
        </Card>
        <Card className="border border-gray-200 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900">Agent status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {AGENT_NAMES.map((name) => (
              <div key={name} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: agentLastRun ? '#22c55e' : '#9ca3af',
                  }}
                />
                <span className="text-gray-700">{name}</span>
                <span className="ml-auto text-xs text-gray-500">
                  {agentLastRun ? formatDistanceToNow(new Date(agentLastRun), { addSuffix: true }) : 'â€”'}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

