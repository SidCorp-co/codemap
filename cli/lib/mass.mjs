// codemap/1 §11 — how many characters of comment this repo carries, and how many of them are story.
//
// The prose tiers police where a comment may sit and the graph tiers police what an annotation
// resolves to. Neither answers the question a repo adopting this asks after five weeks: is there
// LESS comment now? Measured on one consumer repo over that window, policed prose fell ~203 KB while
// annotations added ~527 KB — the comments did not go away, they changed channel, into the one loaded
// into an agent's context before every edit of the file.
//
// So this counts characters per channel, and inside the annotation channel it counts the part that
// does not belong there. Not the bytes: a rule with a real consequence keeps its characters however
// long it is, and a cap on length is paid by shortening the consequence clause, which loses the half
// that carries. What it counts is NARRATIVE — the sentences in past tense, the dates, the incident
// retold — in an annotation that already cites the incident it is retelling.

import { profileFor } from './languages.mjs';
import { scanComments } from './scan.mjs';
import { baselineKey, PROSE_CODES, CM_IGNORE_RE } from './parse.mjs';

// cm:guard the vocabulary stays CLOSED and past-tense-only, biased toward silence — a present-tense
//   verb states a rule, and `shipped`/`measured` were dropped because both double as adjectives (§11)
const MARKERS = [
  /\bwas\b/i, /\bwere\b/i, /\bhad been\b/i, /\bused to\b/i, /\bturned out\b/i,
  /\buntil 20\d\d-\d\d-\d\d\b/i, /\blanded on 20\d\d-\d\d-\d\d\b/i,
  /\bregressed\b/i, /\bbroke\b/i,
];

// cm:guard a citation is what makes the story removable rather than lost — ISS-<n> and a date are
//   both listed as evidence by the doctrine, so an annotation carrying neither is never billed here
const CITATION = /(ISS-\d+|20\d\d-\d\d-\d\d)/i;

// cm:why the unit is a SENTENCE, not the tail after the citation — across 1,141 cited annotations in
//   one consumer repo the story sits before the citation as often as after it (§11)
const sentences = (text) => text.split(/(?<=[.!?])\s+/).filter(Boolean);

/** The annotation's own text plus the one line §4 lets it wrap onto. */
export const annotationText = (a) => [a.text, a.wrap].filter(Boolean).join(' ');

// cm:guard the citation is looked for in the WHOLE comment, never in `text` alone — parseAnnotation
//   keeps only the prose past the em dash there, so a cm:hack's mandatory ISS- never reaches it
const citationText = (a) => (typeof a === 'string' ? a : [a.raw, a.wrap].filter(Boolean).join(' '));

// cm:edge contract -> cli/cm.mjs — the same two lines the graph tiers' ignore
//   filter reads, so a `cm:ignore CM303` clears the diagnostic and the number it is counted in together
const silenced = (a, ignores) => Boolean(ignores?.get(a.line)?.has('CM303') || ignores?.get(a.line - 1)?.has('CM303'));

// cm:guard 120 is read OFF the distribution, never chosen — p10=123 across 4,870 annotations, and
//   under it sits the bare `Measured <date> on <file>.` the doctrine allows as evidence (§11)
export const NARRATIVE_MIN = 120;

/**
 * The characters of incident narrative one annotation carries, and the sentences they sit in.
 *
 * Zero for anything with no citation, and zero for a sentence with no marker: the rule and its
 * consequence are what the annotation is for.
 */
// cm:edge contract -> cli/lib/graph.mjs#advisoryDiags — CM303 fires on this
//   verdict, so the rule and the number `cm mass` prints cannot disagree about what a story is
export function narrativeOf(a) {
  if (!CITATION.test(citationText(a))) return { chars: 0, sentences: [], cited: false };
  const text = typeof a === 'string' ? a : annotationText(a);
  const story = sentences(text).filter((s) => MARKERS.some((re) => re.test(s)));
  return { chars: story.reduce((n, s) => n + s.length, 0), sentences: story, cited: true };
}

/**
 * Does this annotation retell the incident it cites, rather than citing it and stopping?
 *
 * @param ignores the file's `cm:ignore` map, where the caller is counting rather than reporting —
 *   `cm verify` filters the diagnostic itself, so passing it here is what keeps the two in step.
 */
export function retells(a, ignores) {
  if (typeof a !== 'string' && silenced(a, ignores)) return null;
  const n = narrativeOf(a);
  return n.chars >= NARRATIVE_MIN ? n : null;
}

/** How much narrative the annotation channel of these files carries. */
export function narrativeMass(perFile) {
  let total = 0;
  let cited = 0;
  let chars = 0;
  let retelling = 0;
  for (const f of perFile) {
    for (const a of f.annotations ?? []) {
      total++;
      if (narrativeOf(a).cited) cited++;
      const story = retells(a, f.ignores);
      if (story) { retelling++; chars += story.chars; }
    }
  }
  return { annotations: total, cited, retelling, chars };
}

/**
 * One file's comment characters, by channel.
 *
 * @param res the analysis of THIS source, so the two classifications a reader cannot make from the
 *   text alone — which line is an annotation's wrap, and which comment is prose — are analyze.mjs's
 *   verdict rather than a second implementation of it.
 */
// cm:edge contract -> cli/lib/analyze.mjs — the channels read `annotations`, `diags`,
//   `overflowLines` and `header` off the analysis; deriving them from the source again would drift from it
export function fileMass({ relPath, src, res, frozen }) {
  const prof = profileFor(relPath);
  const out = { relPath, annotation: 0, frozen: 0, live: 0, doc: 0, header: 0, narrative: 0, annotations: 0, retelling: 0 };
  if (!prof || res?.skipped) return out;

  for (const a of res.annotations ?? []) {
    out.annotations++;
    // cm:guard the number and CM303 count the SAME annotations — a total that included narrative the
    //   rule leaves alone would ask a repo to make a figure fall that nothing tells it how to reach
    const story = retells(a, res.ignores);
    if (story) { out.retelling++; out.narrative += story.chars; }
  }

  const annLines = new Set();
  for (const a of res.annotations ?? []) {
    annLines.add(a.line);
    if (a.wrap) annLines.add(a.line + 1);
  }
  const proseAt = new Map();
  for (const d of res.diags ?? []) {
    // cm:why CM011 measures a header's LENGTH and carries `header:<n>` rather than a comment, so the
    //   header channel below bills those characters and this map must not bill them again
    if (!PROSE_CODES.has(d.code) || d.code === 'CM011') continue;
    proseAt.set(d.line, d);
  }
  const ignoredProse = (line) => [...(res.ignores?.get(line) ?? []), ...(res.ignores?.get(line - 1) ?? [])]
    .some((code) => PROSE_CODES.has(code));

  const header = res.header;
  // cm:guard every comment carrying text is billed to exactly ONE channel, so the channels plus the
  //   directives below reconcile to the file's whole comment text — a channel is an attribution, never a filter
  for (const c of scanComments(src, prof).comments) {
    if (!c.text) continue;
    // cm:why an ignore directive is billed nowhere — it is the escape hatch a code's own fix line
    //   offers, and pricing it would charge an author for taking the way out the checker handed them
    if (CM_IGNORE_RE.test(c.text)) continue;
    if (annLines.has(c.line)) { out.annotation += c.text.length; continue; }
    const prose = proseAt.get(c.line);
    if (prose) {
      const key = baselineKey(prose.text ?? prose.message);
      const baselined = frozen?.has(key) || (prose.blockKey && frozen?.has(prose.blockKey));
      // cm:edge contract -> cli/cm.mjs — `|| d.sited` bypasses the baseline there (§4: a sited line
      //   cannot be frozen), so a frozen channel ignoring `sited` would contradict verify (ISS-41)
      if (baselined && !prose.sited) out.frozen += c.text.length;
      else out.live += c.text.length;
      continue;
    }
    if (header && !header.glued && c.line >= header.start && c.endLine <= header.end) { out.header += c.text.length; continue; }
    // cm:why prose an author silenced is still prose. Keyed on the LINE and ahead of §4.2's rule, so it
    //   also takes a `doc` block off a covered line, for a directive that silenced nothing (ISS-48)
    if (ignoredProse(c.line)) { out.live += c.text.length; continue; }
    // cm:guard this matches a LINE, not a comment — a block's close and a line comment can share one,
    //   so it can still claim a `doc` form the rule below would bill to doc (ISS-36, measured on ISS-40)
    if (res.overflowLines?.has(c.line)) { out.live += c.text.length; continue; }
    // cm:why a form the profile exempts from prose is still PROSE (ISS-28). §4.2's rule below bills
    //   every non-doc form to live, so this states the intent and no longer decides the channel (ISS-48)
    if (prof.proseExemptBlockOpens?.includes(c.leader)) { out.live += c.text.length; continue; }
    // cm:guard §4.2 makes `/** */` documentation BY FORM and every other form prose, `/* */` included,
    //   so only `doc` is exempt here and a new kind fails toward prose rather than into doc (ISS-40)
    if (c.kind !== 'doc') { out.live += c.text.length; continue; }
    out.doc += c.text.length;
  }

  return out;
}

/** Every channel summed, the narrative share, and the files that hold the most of it. */
export function massOf(rows) {
  const total = { annotation: 0, frozen: 0, live: 0, doc: 0, header: 0, narrative: 0, annotations: 0, retelling: 0 };
  for (const r of rows) for (const k of Object.keys(total)) total[k] += r[k];
  total.comment = total.annotation + total.frozen + total.live + total.doc + total.header;

  const byNarrative = rows.filter((r) => r.narrative).sort((a, b) => b.narrative - a.narrative || a.relPath.localeCompare(b.relPath));
  const byAnnotation = rows.filter((r) => r.annotation).sort((a, b) => b.annotation - a.annotation || a.relPath.localeCompare(b.relPath));
  const share = (list, n, key) => (total[key] ? Math.round((list.slice(0, n).reduce((s, r) => s + r[key], 0) / total[key]) * 100) : 0);

  return {
    total,
    files: rows.length,
    // cm:why the head's SHARE says whether a drain can be targeted at all — on the repo §11 quotes, 100
    //   of 965 files hold 47% of the debt, so ranking reaches the tail without an edit
    headShare: { narrative: share(byNarrative, 20, 'narrative'), annotation: share(byAnnotation, 20, 'annotation') },
    byNarrative,
    byAnnotation,
  };
}
