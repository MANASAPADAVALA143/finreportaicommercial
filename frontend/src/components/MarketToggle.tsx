import { useNavigate, useLocation } from 'react-router-dom';
import { useMarket } from '@/contexts/MarketContext';

/** Global India / UAE market toggle — opens AP InvoiceFlow in that market (INR+GST / AED+VAT). */
export function MarketToggle({ compact = false }: { compact?: boolean }) {
  const { market, setMarket, creatingWorkspace } = useMarket();
  const navigate = useNavigate();
  const location = useLocation();

  const pick = (next: 'india' | 'uae') => {
    if (creatingWorkspace) return;
    // setMarket force-pins + marks user-chosen so /dashboard cannot snap back to UAE.
    // When no workspace exists yet for `next`, setMarket creates one and reloads the
    // page onto it — so don't also navigate here, the reload will land correctly.
    void setMarket(next);

    const onAp = location.pathname === '/ap-invoices' || location.pathname.startsWith('/ap-invoices/');
    const onAuthOrLanding =
      location.pathname === '/' ||
      location.pathname === '/login' ||
      location.pathname === '/register';
    if (!onAp || onAuthOrLanding) {
      navigate('/ap-invoices');
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-0.5 rounded-full bg-white/10 p-0.5">
        <button
          type="button"
          disabled={creatingWorkspace}
          onClick={() => pick('uae')}
          title="UAE — VAT, TRN, AED"
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all disabled:opacity-50 disabled:cursor-wait ${
            market === 'uae' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
          }`}
        >
          🇦🇪 UAE
        </button>
        <button
          type="button"
          disabled={creatingWorkspace}
          onClick={() => pick('india')}
          title="India — GST, GSTIN, INR"
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all disabled:opacity-50 disabled:cursor-wait ${
            market === 'india' ? 'bg-orange-600 text-white' : 'text-slate-300 hover:text-white'
          }`}
        >
          🇮🇳 India
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-full bg-slate-800 p-0.5">
      <button
        type="button"
        disabled={creatingWorkspace}
        onClick={() => pick('uae')}
        title="UAE mode — VAT, TRN, AED"
        className={`flex-1 rounded-full px-2 py-1 text-[10px] font-semibold transition-all disabled:opacity-50 disabled:cursor-wait ${
          market === 'uae' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
        }`}
      >
        🇦🇪 UAE
      </button>
      <button
        type="button"
        disabled={creatingWorkspace}
        onClick={() => pick('india')}
        title="India mode — GST, GSTIN, INR"
        className={`flex-1 rounded-full px-2 py-1 text-[10px] font-semibold transition-all disabled:opacity-50 disabled:cursor-wait ${
          market === 'india' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
        }`}
      >
        🇮🇳 India
      </button>
    </div>
  );
}
