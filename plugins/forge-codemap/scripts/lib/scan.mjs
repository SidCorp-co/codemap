// Comment scanner. Line-by-line state machine — enough to keep comment leaders inside string
// literals from being mistaken for comments, without pretending to be a real lexer.
//
// Deliberate limitation: heredocs (PHP/shell) and Rust raw strings are not modelled. Both can only
// produce a false-positive prose comment, which an author can silence with an ignore directive —
// never a missed annotation.

function matchLongest(candidates, line, i) {
  let best = null;
  for (const c of candidates) {
    if (line.startsWith(c, i) && (!best || c.length > best.length)) best = c;
  }
  return best;
}

function findUnescaped(line, delim, from) {
  for (let i = from; i < line.length; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line.startsWith(delim, i)) return i;
  }
  return -1;
}

/**
 * @returns {{comments: Array, codeLines: Set<number>}}
 *   comments: { kind: 'line'|'doc'|'block', line, endLine, leader, text, lines, firstOnLine }
 *             line comments also carry { indent, col } — `col` is the 0-based offset of the leader,
 *             which is what lets `cm fmt` rewrite an annotation positionally (see lib/rewrite.mjs)
 *   codeLines: 1-based line numbers that contain code outside comments (used by Go's
 *              required-on-exported policy to find the declaration a comment block documents)
 */
export function scanComments(src, prof) {
  const comments = [];
  const codeLines = new Set();
  const lines = src.split('\n');

  let block = null;
  let str = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    // cm:why a shebang counts as neither code nor comment, else no file with one could have a header
    if (i === 0 && line.startsWith('#!')) continue;
    let j = 0;
    let sawCode = false;

    while (j < line.length) {
      if (block) {
        const k = line.indexOf(block.close, j);
        const seg = k === -1 ? line.slice(j) : line.slice(j, k);
        block.lines.push({ line: lineNo, text: seg.replace(/^\s*\*?\s?/, '').trim() });
        if (k === -1) { j = line.length; break; }
        j = k + block.close.length;
        comments.push({
          kind: block.isDoc ? 'doc' : 'block',
          line: block.startLine,
          endLine: lineNo,
          leader: block.open,
          text: block.lines.map((l) => l.text).filter(Boolean).join(' '),
          lines: block.lines,
          firstOnLine: block.firstOnLine,
        });
        block = null;
        continue;
      }

      if (str) {
        const k = findUnescaped(line, str, j);
        if (k === -1) { j = line.length; break; }
        j = k + str.length;
        str = null;
        sawCode = true;
        codeLines.add(lineNo);
        continue;
      }

      const ch = line[j];
      if (ch === ' ' || ch === '\t') { j++; continue; }

      const leader = matchLongest(prof.lineLeaders, line, j);
      // cm:why regex literals are not lexed, and `/https?:\/\//` ends in an escaped slash against its own
      // closing delimiter — read as a leader, that phantom comment is a CM001 on a line of real code
      if (leader && j > 0 && line[j - 1] === '\\') { j++; continue; }
      if (leader) {
        comments.push({
          kind: prof.docLineLeaders.includes(leader) ? 'doc' : 'line',
          line: lineNo,
          endLine: lineNo,
          leader,
          text: line.slice(j + leader.length).trim(),
          lines: [{ line: lineNo, text: line.slice(j + leader.length).trim() }],
          firstOnLine: !sawCode,
          indent: line.slice(0, j),
          col: j,
        });
        j = line.length;
        break;
      }

      const open = matchLongest(prof.blockOpens.map((b) => b[0]), line, j);
      if (open) {
        const pair = prof.blockOpens.find((b) => b[0] === open);
        block = {
          open,
          close: pair[1],
          isDoc: prof.docBlockOpens.includes(open),
          startLine: lineNo,
          lines: [],
          firstOnLine: !sawCode,
        };
        j += open.length;
        continue;
      }

      const q = matchLongest(prof.strDelims, line, j);
      if (q) {
        const k = findUnescaped(line, q, j + q.length);
        sawCode = true;
        codeLines.add(lineNo);
        if (k === -1) {
          // cm:why only genuinely multi-line delimiters carry state on, so a stray apostrophe in prose cannot desync the rest of the file
          if (prof.multiline.includes(q)) { str = q; }
          j = line.length;
          break;
        }
        j = k + q.length;
        continue;
      }

      sawCode = true;
      codeLines.add(lineNo);
      j++;
    }
  }

  return { comments, codeLines };
}

/** First code line at or after `from`, or null. */
export function nextCodeLine(lines, codeLines, from) {
  for (let n = from; n <= lines.length; n++) {
    if (codeLines.has(n)) return { line: n, text: lines[n - 1].trim() };
  }
  return null;
}
