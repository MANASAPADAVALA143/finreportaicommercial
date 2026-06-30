import { NavLink, Outlet } from 'react-router-dom';

const LINKS = [
  { to: '/crm', label: 'Dashboard', end: true },
  { to: '/crm/contacts', label: 'Contacts' },
  { to: '/crm/deals', label: 'Deals' },
  { to: '/crm/quotes', label: 'Quotes' },
  { to: '/crm/activities', label: 'Activities' },
];

export default function CRMLayout() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">CRM</h1>
          <p className="text-sm text-gray-400 mt-1">Customers, deals, quotes — lightweight sales for UAE SMEs</p>
        </div>
        <nav className="flex flex-wrap gap-2 mb-6 border-b border-gray-800 pb-3">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-sm ${isActive ? 'bg-teal-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
    </div>
  );
}
