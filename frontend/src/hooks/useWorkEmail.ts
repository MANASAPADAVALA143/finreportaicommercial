import { useCallback, useState } from 'react';

const KEY = 'invoiceflow_work_email';

export function useWorkEmail() {
  const [email, setEmailState] = useState(() => {
    try {
      return localStorage.getItem(KEY) || '';
    } catch {
      return '';
    }
  });

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
