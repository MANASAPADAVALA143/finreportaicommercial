import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, CheckCircle } from 'lucide-react';

export interface IFRSTabBarProps {
  activeSection: string;
  onSectionChange: (sectionId: string) => void;
  completedSections: string[];
}

export const TAB_GROUPS = [
  {
    id: 'statements',
    label: 'Statements',
    sections: [
      { id: 'financial-position', label: 'Financial Position' },
      { id: 'profit-loss', label: 'Profit & Loss' },
      { id: 'cash-flows', label: 'Cash Flows' },
      { id: 'equity', label: 'Changes in Equity' },
    ],
  },
  {
    id: 'notes',
    label: 'Notes',
    sections: [
      { id: 'note-1-general', label: 'Note 1 – General Information' },
      { id: 'note-2-policies', label: 'Note 2 – Accounting Policies' },
      { id: 'note-3-revenue', label: 'Note 3 – Revenue (IFRS 15)' },
      { id: 'note-4-ppe', label: 'Note 4 – Property, Plant & Equipment' },
      { id: 'note-5-leases', label: 'Note 5 – Leases (IFRS 16)' },
      { id: 'note-6-instruments', label: 'Note 6 – Financial Instruments' },
      { id: 'note-7-inventory', label: 'Note 7 – Inventories' },
      { id: 'note-8-tax', label: 'Note 8 – Income Tax' },
      { id: 'note-9-related', label: 'Note 9 – Related Party Transactions' },
      { id: 'note-10-events', label: 'Note 10 – Subsequent Events' },
    ],
  },
  {
    id: 'commentary',
    label: 'Commentary',
    sections: [{ id: 'md-and-a', label: 'AI Financial Commentary' }],
  },
];

const IFRSTabBar: React.FC<IFRSTabBarProps> = ({
  activeSection,
  onSectionChange,
  completedSections,
}) => {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const getActiveGroupLabel = (groupId: string) => {
    const group = TAB_GROUPS.find((g) => g.id === groupId);
    const activeInGroup = group?.sections.find((s) => s.id === activeSection);
    return activeInGroup ? activeInGroup.label : null;
  };

  const statementsGroup = TAB_GROUPS.find((g) => g.id === 'statements');
  const dropdownGroups = TAB_GROUPS.filter((g) => g.id !== 'statements');

  return (
    <div ref={ref} className="border-b border-gray-200 bg-white print:hidden">
      <div className="flex items-center gap-1 px-4">
        {/* Statements: flat tabs */}
        {statementsGroup?.sections.map((section) => {
          const isActive = activeSection === section.id;
          return (
            <button
              type="button"
              key={section.id}
              onClick={() => onSectionChange(section.id)}
              className={`
                px-6 py-3 text-sm font-medium border-b-2 transition-colors
                ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
                }
              `}
            >
              {section.label}
            </button>
          );
        })}

        {/* Notes & Commentary: dropdowns */}
        {dropdownGroups.map((group) => {
          const isGroupActive = group.sections.some((s) => s.id === activeSection);
          const activeLabel = getActiveGroupLabel(group.id);
          const completedInGroup = group.sections.filter((s) =>
            completedSections.includes(s.id)
          ).length;

          return (
            <div key={group.id} className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown(openDropdown === group.id ? null : group.id)
                }
                className={`
                  flex items-center gap-1.5 px-4 py-3 text-sm font-medium
                  border-b-2 transition-colors
                  ${
                    isGroupActive
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                  }
                `}
              >
                <span>{group.label}</span>
                {activeLabel && (
                  <span className="max-w-[140px] truncate text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                    {activeLabel}
                  </span>
                )}
                {completedInGroup > 0 && (
                  <span className="text-xs text-green-600">
                    {completedInGroup}/{group.sections.length}
                  </span>
                )}
                <ChevronDown
                  size={14}
                  className={`transition-transform ${openDropdown === group.id ? 'rotate-180' : ''}`}
                />
              </button>

              {openDropdown === group.id && (
                <div className="absolute top-full left-0 z-50 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-80 overflow-y-auto">
                  {group.sections.map((section) => {
                    const isActive = activeSection === section.id;
                    const isCompleted = completedSections.includes(section.id);

                    return (
                      <button
                        type="button"
                        key={section.id}
                        onClick={() => {
                          onSectionChange(section.id);
                          setOpenDropdown(null);
                        }}
                        className={`
                          w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left
                          transition-colors
                          ${
                            isActive
                              ? 'bg-blue-50 text-blue-700 font-medium'
                              : 'text-gray-700 hover:bg-gray-50'
                          }
                        `}
                      >
                        {isCompleted ? (
                          <CheckCircle
                            size={13}
                            className="text-green-500 flex-shrink-0"
                          />
                        ) : (
                          <span className="w-3.5 h-3.5 rounded-full border border-gray-300 flex-shrink-0" />
                        )}
                        {section.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default IFRSTabBar;
