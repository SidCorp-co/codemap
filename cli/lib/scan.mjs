// Comment scanner. Line-by-line state machine — enough to keep comment leaders inside string
// literals from being mistaken for comments, without pretending to be a real lexer.
//
// A leader is narrowed by the text before it in two ways, both here rather than in any caller: a bare
// URL or a `<scheme>:` prefix (insideUrl), and, where the profile sets `leaderAfter`, a leader that
// must begin a word — `#` in sh, yaml and docker, where `${f#src/}` and `run#now` are one token. py,
// php and toml set none on purpose: in all three `x = 1#c` IS a comment (ISS-61).
//
// Deliberate limitation: heredocs (PHP/shell) and Rust raw strings are not modelled. A comment leader
// inside one reads as a leader. That costs a false-positive prose comment where prose is policed, which
// an author can silence with an ignore directive — and, in the same place, a `cm propose` candidate,
// which they cannot, because propose reads no directives and the loss is silent (ISS-61). A BLOCK
// opener inside one is the exception that is not free: it swallows the rest of the file, and the
// annotations below it are lost rather than merely mis-billed. That is why the discard reports CM203
// instead of passing quietly — the loss is loud, not prevented (ISS-31).

function matchLongest(candidates, line, i) {
  let best = null;
  for (const c of candidates) {
    if (line.startsWith(c, i) && (!best || c.length > best.length)) best = c;
  }
  return best;
}

// cm:why a bare URL outside a string is never lexed, so the `//` in JSX text or a `#fragment` in a
// YAML scalar reads as a leader and turns a line of real code into a phantom CM001
// cm:guard keep the vocabulary closed — an open `[a-z]+:` rule read `{ key://cm:guard … }` as a URL
// and swallowed the annotation silently, the one failure direction this scanner's header forbids
const SCHEMES = new Set([
  'http', 'https', 'ws', 'wss', 'ftp', 'ftps', 'file',
  'git', 'git+ssh', 'git+https', 'ssh', 'svn', 'docker', 'oci', 's3', 'gs',
  'postgres', 'postgresql', 'mysql', 'mongodb', 'mongodb+srv', 'redis', 'rediss', 'amqp', 'amqps',
]);

/** Does `line[..j)` end in `<scheme>:`, i.e. does a URL start at j? */
function schemeEndsAt(line, j) {
  if (line[j - 1] !== ':') return false;
  let k = j - 1;
  while (k > 0 && /[a-z0-9+.-]/i.test(line[k - 1])) k--;
  return SCHEMES.has(line.slice(k, j - 1).toLowerCase());
}

/** Is j inside a bare URL that started earlier on this line? Whitespace ends the URL. */
function insideBareUrl(line, j) {
  let k = j;
  while (k > 0 && !/\s/.test(line[k - 1])) k--;
  const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(line.slice(k, j));
  return !!m && SCHEMES.has(m[1].toLowerCase());
}

function insideUrl(line, j, leader) {
  return insideBareUrl(line, j) || (leader === '//' && schemeEndsAt(line, j));
}

// cm:edge contract -> cli/lib/languages.mjs — `leaderAfter` is a RegExp `.test`ed against the ONE
//   character before the leader, and omitting it keeps the match-anywhere reading .toml needs
/** Where the profile requires a leader to begin a word, does one begin at j? */
function beginsWord(line, j, prof) {
  return !prof.leaderAfter || j === 0 || prof.leaderAfter.test(line[j - 1]);
}

function findUnescaped(line, delim, from) {
  for (let i = from; i < line.length; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line.startsWith(delim, i)) return i;
  }
  return -1;
}

/**
 * @returns {{comments: Array, codeLines: Set<number>, unterminated: ?{line: number, leader: string}}}
 *   comments: { kind: 'line'|'doc'|'block', line, endLine, leader, text, lines, spans, firstOnLine }
 *             line comments also carry { indent, col } — `col` is the 0-based offset of the leader,
 *             which is what lets `cm fmt` rewrite an annotation positionally (see lib/rewrite.mjs)
 *             spans: present ONLY under { spans: true }, undefined otherwise — { line, from, to }
 *             per line the comment occupies, delimiters included, a half-open character range, which
 *             is what lets a caller blank comment text without moving code (see lib/propose.mjs)
 *   codeLines: 1-based line numbers that contain code outside comments (used by Go's
 *              required-on-exported policy to find the declaration a comment block documents)
 *   unterminated: { line, leader, col } — the opener of a block still open at EOF, when it was
 *                 discarded rather than flushed; `col` is where its text starts swallowing the file
 */
// cm:guard flushOpen exists for isGenerated alone, which hands in a truncated head and needs the block
//   still open at the cut; every other caller must leave it false (ISS-26)
// cm:edge contract -> cli/lib/propose.mjs — `spans` is a half-open [from,to) character range per line
//   and codeOnly masks exactly it; a span that excluded its delimiters would leave a literal readable (ISS-59)
// cm:why flushing an unterminated block into the general comment list would turn one missing close
//   delimiter into prose diagnostics down the rest of the file (ISS-26)
export function scanComments(src, prof, { flushOpen = false, spans: wantSpans = false } = {}) {
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
        // cm:guard openCol belongs to the START line only — a block opening at end of line pushes its
        //   first span on the NEXT one, where that column masks from the wrong offset (ISS-59)
        if (wantSpans) {
          block.spans.push({
            line: lineNo,
            from: lineNo === block.startLine ? block.openCol : j,
            to: k === -1 ? line.length : k + block.close.length,
          });
        }
        if (k === -1) { j = line.length; break; }
        j = k + block.close.length;
        comments.push({
          kind: block.isDoc ? 'doc' : 'block',
          line: block.startLine,
          endLine: lineNo,
          leader: block.open,
          text: block.lines.map((l) => l.text).filter(Boolean).join(' '),
          lines: block.lines,
          spans: block.spans,
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
      // cm:why both narrowings share ONE branch and one "treat it as code" path — a second reader of
      //   what a comment is is exactly the divergence between verify and propose that ISS-59 closed
      if (leader && (insideUrl(line, j, leader) || !beginsWord(line, j, prof))) {
        sawCode = true;
        codeLines.add(lineNo);
        j += leader.length;
        continue;
      }
      if (leader) {
        comments.push({
          kind: prof.docLineLeaders.includes(leader) ? 'doc' : 'line',
          line: lineNo,
          endLine: lineNo,
          leader,
          text: line.slice(j + leader.length).trim(),
          lines: [{ line: lineNo, text: line.slice(j + leader.length).trim() }],
          spans: wantSpans ? [{ line: lineNo, from: j, to: line.length }] : undefined,
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
          spans: wantSpans ? [] : undefined,
          openCol: j,
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

    // cm:guard an opener that ENDS its line never reaches the block branch, which runs from the NEXT
    //   line — without this the start line gets no span and its delimiter survives the mask (ISS-59)
    if (wantSpans && block && block.startLine === lineNo && block.spans.length === 0) {
      block.spans.push({ line: lineNo, from: block.openCol, to: line.length });
    }
  }

  let unterminated = null;
  if (block && flushOpen) {
    comments.push({
      kind: block.isDoc ? 'doc' : 'block',
      line: block.startLine,
      endLine: lines.length,
      leader: block.open,
      text: block.lines.map((l) => l.text).filter(Boolean).join(' '),
      lines: block.lines,
      spans: block.spans,
      firstOnLine: block.firstOnLine,
    });
  } else if (block) {
    // cm:guard reported only on the discard path — a block still open at isGenerated's truncated head is
    //   where the cut fell, not a defect, so flushOpen keeps its silence (ISS-31)
    unterminated = { line: block.startLine, leader: block.open, col: block.openCol };
  }

  return { comments, codeLines, unterminated };
}

/** First code line at or after `from`, or null. */
export function nextCodeLine(lines, codeLines, from) {
  for (let n = from; n <= lines.length; n++) {
    if (codeLines.has(n)) return { line: n, text: lines[n - 1].trim() };
  }
  return null;
}
