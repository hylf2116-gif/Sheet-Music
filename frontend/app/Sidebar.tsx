'use client';

interface Props {
  open: boolean;
  onToggle: () => void;
}

const SECTIONS = [
  { icon: '🕐', label: 'Recent Sessions' },
  { icon: '🎼', label: 'My Scores' },
  { icon: '⭐', label: 'Favorites' },
] as const;

export default function Sidebar({ open, onToggle }: Props) {
  return (
    <div
      className="relative flex-shrink-0 flex flex-col bg-[#0d0d15] border-r border-white/[0.06] z-10 transition-all duration-300 overflow-hidden"
      style={{ width: open ? 220 : 52 }}
    >
      <button
        onClick={onToggle}
        title={open ? 'Collapse sidebar' : 'Expand sidebar'}
        className="flex-shrink-0 h-12 flex items-center justify-center text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors w-full"
      >
        <svg
          width="14" height="14" viewBox="0 0 14 14" fill="none"
          className={`transition-transform duration-300 ${open ? '' : 'rotate-180'}`}
        >
          <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden py-2">
        {SECTIONS.map(({ icon, label }) => (
          <div key={label} className="mb-1">
            <div
              className={`flex items-center gap-3 px-3 py-2 mx-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 cursor-default transition-colors ${
                open ? '' : 'justify-center'
              }`}
            >
              <span className="text-sm flex-shrink-0">{icon}</span>
              {open && (
                <span className="text-xs font-semibold uppercase tracking-widest whitespace-nowrap text-gray-600">
                  {label}
                </span>
              )}
            </div>
            {open && (
              <p className="text-xs text-gray-700 px-5 pb-2">Nothing here yet.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
