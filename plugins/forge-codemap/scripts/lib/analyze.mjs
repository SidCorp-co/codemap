// Per-file analysis: comments -> annotations + grammar diagnostics (codemap/1 §7 grammar tier).

import { profileFor, isGenerated } from './languages.mjs';
import { scanComments, nextCodeLine } from './scan.mjs';
import { parseAnnotation, canonical, hasTodo, diag, PROSE_CODES, baselineKey } from './parse.mjs';
import { enforcementFor } from './registry.mjs';

// cm:why a docblock carrying structured tags is machine-consumed, not narration, so it is exempt
const STRUCTURED_DOC = /@(param|returns?|type|template|satisfies|throws|var|property|method|mixin|deprecated|example|see|link|inheritDoc)\b/;

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
      const want = canonical(ann);
      if (text !== want) raw.push({ ...diag('CM009', relPath, c.line, text), canonical: want });
      continue;
    }

    if (prof.exempt.some((re) => re.test(text))) continue;

    if (grammar && hasTodo(text)) {
      raw.push({ ...diag('CM010', relPath, c.line, trunc(text)), text });
      continue;
    }

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

  return {
    annotations,
    diags,
    proseKeys: [...new Set(diags.filter((d) => PROSE_CODES.has(d.code)).map((d) => baselineKey(d.text ?? d.message)))],
    skipped: null,
  };
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
