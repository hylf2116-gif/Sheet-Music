'use client';

import { useSyncExternalStore } from 'react';

// True while the CSS media query matches. False during server render.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    onChange => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// Phones: narrow screens get the compact two-row toolbar and full-width panels.
export const PHONE_QUERY = '(max-width: 767px)';
export const usePhone = () => useMediaQuery(PHONE_QUERY);

// Phones and iPad in portrait: two-row toolbar with larger touch targets.
export const useNarrow = () => useMediaQuery('(max-width: 1023px)');
