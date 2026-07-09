import { useSuite } from '../context/SuiteContext';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { visibleSuiteIds } from '../config/productRole';

const SUITES = [
  {
    id: 'india' as const,
    label: 'India Suite',
    flag: '🇮🇳',
    color: '#FF9933',
    subtitle: 'GST · TDS · Payroll · Ind AS',
    defaultPath: '/india-full',
  },
  {
    id: 'uae' as const,
    label: 'UAE Suite',
    flag: '🇦🇪',
    color: '#0D9488',
    subtitle: 'VAT · CT · EOSB · IFRS',
    defaultPath: '/dashboard',
  },
  {
    id: 'fpa' as const,
    label: 'FP&A Suite',
    flag: '📊',
    color: '#7C3AED',
    subtitle: 'Forecast · Variance · CFO',
    defaultPath: '/fpa/variance',
  },
];

export function SuiteSwitcher() {
  const { activeSuite, setSuite } = useSuite();
  const { productRole } = useAuth();
  const navigate = useNavigate();

  const visible = visibleSuiteIds(productRole);
  const suites = SUITES.filter((s) => visible.includes(s.id));

  const handleSwitch = (suite: (typeof SUITES)[0]) => {
    setSuite(suite.id);
    navigate(suite.defaultPath);
  };

  const active = suites.find(s => s.id === activeSuite) ?? suites[0];
  if (!active || suites.length === 0) return null;

  return (
    <div className="px-3 py-2 border-b border-white/10">
      {/* Active suite display */}
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 px-1">Active Suite</div>
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg mb-2"
        style={{ backgroundColor: active.color + '20', border: `1px solid ${active.color}40` }}
      >
        <span className="text-lg">{active.flag}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">{active.label}</div>
          <div className="text-[10px] text-gray-400 truncate">{active.subtitle}</div>
        </div>
      </div>

      {/* Switch buttons */}
      <div className={`grid gap-1 ${suites.length === 3 ? 'grid-cols-3' : suites.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {suites.map(suite => (
          <button
            key={suite.id}
            onClick={() => handleSwitch(suite)}
            className={`
              flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg text-xs transition-all
              ${activeSuite === suite.id
                ? 'text-white font-medium'
                : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}
            `}
            style={
              activeSuite === suite.id
                ? { backgroundColor: suite.color + '30', border: `1px solid ${suite.color}50` }
                : { border: '1px solid transparent' }
            }
          >
            <span className="text-base">{suite.flag}</span>
            <span className="truncate w-full text-center leading-tight text-[10px]">
              {suite.id === 'fpa' ? 'FP&A' : suite.label.split(' ')[0]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
