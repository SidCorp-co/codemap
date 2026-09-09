// cm:edge lockstep -> tests/mutate-lib.mjs — its classification, parsing, containment and scrub are
//   pinned here: a new outcome or a changed parse belongs in the same change as its case (ISS-30)

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  applyMutation, classify, GIT_CONFIG_VAR_NAMES, GIT_IDENTITY_VAR_NAMES, GIT_LOCATION_VAR_NAMES,
  MUTATIONS,
  parseCorpusOutput, stripGitEnv,
} from './mutate-lib.mjs';

const COUNT = (p, f) => `codemap golden corpus: ${p} passed, ${f} failed\n`;

function classifyCases(check) {
  const ran = (p, f) => parseCorpusOutput(COUNT(p, f), '');

  check('mutate: a failing check is pinned',
    classify(ran(650, 3), 653) === 'pinned',
    `expected pinned, got ${classify(ran(650, 3), 653)}`);

  check('mutate: nothing failing on the same total is DEAD',
    classify(ran(653, 0), 653) === 'DEAD',
    `expected DEAD, got ${classify(ran(653, 0), 653)}`);

  // cm:guard this is the false-DEAD case: a tier that disables itself rather than fail reports 0
  //   failed on FEWER checks, and calling that DEAD tells the author to delete working code (ISS-30)
  check('mutate: nothing failing on a smaller total is INCONCLUSIVE, not DEAD',
    classify(ran(653, 0), 654) === 'INCONCLUSIVE',
    `expected INCONCLUSIVE, got ${classify(ran(653, 0), 654)} — a shrunken corpus must never read as a dead mechanism`);

  check('mutate: nothing failing on a larger total is INCONCLUSIVE too',
    classify(ran(655, 0), 654) === 'INCONCLUSIVE',
    'a corpus that grew under mutation has not measured the mechanism either');

  check('mutate: a run with no count line is CRASH',
    classify(parseCorpusOutput('', 'ReferenceError: x is not defined'), 653) === 'CRASH',
    'a corpus that never printed its count line must not be classified from its exit status');

  // cm:guard a crash exits non-zero with nothing failing, so CRASH must outrank the count comparison
  //   or a throw would read as INCONCLUSIVE and lose its diagnosis (ISS-30)
  check('mutate: CRASH outranks a total mismatch',
    classify(parseCorpusOutput('', 'boom'), 654) === 'CRASH',
    'a run with no count line is a crash whatever the control ran');
}

function parseCases(check) {
  const one = parseCorpusOutput(COUNT(651, 2), '');
  check('mutate: the count line is read off stdout',
    one.passed === 651 && one.failed === 2 && one.total === 653,
    `got passed=${one.passed} failed=${one.failed} total=${one.total}`);

  const named = parseCorpusOutput(COUNT(1, 2), '  FAIL first check\n    detail\n  FAIL second check\n');
  check('mutate: every FAIL line is named, not counted',
    JSON.stringify(named.names) === JSON.stringify(['first check', 'second check']),
    `expected both names, got ${JSON.stringify(named.names)} — the count alone is what hid a case in ISS-26`);

  // cm:guard the leader is exactly two spaces, because a failure detail quotes another process
  //   verbatim: a looser one invents a check name nothing raised (ISS-30)
  const phantom = parseCorpusOutput(COUNT(1, 1),
    '  FAIL install: vendors it\n    install said:\n      FAIL not-a-real-check\n');
  check('mutate: an embedded FAIL line in a failure detail is not harvested',
    JSON.stringify(phantom.names) === JSON.stringify(['install: vendors it']),
    `expected only the real check, got ${JSON.stringify(phantom.names)}`);

  check('mutate: a spawn error reaches the diagnosis',
    parseCorpusOutput('', '', 'ETIMEDOUT').diagnosis.includes('ETIMEDOUT'),
    'a timed-out run must say so rather than reporting an empty crash');
}

function anchorCases(check) {
  const dir = mkdtempSync(join(tmpdir(), 'cm-mutate-anchors-'));
  const outside = mkdtempSync(join(tmpdir(), 'cm-mutate-outside-'));
  try {
    const rel = join('lib', 'sample.mjs');
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, rel), 'const a = 1;\nconst b = 2;\nconst a = 3;\n');

    check('mutate: an anchor that is absent is refused',
      /anchor not found/.test(applyMutation(dir, { file: rel, find: 'nowhere in this file', replace: 'x' })),
      'a point whose source moved must say the anchor is gone, not mutate something else');

    // cm:guard an anchor matching twice names no single site, so mutating both would report a
    //   mechanism that no single edit corresponds to (ISS-30)
    check('mutate: an anchor matching more than once is refused',
      /matches 2x/.test(applyMutation(dir, { file: rel, find: 'const a', replace: 'const c' })),
      'an ambiguous anchor must be refused rather than replaced everywhere');

    check('mutate: a file the copy does not hold is refused',
      /is not in the tree/.test(applyMutation(dir, { file: 'lib/absent.mjs', find: 'x', replace: 'y' })),
      'a point naming a file the copy does not hold must say so');

    // cm:guard pinned against a file that really EXISTS outside the copy: with a missing path this
    //   passed on "is not in the tree" and left a `..` point free to overwrite the tree (ISS-30)
    const victim = join(outside, 'victim.txt');
    writeFileSync(victim, 'untouched\n');
    const escape = applyMutation(dir, {
      file: join('..', basename(outside), 'victim.txt'),
      find: 'untouched',
      replace: 'OVERWRITTEN',
    });
    check('mutate: a point resolving outside the copy is refused',
      /resolves outside the copy/.test(String(escape)),
      `expected a containment refusal, got ${JSON.stringify(escape)}`);
    check('mutate: a refused escape wrote nothing',
      readFileSync(victim, 'utf8') === 'untouched\n',
      `the file outside the copy now reads ${JSON.stringify(readFileSync(victim, 'utf8'))}`);

    check('mutate: a unique anchor is substituted, and nothing else is',
      applyMutation(dir, { file: rel, find: 'const b = 2;', replace: 'const b = 99;' }) === null
      && readFileSync(join(dir, rel), 'utf8') === 'const a = 1;\nconst b = 99;\nconst a = 3;\n',
      `after substitution the file read: ${JSON.stringify(readFileSync(join(dir, rel), 'utf8'))}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

// cm:guard the scrub is pinned by putting a poisoned environment THROUGH it, never an already-clean
//   one: against a clean process.env a strip loop that strips nothing also passes (ISS-30)
// cm:guard the poisoned environment starts from the SCRUBBED one and is given back only GIT_DIR:
//   from process.env it keeps GIT_INDEX_FILE and stages this fixture in the real index (ISS-30)
function gitEnvCases(check) {
  const victim = mkdtempSync(join(tmpdir(), 'cm-mutate-victim-'));
  const poisonedCopy = mkdtempSync(join(tmpdir(), 'cm-mutate-poisoned-'));
  const guardedCopy = mkdtempSync(join(tmpdir(), 'cm-mutate-guarded-'));
  try {
    const clean = stripGitEnv(process.env);
    const id = ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'];
    const run = (cwd, args, env) => execFileSync('git', ['-C', cwd, ...args],
      { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });

    run(victim, ['init', '-q'], clean);
    writeFileSync(join(victim, 'canary.txt'), 'original\n');
    run(victim, ['add', 'canary.txt'], clean);
    run(victim, [...id, 'commit', '-q', '-m', 'victim base'], clean);
    const before = run(victim, ['rev-parse', 'HEAD'], clean).trim();

    const poisoned = { ...clean, GIT_DIR: join(victim, '.git') };

    let leaked = false;
    try {
      writeFileSync(join(poisonedCopy, 'canary.txt'), 'MUTATED\n');
      run(poisonedCopy, ['init', '-q'], poisoned);
      run(poisonedCopy, ['add', '--', 'canary.txt'], poisoned);
      run(poisonedCopy, [...id, 'commit', '-q', '-m', 'poisoned'], poisoned);
      leaked = run(victim, ['rev-parse', 'HEAD'], clean).trim() !== before;
    } catch { leaked = false; }
    check('mutate: an inherited GIT_DIR really can reach another repository',
      leaked,
      'the positive control did not leak, so the case below proves nothing about the scrub');

    run(victim, [...id, 'reset', '-q', '--hard', before], clean);
    const restored = run(victim, ['rev-parse', 'HEAD'], clean).trim();

    let leakedAfterStrip = false;
    try {
      writeFileSync(join(guardedCopy, 'canary.txt'), 'MUTATED\n');
      const scrubbed = stripGitEnv(poisoned);
      run(guardedCopy, ['init', '-q'], scrubbed);
      run(guardedCopy, ['add', '--', 'canary.txt'], scrubbed);
      run(guardedCopy, [...id, 'commit', '-q', '-m', 'guarded'], scrubbed);
      leakedAfterStrip = run(victim, ['rev-parse', 'HEAD'], clean).trim() !== restored;
    } catch { leakedAfterStrip = true; }
    const canary = run(victim, ['show', 'HEAD:canary.txt'], clean).trim();
    check('mutate: stripGitEnv defuses the leak the control just demonstrated',
      !leakedAfterStrip && canary === 'original',
      `the same environment through stripGitEnv still reached the other repository: canary reads ${JSON.stringify(canary)}`);

    const poisonedConfig = {
      ...clean,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: '/nonexistent',
      GIT_CONFIG_PARAMETERS: "'core.hooksPath'='/nonexistent'",
    };
    const scrubbedConfig = stripGitEnv(poisonedConfig);
    const configSurvivors = Object.keys(scrubbedConfig)
      .filter((k) => /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(k));
    check('mutate: stripGitEnv removes the environment config channel',
      configSurvivors.length === 0,
      `git honours these from the environment, so they reach the copy: ${configSurvivors.join(', ')}`);

    // cm:guard a FIXED list, never the arrays the scrub iterates: reading those back catches a
    //   broken loop but never a shortened one, so dropping GIT_INDEX_FILE would pass (ISS-30)
    const MUST_NOT_SURVIVE = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
      'GIT_COMMON_DIR', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_TEMPLATE_DIR', 'GIT_NAMESPACE',
      'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS',
      'GIT_CONFIG_COUNT', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE',
      'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE'];
    const everything = { ...process.env };
    for (const k of MUST_NOT_SURVIVE) everything[k] = '/poison';
    // cm:guard these three are poisoned too, since the harness spawns its runs with the values the
    //   scrub sets: unpoisoned, this case could not fail during `node tests/mutate.mjs` (ISS-30)
    everything.GIT_CONFIG_GLOBAL = '/poison';
    everything.GIT_CONFIG_SYSTEM = '/poison';
    everything.GIT_CONFIG_NOSYSTEM = '0';
    const scrubbedAll = stripGitEnv(everything);
    const survivors = MUST_NOT_SURVIVE.filter((k) => k in scrubbedAll);
    check('mutate: stripGitEnv removes every location, config and identity variable',
      survivors.length === 0, `still present after the scrub: ${survivors.join(', ')}`);

    const named = new Set([...GIT_LOCATION_VAR_NAMES, ...GIT_CONFIG_VAR_NAMES,
      ...GIT_IDENTITY_VAR_NAMES]);
    const unnamed = MUST_NOT_SURVIVE.filter((k) => !named.has(k));
    check('mutate: the scrub names every variable this case requires it to remove',
      unnamed.length === 0,
      `the fixed list expects these but the module does not name them: ${unnamed.join(', ')}`);

    // cm:guard suppression is POINTING these at an empty file, not unsetting them: unsetting hands
    //   back a ~/.gitconfig the caller may be suppressing on purpose (ISS-30)
    check('mutate: stripGitEnv suppresses user and system config rather than unsetting it',
      scrubbedAll.GIT_CONFIG_GLOBAL === '/dev/null'
      && scrubbedAll.GIT_CONFIG_SYSTEM === '/dev/null'
      && scrubbedAll.GIT_CONFIG_NOSYSTEM === '1',
      `got GLOBAL=${scrubbedAll.GIT_CONFIG_GLOBAL} SYSTEM=${scrubbedAll.GIT_CONFIG_SYSTEM} NOSYSTEM=${scrubbedAll.GIT_CONFIG_NOSYSTEM}`);

    check('mutate: stripGitEnv leaves the rest of the environment alone',
      scrubbedAll.PATH === process.env.PATH,
      'the copy still has to be able to find git and node');
  } finally {
    for (const d of [victim, poisonedCopy, guardedCopy]) rmSync(d, { recursive: true, force: true });
  }
}

// cm:guard every text check below reads CODE ONLY: with comments left in, a rule written beside a
//   call site satisfies the check that the call site itself is missing (ISS-30)
// cm:guard scanned character by character, never by regex: this repository's corpus holds comment
//   delimiters inside STRING fixtures, which a block-comment regex reads as a comment start (ISS-30)
// cm:guard a trailing comment counts with no space before it: `,//env: GIT_ENV` slips past a leader
//   requiring whitespace, one space away from the assignment being pinned (ISS-30)
// cm:guard cli/lib/scan.mjs is NOT reused for this, though it scans comments for a living: the
//   declared point `flushopen-block` mutates it, so these checks would judge mutated code (ISS-30)
// cm:guard newlines inside a stripped comment are kept, so the output has the same line count as the
//   input: dropping them joins two statements and changes what parses (ISS-30)
const REGEX_KEYWORDS = ['return', 'typeof', 'case', 'in', 'of', 'void', 'new', 'delete', 'await',
  'yield', 'throw', 'instanceof', 'do', 'else'];

// cm:guard a keyword position starts a regex just as an operator does: with only the last character
//   considered, `return /[/*]/` reads as division and its `/*` swallows the rest of the file (ISS-30)
function startsRegex(out) {
  const t = out.replace(/\s+$/, '');
  if (t === '') return true;
  if ('(,=:[!&|?{};+-*%~^<>'.includes(t[t.length - 1])) return true;
  return REGEX_KEYWORDS.some((k) => new RegExp(`(^|[^\\w$])${k}$`).test(t));
}

function codeOnly(src) {
  let out = '';
  let i = 0;
  let state = 'code';
  let inClass = false;
  const frames = [];
  const keepNewlines = (from, to) => {
    for (let j = from; j < to && j < src.length; j++) if (src[j] === '\n') out += '\n';
  };
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') {
        const from = i;
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2;
        keepNewlines(from, i);
        continue;
      }
      if (c === "'" || c === '"') { state = c === "'" ? 'squote' : 'dquote'; out += c; i++; continue; }
      if (c === '`') { state = 'template'; out += c; i++; continue; }
      if (c === '/' && startsRegex(out)) { state = 'regex'; inClass = false; out += c; i++; continue; }
      // cm:guard the interpolation's own braces are counted, so a `}` inside `${}` does not close it
      //   early and drop the template's tail into code (ISS-30)
      if (c === '{' && frames.length) { frames[frames.length - 1].braces++; out += c; i++; continue; }
      if (c === '}' && frames.length) {
        if (frames[frames.length - 1].braces === 0) { frames.pop(); state = 'template'; }
        else frames[frames.length - 1].braces--;
        out += c; i++; continue;
      }
      out += c; i++; continue;
    }
    if (state === 'squote' || state === 'dquote') {
      const q = state === 'squote' ? "'" : '"';
      if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      out += c; i++;
      // cm:guard an unterminated string recovers at the newline instead of running to EOF, so one
      //   stray quote cannot hide the rest of the file from every check here (ISS-30)
      if (c === q || c === '\n') state = 'code';
      continue;
    }
    if (state === 'template') {
      if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === '$' && d === '{') { out += '${'; i += 2; frames.push({ braces: 0 }); state = 'code'; continue; }
      out += c; i++;
      if (c === '`') state = frames.length ? 'template' : 'code';
      continue;
    }
    if (state === 'regex') {
      if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      out += c; i++;
      // cm:guard a `/` inside a character class is not the terminator, and a regex never spans a line
      if (c === '\n' || (c === '/' && !inClass)) state = 'code';
      continue;
    }
  }
  return out;
}

// cm:guard the scanner is checked by PARSING its own output, not only by cases naming known gaps: a
//   gap that drops code leaves the rest unparseable, so this is loud where a case is silent (ISS-30)
function codeOnlyParsesCases(pluginRoot, check) {
  const dir = join(pluginRoot, 'tests');
  const probe = mkdtempSync(join(tmpdir(), 'cm-mutate-parse-'));
  try {
    const broken = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
      const out = join(probe, f);
      writeFileSync(out, codeOnly(readFileSync(join(dir, f), 'utf8')));
      const res = spawnSync(process.execPath, ['--check', out],
        { encoding: 'utf8', timeout: 30000, env: stripGitEnv(process.env) });
      if (res.status !== 0) broken.push(`${f}: ${(res.stderr ?? '').split('\n').slice(1, 3).join(' ').trim()}`);
    }
    check('mutate: stripping comments leaves every tests/ file still parseable',
      broken.length === 0,
      `codeOnly dropped code from these, so every text check reading them is blind to part of the `
      + `file: ${broken.join(' | ')}`);
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

// cm:guard no fixture here names the module or the word import: test data spelling either is
//   indistinguishable from a real import to the sweep below, which reported exactly that (ISS-30)
function codeOnlyCases(check) {
  const strip = (src) => codeOnly(src).replace(/\s+/g, ' ').trim();

  check('mutate: codeOnly drops a whole-line comment',
    strip('  // dropped\nconst a = 1;') === 'const a = 1;',
    `got ${JSON.stringify(strip('  // dropped\nconst a = 1;'))}`);

  check('mutate: codeOnly drops a trailing comment with no space before it',
    !codeOnly('x: 1,//env: GIT_ENV').includes('GIT_ENV'),
    `one space is the whole difference, so the leader cannot require whitespace: ${JSON.stringify(codeOnly('x: 1,//env: GIT_ENV'))}`);

  check('mutate: codeOnly drops an inline block comment',
    !codeOnly('a, /* env: GIT_ENV */ b').includes('GIT_ENV'),
    `got ${JSON.stringify(codeOnly('a, /* env: GIT_ENV */ b'))}`);

  // cm:guard the case this helper exists for: an unclosed block delimiter inside a STRING must not
  //   swallow the code after it, or code there leaves every check reading the file (ISS-30)
  const stringBorne = "const a = '/* oops unterminated';\nconst keep = 1;\nconst b = '/* closed */';";
  check('mutate: a comment delimiter inside a string does not blind the code after it',
    codeOnly(stringBorne).includes('const keep = 1'),
    `the code after a string-borne "/*" must survive: ${JSON.stringify(codeOnly(stringBorne))}`);

  check('mutate: codeOnly keeps a URL inside a string intact',
    codeOnly('const u = "https://example.com/a//b";').includes('https://example.com/a//b'),
    `a // inside a string is not a comment: ${JSON.stringify(codeOnly('const u = "https://example.com/a//b";'))}`);

  // cm:guard the terminator must not pair with an ESCAPED slash: `/a\//g` ends at the third slash,
  //   and treating the escaped one as the end leaves `/g; …` read as a comment (ISS-30)
  check('mutate: a regex ending in an escaped slash does not comment out its line',
    codeOnly('const re = /a\\//g; const k = 1;').includes('const k = 1'),
    `got ${JSON.stringify(codeOnly('const re = /a\\//g; const k = 1;'))}`);

  // cm:guard a `/` inside a character class is not the terminator, so `/[/*]/` must not open a block
  //   comment and swallow the rest of the file (ISS-30)
  check('mutate: a slash in a regex character class does not open a comment',
    codeOnly('function f(u){ return /[/*]/.test(u); }\nconst k = 1;').includes('const k = 1'),
    `got ${JSON.stringify(codeOnly('function f(u){ return /[/*]/.test(u); }\nconst k = 1;'))}`);

  check('mutate: a regex in a keyword position is read as a regex, not as division',
    codeOnly('function f(u){ return /x\\//.test(u); }\nconst k = 1;').includes('.test(u)'),
    `a slash after the return keyword starts a regex: ${JSON.stringify(codeOnly('function f(u){ return /x\\//.test(u); }\nconst k = 1;'))}`);

  // cm:guard a nested template inside `${}` must not close the outer one, or the tail of the line is
  //   read as code and its comment leader drops it (ISS-30)
  check('mutate: a nested template literal does not end the outer template',
    codeOnly('const h = `a ${`b //`} c`; const k = 1;').includes('const k = 1'),
    `got ${JSON.stringify(codeOnly('const h = `a ${`b //`} c`; const k = 1;'))}`);

  // cm:guard asserts a DROP, not a survival: when the escape is mishandled the string reopens and
  //   copies its tail verbatim, so asserting the tail survives passes either way (ISS-30)
  check('mutate: an escaped quote does not end its string',
    !codeOnly("const s = 'it\\'s a test'; // env: GIT_ENV\nconst k = 2;").includes('GIT_ENV'),
    `got ${JSON.stringify(codeOnly("const s = 'it\\'s a test'; // env: GIT_ENV\nconst k = 2;"))}`);

  check('mutate: codeOnly keeps the line count of its input',
    codeOnly('a;\n/* one\ntwo\nthree */\nb;').split('\n').length === 5,
    `stripping must not join statements: ${JSON.stringify(codeOnly('a;\n/* one\ntwo\nthree */\nb;'))}`);
}

// cm:guard the CLI half is read as TEXT here, and only for what running it cannot show; a regex over
//   the call site is gameable, since spawnSync or hoisted options walk past it (ISS-30)
function wiringCases(pluginRoot, check) {
  const cli = codeOnly(readFileSync(join(pluginRoot, 'tests', 'mutate.mjs'), 'utf8'));

  const execGit = (cli.match(/execFileSync\(\s*['"]git['"]/g) ?? []).length;
  const spawnGit = (cli.match(/spawnSync\(\s*['"]git['"]/g) ?? []).length;
  check('mutate: the harness invokes git from exactly one place',
    execGit === 1 && spawnGit === 0,
    `found ${execGit} execFileSync and ${spawnGit} spawnSync git call sites — every one has to go `
    + 'through the single wrapper that passes the scrubbed environment, or the scrub is bypassable');

  // cm:guard counting the call sites is not enough: a scrub that is COMPUTED and never passed leaves
  //   every one of them on the ambient environment, and nothing else here would notice (ISS-30)
  // cm:guard both children are read, the git wrapper and the corpus spawn: the second inherits this
  //   process's environment for a whole corpus run inside the copy (ISS-30)
  // cm:guard matched against codeOnly, never raw source: commenting the assignment out rather than
  //   deleting it keeps both of these checks green (ISS-30)
  const gitOptions = /execFileSync\(\s*['"]git['"][\s\S]{0,300}?\{([^}]*)\}/.exec(cli);
  const spawnOptions = /spawnSync\(\s*process\.execPath[\s\S]{0,300}?\{([^}]*)\}/.exec(cli);
  check('mutate: the git wrapper passes the scrubbed environment',
    Boolean(gitOptions) && /\benv:\s*GIT_ENV\b/.test(gitOptions[1]),
    `the one git call site must pass env: GIT_ENV, or GIT_DIR from a hook or a bisect reaches it: `
    + `options read as ${JSON.stringify(gitOptions && gitOptions[1].trim())}`);
  check('mutate: the corpus spawn passes the scrubbed environment',
    Boolean(spawnOptions) && /\benv:\s*GIT_ENV\b/.test(spawnOptions[1]),
    `the corpus child must pass env: GIT_ENV: options read as `
    + `${JSON.stringify(spawnOptions && spawnOptions[1].trim())}`);

  // cm:guard EVERY .mjs under tests/ is read, not a named few: a new tier importing the CLI half is
  //   otherwise unnoticed (ISS-30)
  // cm:guard the second pattern is for a CONCATENATED specifier, which a static-only match walks
  //   past; it is not dead code (ISS-30)
  // cm:guard the third rejects any dynamic import whose specifier is INTERPOLATED, because such a
  //   specifier cannot be read from the text at all — this file's own fixtures used that form (ISS-30)
  const dir = join(pluginRoot, 'tests');
  const importers = readdirSync(dir)
    .filter((f) => f.endsWith('.mjs') && f !== 'mutate.mjs')
    .filter((f) => {
      const src = codeOnly(readFileSync(join(dir, f), 'utf8'));
      return /(?:from|import)\s*\(?\s*['"`][^'"`]*mutate\.mjs['"`]/.test(src)
        || /import\s*\(\s*['"`][^'"`]*mutate['"`]\s*\+/.test(src)
        || /import\s*\(\s*[^)]*\$\{/.test(src);
    });
  check('mutate: nothing else under tests/ imports the half that spawns',
    importers.length === 0,
    `these import tests/mutate.mjs: ${importers.join(', ')} — the corpus would then hold a path to `
    + 'main, which spawns one whole corpus run per declared point');

  // cm:guard the entry-point check is the only thing between an import of the CLI half and a corpus
  //   run, so it is exercised: importing must print nothing and spawn nothing (ISS-30)
  // cm:guard the importer is a SCRIPT on disk, never `node -e`: under -e process.argv[1] is undefined
  //   and the check short-circuits, leaving the path comparison — the real defence — unrun (ISS-30)
  const probeDir = mkdtempSync(join(tmpdir(), 'cm-mutate-entry-'));
  try {
    const script = join(probeDir, 'import-the-cli.mjs');
    writeFileSync(script,
      `import ${JSON.stringify(join(dir, 'mutate.mjs'))};\nconsole.log('imported');\n`);
    const probe = spawnSync(process.execPath, [script],
      { encoding: 'utf8', timeout: 30000, env: stripGitEnv(process.env) });
    check('mutate: importing the half that spawns runs nothing',
      probe.status === 0 && /^imported\s*$/.test(probe.stdout ?? ''),
      `importing tests/mutate.mjs from a script must be inert: status=${probe.status} `
      + `stdout=${JSON.stringify((probe.stdout ?? '').slice(0, 200))} `
      + `stderr=${JSON.stringify((probe.stderr ?? '').slice(0, 200))}`);
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }

  // cm:guard `--no-optional-locks` is the whole claim to write NOTHING in the measured repository,
  //   read at the call site because no file under tests/ may import the half that performs it (ISS-30)
  const statusCalls = [...cli.matchAll(/git\(ROOT, \[([^\]]*)\]/g)]
    .map((m) => m[1])
    .filter((args) => args.includes("'status'"));
  check('mutate: every tree-state read passes --no-optional-locks',
    statusCalls.length > 0 && statusCalls.every((a) => a.includes("'--no-optional-locks'")),
    `found ${statusCalls.length} status call(s); a plain git status takes index.lock and rewrites `
    + `.git/index with a stat-cache refresh, which is a write in the tree being measured: ${statusCalls.join(' | ')}`);
}

function declaredListCases(check) {
  // cm:guard every other check here asserts a filter is empty, so all of them pass on an EMPTY list
  //   and the harness then reports success having measured nothing (ISS-30)
  check('mutate: the declared list is not empty',
    MUTATIONS.length > 0,
    'with no declared points every other check here is vacuous and the harness reports success');

  // cm:guard the declared list is the reviewed artefact, so its shape is checked rather than its
  //   contents: a point with no id or no anchor is a row that cannot be read (ISS-30)
  const shapeless = MUTATIONS.filter((m) => !m.id || !m.file || !m.find || m.replace === undefined
    || !m.mechanism);
  check('mutate: every declared point carries an id, a file, an anchor, a replacement and a mechanism',
    shapeless.length === 0, `incomplete: ${shapeless.map((m) => m.id ?? '(no id)').join(', ')}`);

  const ids = MUTATIONS.map((m) => m.id);
  check('mutate: declared ids are unique',
    new Set(ids).size === ids.length,
    `--only takes an id, so a duplicate makes one point unreachable: [${ids.join(', ')}]`);

  const sameText = MUTATIONS.filter((m) => m.find === m.replace);
  check('mutate: no declared point replaces its anchor with itself',
    sameText.length === 0,
    `a no-op mutation always reads DEAD: ${sameText.map((m) => m.id).join(', ')}`);

  const escaping = MUTATIONS.filter((m) => m.file.split('/').includes('..') || m.file.startsWith('/'));
  check('mutate: no declared point names a path outside the tree',
    escaping.length === 0,
    `these would be refused at run time, so they are dead rows: ${escaping.map((m) => m.id).join(', ')}`);
}

export function mutateCases(pluginRoot, check) {
  codeOnlyCases(check);
  codeOnlyParsesCases(pluginRoot, check);
  classifyCases(check);
  parseCases(check);
  anchorCases(check);
  gitEnvCases(check);
  wiringCases(pluginRoot, check);
  declaredListCases(check);
}
