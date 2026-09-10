// codemap/1 §11 — how many characters of comment this repo carries, and how many of them are story.
//
// The prose tiers police where a comment may sit and the graph tiers police what an annotation
// resolves to. Neither answers the question a repo adopting this asks after five weeks: is there
// LESS comment now? Measured on one consumer repo over that window, policed prose fell 294 KB while
// annotations added 1,014 KB — the comments did not go away, they changed channel, into the one loaded
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

// cm:why the unit is a SENTENCE, not the tail after the citation — across 1,349 cited annotations in
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

// cm:guard 120 is read OFF the distribution, never chosen — p10=123 across 4,886 annotations, and
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
 * @param res the analysis, carrying the source it was taken from, so the two classifications a
 *   reader cannot make from the text alone — which line is an annotation's wrap, and which comment
 *   is prose — are analyze.mjs's verdict rather than a second implementation of it.
 */
// cm:edge contract -> cli/lib/analyze.mjs — this reads `skipped`, `annotations`, `diags`, `ignores`,
//   `header`, `silencedProse` and `src` off it; deriving any of them from the source again would drift from it
// cm:guard the source comes from `res`, never from a parameter beside it — the channels match each
//   diagnostic to a comment by TEXT, so two reads of one path billed a mid-run edit frozen 0 (ISS-56)
export function fileMass({ relPath, res, frozen }) {
  const src = res?.src;
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

  // cm:guard the annotation channel is keyed on the comment's SCAN INDEX — a line key billed a
  //   neighbouring prose comment (ISS-51), a text key a block of identical text beside it (ISS-58)
  // cm:edge contract -> cli/lib/analyze.mjs — `ci` and `wrapCi` are indices into the SAME scan this
  //   function walks below, which holds because both take `res.src` and profileFor(relPath) (ISS-56)
  const annAt = new Set();
  for (const a of res.annotations ?? []) {
    if (a.ci !== undefined) annAt.add(a.ci);
    if (a.wrap && a.wrapCi !== undefined) annAt.add(a.wrapCi);
  }
  const proseAt = new Map();
  for (const d of res.diags ?? []) {
    // cm:why CM011 carries a header's LENGTH as its text, not a comment's, so the header channel bills
    //   it and this map must not again — dropping this moves 9 chars to live on collide.ts (ISS-57)
    if (!PROSE_CODES.has(d.code) || d.code === 'CM011') continue;
    const at = proseAt.get(d.line) ?? [];
    at.push(d);
    proseAt.set(d.line, at);
  }
  // cm:guard a diagnostic is matched to the COMMENT by text, never to its line — a block and the line
  //   comment closing beside it share one line, and one diagnostic decided the channel of both (ISS-51)
  // cm:why two comments of the SAME text on one line need no tie-break: every field the channel reads
  //   — the baseline key, `blockKey`, `sited` — is equal for both, so consuming the match pinned nothing
  const takeProse = (c) => proseAt.get(c.line)?.find((d) => d.text === c.text);
  // cm:guard keyed on the COMMENT exactly as `takeProse` is — an ignore directive names a LINE, and a
  //   line-keyed test billed a doc block sharing a silenced line as prose (ISS-51)
  // cm:guard these carry no `sited` and no `blockKey`: analyze collects them BEFORE siteProse and the
  //   blockKey loop, which walk `diags` alone — so the verdict is a boolean and never a frozen input
  const silencedAt = new Map();
  for (const d of res.silencedProse ?? []) {
    const at = silencedAt.get(d.line) ?? [];
    at.push(d);
    silencedAt.set(d.line, at);
  }
  const takeSilenced = (c) => silencedAt.get(c.line)?.some((d) => d.text === c.text);

  const header = res.header;
  // cm:guard every comment carrying text is billed to exactly ONE channel, so the channels plus the
  //   directives below reconcile to the file's whole comment text — a channel is an attribution, never a filter
  for (const [ci, c] of scanComments(src, prof).comments.entries()) {
    if (!c.text) continue;
    // cm:why an ignore directive is billed nowhere — it is the escape hatch a code's own fix line
    //   offers, and pricing it would charge an author for taking the way out the checker handed them
    if (CM_IGNORE_RE.test(c.text)) continue;
    if (annAt.has(ci)) { out.annotation += c.text.length; continue; }
    const prose = takeProse(c);
    if (prose) {
      // cm:guard no fallback to `.message` here: `takeProse` only ever returns a diagnostic whose `text`
      //   equals this comment's, and a prose code arriving without one changes channel in silence (ISS-51)
      const key = baselineKey(prose.text);
      const baselined = frozen?.has(key) || (prose.blockKey && frozen?.has(prose.blockKey));
      // cm:edge contract -> cli/cm.mjs — `|| d.sited` bypasses the baseline there (§4: a sited line
      //   cannot be frozen), so a frozen channel ignoring `sited` would contradict verify (ISS-41)
      if (baselined && !prose.sited) out.frozen += c.text.length;
      else out.live += c.text.length;
      continue;
    }
    if (header && !header.glued && c.line >= header.start && c.endLine <= header.end) { out.header += c.text.length; continue; }
    // cm:why prose an author silenced is still prose, and the verdict comes from analyze per COMMENT —
    //   a profile constant here billed every rustdoc line and phpdoc block as narration (ISS-51)
    if (takeSilenced(c)) { out.live += c.text.length; continue; }
    // cm:why a form the profile exempts from prose is still prose (ISS-28), which §4.2's rule below
    //   bills to live with no branch of its own (ISS-40)
    // cm:guard §4.2 makes `/** */` documentation BY FORM and every other form prose, `/* */` included,
    //   so only `doc` is exempt here and a new kind fails toward prose rather than into doc (ISS-40)
    // cm:guard at `grammar: false` this is the only rule billing an annotation's orphaned continuation line
    //   to live — never rescue one by line number instead: that bills a doc block sharing its line to prose (ISS-48)
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
    // cm:why the head's SHARE says whether a drain can be targeted at all — on the repo §11 quotes, the
    //   top 100 of the 783 files carrying frozen prose hold 48% of it, so ranking reaches the tail without an edit
    headShare: { narrative: share(byNarrative, 20, 'narrative'), annotation: share(byAnnotation, 20, 'annotation') },
    byNarrative,
    byAnnotation,
  };
}
