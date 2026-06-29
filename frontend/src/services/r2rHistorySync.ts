/**
 * Sync posted journal lines into R2R Historical Intelligence baseline.
 * POST /api/v2/history/upload — company-specific, deduplicates by journal_id.
 */

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8001';

export type HistorySyncLine = {
  journal_id: string;
  posting_date: string;
  account: string;
  amount: number;
  user_id: string;
  source?: string;
  description?: string;
  entity?: string;
};

export async function syncJournalLinesToR2R(params: {
  companyId: string;
  uploadMonth: string;
  entries: HistorySyncLine[];
}): Promise<{ saved: number; skipped_duplicates: number }> {
  if (!params.entries.length) return { saved: 0, skipped_duplicates: 0 };

  const res = await fetch(`${API}/api/v2/history/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company_id: params.companyId,
      upload_month: params.uploadMonth,
      entries: params.entries,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : `R2R sync failed (${res.status})`);
  }

  const data = await res.json();
  return {
    saved: Number(data.saved || 0),
    skipped_duplicates: Number(data.skipped_duplicates || 0),
  };
}

/** Build history entries from a posted UAE JE (one row per line, debit-positive amount). */
export function uaeJEToHistoryEntries(
  je: {
    id: string;
    entry_date: string;
    reference?: string;
    description?: string;
    source?: string;
    lines?: { account_code?: string; debit?: number; credit?: number; description?: string }[];
    total_debit?: number;
  },
  companyId: string,
): HistorySyncLine[] {
  const lines = je.lines ?? [];
  const uploadMonth = (je.entry_date || '').slice(0, 7) || new Date().toISOString().slice(0, 7);
  const baseId = je.reference || je.id;

  if (lines.length === 0) {
    const amt = Number(je.total_debit || 0);
    if (amt <= 0) return [];
    return [{
      journal_id: `${baseId}-0`,
      posting_date: je.entry_date,
      account: '',
      amount: amt,
      user_id: 'uae-system',
      source: je.source || 'uae-accounting',
      description: je.description || '',
      entity: companyId,
    }];
  }

  return lines.flatMap((l, idx) => {
    const debit = Number(l.debit || 0);
    const credit = Number(l.credit || 0);
    const amount = debit > 0 ? debit : credit;
    if (amount <= 0) return [];
    return [{
      journal_id: `${baseId}-${idx}`,
      posting_date: je.entry_date,
      account: String(l.account_code || ''),
      amount,
      user_id: 'uae-system',
      source: je.source || 'uae-accounting',
      description: l.description || je.description || '',
      entity: companyId,
    }];
  });
}
