/**
 * Public one-tap approval page â€” no login required.
 * URL: /approve?id=<approvalRowId>&email=<approverEmail>&action=approved|rejected
 *
 * Reads query params, calls processApprovalAction once, shows a result card.
 * The approver clicks the WhatsApp link on their phone and sees this page.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { processApprovalAction } from '../../lib/ap-invoice/approvalService';

type State = 'loading' | 'success' | 'error';

export function ApprovalCallback() {
  const [params] = useSearchParams();
  const [state, setState] = useState<State>('loading');
  const [message, setMessage] = useState('');
  const calledRef = useRef(false);

  const id = params.get('id') ?? '';
  const email = params.get('email') ?? '';
  const action = params.get('action') as 'approved' | 'rejected' | null;

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    if (!id || !email || (action !== 'approved' && action !== 'rejected')) {
      setState('error');
      setMessage('Invalid or expired approval link. Please check the link and try again.');
      return;
    }

    processApprovalAction(id, email, action)
      .then((result) => {
        if (result.ok) {
          setState('success');
          setMessage(action === 'approved' ? 'Invoice approved successfully.' : 'Invoice rejected.');
        } else {
          setState('error');
          setMessage(result.message);
        }
      })
      .catch((e) => {
        setState('error');
        setMessage(e instanceof Error ? e.message : 'Unexpected error. Please try again.');
      });
  }, [id, email, action]);

  const isApproved = action === 'approved';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
        <div className="mb-4 text-5xl">
          {state === 'loading' && 'â³'}
          {state === 'success' && (isApproved ? 'âœ…' : 'ðŸš«')}
          {state === 'error' && 'âŒ'}
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          {state === 'loading' && 'Processingâ€¦'}
          {state === 'success' && (isApproved ? 'Invoice Approved' : 'Invoice Rejected')}
          {state === 'error' && 'Action Failed'}
        </h1>
        <p className="text-sm text-gray-600 mb-6">{state === 'loading' ? 'Please wait.' : message}</p>
        {state !== 'loading' && (
          <a
            href="/invoices"
            className="inline-block bg-[#1a56db] text-white text-sm font-medium rounded-lg px-5 py-2 hover:bg-blue-700 transition-colors"
          >
            Go to Invoices
          </a>
        )}
        <p className="mt-4 text-xs text-gray-400">InvoiceFlow AP Automation</p>
      </div>
    </div>
  );
}

