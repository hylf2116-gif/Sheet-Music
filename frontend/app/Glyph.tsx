// Unino's own small icons, used instead of emoji so they look the same on every device.
// House style: 24×24, round 1.8 strokes, and a tilted "note head" (a small slanted oval) as
// the signature detail — heads of people, tips of the crown, the hand's raised dot, and so on.
import type { CSSProperties } from 'react';

// A note head: a small oval tilted like printed music (−20°).
const head = (cx: number, cy: number, rx = 2.6, ry = 1.9) => (
  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(-20 ${cx} ${cy})`} fill="currentColor" stroke="none" />
);

const G: Record<string, React.ReactNode> = {
  // people: two note-head heads with shoulders
  people: <>{head(9, 8, 3, 2.3)}<path d="M3.5 19c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2" />{head(17, 9, 2.4, 1.8)}<path d="M15.6 13.9c2.4.2 4.2 1.8 4.8 4.6" /></>,
  person: <>{head(12, 8, 3.3, 2.5)}<path d="M5.5 20c.7-3.8 3.2-5.8 6.5-5.8s5.8 2 6.5 5.8" /></>,
  // crown whose three points end in note heads
  crown: <><path d="M4.5 18h15M5 15l-1-7 5 3.5L12 6l3 5.5 5-3.5-1 7z" />{head(4, 7.2, 1.6, 1.2)}{head(12, 5, 1.6, 1.2)}{head(20, 7.2, 1.6, 1.2)}</>,
  // co-host: a smaller crown with one note head (half the crown)
  cohost: <><path d="M6 17.5h12M7 15l-.6-5 3.6 2.4L12 8.5l2 3.9 3.6-2.4-.6 5z" />{head(12, 7.6, 1.5, 1.1)}</>,
  // raised hand: open palm, a note head above it
  hand: <><path d="M8 13V7.5a1.5 1.5 0 0 1 3 0V12m0-5.5V6a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V14c0 3.6-2.4 6-6 6-2.6 0-4.2-1.2-5.4-3.2L4.3 13a1.4 1.4 0 0 1 2.3-1.6L8 13" />{head(19.5, 4, 1.7, 1.25)}</>,
  chat: <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" />{head(9, 10, 1.4, 1)}{head(15, 10, 1.4, 1)}</>,
  mail: <><rect x="3.5" y="6" width="17" height="12.5" rx="2.5" /><path d="m4 7.5 8 6 8-6" />{head(18.5, 5.5, 2, 1.5)}</>,
  mic: <><rect x="9" y="3.5" width="6" height="10.5" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" /></>,
  sound: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  muted: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="m16 9.5 5 5m0-5-5 5" /></>,
  timer: <><circle cx="12" cy="13.5" r="7" /><path d="M12 13.5V10M10 3h4" />{head(12, 13.5, 1.3, 1)}</>,
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" />,
  record: <circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none" />,
  prev: <path d="M14.5 6 8.5 12l6 6" />,
  next: <path d="m9.5 6 6 6-6 6" />,
  check: <path d="m5.5 12.5 4 4 9-9" />,
  close: <path d="M6.5 6.5l11 11m0-11-11 11" />,
  caret: <path d="m7 10 5 5 5-5" />,
  // star / pinned: five points, a note head in the middle when filled
  star: <path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" />,
  starFill: <path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" fill="currentColor" />,
  // AI sparkle: a four-point spark with a note head
  spark: <><path d="M10 3.5c.6 4 2 5.4 6 6-4 .6-5.4 2-6 6-.6-4-2-5.4-6-6 4-.6 5.4-2 6-6z" />{head(18, 17, 2, 1.5)}</>,
};

export default function Glyph({ name, size = 16, className, style, title }: {
  name: keyof typeof G | string; size?: number; className?: string; style?: CSSProperties; title?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      style={{ width: size, height: size, flexShrink: 0, display: 'inline-block', verticalAlign: '-0.15em', ...style }}>
      {title && <title>{title}</title>}
      {G[name]}
    </svg>
  );
}
