import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';

const KEY = 'invoiceflow_work_email';

function readStoredEmail(): string {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

/** Work email for approvals — localStorage, seeded from logged-in auth email. */
export function useWorkEmail() {
  const { user } = useAuth();
  const [email, setEmailState] = useState(readStoredEmail);

  useEffect(() => {
    const authEmail = user?.email?.trim();
    if (!authEmail) return;
    setEmailState((prev) => {
      if (prev.trim()) return prev;
      try {
        localStorage.setItem(KEY, authEmail);
      } catch {
        /* ignore */
      }
      return authEmail;
    });
  }, [user?.email]);

  const setEmail = useCallback((next: string) => {
    setEmailState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return { email, setEmail };
}
