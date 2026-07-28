// Per-file analysis: comments -> annotations + grammar diagnostics (codemap/1 §7 grammar tier).

import { profileFor, isGenerated } from './languages.mjs';
import { scanComments, nextCodeLine } from './scan.mjs';
import { parseAnnotation, canonical, hasTodo, diag, PROSE_CODES, baselineKey } from './parse.mjs';
import { enforcementFor } from './registry.mjs';

// cm:why a docblock carrying structured tags is machine-consumed, not narration, so it is exempt
const STRUCTURED_DOC = /@(param|returns?|type|template|satisfies|throws|var|property|method|mixin|deprecated|example|see|link|inheritDoc)\b/;

// cm:why CM011 measures a header's LENGTH, not one comment's text, so it can never be owned by a site
const SITEABLE = new Set(['CM001', 'CM010']);

export function analyzeFile({ relPath, src, reg }) {
  const prof = profileFor(relPath);
  if (!prof) return { skipped: 'no-profile', annotations: [], diags: [], proseKeys: [] };
  if (isGenerated(src)) return { skipped: 'generated', annotations: [], diags: [], proseKeys: [] };

  const { grammar, docPolicy } = enforcementFor(reg, prof);
  const lines = src.split('\n');
  const { comments, codeLines } = scanComments(src, prof);

  const annotations = [];
  const raw = [];
  const ignores = new Map();
  const annLines = new Map();

  const header = moduleHeader(lines, comments, codeLines);
  const headerMax = reg.enforce?.headerMaxLines ?? 20;
  if (header && header.count > headerMax) {
    raw.push({ ...diag('CM011', relPath, header.start, `${header.count} lines (max ${headerMax})`), text: `header:${header.count}` });
  }
  const inHeader = (c) => !!header && c.line >= header.start && c.endLine <= header.end;

  for (const c of comments) {
    if (c.kind !== 'line') {
      let misplaced = false;
      for (const l of c.lines) {
        if (/^cm:/.test(l.text)) {
          raw.push(diag('CM003', relPath, l.line, l.text.slice(0, 60)));
          misplaced = true;
        }
      }
      // cm:why CM003 is the actionable diagnostic, so a misplaced block is not also billed as prose
      const hoverDoc = c.kind === 'doc' && prof.docBlocksAllowed;
      if (!misplaced && grammar && docPolicy === 'banned' && c.text && !inHeader(c) && !hoverDoc &&
          !STRUCTURED_DOC.test(c.text) && !prof.exempt.some((re) => re.test(c.text))) {
        raw.push({ ...diag('CM001', relPath, c.line, trunc(c.text)), text: c.text });
      }
      continue;
    }

    const text = c.text;
    if (!text) continue;

    if (/^cm:/.test(text)) {
      const parsed = parseAnnotation(text, relPath, c.line);
      if (!parsed) continue;
      if (parsed.ignore) {
        const set = ignores.get(c.line) ?? new Set();
        set.add(parsed.ignore.code);
        ignores.set(c.line, set);
        continue;
      }
      if (parsed.diags) { raw.push(...parsed.diags); continue; }
      const ann = { ...parsed.ann, indent: c.indent ?? '', leader: c.leader };
      annotations.push(ann);
      annLines.set(c.line, c.leader);
      const want = canonical(ann);
      if (text !== want) raw.push({ ...diag('CM009', relPath, c.line, text), canonical: want });
      continue;
    }

    if (prof.exempt.some((re) => re.test(text))) continue;

    if (grammar && hasTodo(text)) {
      raw.push({ ...diag('CM010', relPath, c.line, trunc(text)), text });
      continue;
    }

    // cm:why an annotation may wrap onto exactly ONE following line — enough for a sentence that does not
    // fit, while a third line is prose again, so this cannot become a licence to dump a paragraph (§4)
    if (c.firstOnLine !== false && annLines.get(c.line - 1) === c.leader) continue;

    if (!grammar || inHeader(c)) continue;

    if (docPolicy === 'banned') {
      raw.push({ ...diag('CM001', relPath, c.line, trunc(text)), text });
    } else if (docPolicy === 'required-on-exported') {
      // cm:why godoc/revive require a comment above every exported declaration, so only that position is exempt
      const exempt = c.firstOnLine && documentsExported(lines, codeLines, c.line, prof);
      if (!exempt) raw.push({ ...diag('CM001', relPath, c.line, trunc(text)), text });
    }
  }

  const diags = raw.filter((d) => {
    const above = ignores.get(d.line - 1);
    const same = ignores.get(d.line);
    return !(above?.has(d.code) || same?.has(d.code));
  });

  siteProse(comments, annotations, diags);

  return {
    annotations,
    diags,
    // cm:why sited prose can never be spared, so freezing its key would only add a hash that decides nothing
    proseKeys: [...new Set(diags.filter((d) => PROSE_CODES.has(d.code) && !d.sited)
      .map((d) => baselineKey(d.text ?? d.message)))],
    skipped: null,
  };
}

// cm:edge lockstep -> plugins/forge-codemap/scripts/hook-post-edit.mjs — the `sited` flag is what overrides the baseline there
// cm:why the baseline spares legacy prose everywhere except a block its author has just annotated: that
// is the one place the tool can tell "you worked here and left the noise" from "this predates you" (§8)
function siteProse(comments, annotations, diags) {
  const annLines = new Set(annotations.map((a) => a.line));
  if (!annLines.size) return;

  const standalone = comments.filter((c) => c.firstOnLine !== false).sort((a, b) => a.line - b.line);
  for (let i = 0; i < standalone.length;) {
    let end = standalone[i].endLine;
    const start = standalone[i].line;
    let j = i + 1;
    while (j < standalone.length && standalone[j].line <= end + 1) {
      end = Math.max(end, standalone[j].endLine);
      j++;
    }
    if ([...annLines].some((l) => l >= start && l <= end)) {
      for (const d of diags) {
        if (SITEABLE.has(d.code) && d.line >= start && d.line <= end) d.sited = true;
      }
    }
    i = j;
  }
}

// cm:why the trailing blank line is what separates a header from narration glued to the first statement (§4.1)
function moduleHeader(lines, comments, codeLines) {
  let start = 1;
  if (lines[0]?.startsWith('#!')) start = 2;
  while (start <= lines.length && lines[start - 1].trim() === '') start++;

  const first = comments.find((c) => c.line === start);
  if (!first) return null;

  let end = first.endLine;
  for (;;) {
    const next = comments.find((c) => c.line === end + 1);
    if (!next) break;
    end = next.endLine;
  }

  if (lines[end] === undefined || lines[end].trim() !== '') return null;
  const firstCode = Math.min(...codeLines, Infinity);
  if (firstCode <= end) return null;

  return { start, end, count: end - start + 1 };
}

function documentsExported(lines, codeLines, fromLine, prof) {
  const next = nextCodeLine(lines, codeLines, fromLine + 1);
  if (!next) return false;
  return prof.exportedDecl?.test(next.text) ?? false;
}

function trunc(s) {
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}
