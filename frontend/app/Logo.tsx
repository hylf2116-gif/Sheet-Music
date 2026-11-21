'use client';

import { useId } from 'react';

// The Unino mark: one handwritten line that draws a u, loops into a note head, rises as the stem and ends in a flag.
// Large sizes use a "ribbon" calligraphy pen (a light wide band behind a narrow 45° nib).
// Below 40 px a plain even line is used so it stays sharp.
export const LOGO_PATH =
  'M22.5 28C24 22.5 30 22.5 30 30V49C30 64.5 40.5 72 51.5 69.5C60 67.5 65 61.5 62.5 57C60 52.5 51 54 50.5 60.5C50 66.5 58.5 68.5 64 63.5C67 60.5 68 56.5 68 51V19.5C77 21.5 84.5 29 82 41.5';
const BG = '#17130f';
const GOLD = '#d4a24c';

// Offsets along a 45° nib of the given length: stamping the line at each one gives thick/thin strokes
function nibOffsets(length: number) {
  const out: [number, number][] = [];
  for (let i = 0; i <= 30; i++) {
    const t = (i / 30 - 0.5) * length * Math.SQRT1_2;
    out.push([+t.toFixed(2), +(-t).toFixed(2)]);
  }
  return out;
}
const WIDE = nibOffsets(7);
const NARROW = nibOffsets(3.5);

export function LogoMark({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  const small = size < 40;
  const stroke = { fill: 'none', stroke: GOLD, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <defs><clipPath id={`c${id}`}><rect width="96" height="96" rx="21" /></clipPath></defs>
      <g clipPath={`url(#c${id})`}>
        <rect width="96" height="96" fill={BG} />
        {small ? (
          <path d={LOGO_PATH} strokeWidth={8} {...stroke} />
        ) : (
          <>
            <g opacity={0.55}>
              {WIDE.map(([x, y], i) => <path key={i} d={LOGO_PATH} transform={`translate(${x} ${y})`} strokeWidth={1.3} {...stroke} />)}
            </g>
            {NARROW.map(([x, y], i) => <path key={i} d={LOGO_PATH} transform={`translate(${x} ${y})`} strokeWidth={1.3} {...stroke} />)}
          </>
        )}
      </g>
    </svg>
  );
}
