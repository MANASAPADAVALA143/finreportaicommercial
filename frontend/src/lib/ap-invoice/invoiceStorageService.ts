/**
 * Invoice image / file storage service (Supabase Storage).
 * Bucket: invoice-files (public)
 *
 * Provides:
 *  - uploadInvoiceFile: upload a file, return public URL
 *  - getInvoiceFileUrl: get signed URL for private bucket (if needed)
 *  - deleteInvoiceFile: remove from storage when invoice is deleted
 */
import { supabase } from '@/lib/ap-invoice/supabase';

const BUCKET = 'invoice-files';

export interface StorageUploadResult {
  url: string;
  path: string;
}

/**
 * Upload an invoice file to Supabase Storage.
 * Returns the public URL and storage path.
 * Sanitizes the filename and uses a timestamp prefix for uniqueness.
 */
export async function uploadInvoiceFile(file: File, prefix = 'uploads'): Promise<StorageUploadResult> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`;

  const { data, error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
  return { url: urlData.publicUrl, path: data.path };
}

/**
 * Get the public URL for an existing storage path.
 * Returns null if path is already a full URL (e.g. n8n-hosted files).
 */
export function getPublicUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http')) return pathOrUrl;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathOrUrl);
  return data.publicUrl;
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
    return decodeURIComponent(url.slice(idx + marker.length));
  } catch {
    return null;
  }
}
