/**
 * Invoice image / file storage service (Supabase Storage).
 * Bucket: invoice-files (private — see supabase/migrations/065_invoice_files_bucket.sql)
 *
 * Objects are stored under `<company_id>/<prefix>/…`; storage RLS only lets members of
 * that company read or write them. Rows keep the storage path (not a URL) in
 * `invoices.file_url` / `payment_proof_url`, and viewers resolve it to a short-lived
 * signed URL with `resolveInvoiceFileUrl`.
 *
 * Users signed in only through the backend have no Supabase session, so storage RLS
 * rejects their browser calls; both upload and signing then go through
 * `/api/ap/invoice-files`, which checks company access server-side.
 *
 * Provides:
 *  - uploadInvoiceFile: upload a file, return its storage path
 *  - storeInvoiceFile: best-effort upload that never throws (returns path or null)
 *  - attachDocumentToInvoice: upload and link a document to an invoice that has none
 *  - resolveInvoiceFileUrl: turn a stored reference into a viewable URL
 *  - deleteInvoiceFile: remove from storage when invoice is deleted
 */
import { supabase } from '@/lib/ap-invoice/supabase';
import { isBackendConfigured, joinApiUrl } from '@/utils/backendOrigin';
import { workspaceHeaders } from '@/utils/workspaceHeaders';

const BUCKET = 'invoice-files';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const STORAGE_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/.+/i;

export interface StorageUploadResult {
  path: string;
}

/**
 * Upload an invoice file to Supabase Storage under the company's folder.
 * Sanitizes the filename and uses a timestamp prefix for uniqueness.
 */
export async function uploadInvoiceFile(
  file: File,
  companyId: string,
  prefix = 'uploads',
): Promise<StorageUploadResult> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${companyId}/${prefix}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (!error) return { path: data.path };

  if (!isBackendConfigured()) throw new Error(`Storage upload failed: ${error.message}`);
  return uploadViaBackend(file, companyId, prefix);
}

async function uploadViaBackend(file: File, companyId: string, prefix: string): Promise<StorageUploadResult> {
  const { 'Content-Type': _json, ...headers } = workspaceHeaders();
  const form = new FormData();
  form.append('file', file);
  form.append('company_id', companyId);
  form.append('prefix', prefix);
  const res = await fetch(joinApiUrl('/api/ap/invoice-files/upload'), {
    method: 'POST',
    headers,
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Storage upload failed (${res.status}): ${detail}`);
  }
  const body = (await res.json()) as { path?: string };
  if (!body.path) throw new Error('Storage upload failed: no path returned');
  return { path: body.path };
}

async function signedUrlViaBackend(path: string): Promise<string | null> {
  if (!isBackendConfigured()) return null;
  try {
    const res = await fetch(joinApiUrl('/api/ap/invoice-files/signed-url'), {
      method: 'POST',
      headers: workspaceHeaders(),
      credentials: 'include',
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      console.warn('[storage] signed URL via API failed:', res.status);
      return null;
    }
    return ((await res.json()) as { url?: string }).url ?? null;
  } catch (e) {
    console.warn('[storage] signed URL via API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Upload without failing the caller: invoice saves must not depend on storage.
 * Returns the storage path, or null when there is no file/company or the upload fails.
 */
export async function storeInvoiceFile(
  file: File | null | undefined,
  companyId: string | null | undefined,
  prefix: string,
): Promise<string | null> {
  if (!file || !companyId) return null;
  try {
    return (await uploadInvoiceFile(file, companyId, prefix)).path;
  } catch (e) {
    console.warn('[storage] invoice file not stored:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Upload a document and link it to an existing invoice that has none (e.g. Excel imports).
 * Throws when either the upload or the link fails so the caller can surface it.
 */
export async function attachDocumentToInvoice(
  invoice: { id: string; company_id?: string | null },
  file: File,
): Promise<string> {
  if (!invoice.company_id) throw new Error('Invoice has no company — cannot store its document.');
  const { path } = await uploadInvoiceFile(file, invoice.company_id, 'uploads');
  const fileType = file.type || null;

  const { data, error } = await supabase
    .from('invoices')
    .update({ file_url: path, file_type: fileType, updated_at: new Date().toISOString() })
    .eq('id', invoice.id)
    .select('id');
  if (!error && data && data.length > 0) return path;

  // RLS silently matches zero rows for users without a Supabase session.
  if (!isBackendConfigured()) throw new Error(error?.message || 'Invoice could not be updated.');
  const res = await fetch(joinApiUrl('/api/ap/invoice-files/attach'), {
    method: 'POST',
    headers: workspaceHeaders(),
    credentials: 'include',
    body: JSON.stringify({ invoice_id: invoice.id, path, file_type: fileType }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Linking the document failed (${res.status}): ${detail}`);
  }
  return path;
}

/**
 * Resolve a stored file reference to a URL the browser can open.
 * Storage paths (and legacy public URLs for this bucket) become signed URLs;
 * other http(s) URLs pass through; intake placeholders ("email-…", "batch-…") return null.
 */
export async function resolveInvoiceFileUrl(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  const path = STORAGE_PATH_RE.test(ref) ? ref : extractStoragePath(ref);
  if (path) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (!error && data?.signedUrl) return data.signedUrl;
    return signedUrlViaBackend(path);
  }
  return /^https?:\/\//i.test(ref) ? ref : null;
}

/**
 * Delete an invoice file from storage. Pass the path (not full URL).
 * Fire-and-forget — failures are logged but not thrown.
 */
export async function deleteInvoiceFile(path: string): Promise<void> {
  if (!path || path.startsWith('http')) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.warn('[storage] delete failed:', error.message);
}

/**
 * Extract the storage path from a public URL.
 * e.g. https://xxx.supabase.co/storage/v1/object/public/invoice-files/uploads/abc.pdf
 *      → uploads/abc.pdf
 */
export function extractStoragePath(url: string): string | null {
  try {
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
  } catch {
    return null;
  }
}
