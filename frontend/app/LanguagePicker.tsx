'use client';

import { useLang, type Lang } from '../lib/i18n';

// Language switch. Each option is written in its own language so anyone can find theirs.
const OPTIONS: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '简体中文' },
];

export default function LanguagePicker({ dark = true }: { dark?: boolean }) {
  const { lang, setLang } = useLang();
  return (
    <div className="grid grid-cols-2 gap-2">
      {OPTIONS.map(o => {
        const active = lang === o.value;
        return (
          <button key={o.value} onClick={() => setLang(o.value)} aria-pressed={active}
            className={`py-2.5 rounded-xl border text-sm font-medium transition-all ${
              active
                ? (dark ? 'bg-indigo-500/15 border-indigo-500/40 text-white' : 'bg-indigo-50 border-indigo-300 text-indigo-700')
                : (dark ? 'bg-white/[0.03] border-white/[0.06] text-gray-400 hover:bg-white/[0.07]' : 'bg-white border-black/10 text-gray-600 hover:bg-gray-50')
            }`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
