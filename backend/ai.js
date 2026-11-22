// AI teaching marks: Claude reads the recognized score (as a compact bar-by-bar summary) and
// suggests marks a teacher would write: difficult spots, fingering, shifts, bowing, intonation,
// practice tips. The suggestions come back as structured JSON; the teacher's browser places them
// above the right bars as normal annotations (they can be moved, edited or deleted).
//
// Needs ANTHROPIC_API_KEY on the server (Railway → Variables). Without it, aiAvailable() is false.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5-5';
const STEP_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const TYPE_SHORT = { whole: 'w', half: 'h', quarter: 'q', eighth: 'e', '16th': 's', '32nd': 't' };

let client = null;
function aiAvailable() { return !!process.env.ANTHROPIC_API_KEY; }
function getClient() { return (client ||= new Anthropic()); }

// A compact text version of the MusicXML: one line per bar, e.g.
//   "bar 3: G2s D3s B3s A3s B3s ... (dyn: f)"
// Keeps the request small (a 100-bar piece is a few thousand tokens).
function summarizeMusicXml(xml) {
  const lines = [];
  const key = xml.match(/<fifths>(-?\d+)<\/fifths>/);
  const beats = xml.match(/<beats>(\d+)<\/beats>\s*<beat-type>(\d+)<\/beat-type>/);
  const clef = xml.match(/<clef[^>]*>\s*<sign>(\w)<\/sign>/);
  lines.push(`Key signature: ${key ? key[1] : '0'} sharps (negative = flats). Time: ${beats ? `${beats[1]}/${beats[2]}` : 'unknown'}. Clef: ${clef ? clef[1] : '?'}.`);
  const measures = xml.split(/<measure\s/).slice(1);
  measures.forEach((m, i) => {
    const notes = [];
    for (const n of m.match(/<note[ >][\s\S]*?<\/note>/g) || []) {
      if (/<grace/.test(n)) continue;
      const type = (n.match(/<type>(\w+)<\/type>/) || [])[1];
      const t = TYPE_SHORT[type] || '';
      if (/<rest/.test(n)) { notes.push(`r${t}`); continue; }
      const p = n.match(/<step>(\w)<\/step>(?:\s*<alter>(-?\d+)<\/alter>)?\s*<octave>(\d)<\/octave>/);
      if (!p) continue;
      const midi = 12 * (Number(p[3]) + 1) + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[p[1]] + Number(p[2] || 0);
      const name = STEP_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
      notes.push((/<chord/.test(n) ? '+' : '') + name + t + (/<dot/.test(n) ? '.' : ''));
    }
    const dyn = [...m.matchAll(/<dynamics[^>]*>\s*<(\w+)/g)].map((d) => d[1]);
    const words = [...m.matchAll(/<words[^>]*>([^<]+)<\/words>/g)].map((w) => w[1].trim()).filter(Boolean);
    let line = `bar ${i + 1}: ${notes.join(' ') || '(empty)'}`;
    if (dyn.length) line += ` (dyn: ${dyn.join(',')})`;
    if (words.length) line += ` (text: ${words.join('; ').slice(0, 60)})`;
    lines.push(line);
  });
  return { text: lines.join('\n'), barCount: measures.length };
}

const SCHEMA = {
  type: 'object',
  properties: {
    marks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          bar: { type: 'integer', description: 'Bar number from the summary (1-based).' },
          kind: { type: 'string', enum: ['difficult', 'fingering', 'shift', 'bowing', 'intonation', 'rhythm', 'dynamics', 'practice'] },
          text: { type: 'string', description: 'The mark itself, short enough to write above a bar (max ~40 characters).' },
        },
        required: ['bar', 'kind', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['marks'],
  additionalProperties: false,
};

const LANG_NAME = { zh: 'Simplified Chinese', en: 'English' };

/**
 * Ask Claude for teaching marks. Returns [{ bar, kind, text }], bars clamped to the score.
 * @param {string} xml  recognized MusicXML
 * @param {{ instrument?: string, level?: string, lang?: string, scoreName?: string }} opts
 */
async function suggestMarks(xml, opts = {}) {
  const { text, barCount } = summarizeMusicXml(xml);
  if (!barCount) return [];
  const instrument = opts.instrument || 'cello';
  const lang = LANG_NAME[opts.lang] || 'English';

  const system = [
    'You are an experienced string teacher preparing a student\'s sheet music before a lesson.',
    'You get a bar-by-bar summary of a score that was read automatically from a scan. Note names use',
    'scientific pitch (C4 = middle C); the letter after a note is its value (w h q e s t = whole, half,',
    'quarter, eighth, 16th, 32nd; "." dotted; "+" a note played together with the previous one).',
    'The scan reading can contain mistakes, so do not comment on single odd notes.',
    '',
    `Suggest the marks a good teacher would write on this score for a ${instrument} student:`,
    'where it gets difficult and why, useful fingerings or position shifts, bowing, places that need',
    'careful intonation, rhythm traps, dynamics to bring out, and how to practise the hardest bars.',
    'Choose the 6 to 15 marks that matter most; do not mark every bar. Keep each mark short enough to',
    `write above one bar (about 40 characters). Write the marks in ${lang}, in the natural wording a`,
    'teacher would use, keeping standard musical terms (like rit., p, f, sul tasto) as they are.',
  ].join('\n');

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system,
    messages: [{
      role: 'user',
      content: `Score: ${opts.scoreName || 'untitled'} (${barCount} bars)\n\n${text}`,
    }],
  });

  if (response.stop_reason === 'refusal') throw Object.assign(new Error('The AI declined this request.'), { code: 'AI_REFUSED' });
  if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('The AI answer was cut off.'), { code: 'AI_TRUNCATED' });
  const block = response.content.find((b) => b.type === 'text');
  let parsed;
  try { parsed = JSON.parse(block ? block.text : ''); } catch { throw Object.assign(new Error('The AI answer could not be read.'), { code: 'AI_BAD_JSON' }); }
  return (parsed.marks || [])
    .filter((m) => Number.isInteger(m.bar) && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ bar: Math.min(Math.max(1, m.bar), barCount), kind: m.kind, text: m.text.trim().slice(0, 60) }))
    .slice(0, 20);
}

module.exports = { aiAvailable, suggestMarks, summarizeMusicXml, MODEL };
