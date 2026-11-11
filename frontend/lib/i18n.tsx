'use client';

// App language (English / Simplified Chinese).
// Text is written in English in the code and wrapped in t('...'); the English text is the key.
// Chinese translations live in ./zh.ts. A missing translation falls back to English.
// Placeholders: t('{n} in room', { n: 3 }).
// Context: t('bars|timer') shows "bars" in English; the part after | only tells translations apart.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ZH } from './zh';

export type Lang = 'en' | 'zh';
const STORAGE_KEY = 'unino_lang';

type Vars = Record<string, string | number>;
export type TFunc = (text: string, vars?: Vars) => string;

function fill(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const english = (text: string) => { const i = text.indexOf('|'); return i < 0 ? text : text.slice(0, i); };

export function translate(lang: Lang, text: string, vars?: Vars): string {
  if (!text) return text;
  if (lang === 'zh') {
    const zh = ZH[text];
    if (zh === undefined && process.env.NODE_ENV !== 'production') {
      console.warn('[i18n] missing Chinese text for:', text);
    }
    return fill(zh ?? english(text), vars);
  }
  return fill(english(text), vars);
}

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: 'en',
  setLang: () => {},
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load saved language after mount (localStorage is not available during server render)
      if (saved === 'zh' || saved === 'en') setLangState(saved);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}

export function useT(): TFunc {
  const { lang } = useContext(LangContext);
  return useCallback((text: string, vars?: Vars) => translate(lang, text, vars), [lang]);
}
