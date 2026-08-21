import { useNavigate, useLocation } from 'react-router-dom';
import { useMarket } from '@/contexts/MarketContext';
import { pinIndiaSuiteMarket, pinUaeSuiteMarket } from '@/config/productRole';

/** Global India / UAE market toggle — opens AP InvoiceFlow in that market (INR+GST / AED+VAT). */
export function MarketToggle({ compact = false }: { compact?: boolean }) {
  const { market, setMarket } = useMarket();
  const navigate = useNavigate();
  const location = useLocation();

  const pick = (next: 'india' | 'uae') => {
    if (next === 'india') pinIndiaSuiteMarket();
    else pinUaeSuiteMarket();
    void setMarket(next);

    // Open AP for the selected market (same entry for India and UAE)
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
          onClick={() => pick('uae')}
          title="UAE — VAT, TRN, AED"
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all ${
            market === 'uae' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
          }`}
        >
          🇦🇪 UAE
        </button>
        <button
          type="button"
          onClick={() => pick('india')}
          title="India — GST, GSTIN, INR"
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all ${
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
        onClick={() => pick('uae')}
        title="UAE mode — VAT, TRN, AED"
        className={`flex-1 rounded-full px-2 py-1 text-[10px] font-semibold transition-all ${
          market === 'uae' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
        }`}
      >
        🇦🇪 UAE
      </button>
      <button
        type="button"
        onClick={() => pick('india')}
        title="India mode — GST, GSTIN, INR"
        className={`flex-1 rounded-full px-2 py-1 text-[10px] font-semibold transition-all ${
          market === 'india' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
        }`}
      >
        🇮🇳 India
      </button>
    </div>
  );
}
