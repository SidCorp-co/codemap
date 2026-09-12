// codemap/1 §9 — the golden corpus. Source snippet in, diagnostics and graph out.
// Changing the grammar without updating these fails CI; this is the spec's own test suite.

export const analyzeCases = [
  {
    name: 'ts: prose in an annotated block is sited, so the baseline cannot spare it (§8)',
    file: 'sited.ts',
    src: [
      '// Load the config',
      '// cm:guard callers must hold the run lock',
      'function f() {}',
      '',
      '// unrelated narration far from any annotation',
      'function g() {}',
    ].join('\n'),
    codes: ['CM001', 'CM001'],
    annotations: ['guard'],
    sited: [1],
    // cm:why BOTH keys — siting decides what is REPORTED, never what the baseline knows exists
    // (lib/analyze.mjs header has what excluding the sited one cost)
    proseKeyCount: 2,
  },
  {
    name: 'ts: an annotation may wrap onto one line, and only one (§4)',
    file: 'wrap.ts',
    src: [
      '// cm:why the retry budget is per-run because a per-attempt one lets a flapping step spend it all',
      '// and the dispatcher cannot tell that apart from genuine progress',
      '// a third line is prose again',
      'const r = 1;',
    ].join('\n'),
    codes: ['CM001', 'CM204'],
    annotations: ['why'],
    sited: [3],
    texts: ['the retry budget is per-run because a per-attempt one lets a flapping step spend it all'
      + ' and the dispatcher cannot tell that apart from genuine progress'],
  },
  {
    // cm:why the wrap must reach a QUERY without reaching canonical(): joining it into `text` makes every
    // wrapped annotation a CM009 whose --fix duplicates the wrap onto line one (§4, ISS-3)
    name: 'ts: a wrapped annotation is carried whole and is still canonical',
    file: 'wrap-canonical.ts',
    src: [
      '// cm:guard the run lock is held for the whole batch, never per row —',
      '// releasing between rows lets a second dispatcher claim the tail of this one',
      'function f() {}',
    ].join('\n'),
    codes: [],
    annotations: ['guard'],
    texts: ['the run lock is held for the whole batch, never per row —'
      + ' releasing between rows lets a second dispatcher claim the tail of this one'],
  },
  {
    name: 'ts: a malformed annotation keeps its wrap, so one mistake is one diagnostic (ISS-6)',
    file: 'wrap-malformed.ts',
    src: [
      '// cm:edge lockstep -> packages/core/refs.ts writes these refs; the',
      '// provenance gate allows them through via this predicate',
      'const x = 1;',
    ].join('\n'),
    codes: ['CM012'],
    annotations: [],
    fixMatches: /put " — " before the rationale/,
  },
  {
    name: 'edge: a target followed by prose AFTER a separator is still CM005, not CM012',
    file: 'wrap-separated.ts',
    src: '// cm:edge lockstep -> packages/core/refs.ts and also x.ts — two targets is not a thing',
    codes: ['CM005'],
    annotations: [],
    fixMatches: /use cm:why/,
  },
  {
    // cm:edge lockstep -> cli/lib/analyze.mjs — the ungating this pins is stated there as a guard, and
    //   a change that gates CM204 on `grammar` has to fail a case, not merely contradict a comment
    name: 'ts: CM204 survives grammar: false, and is raised once however far the annotation overflows',
    file: 'wrap-overflow-nogrammar.ts',
    src: [
      '// cm:guard the batch is claimed whole, never row by row',
      '//   because releasing between rows lets a second dispatcher claim the tail',
      '//   and the third line never reaches the channel',
      '//   nor the fourth',
      '//   nor the fifth',
      'const r = 1;',
    ].join('\n'),
    reg: { enforce: { grammar: false } },
    codes: ['CM204'],
    annotations: ['guard'],
    texts: ['the batch is claimed whole, never row by row'
      + ' because releasing between rows lets a second dispatcher claim the tail'],
  },
  {
    // cm:edge lockstep -> cli/lib/analyze.mjs — the adoption branch's FROZEN test is what this pins,
    //   and ISS-22 is the incident that put it there
    name: 'ts: a FROZEN line directly under an annotation is still refused as its wrap',
    file: 'frozen-wrap.ts',
    src: [
      '// cm:guard the batch is claimed whole, never row by row',
      '//   a stranger parked this sentence here',
      '//   and a line below the frozen one, which the refusal must not adopt either',
      'const r = 1;',
    ].join('\n'),
    frozen: ['a stranger parked this sentence here'],
    codes: ['CM001', 'CM001'],
    annotations: ['guard'],
    texts: ['the batch is claimed whole, never row by row'],
  },
  {
    // cm:guard the frozen line sits BELOW a legal wrap here — the position the adoption branch never
    //   reaches, where counting it would bill a stranger's sentence as the annotation's lost tail
    name: 'ts: a FROZEN line below a legal wrap ends the run rather than counting as overflow',
    file: 'frozen-overflow.ts',
    src: [
      '// cm:guard the batch is claimed whole, never row by row',
      '//   because releasing between rows lets a second dispatcher claim the tail',
      '//   a stranger parked this sentence here',
      'const r = 1;',
    ].join('\n'),
    frozen: ['a stranger parked this sentence here'],
    codes: ['CM001'],
    annotations: ['guard'],
    texts: ['the batch is claimed whole, never row by row'
      + ' because releasing between rows lets a second dispatcher claim the tail'],
  },
  {
    // cm:edge lockstep -> cli/lib/analyze.mjs — the exempt branch's run-through is what this pins, and
    //   a directive that ends the run again has to fail a case rather than only contradict a comment
    name: 'ts: a lint directive carries the overflow run through it and is not itself billed',
    file: 'wrap-exempt-run.ts',
    src: [
      '// cm:guard the batch is claimed whole, never row by row',
      '//   because releasing between rows lets a second dispatcher claim the tail',
      '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
      '//   and this consequence clause never reaches the channel',
      'const r = 1;',
    ].join('\n'),
    reg: { enforce: { grammar: false } },
    codes: ['CM204'],
    annotations: ['guard'],
    texts: ['the batch is claimed whole, never row by row'
      + ' because releasing between rows lets a second dispatcher claim the tail'],
  },
  {
    // cm:guard a directive in the WRAP slot must not hand that slot to the line below it — adopting one
    //   would change what renders, and a truncation diagnostic may only ever add diagnostics (ISS-67)
    name: 'ts: a lint directive in the wrap slot leaves the annotation unwrapped',
    file: 'wrap-exempt-slot.ts',
    src: [
      '// cm:guard the batch is claimed whole, never row by row',
      '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
      '//   because releasing between rows lets a second dispatcher claim the tail',
      '//   and this consequence clause never reaches the channel',
      'const r = 1;',
    ].join('\n'),
    reg: { enforce: { grammar: false } },
    codes: ['CM204'],
    annotations: ['guard'],
    texts: ['the batch is claimed whole, never row by row'],
  },
  {
    name: 'ts: an annotation wrapping onto exactly one line draws no CM204',
    file: 'wrap-fits.ts',
    src: [
      '// cm:guard the batch is claimed whole, never row by row',
      '//   because releasing between rows lets a second dispatcher claim the tail',
      'const r = 1;',
    ].join('\n'),
    reg: { enforce: { grammar: false } },
    codes: [],
    annotations: ['guard'],
  },
  {
    // cm:guard php is the profile that makes this reachable — it carries `//` and `#` as two LINE
    //   leaders, so dropping the same-leader test here has to fail a case rather than pass silently
    name: 'php: a continuation under a different LINE leader is not part of the run, so no CM204',
    file: 'leader-run.php',
    src: [
      '<?php',
      '// cm:guard the batch is claimed whole, never row by row',
      '//   because releasing between rows lets a second dispatcher claim the tail',
      '#   a different leader, so this is prose rather than the annotation running on',
      '$r = 1;',
    ].join('\n'),
    codes: [],
    annotations: ['guard'],
    texts: ['the batch is claimed whole, never row by row'
      + ' because releasing between rows lets a second dispatcher claim the tail'],
  },
  {
    // cm:guard this pins `firstOnLine` at the OVERFLOW position — `trailing.ts` pins it at the wrap,
    //   so without this a trailing comment counts as the annotation running on and nothing fails
    name: 'ts: a trailing comment below the wrap is not the annotation overflowing',
    file: 'wrap-overflow-trailing.ts',
    src: [
      '// cm:guard the batch is claimed whole, never row by row',
      '//   because releasing between rows lets a second dispatcher claim the tail',
      'const r = 1; //   a trailing comment, not a standalone line',
    ].join('\n'),
    reg: { enforce: { grammar: false } },
    codes: [],
    annotations: ['guard'],
  },
  {
    name: 'ts: a block comment under the wrap ends the run, so it draws no CM204',
    file: 'wrap-overflow-leader.ts',
    src: [
      '// cm:guard the batch is claimed whole, never row by row',
      '//   because releasing between rows lets a second dispatcher claim the tail',
      '/* narration in a block comment */',
      'const r = 1;',
    ].join('\n'),
    codes: ['CM001'],
    annotations: ['guard'],
  },
  {
    name: 'ts: a wrapped line under a DIFFERENT leader is not a continuation',
    file: 'wrap-leader.ts',
    src: [
      '// cm:why the retry budget is per-run, not per-attempt',
      '/* narration in a block comment */',
      'const r = 1;',
    ].join('\n'),
    codes: ['CM001'],
    annotations: ['why'],
  },
  {
    name: 'ts: a blank line ends the block, so prose below it is not sited',
    file: 'gap.ts',
    src: [
      '// cm:guard callers must hold the run lock',
      '',
      '// Load the config',
      'function f() {}',
    ].join('\n'),
    codes: ['CM001'],
    annotations: ['guard'],
    sited: [],
  },
  {
    name: 'ts: a trailing comment on a code line is not part of the block above it',
    file: 'trailing.ts',
    src: [
      '// cm:guard callers must hold the run lock',
      'function f() {} // Load the config',
    ].join('\n'),
    codes: ['CM001'],
    annotations: ['guard'],
    sited: [],
  },
  {
    name: 'ts: a TODO glued to an annotation is sited too',
    file: 'sited-todo.ts',
    src: [
      '// cm:why the retry budget is per-run, not per-attempt',
      '// TODO tune the ceiling',
      'const r = 1;',
    ].join('\n'),
    codes: ['CM010'],
    annotations: ['why'],
    sited: [2],
    proseKeyCount: 1,
  },
  {
    // cm:why a URL regex is the everyday shape of this — `/https?:\/\//` ends with an escaped slash
    // against its own closing delimiter, and a false CM001 on real code is how a validator gets switched off
    name: 'ts: an escaped slash in a regex literal is not a comment leader',
    file: 'regex.ts',
    src: [
      'const isUrl = /^https?:\\/\\//.test(u);',
      'const p = /\\.forge\\/codemap\\//;',
      'const ok = 1; // this one really is a comment',
    ].join('\n'),
    codes: ['CM001'],
    annotations: [],
  },
  {
    name: 'ts: prose comment is invalid, pragmas and annotations are not',
    file: 'a.ts',
    src: [
      '// Load the config',
      'const c = load();',
      '// @ts-expect-error upstream types are wrong',
      'const d: number = c;',
      '// cm:guard callers must hold the run lock',
      'function f() {}',
    ].join('\n'),
    codes: ['CM001'],
    annotations: ['guard'],
  },
  {
    name: 'ts: i18n-allow with a reason is exempt, the same directive with no reason is not (ISS-22)',
    file: 'i18n.ts',
    src: [
      "const a = 'điều kiện'; // i18n-allow: Vietnamese fixture",
      "const b = 'điều kiện'; // i18n-allow",
    ].join('\n'),
    codes: ['CM001'],
    annotations: [],
  },
  {
    name: 'ts: comment leader inside a string literal is not a comment',
    file: 'b.ts',
    src: ['const url = "https://example.com/a#b";', "const p = 'a // b';", 'const t = `x // y`;'].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'ts: a bare URL in markup text is code, but a trailing comment after one still counts',
    file: 'b2.tsx',
    src: [
      'const a = <p>Visit https://example.com/a//b#frag for docs</p>;',
      'const b = 1; // cm:why https://example.com/rfc pins this constant',
      'const c = <a>https://x.dev</a>; // Load the config',
    ].join('\n'),
    codes: ['CM001'],
    annotations: ['why'],
  },
  {
    name: 'ts: a colon that is not a known scheme still opens a comment',
    file: 'b4.ts',
    src: [
      'const t = a?b:c// Load the config',
      'const o = { key://cm:guard callers must hold the run lock',
      '  1 };',
    ].join('\n'),
    codes: ['CM001'],
    annotations: ['guard'],
  },
  {
    name: 'yaml: a #fragment inside a bare URL is not a comment',
    file: 'b3.yaml',
    src: ['url: https://example.com#frag', 'other: 1 # a real comment'].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'ts: annotation inside a doc comment is CM003',
    file: 'c.ts',
    src: ['/**', ' * cm:guard must not live in a docblock', ' */', 'function f() {}'].join('\n'),
    codes: ['CM003'],
    annotations: [],
  },
  {
    name: 'ts: a /** */ block is documentation; a /* */ block and // prose are not',
    file: 'd.ts',
    src: [
      '/** Returns the config. */',
      'export function a() {}',
      '/** @param x the thing */',
      'export function b(x) {}',
      '/** Internal helper that does the thing. */',
      'function c() {}',
      '/** @param x on an interface member */',
      'export interface I { x: number }',
      '/* not a doc block, just prose */',
      'export function d() {}',
    ].join('\n'),
    codes: ['CM001'],
    annotations: [],
  },
  {
    // cm:why 3036 blocks / 5925 lines in one Go repo, the largest single bucket measured — godoc renders a
    // field's doc exactly as a package-level one, so the policy was flagging what the ecosystem requires
    name: 'go: a field and a method of an exported type are exempt, like the type itself (§6)',
    file: 'thing.go',
    src: [
      '// Thing is a thing.',
      'type Thing struct {',
      '\t// Name is the display name shown to the user.',
      '\tName string',
      '\t// internal is not exported and gets no pass.',
      '\tinternal string',
      '}',
      '',
      '// Doer does.',
      'type Doer interface {',
      '\t// Do performs the action.',
      '\tDo() error',
      '}',
      '',
      '// Status codes.',
      'const (',
      '\t// StatusOK is fine.',
      '\tStatusOK = 1',
      ')',
    ].join('\n'),
    codes: ['CM001'],
    annotations: [],
  },
  {
    // cm:guard capitalisation ALONE would exempt this — a same-package exported call inside a body reads
    // exactly like an interface method, and this bucket (1628 blocks measured) is the policy's whole point
    name: 'go: narration above a capitalised call in a function body is still CM001',
    file: 'body.go',
    src: [
      '// Run runs.',
      'func Run() {',
      '\t// first we do the thing, then we do the other thing',
      '\tDoThing()',
      '}',
      '',
      'type thing struct {',
      '\t// a field of an UNEXPORTED type is not godoc',
      '\tName string',
      '}',
    ].join('\n'),
    codes: ['CM001', 'CM001'],
    annotations: [],
  },
  {
    name: 'non-canonical form is CM009 and carries its fix',
    file: 'e.ts',
    src: '// cm:edge contract->packages/core/x.ts - both sides share the token',
    codes: ['CM009'],
    annotations: ['edge'],
    canonical: 'cm:edge contract -> packages/core/x.ts — both sides share the token',
  },
  {
    name: 'edge: unknown kind, absolute target, missing arrow',
    file: 'f.ts',
    src: [
      '// cm:edge magic -> a/b.ts — nope',
      '// cm:edge contract -> /abs/path.ts — nope',
      '// cm:edge contract a/b.ts — nope',
    ].join('\n'),
    codes: ['CM004', 'CM005', 'CM005'],
    annotations: [],
  },
  {
    // cm:why the grammar tier is the edit hook, so a target the author can still see on screen is
    // rejected there — as a referential CM102 it arrived weeks later, in CI, for someone else (ISS-5)
    name: 'edge: a source-relative target is rejected by the grammar tier, not by CI',
    file: 'apps/web/src/f.ts',
    src: [
      '// cm:edge contract -> ../api/src/routes/thing.ts — the sibling app',
      '// cm:edge contract -> ./sibling.ts — same directory',
    ].join('\n'),
    codes: ['CM005', 'CM005'],
    annotations: [],
    fixMatches: /cm fmt rewrites a \.\.\/ target that resolves/,
  },
  {
    // cm:why the target of a migration's original codebase is not in the tree, so it was the one coupling
    // that had to stay prose — 354 comments in one repo were carrying it that way (ISS-11)
    name: 'edge: an external target parses, and its shape is still checked',
    file: 'x.ts',
    src: [
      '// cm:edge contract -> external:laravel-app/App/Models/Quote.php — mirrors the original model',
      '// cm:edge contract -> external:laravel-app — a name with no path inside it',
      '// cm:edge contract -> external:LaravelApp/x.php — a name that is not registry-shaped',
    ].join('\n'),
    codes: ['CM005', 'CM005'],
    annotations: ['edge'],
    fixMatches: /cm new external <name>/,
  },
  {
    name: 'flow: needs flow/step, rejects unknown tokens',
    file: 'g.ts',
    src: [
      '// cm:flow job-dispatch — missing the step',
      '// cm:flow job-dispatch/claim-row after:pick-runner — ok',
      '// cm:flow job-dispatch/next order:2 — bad token',
    ].join('\n'),
    codes: ['CM006', 'CM006'],
    annotations: ['flow'],
  },
  {
    name: 'hack: needs issue, until: and text',
    file: 'h.ts',
    src: [
      '// cm:hack ISS-712 — no exit condition',
      '// cm:hack ISS-712 until:core ships ws ack — poll instead of listening',
    ].join('\n'),
    codes: ['CM007'],
    annotations: ['hack'],
  },
  {
    name: 'unknown tag and empty body',
    file: 'i.ts',
    src: ['// cm:note something', '// cm:guard'].join('\n'),
    codes: ['CM002', 'CM008'],
    annotations: [],
  },
  // cm:why the guard's text stays truncated on purpose: a cm: line is itself an annotation attempt, so
  //   it cannot be the wrap, and the remedy is the CM002 raised on it rather than a wrap (§4, ISS-38)
  {
    name: 'a cm: prefix with no parseable tag is a malformed annotation, never a dropped line (§4)',
    file: 'untagged.ts',
    src: [
      '// cm:guard callers must hold the run lock before',
      '//   cm: the words that moved into a tag are still in the file',
      '// cm: bare prose after the colon',
      '// cm:Guard an upper-case tag never matched the recognizer',
      '// cm:123 a digit never matched it either',
      '// cm:',
      'const a = 1;',
      '// cm: a wrapped line with ordinary narration under it',
      '// an ordinary narration line right below it',
      'const b = 2;',
    ].join('\n'),
    codes: ['CM002', 'CM002', 'CM002', 'CM002', 'CM002', 'CM002'],
    annotations: ['guard'],
    texts: ['callers must hold the run lock before'],
    proseKeyCount: 0,
  },
  {
    name: 'TODO is CM010, not a comment violation',
    file: 'j.ts',
    src: '// TODO: wire the retry',
    codes: ['CM010'],
    annotations: [],
  },
  {
    name: 'cm:ignore on the line above suppresses that code only',
    file: 'k.ts',
    src: [
      '// cm:ignore CM001 — frozen vendor snippet',
      '// Load the config',
      '// Load it again',
    ].join('\n'),
    codes: ['CM001'],
    annotations: [],
  },
  {
    name: 'cm:ignore without a code and reason is itself invalid',
    file: 'l.ts',
    src: '// cm:ignore',
    codes: ['CM008'],
    annotations: [],
  },

  {
    name: 'module header: first comment run followed by a blank line is exempt',
    file: 'hdr1.ts',
    src: [
      '// Dispatch gates.',
      '// Every gate must be cheap enough to run on every dispatch tick.',
      '',
      'export function gate() {}',
    ].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'module header: narration glued to the first statement is not a header',
    file: 'hdr2.ts',
    src: ['// Load the config', 'const c = load();'].join('\n'),
    codes: ['CM001'],
    annotations: [],
  },
  {
    name: 'module header: allowed after a shebang',
    file: 'hdr3.mjs',
    src: ['#!/usr/bin/env node', '// One-shot migration runner.', '', 'run();'].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'module header: over the cap is CM011',
    file: 'hdr4.ts',
    src: [...Array.from({ length: 21 }, (_, i) => `// line ${i + 1}`), '', 'run();'].join('\n'),
    codes: ['CM011'],
    annotations: [],
  },
  {
    // cm:guard keep BOTH the header line and a length over the engine's argument limit (~125k on
    //   node 22, less the deeper the stack) — trimming either lets this pass with the spread restored
    name: 'module header: a source with more code lines than the argument limit is still analyzed (ISS-43)',
    file: 'hdr-huge.ts',
    src: ['// One-shot migration runner.', '', ...Array.from({ length: 200000 }, () => 'run();')].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    // cm:guard this is the case that pins `firstCode <= end`, which the huge-source case above leaves
    //   dead — a firstCode stuck at Infinity makes this trailing comment a module header and loses CM001
    name: 'module header: a comment trailing the first code line is not a header (ISS-43)',
    file: 'hdr-trailing.ts',
    src: ['run(); // a trailing note on the first line of code', '', 'more();'].join('\n'),
    codes: ['CM001'],
    annotations: [],
  },
  {
    name: 'module header: allowed after a "use client" directive prologue (§4.1)',
    file: 'hdr5.tsx',
    src: [
      '"use client";',
      '',
      '// Agent MCP servers panel. Renders what the dispatch-time resolvers inject.',
      '',
      'export function Panel() {}',
    ].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'module header: the prologue is a closed vocabulary, not any string statement',
    file: 'hdr6.ts',
    src: ['"side effect";', '', '// Load the config', '', 'run();'].join('\n'),
    codes: ['CM001'],
    annotations: [],
  },
  {
    name: 'module header: over the cap after a prologue is still CM011',
    file: 'hdr7.tsx',
    src: [
      "'use strict';",
      '',
      ...Array.from({ length: 21 }, (_, i) => `// line ${i + 1}`),
      '',
      'run();',
    ].join('\n'),
    codes: ['CM011'],
    annotations: [],
  },
  {
    // cm:why the near-miss must stay REPORTED — exempting it would license narration above the first
    // statement, which is §4.1's whole subject; only the fix line changes
    name: 'module header: a top-of-file run glued to the code is still CM001, with a blank-line fix',
    file: 'hdr8.ts',
    src: ['// Dispatch gates.', '// Cheap enough to run every tick.', 'export function gate() {}'].join('\n'),
    codes: ['CM001', 'CM001'],
    annotations: [],
    fixMatches: /blank line/,
  },
  {
    // cm:why a repo can adopt the graph without the comment discipline (`enforce.grammar: false`), and
    // every prose-family code has to go quiet together or that mode ships surprise header errors
    name: 'enforce.grammar: false silences the whole prose family, never the annotation grammar',
    file: 'graphonly.ts',
    src: [
      ...Array.from({ length: 21 }, (_, i) => `// header line ${i + 1}`),
      '',
      '// plain narration a compiler already knows',
      '// TODO wire the retry',
      '// cm:edge magic -> nowhere.ts — a malformed annotation is still malformed',
      '// cm:guard this one is fine',
      'run();',
    ].join('\n'),
    reg: { enforce: { grammar: false } },
    codes: ['CM004'],
    annotations: ['guard'],
  },

  {
    name: 'go: doc comment above an exported decl is exempt, elsewhere it is not',
    file: 'm.go',
    src: [
      '//go:build linux',
      '',
      '// Package runner claims jobs.',
      'package runner',
      '',
      '// Claim takes the next job.',
      'func Claim() {}',
      '',
      '// helper does things',
      'func helper() {}',
      '',
      'func other() {',
      '\tx := 1 // count of things',
      '\t_ = x',
      '}',
    ].join('\n'),
    codes: ['CM001', 'CM001'],
    annotations: [],
  },
  {
    name: 'go: methods on exported receivers are exempt',
    file: 'n.go',
    src: ['// Run starts the loop.', 'func (r *Runner) Run() {}'].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'php: docblocks and prose are allowed, annotations still parse',
    file: 'o.php',
    src: [
      '<?php',
      '/** @param int $x */',
      '// a plain note, allowed in php',
      '# cm:guard tenant scope must be applied before this query',
      'function f($x) {}',
    ].join('\n'),
    codes: [],
    annotations: ['guard'],
  },
  {
    name: 'python: docstring is a string not a comment; pragmas exempt; # leader annotates',
    file: 'p.py',
    src: [
      'def f():',
      '    """Docstring mentioning # not a comment."""',
      '    x = 1  # noqa',
      '    # cm:edge sideeffect -> app/jobs/worker.py — enqueues out of process',
      '    return x',
    ].join('\n'),
    codes: [],
    annotations: ['edge'],
  },
  {
    name: 'rust: /// docs and SAFETY are exempt; lifetimes do not desync the scanner',
    file: 'q.rs',
    src: [
      '/// Claims a job.',
      'pub fn claim<\'a>(s: &\'a str) -> &\'a str {',
      '    // SAFETY: pointer is checked above',
      '    // cm:edge contract -> packages/core/src/pipeline/failure-classifier.ts — token must match',
      '    s',
      '}',
    ].join('\n'),
    codes: [],
    annotations: ['edge'],
  },
  {
    name: 'sql: enforcement off, annotations still collected',
    file: 'r.sql',
    src: [
      '-- plain migration note, fine',
      '--> statement-breakpoint',
      '-- cm:edge sideeffect -> packages/core/src/jobs/dispatch-gates.ts — trigger cancels rows this reads',
      'CREATE TRIGGER t AFTER UPDATE ON jobs EXECUTE FUNCTION f();',
    ].join('\n'),
    codes: [],
    annotations: ['edge'],
  },
  {
    name: 'generated files are skipped entirely',
    file: 's.go',
    src: ['// Code generated by protoc. DO NOT EDIT.', '', '// noise everywhere', 'func x() {}'].join('\n'),
    codes: [],
    annotations: [],
    skipped: 'generated',
  },
  {
    name: 'a marker quoted in a regex or a string literal does not skip the file (ISS-26)',
    file: 'markers.ts',
    src: [
      'const MARKERS = [',
      '  /^@generated\\b/,',
      "  '**/_ide_helper*',",
      '  /AUTO-GENERATED/,',
      '];',
      '// cm:guard the list is the authority; nothing may restate it',
      'export const m = MARKERS;',
    ].join('\n'),
    codes: [],
    annotations: ['guard'],
  },
  {
    name: 'a marker in a header line comment still skips the file (ISS-26)',
    file: 'vendored.ts',
    src: [
      '// @generated codemap 0.0.0 — vendored by `cm install`; edit the plugin, not this.',
      '// cm:guard this annotation belongs to the tool, never to the project scanning it',
      'export const v = 1;',
    ].join('\n'),
    codes: [],
    annotations: [],
    skipped: 'generated',
  },
  {
    name: 'a marker in a comment below the head window does not skip the file (ISS-26)',
    file: 'late.ts',
    src: [...Array(41).fill('export const filler = 1;'),
      '// @generated but far too late to be this file\'s header',
      '// cm:why the window is what makes a marker a header rather than a mention',
      'export const l = 1;'].join('\n'),
    codes: [],
    annotations: ['why'],
  },
  {
    name: 'a marker far below the window does not skip via a block opened inside it (ISS-26)',
    file: 'commented-out.ts',
    src: ['/*', ...Array(400).fill(' * const MARKERS = ['), ' * @generated', ' */',
      '// cm:guard commenting out code that quotes a marker must not hide this file',
      'export const c = 1;'].join('\n'),
    codes: ['CM001'],
    annotations: ['guard'],
  },
  {
    name: 'a generated header block closing past the window still skips the file (ISS-26)',
    file: 'licensed.ts',
    src: ['/*', ' * Code generated by protoc-gen-go. DO NOT EDIT.',
      ...Array(60).fill(' * a long license nobody reads'), ' */',
      '// cm:guard this belongs to the generator, never to the project',
      'export const g = 1;'].join('\n'),
    codes: [],
    annotations: [],
    skipped: 'generated',
  },
  {
    name: 'a marker split across two lines of one block header still skips the file (ISS-26)',
    file: 'split.ts',
    src: ['/*', ' * Code generated by protoc-gen-go.', ' * DO NOT EDIT.', ' */',
      '// cm:why the window is re-joined, so a marker may span the lines of one header',
      'export const s = 1;'].join('\n'),
    codes: [],
    annotations: [],
    skipped: 'generated',
  },
  {
    name: 'sfc: a generated .vue marked in an HTML comment is skipped (ISS-28)',
    file: 'gen.vue',
    src: [
      '<!-- @generated by codegen; do not edit -->',
      '<template><div/></template>',
    ].join('\n'),
    codes: [],
    annotations: [],
    skipped: 'generated',
  },
  {
    name: 'sfc: a generated .svelte marked in an HTML comment is skipped, as .vue is (ISS-28)',
    file: 'gen.svelte',
    src: [
      '<!-- Code generated by svelte-kit. DO NOT EDIT. -->',
      '<div/>',
    ].join('\n'),
    codes: [],
    annotations: [],
    skipped: 'generated',
  },
  {
    name: 'sfc: prose in an SFC template HTML comment is not billed as prose (ISS-28)',
    file: 'ordinary.vue',
    src: [
      '<template>',
      '  <!-- the sidebar collapses below the medium breakpoint -->',
      '  <div/>',
      '</template>',
    ].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'sfc: a Svelte compiler directive in a template raises nothing (ISS-28, ISS-22)',
    file: 'ignore.svelte',
    src: [
      '<!-- svelte-ignore a11y-autofocus -->',
      '<input autofocus/>',
    ].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'sfc: an SFC template comment is exempt by FORM, so any text in one is (ISS-28)',
    file: 'anytext.vue',
    src: [
      '<template>',
      '  <!-- @migration-task check this before release -->',
      '  <div/>',
      '</template>',
    ].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'sfc: script-block prose is still CM001 — only the HTML form is exempt (ISS-28)',
    file: 'scriptprose.vue',
    src: [
      '<template>',
      '  <!-- this one is free -->',
      '  <div/>',
      '</template>',
      '<script setup lang="ts">',
      '// this one is not',
      'const a = 1;',
      '</script>',
    ].join('\n'),
    codes: ['CM001'],
    annotations: [],
  },
  {
    name: 'sfc: a /* */ block in an SFC script is prose, as it is in ts (ISS-28)',
    file: 'blockprose.vue',
    src: [
      '<script setup lang="ts">',
      '/* narration a compiler already knows */',
      'const a = 1;',
      '</script>',
    ].join('\n'),
    codes: ['CM001'],
    annotations: [],
  },
  {
    name: 'sfc: a /** */ doc block in an SFC script is exempt, as it is in ts (ISS-28)',
    file: 'docblock.vue',
    src: [
      '<script setup lang="ts">',
      '/** the shape the parent passes down */',
      'export type P = { id: string };',
      '</script>',
    ].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'sfc: a TS pragma is exempt in an SFC script, as it is in ts (ISS-28)',
    file: 'pragma.vue',
    src: [
      '<script setup lang="ts">',
      '// eslint-disable-next-line no-console',
      'console.log(1);',
      '</script>',
    ].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'sfc: a template string delimiter does not desync the scanner (ISS-28)',
    file: 'apostrophe.vue',
    src: [
      '<template>',
      "  <p>It's here</p>",
      '  <div/>',
      '</template>',
      '<script setup lang="ts">',
      '// cm:why the annotation after an apostrophe must still be found',
      'const a = 1;',
      '</script>',
    ].join('\n'),
    codes: [],
    annotations: ['why'],
  },
  {
    name: 'sfc: a comment leader inside an SFC script string is not a comment (ISS-28)',
    file: 'strdelim.vue',
    src: [
      '<script setup lang="ts">',
      'const url = "https://example.com/a#b";',
      "const p = 'a // b';",
      'const t = `x // y`;',
      '</script>',
    ].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'sfc: a long all-HTML header is not billed for length either (ISS-28)',
    file: 'banner.vue',
    src: ['<!--', ...Array(27).fill(' a long licence banner nobody reads'), '-->', '',
      '<template><div/></template>'].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'sfc: a long /* */ header in an SFC script is still CM011 (ISS-28)',
    file: 'banner-script.vue',
    src: ['/*', ...Array(27).fill(' * a long narration header'), '*/', '',
      'export const a = 1;'].join('\n'),
    codes: ['CM011'],
    annotations: [],
  },
  {
    name: 'sfc: a mixed header bills only its billable lines, so exempt lines cannot push it over (ISS-28)',
    file: 'mixed-under.vue',
    src: ['<!--', ...Array(25).fill(' a long licence banner'), '-->', '/*', ' * two billable lines', '*/', '',
      'export const a = 1;'].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    // cm:guard this pins CM011's count to the BILLABLE half of a mixed header — count the whole
    //   span instead, and a 25-line narration behind a short HTML banner goes unreported
    name: 'sfc: a mixed header whose BILLABLE half is over the max is still CM011 (ISS-28)',
    file: 'mixed-over.vue',
    src: ['<!--', ...Array(3).fill(' a short banner'), '-->', '/*', ...Array(23).fill(' * narration'), '*/', '',
      'export const a = 1;'].join('\n'),
    codes: ['CM011'],
    annotations: [],
  },
  {
    name: 'sfc: a generated marker in a /** */ head still skips an SFC (ISS-28)',
    file: 'genblock.vue',
    src: [
      '<script setup lang="ts">',
      '/** @generated by codegen */',
      'const a = 1;',
      '</script>',
    ].join('\n'),
    codes: [],
    annotations: [],
    skipped: 'generated',
  },
  {
    name: 'sfc: an HTML comment in a .ts file is not a comment, so the marker does not skip it (ISS-28)',
    file: 'nothtml.ts',
    src: [
      'const banner = "<!-- @generated -->";',
      '// cm:guard the HTML form belongs to the sfc profile alone, never to ts',
      'export const b = banner;',
    ].join('\n'),
    codes: [],
    annotations: ['guard'],
  },
  {
    name: 'sfc: a marker quoted in an SFC script string does not skip the file (ISS-26 held at sfc)',
    file: 'quoted.vue',
    src: [
      '<script setup lang="ts">',
      'const m = "@generated";',
      '// cm:why the ISS-26 narrowing must hold for every profile, not only ts',
      '</script>',
    ].join('\n'),
    codes: [],
    annotations: ['why'],
  },
  {
    name: 'sfc: a script-block annotation is still read, and script prose is still CM001 (ISS-28)',
    file: 'script.vue',
    src: [
      '<script setup lang="ts">',
      '// cm:why the store is read once at mount, not per render',
      'const a = 1;',
      '// load the config',
      'const b = 2;',
      '</script>',
    ].join('\n'),
    codes: ['CM001'],
    annotations: ['why'],
  },
  {
    name: 'sfc: languages.sfc reaches the sfc profile and languages.ts does not (ISS-28)',
    file: 'knob.vue',
    src: [
      '<script setup lang="ts">',
      '// narration a compiler already knows',
      'const a = 1;',
      '</script>',
    ].join('\n'),
    reg: { languages: { sfc: { docPolicy: 'allowed' } } },
    codes: [],
    annotations: [],
  },
  {
    name: 'sfc: a knob addressed to ts does not reach an SFC (ISS-28)',
    file: 'knob-ts.vue',
    src: [
      '<script setup lang="ts">',
      '// narration a compiler already knows',
      'const a = 1;',
      '</script>',
    ].join('\n'),
    reg: { languages: { ts: { docPolicy: 'allowed' } } },
    codes: ['CM001'],
    annotations: [],
  },
  {
    name: 'docker: a guard in a Dockerfile is read, and the syntax directive is exempt (ISS-25)',
    file: 'Dockerfile',
    src: [
      '# syntax=docker/dockerfile:1',
      '# cm:guard the build stage and the runtime stage must install the same lockfile',
      'FROM node:22',
    ].join('\n'),
    codes: [],
    annotations: ['guard'],
  },
  {
    name: 'docker: a variant name resolves, and prose in one is legal (docPolicy allowed)',
    file: 'Dockerfile.preview',
    src: [
      '# the preview image differs from prod only in its entrypoint',
      '# cm:edge lockstep -> compose.preview.yml — the service name is repeated there',
      'FROM node:22',
    ].join('\n'),
    codes: [],
    annotations: ['edge'],
  },
  {
    name: 'docker: <variant>.Dockerfile resolves too',
    file: 'prod.Dockerfile',
    src: ['# cm:guard the runtime image installs no build toolchain', 'FROM node:22'].join('\n'),
    codes: [],
    annotations: ['guard'],
  },
  {
    // cm:why a fenced example under a `#` leader would otherwise enter the graph as a real guard,
    //   which is a false edge — the one failure direction the scanner may not have (ISS-25)
    name: 'docker: a Dockerfile.md is documentation and is never scanned',
    file: 'Dockerfile.md',
    src: [
      '# How to build this image',
      '',
      '    # cm:guard this is an example, not a declaration',
    ].join('\n'),
    codes: [],
    annotations: [],
    skipped: 'no-profile',
  },
  {
    name: 'ts: a block comment that never closes is reported at its opener (§6)',
    file: 'unterminated.ts',
    src: [
      'const a = 1;',
      '/* oops unterminated',
      'const b = 2;',
      '// cm:guard this must never be lost',
      'const c = 3;',
    ].join('\n'),
    codes: ['CM203'],
    annotations: [],
  },
  {
    // cm:edge lockstep -> spec/SPEC.md — §6 states this reach as the profile's one consumer-visible
    //   cost, and a change that silences it has to fail a case rather than merely outdate the prose
    name: 'sfc: a cm: annotation in a template HTML comment is CM003 and is not read (ISS-28)',
    file: 'tmpl-annotation.vue',
    src: [
      '<template>',
      '  <!-- cm:edge contract -> src/bus.ts \u2014 the topic string both sides spell -->',
      '  <div/>',
      '</template>',
    ].join('\n'),
    codes: ['CM003'],
    annotations: [],
  },
  {
    name: 'sfc: a template CM003 survives grammar: false, as losing an annotation is not prose (ISS-28)',
    file: 'tmpl-annotation-nogrammar.vue',
    src: [
      '<template>',
      '  <!-- cm:guard this must never be lost -->',
      '  <div/>',
      '</template>',
    ].join('\n'),
    reg: { enforce: { grammar: false } },
    codes: ['CM003'],
    annotations: [],
  },
  {
    name: 'sfc: an unclosed HTML comment is reported the same way as an unclosed /* (§6)',
    file: 'unterminated.vue',
    src: [
      '<template>',
      '<!-- oops unterminated',
      '</template>',
      '<script>',
      '// cm:guard this must never be lost',
      'const c = 3;',
      '</script>',
    ].join('\n'),
    codes: ['CM203'],
    annotations: [],
  },
  {
    // cm:edge lockstep -> cli/lib/analyze.mjs — the ungating this pins is stated there as a guard, and
    //   a change that gates CM203 on `grammar` has to fail a case, not merely contradict a comment
    name: 'ts: CM203 survives grammar: false, because losing annotations is not a prose matter',
    file: 'unterminated-nogrammar.ts',
    src: [
      '// narration that grammar: false spares',
      '/* oops unterminated',
      '// cm:guard this must never be lost',
      'const c = 3;',
    ].join('\n'),
    reg: { enforce: { grammar: false } },
    codes: ['CM203'],
    annotations: [],
  },
  {
    // cm:guard CM203's fix line offers this escape, so it has to work from the position the convention
    //   puts it in: a heredoc or raw-string opener has nothing to close, and §6 models neither (ISS-31)
    name: 'ts: cm:ignore CM203 above the opener silences it',
    file: 'unterminated-ignored.ts',
    src: [
      'const a = 1;',
      '// cm:ignore CM203 — the opener is heredoc content, not a comment',
      '/* not really an opener',
      'const b = 2;',
    ].join('\n'),
    codes: [],
    annotations: [],
  },
  {
    name: 'ts: a block comment that closes reports no CM203, and what is below it is read',
    file: 'terminated.ts',
    src: [
      '/* a closed block */',
      '// cm:guard this is read',
      'const c = 3;',
    ].join('\n'),
    codes: ['CM001'],
    annotations: ['guard'],
  },
  {
    // cm:guard the annotation and the expansion must be in ONE case — the analyzer is what the hook
    //   runs, and a narrowing that reached scan.mjs alone could still lose the guard here (ISS-61)
    name: 'sh: an annotation is read, and the parameter expansion under it opens no comment (ISS-61)',
    file: 'deploy.sh',
    src: [
      '# cm:guard the unit file and this script must name the same listen port',
      'set -- ${f#cm:guard this text is code and must never be adopted as a second annotation}',
      'exec ./run "$@"',
    ].join('\n'),
    codes: [],
    annotations: ['guard'],
  },
];

export const baselineCases = [
  { name: 'identical text hashes identically', a: 'Load the config', b: 'Load the config', same: true },
  { name: 'whitespace is normalized away', a: '  Load   the config ', b: 'Load the config', same: true },
  { name: 'different text hashes differently', a: 'Load the config', b: 'Load the cache', same: false },
  { name: 'a one-character change is detected', a: 'retry once', b: 'retry twice', same: false },
];

export const parseCases = [
  {
    name: 'parse: text that never began cm: is not an annotation attempt',
    text: 'ordinary narration about the loop below',
    result: null,
  },
  {
    name: 'parse: a cm: prefix with no readable tag is an attempt, and is CM002',
    text: 'cm: the words that moved into a tag are still in the file',
    codes: ['CM002'],
  },
  {
    name: 'parse: a readable tag outside the five is CM002 as well',
    text: 'cm:note something',
    codes: ['CM002'],
  },
  {
    name: 'parse: a known tag carrying a body is an annotation',
    text: 'cm:guard callers must hold the run lock',
    tag: 'guard',
  },
];

// cm:why CM013's exemption for reflow IS this identity — a formatter run or a rewrap must leave it
//   untouched, and only a change to what the file DOES may move it (SPEC.md §8)
export const codeShapeCases = [
  {
    name: 'codeShape: rewrapping a comment run does not move it',
    a: '// one long sentence of narration that was written on a single line\nexport const a = 1;\n',
    b: '// one long sentence of narration that\n// was written on a single line\nexport const a = 1;\n',
    same: true,
  },
  {
    name: 'codeShape: deleting a comment does not move it either',
    a: '// narration\nexport const a = 1;\n',
    b: 'export const a = 1;\n',
    same: true,
  },
  {
    name: 'codeShape: reindenting and reblanking code does not move it',
    a: 'export function f() {\n  return 1;\n}\n',
    b: 'export function f() {\n\n        return 1;\n\n}\n',
    same: true,
  },
  {
    name: 'codeShape: a one-character change to the code moves it',
    a: 'export const a = 1;\n',
    b: 'export const a = 2;\n',
    same: false,
  },
  {
    name: 'codeShape: a trailing comment is cut at its leader, and its line of code is kept',
    a: 'export const a = 1; // why one\n',
    b: 'export const a = 1; // a completely different remark\n',
    same: true,
  },
  {
    name: 'codeShape: cutting a trailing comment must not take the code with it',
    a: 'export const a = 1; // why one\n',
    b: 'export const b = 1; // why one\n',
    same: false,
  },
  {
    name: 'codeShape: a leader inside a string literal is code, not a comment',
    a: 'export const u = "https://example.com/a";\n',
    b: 'export const u = "https://example.com/b";\n',
    same: false,
  },
];

export const graphCases = [
  {
    name: 'flow ordering follows after:, not declaration order',
    files: [
      { relPath: 'c.ts', annotations: [{ tag: 'flow', flow: 'f', step: 'three', after: 'two', file: 'c.ts', line: 1 }] },
      { relPath: 'a.ts', annotations: [{ tag: 'flow', flow: 'f', step: 'one', after: null, file: 'a.ts', line: 1 }] },
      { relPath: 'b.ts', annotations: [{ tag: 'flow', flow: 'f', step: 'two', after: 'one', file: 'b.ts', line: 1 }] },
    ],
    flows: [{ name: 'f' }],
    order: ['one', 'two', 'three'],
    codes: [],
  },
  {
    name: 'undeclared flow is CM101',
    files: [{ relPath: 'a.ts', annotations: [
      { tag: 'flow', flow: 'ghost', step: 'one', after: null, file: 'a.ts', line: 1 },
      { tag: 'flow', flow: 'ghost', step: 'two', after: 'one', file: 'a.ts', line: 2 },
    ] }],
    flows: [],
    codes: ['CM101'],
  },
  {
    name: 'dangling edge target is CM102',
    files: [{ relPath: 'a.ts', annotations: [
      { tag: 'edge', kind: 'contract', target: 'spec/SPEC.md', file: 'a.ts', line: 1 },
      { tag: 'edge', kind: 'contract', target: 'does/not/exist.ts', file: 'a.ts', line: 2 },
    ] }],
    flows: [],
    codes: ['CM102'],
  },
  {
    // cm:why 110 of one production repo's 186 edges carry an anchor, so without this the majority of the
    // edge layer was verified no further than "the file still exists" (ISS-4)
    name: 'an anchor that is not in the target is CM106, and a live one is green',
    files: [{ relPath: 'a.ts', annotations: [
      { tag: 'edge', kind: 'contract', target: 'cli/lib/parse.mjs#parseAnnotation', file: 'a.ts', line: 1 },
      { tag: 'edge', kind: 'contract', target: 'cli/lib/parse.mjs#thisSymbolMovedAway', file: 'a.ts', line: 2 },
    ] }],
    flows: [],
    codes: ['CM106'],
  },
  {
    name: 'an anchor is matched on its first dot-segment, and never as a substring',
    files: [{ relPath: 'a.ts', annotations: [
      { tag: 'edge', kind: 'contract', target: 'cli/lib/parse.mjs#PROSE_CODES.has', file: 'a.ts', line: 1 },
      { tag: 'edge', kind: 'contract', target: 'cli/lib/parse.mjs#arseAnnotatio', file: 'a.ts', line: 2 },
    ] }],
    flows: [],
    codes: ['CM106'],
  },
  {
    name: 'an undeclared external is CM107, and a declared one is green with no path check',
    files: [{ relPath: 'a.ts', annotations: [
      { tag: 'edge', kind: 'contract', target: 'external:laravel-app/App/Models/Quote.php', external: 'laravel-app', file: 'a.ts', line: 1 },
      { tag: 'edge', kind: 'contract', target: 'external:laravel-app/nothing/here/at/all.php', external: 'laravel-app', file: 'a.ts', line: 2 },
      { tag: 'edge', kind: 'contract', target: 'external:ghost-app/x.php', external: 'ghost-app', file: 'a.ts', line: 3 },
    ] }],
    flows: [],
    externals: [{ name: 'laravel-app' }],
    codes: ['CM107'],
  },
  {
    name: 'an anchor on a directory target is CM106, not a silent pass',
    files: [{ relPath: 'a.ts', annotations: [
      { tag: 'edge', kind: 'contract', target: 'cli/lib#somewhereInThere', file: 'a.ts', line: 1 },
      { tag: 'edge', kind: 'contract', target: 'cli/lib', file: 'a.ts', line: 2 },
    ] }],
    flows: [],
    codes: ['CM106'],
  },
  {
    name: 'after: pointing nowhere is CM103, duplicate step id is CM105',
    files: [{ relPath: 'a.ts', annotations: [
      { tag: 'flow', flow: 'f', step: 'one', after: null, file: 'a.ts', line: 1 },
      { tag: 'flow', flow: 'f', step: 'one', after: null, file: 'a.ts', line: 2 },
      { tag: 'flow', flow: 'f', step: 'two', after: 'nope', file: 'a.ts', line: 3 },
    ] }],
    flows: [{ name: 'f' }],
    codes: ['CM103', 'CM105', 'CM202'],
  },
  {
    name: 'single-step flow is CM201',
    files: [{ relPath: 'a.ts', annotations: [{ tag: 'flow', flow: 'f', step: 'only', after: null, file: 'a.ts', line: 1 }] }],
    flows: [{ name: 'f' }],
    codes: ['CM201'],
  },
  {
    name: 'two roots is CM202',
    files: [{ relPath: 'a.ts', annotations: [
      { tag: 'flow', flow: 'f', step: 'one', after: null, file: 'a.ts', line: 1 },
      { tag: 'flow', flow: 'f', step: 'two', after: null, file: 'a.ts', line: 2 },
    ] }],
    flows: [{ name: 'f' }],
    codes: ['CM202'],
  },
  {
    name: 'impact unions guards, both edge directions and adjacent flow steps',
    // cm:why targets are real files in the plugin so the referential tier stays silent here
    files: [
      { relPath: 'cli/cm.mjs', annotations: [
        { tag: 'guard', text: 'hold the lock', file: 'cli/cm.mjs', line: 5 },
        { tag: 'flow', flow: 'f', step: 'two', after: 'one', file: 'cli/cm.mjs', line: 6 },
      ] },
      { relPath: 'cli/lib/graph.mjs', annotations: [
        { tag: 'flow', flow: 'f', step: 'one', after: null, file: 'cli/lib/graph.mjs', line: 1 },
        { tag: 'edge', kind: 'contract', target: 'cli/cm.mjs', file: 'cli/lib/graph.mjs', line: 2 },
      ] },
    ],
    flows: [{ name: 'f' }],
    impact: {
      of: 'cli/cm.mjs',
      guards: 1,
      incoming: 1,
      outgoing: 0,
      flowNeighbours: ['one'],
    },
    codes: [],
  },
];
