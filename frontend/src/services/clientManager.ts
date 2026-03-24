const STORAGE_PREFIX = 'finreport_client_';

export function saveClientData<T>(companyId: string, key: string, data: T): void {
  try {
    const storageKey = `${STORAGE_PREFIX}${companyId}_${key}`;
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch (e) {
    console.warn('clientManager.saveClientData failed:', e);
  }
}

export function getClientData<T>(companyId: string, key: string): T | null {
  try {
    const storageKey = `${STORAGE_PREFIX}${companyId}_${key}`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn('clientManager.getClientData failed:', e);
    return null;
  }
}
