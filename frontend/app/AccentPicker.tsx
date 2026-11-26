'use client';

import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';
import { ACCENTS, savedAccent, setAccent } from '../lib/accent';
import Glyph from './Glyph';

// Theme colour choices: a swatch grid; the chosen colour applies to the whole app at once.
export default function AccentPicker({ columns = 5 }: { columns?: number }) {
  const t = useT();
  const [cur, setCur] = useState('indigo');
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read the saved choice after mount
  useEffect(() => { setCur(savedAccent()); }, []);
  const cur_ = ACCENTS.find(a => a.id === cur) ?? ACCENTS[0];
  return (
    <div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {ACCENTS.map(a => (
          <button key={a.id} onClick={() => { setAccent(a.id); setCur(a.id); }} title={t(a.name)} aria-label={t(a.name)}
            aria-pressed={cur === a.id}
            className="aspect-square rounded-full grid place-items-center text-white transition-transform hover:scale-110"
            style={{
              background: `linear-gradient(135deg, ${a.s[3]}, ${a.s[6]})`,
              boxShadow: cur === a.id ? `0 0 0 2px var(--modal-bg, #fff), 0 0 0 4px ${a.s[5]}` : 'none',
            }}>
            {cur === a.id && <Glyph name="check" size={14} />}
          </button>
        ))}
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--t3)' }}>{t(cur_.name)}</p>
    </div>
  );
}
