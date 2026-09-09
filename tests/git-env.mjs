// Every tier below builds a throwaway repository and names it by path — `git -C <root>`, or
// `cwd: <root>`. Git resolves the environment BEFORE it resolves either, so a corpus run started
// from a git hook, a `git bisect run` or a `git rebase --exec` acted on whatever GIT_DIR named:
// the gate staged and committed into the repository it was run to protect (ISS-39).

const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_TEMPLATE_DIR', 'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX', 'GIT_DISCOVERY_ACROSS_FILESYSTEM'];

// cm:guard config reaches a child git through the ENVIRONMENT, not only files, so the location
//   variables alone are not enough: GIT_CONFIG_PARAMETERS still carries core.hooksPath in (ISS-39)
const GIT_CONFIG_VARS = ['GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];

// cm:guard a real pre-commit hook exports GIT_EXEC_PATH, and git prepends it to PATH for every
//   child it spawns, so a shim there is found by a hook the corpus is running (ISS-39)
// cm:why these change what a tier's `git init` CREATES or what its pathspecs MEAN, which is why
//   they belong with the location channel rather than being treated as cosmetic (ISS-39)
const GIT_BEHAVIOUR_VARS = ['GIT_EXEC_PATH', 'GIT_EDITOR', 'GIT_DEFAULT_HASH',
  'GIT_DEFAULT_REF_FORMAT', 'GIT_INDEX_VERSION', 'GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS', 'GIT_REPLACE_REF_BASE', 'GIT_NO_REPLACE_OBJECTS',
  'GIT_ATTR_SOURCE', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'GIT_TERMINAL_PROMPT'];

// cm:guard these outrank the GIT_AUTHOR_* a tier's own helper sets, so stripping has to happen
//   BEFORE the fixture identity is applied, never after (ISS-39)
const GIT_IDENTITY_VARS = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE'];

// cm:why GIT_TRACE* and GIT_TRACE2* are deliberately NOT stripped: they only add diagnostics to
//   stderr and change no outcome, and a corpus run is a reasonable thing to want to trace (ISS-39)

// cm:guard user and system config are pointed at an empty file, never deleted: deleting them
//   hands back a user config the caller may be suppressing on purpose (ISS-39)
// cm:guard safe.directory is re-injected through the command scope, which protected config also
//   reads: emptying global config alone makes the two real-checkout sites fail on ownership (ISS-39)
// cm:edge contract -> tests/git-env-cases.mjs — that tier holds its own literal copy of these four
//   lists and asserts set equality, so adding or removing a name here fails until it does too
export function stripGitEnv(env) {
  const out = { ...env };
  for (const k of [...GIT_LOCATION_VARS, ...GIT_CONFIG_VARS, ...GIT_BEHAVIOUR_VARS,
    ...GIT_IDENTITY_VARS]) delete out[k];
  for (const k of Object.keys(out)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)) delete out[k];
  }
  out.GIT_CONFIG_GLOBAL = '/dev/null';
  out.GIT_CONFIG_SYSTEM = '/dev/null';
  out.GIT_CONFIG_NOSYSTEM = '1';
  out.GIT_CONFIG_COUNT = '1';
  out.GIT_CONFIG_KEY_0 = 'safe.directory';
  out.GIT_CONFIG_VALUE_0 = '*';
  return out;
}

export const GIT_LOCATION_VAR_NAMES = GIT_LOCATION_VARS;
export const GIT_CONFIG_VAR_NAMES = GIT_CONFIG_VARS;
export const GIT_BEHAVIOUR_VAR_NAMES = GIT_BEHAVIOUR_VARS;
export const GIT_IDENTITY_VAR_NAMES = GIT_IDENTITY_VARS;
